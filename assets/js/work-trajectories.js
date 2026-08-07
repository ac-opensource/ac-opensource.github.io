(function () {
  "use strict";

  const STAGES = Object.freeze([
    { id: "problem", label: "Product problem" },
    { id: "architecture", label: "Shared core" },
    { id: "platform", label: "Platform implementation" },
    { id: "reliability", label: "Reliability" },
    { id: "release", label: "Verified release" },
    { id: "ai", label: "AI assist" }
  ]);

  const stageIds = new Set(STAGES.map(({ id }) => id));
  const stageLabels = new Map(STAGES.map(({ id, label }) => [id, label]));
  const stageControls = Array.from(document.querySelectorAll("[data-trajectory-controls] [data-stage]"));
  const consoleElement = document.querySelector("[data-trajectory-console]");
  const projectList = document.querySelector("[data-trajectory-projects]");
  const status = document.querySelector("[data-trajectory-status]");
  const position = document.querySelector("[data-trajectory-position]");
  const reset = document.querySelector("[data-trajectory-reset]");
  const previous = document.querySelector("[data-trajectory-previous]");
  const next = document.querySelector("[data-trajectory-next]");
  const jump = document.querySelector("[data-trajectory-jump]");
  const map = document.querySelector(".work-trajectory-map");
  const mapStatus = document.querySelector(".work-trajectory-map__status");
  const entries = Array.from(document.querySelectorAll("[data-portfolio-entry][data-trajectory-project]"))
    .map((element) => {
      const id = element.dataset.trajectoryProject || "";
      const heading = element.querySelector("h3");
      const stages = new Set((element.dataset.trajectoryStages || "").split(/\s+/).filter(Boolean));
      return {
        element,
        id,
        kind: element.dataset.trajectoryKind || "project",
        label: heading ? heading.textContent.trim() : id,
        stages
      };
    })
    .filter(({ id }) => id);
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (!stageControls.length || !consoleElement || !projectList || !entries.length) return;

  let state = { project: null, stage: null };
  let mapIsVisible = true;
  let pulseTimer = 0;

  function routeDot(stage, available, className = "work-trajectory-project__dot") {
    const dot = document.createElement("span");
    dot.className = `${className}${available ? " is-present" : ""}`;
    dot.dataset.routeStage = stage.id;
    dot.setAttribute("aria-hidden", "true");
    return dot;
  }

  function buildProjectRoutes() {
    const fragment = document.createDocumentFragment();
    entries.forEach((entry, index) => {
      const button = document.createElement("button");
      const label = document.createElement("span");
      const kind = document.createElement("span");
      const rail = document.createElement("span");
      const name = document.createElement("strong");

      button.type = "button";
      button.className = "work-trajectory-project";
      button.dataset.project = entry.id;
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-controls", entry.element.id);
      button.setAttribute("aria-label", `Select ${entry.label} trajectory, route ${index + 1} of ${entries.length}`);

      label.className = "work-trajectory-project__label";
      kind.className = "work-trajectory-project__kind";
      kind.textContent = `${String(index + 1).padStart(2, "0")} · ${entry.kind}`;
      name.textContent = entry.label;
      label.append(kind, name);

      rail.className = "work-trajectory-project__rail";
      STAGES.forEach((stage) => rail.append(routeDot(stage, entry.stages.has(stage.id))));
      button.append(label, rail);
      fragment.append(button);
    });
    projectList.append(fragment);
  }

  function buildEntryRoutes() {
    entries.forEach((entry, index) => {
      const route = document.createElement("div");
      const label = document.createElement("span");
      const rail = document.createElement("span");
      const availableLabels = STAGES
        .filter(({ id }) => id !== "ai" && entry.stages.has(id))
        .map(({ label: stageLabel }) => stageLabel);

      route.className = "mission-entry-route";
      route.setAttribute("aria-hidden", "true");
      label.className = "mission-entry-route__label";
      label.textContent = `${String(index + 1).padStart(2, "0")} / ${entry.kind} / ${availableLabels.join(" → ")}${entry.stages.has("ai") ? " / + bounded AI assist" : ""}`;
      rail.className = "mission-entry-route__rail";
      STAGES.forEach((stage) => rail.append(routeDot(stage, entry.stages.has(stage.id), "mission-entry-route__dot")));
      route.append(label, rail);
      entry.element.prepend(route);
    });
  }

  function normalizedState(candidate) {
    return {
      project: candidate.project && entriesById.has(candidate.project) ? candidate.project : null,
      stage: candidate.stage && stageIds.has(candidate.stage) ? candidate.stage : null
    };
  }

  function projectFromHash(hash = window.location.hash) {
    let decoded = "";
    try {
      decoded = decodeURIComponent(hash.replace(/^#/, ""));
    } catch {
      return null;
    }
    if (!decoded.startsWith("project-")) return null;
    const project = decoded.slice("project-".length);
    return entriesById.has(project) ? project : null;
  }

  function isManagedProjectHash(hash) {
    try {
      return decodeURIComponent(hash.replace(/^#/, "")).startsWith("project-");
    } catch {
      return hash.startsWith("#project-");
    }
  }

  function stateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return normalizedState({
      project: params.get("project") || projectFromHash(),
      stage: params.get("stage")
    });
  }

  function stateUrl(nextState) {
    const url = new URL(window.location.href);
    if (nextState.project) {
      url.searchParams.set("project", nextState.project);
      url.hash = `project-${nextState.project}`;
    } else {
      url.searchParams.delete("project");
      if (isManagedProjectHash(url.hash)) url.hash = "";
    }
    if (nextState.stage) url.searchParams.set("stage", nextState.stage);
    else url.searchParams.delete("stage");
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function includesStage(element, stage) {
    return (element.dataset.trajectoryStage || "").split(/\s+/).includes(stage);
  }

  function routeDescription(entry) {
    const primary = STAGES
      .filter(({ id }) => id !== "ai" && entry.stages.has(id))
      .map(({ label }) => label)
      .join(", ");
    return `${primary}${entry.stages.has("ai") ? ", with bounded AI assistance" : ""}`;
  }

  function updateEntryState() {
    entries.forEach((entry) => {
      const selected = state.project === entry.id;
      const stageMatch = Boolean(state.stage && entry.stages.has(state.stage));
      entry.element.classList.toggle("is-project-selected", selected);
      entry.element.classList.toggle("is-project-context", Boolean(state.project && !selected));
      entry.element.classList.toggle("is-stage-match", stageMatch);
      entry.element.classList.toggle("is-stage-context", Boolean(state.stage && !stageMatch));

      entry.element.querySelectorAll("[data-trajectory-stage]").forEach((element) => {
        const hit = Boolean(state.stage && includesStage(element, state.stage));
        element.classList.toggle("is-trajectory-hit", hit);
        element.classList.toggle("is-trajectory-muted", Boolean(state.stage && !hit));
      });
    });
  }

  function updateControls() {
    stageControls.forEach((control) => {
      const selected = control.dataset.stage === state.stage;
      control.classList.toggle("is-selected", selected);
      control.setAttribute("aria-pressed", String(selected));
    });

    projectList.querySelectorAll("[data-project]").forEach((control) => {
      const entry = entriesById.get(control.dataset.project || "");
      const selected = Boolean(entry && entry.id === state.project);
      const stageMatch = Boolean(entry && state.stage && entry.stages.has(state.stage));
      control.classList.toggle("is-selected", selected);
      control.classList.toggle("is-context", Boolean(state.project && !selected));
      control.classList.toggle("is-stage-match", stageMatch);
      control.classList.toggle("is-stage-context", Boolean(state.stage && !stageMatch));
      control.setAttribute("aria-pressed", String(selected));
      control.querySelectorAll("[data-route-stage]").forEach((dot) => {
        dot.classList.toggle("is-active", dot.dataset.routeStage === state.stage);
      });
    });

    entries.forEach((entry) => {
      entry.element.querySelectorAll(".mission-entry-route [data-route-stage]").forEach((dot) => {
        dot.classList.toggle("is-active", dot.dataset.routeStage === state.stage);
      });
    });
  }

  function updateReadout() {
    const entry = state.project ? entriesById.get(state.project) : null;
    const index = entry ? entries.indexOf(entry) : -1;
    const active = Boolean(entry || state.stage);
    reset.disabled = !active;

    if (entry && state.stage) {
      const hitCount = entry.element.querySelectorAll("[data-trajectory-stage].is-trajectory-hit").length;
      const neighboringRoutes = entries.filter((candidate) => candidate !== entry && candidate.stages.has(state.stage)).length;
      status.textContent = entry.stages.has(state.stage)
        ? `${entry.label} · ${stageLabels.get(state.stage)}: ${hitCount} exact evidence points in this record; ${neighboringRoutes} other projects also carry this phase. Delivery path: ${routeDescription(entry)}.`
        : `${entry.label} · ${stageLabels.get(state.stage)}: no explicitly tagged evidence for this phase; ${neighboringRoutes} other projects carry it.`;
      position.textContent = `Project ${index + 1} of ${entries.length} · ${entry.label}`;
      previous.disabled = index <= 0;
      next.disabled = index >= entries.length - 1;
      jump.hidden = false;
      jump.href = `#${entry.element.id}`;
      mapStatus.lastChild.textContent = " Evidence aligned";
      return;
    }

    if (entry) {
      status.textContent = `${entry.label}: ${routeDescription(entry)}.`;
      position.textContent = `Project ${index + 1} of ${entries.length} · ${entry.label}`;
      previous.disabled = index <= 0;
      next.disabled = index >= entries.length - 1;
      jump.hidden = false;
      jump.href = `#${entry.element.id}`;
      mapStatus.lastChild.textContent = " Project evidence";
      return;
    }

    jump.hidden = true;
    previous.disabled = true;
    next.disabled = false;
    position.textContent = `Project 0 of ${entries.length} · no project selected`;
    if (state.stage) {
      const matching = entries.filter((candidate) => candidate.stages.has(state.stage));
      status.textContent = `${stageLabels.get(state.stage)}: ${matching.length} of ${entries.length} projects carry explicit evidence in this phase.`;
      mapStatus.lastChild.textContent = " Shared practice";
    } else {
      status.textContent = "Production apps, earlier platforms, and public builds—with roles, outcomes, images, and evidence.";
      mapStatus.lastChild.textContent = " Production practice";
    }
  }

  function pulseTrajectory() {
    window.clearTimeout(pulseTimer);
    map?.classList.remove("is-trajectory-pulsing");
    if (!map || !mapIsVisible || document.hidden || prefersReducedMotion.matches) return;
    map.getBoundingClientRect();
    map.classList.add("is-trajectory-pulsing");
    pulseTimer = window.setTimeout(() => map.classList.remove("is-trajectory-pulsing"), 720);
  }

  function applyState(candidate, { historyMode = null, pulse = false } = {}) {
    state = normalizedState(candidate);
    document.documentElement.classList.toggle("has-trajectory-focus", Boolean(state.project || state.stage));
    document.documentElement.dataset.trajectoryMode = state.project && state.stage
      ? "combined"
      : state.project ? "project" : state.stage ? "stage" : "default";
    document.documentElement.dataset.trajectoryProject = state.project || "";
    document.documentElement.dataset.trajectoryStage = state.stage || "";
    updateEntryState();
    updateControls();
    updateReadout();

    if (historyMode === "push" || historyMode === "replace") {
      window.history[`${historyMode}State`]({
        ...(window.history.state || {}),
        trajectory: state
      }, "", stateUrl(state));
    }
    if (pulse) pulseTrajectory();
  }

  function selectAdjacentProject(offset) {
    const currentIndex = state.project ? entries.findIndex(({ id }) => id === state.project) : -1;
    const nextIndex = currentIndex < 0 ? (offset > 0 ? 0 : -1) : currentIndex + offset;
    if (nextIndex < 0 || nextIndex >= entries.length) return;
    applyState({ project: entries[nextIndex].id, stage: state.stage }, { historyMode: "push", pulse: true });
    projectList.querySelector(`[data-project="${entries[nextIndex].id}"]`)?.focus({ preventScroll: true });
  }

  function updateMotionState() {
    map?.classList.toggle("is-trajectory-paused", document.hidden || !mapIsVisible);
    if (document.hidden || !mapIsVisible || prefersReducedMotion.matches) {
      window.clearTimeout(pulseTimer);
      map?.classList.remove("is-trajectory-pulsing");
    }
  }

  buildProjectRoutes();
  buildEntryRoutes();
  document.querySelectorAll("[data-trajectory-controls], [data-trajectory-console]").forEach((element) => {
    element.hidden = false;
  });

  stageControls.forEach((control, index) => {
    control.addEventListener("click", () => {
      const nextStage = control.dataset.stage || null;
      applyState({
        project: state.project,
        stage: state.stage === nextStage ? null : nextStage
      }, { historyMode: "push", pulse: true });
    });
    control.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      stageControls[(index + direction + stageControls.length) % stageControls.length].focus();
    });
  });

  projectList.addEventListener("click", (event) => {
    const control = event.target.closest("[data-project]");
    if (!control) return;
    const project = control.dataset.project || null;
    applyState({
      project: state.project === project ? null : project,
      stage: state.stage
    }, { historyMode: "push", pulse: true });
  });

  reset.addEventListener("click", () => applyState({}, { historyMode: "push", pulse: true }));
  previous.addEventListener("click", () => selectAdjacentProject(-1));
  next.addEventListener("click", () => selectAdjacentProject(1));
  window.addEventListener("popstate", () => applyState(stateFromUrl()));
  window.addEventListener("hashchange", () => applyState(stateFromUrl()));
  window.addEventListener("pageshow", () => applyState(stateFromUrl()));
  document.addEventListener("visibilitychange", updateMotionState);
  prefersReducedMotion.addEventListener?.("change", updateMotionState);

  if ("IntersectionObserver" in window && map) {
    const observer = new IntersectionObserver(([entry]) => {
      mapIsVisible = Boolean(entry && entry.isIntersecting);
      updateMotionState();
    }, { threshold: 0.05 });
    observer.observe(map);
  }

  const initialState = stateFromUrl();
  applyState(initialState);
  const canonicalUrl = stateUrl(initialState);
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (canonicalUrl !== currentUrl) {
    window.history.replaceState({
      ...(window.history.state || {}),
      trajectory: initialState
    }, "", canonicalUrl);
  }
  updateMotionState();
})();
