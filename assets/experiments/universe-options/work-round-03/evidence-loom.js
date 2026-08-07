(() => {
  "use strict";

  const root = document.querySelector("[data-loom]");
  const field = root?.querySelector("[data-knot-field]");
  const fallbackRecords = [...document.querySelectorAll(".loom-record[data-project]")];
  if (!root || !field || fallbackRecords.length !== 16) return;

  const strandOrder = ["all", "platform", "constraint", "reliability", "evidence"];
  const strandLabels = Object.freeze({
    all: "Whole textile",
    platform: "Platform",
    constraint: "Product constraint",
    reliability: "Reliability",
    evidence: "Evidence"
  });
  const positions = Object.freeze([
    ["bitcoin-wallet", 31, 19, 29, 5],
    ["itvx", 46, 14, 70, 11],
    ["ocbc", 62, 22, 29, 17],
    ["openpay", 77, 14, 70, 23],
    ["mystc", 90, 25, 29, 29],
    ["littlepay", 84, 40, 70, 35],
    ["owto", 67, 38, 29, 40.5],
    ["popslide", 51, 43, 70, 46],
    ["websafety", 32, 40, 29, 51.5],
    ["solo", 25, 56, 70, 57],
    ["projectbass", 43, 60, 29, 62.5],
    ["ntu", 62, 57, 70, 68],
    ["aqua", 82, 63, 29, 73.5],
    ["persons-finder", 90, 80, 70, 79],
    ["orchestrum", 67, 78, 29, 84.5],
    ["mempalace", 44, 84, 70, 90]
  ].map(([id, x, y, mx, my]) => ({ id, x, y, mx, my })));
  const positionById = new Map(positions.map((position) => [position.id, position]));
  const tabletYById = Object.freeze({
    "bitcoin-wallet": 25,
    itvx: 12,
    ocbc: 24,
    openpay: 11,
    mystc: 26
  });

  const readProject = (article) => ({
    category: article.dataset.category,
    context: article.dataset.context,
    copy: article.querySelector("[data-project-copy]")?.textContent.trim() || "",
    evidence: [...article.querySelectorAll("[data-evidence]")].map((anchor) => ({
      href: anchor.getAttribute("href"),
      label: anchor.textContent.trim(),
      rel: anchor.getAttribute("rel"),
      target: anchor.getAttribute("target")
    })),
    id: article.dataset.project,
    name: article.dataset.name,
    ordinal: article.dataset.ordinal,
    ownership: article.dataset.ownership,
    proof: article.dataset.proof,
    strands: article.dataset.strands.trim().split(/\s+/).filter(Boolean)
  });

  const projects = fallbackRecords.map(readProject);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  if (projects.some((project) => !positionById.has(project.id))) return;

  const controls = [...root.querySelectorAll("[data-strand-control]")];
  const release = root.querySelector("[data-loom-release]");
  const status = root.querySelector("[data-loom-status]");
  const strandLines = new Map([...root.querySelectorAll("[data-strand-line]")].map((line) => [line.dataset.strandLine, line]));
  if (!release || !status || controls.length !== strandOrder.length || strandLines.size !== 4) return;

  const state = {
    project: null,
    strand: "all"
  };
  let previewProject = null;
  let previewStrand = null;
  const wrapperById = new Map();
  const buttonById = new Map();

  const createText = (tag, className, copy) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = copy;
    return element;
  };

  const createAnnotation = (project) => {
    const annotation = document.createElement("aside");
    annotation.className = "loom-annotation";
    annotation.id = `loom-note-${project.id}`;
    annotation.hidden = true;
    annotation.setAttribute("aria-label", `${project.name} project note`);
    annotation.append(createText("p", "", `${project.ordinal} / 16 · ${project.category}`));
    annotation.append(createText("h3", "", project.name));
    annotation.append(createText("p", "loom-annotation__context", project.context));
    annotation.append(createText("p", "loom-annotation__copy", project.copy));
    annotation.append(createText("p", "loom-annotation__strands", project.strands.map((strand) => strandLabels[strand]).join(" · ")));

    const links = document.createElement("div");
    links.className = "loom-annotation__links";
    project.evidence.forEach((record) => {
      const anchor = document.createElement("a");
      anchor.href = record.href;
      anchor.textContent = record.label;
      if (record.target) anchor.target = record.target;
      if (record.rel) anchor.rel = record.rel;
      links.append(anchor);
    });
    annotation.append(links);
    return annotation;
  };

  projects.forEach((project) => {
    const position = positionById.get(project.id);
    const wrapper = document.createElement("div");
    wrapper.className = "loom-knot-wrap";
    wrapper.dataset.project = project.id;
    wrapper.dataset.category = project.category;
    wrapper.dataset.strands = project.strands.join(" ");
    wrapper.style.setProperty("--x", `${position.x}%`);
    wrapper.style.setProperty("--y", `${position.y}%`);
    wrapper.style.setProperty("--mx", `${position.mx}%`);
    wrapper.style.setProperty("--my", `${position.my}%`);
    wrapper.style.setProperty("--ty", `${tabletYById[project.id] ?? position.y}%`);
    wrapper.classList.toggle("is-right", position.x > 71 || position.mx > 50);
    wrapper.classList.toggle("is-lower", position.y > 64 || position.my > 74);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "loom-knot";
    button.dataset.projectControl = project.id;
    button.setAttribute("aria-label", `${project.ordinal} of 16, ${project.name}, ${project.category}. Ownership: ${project.ownership}. Evidence: ${project.proof}.`);
    button.setAttribute("aria-describedby", `loom-note-${project.id}`);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-pressed", "false");

    const crossing = document.createElement("span");
    crossing.className = "loom-knot__crossing";
    crossing.setAttribute("aria-hidden", "true");
    crossing.append(document.createElement("i"));

    const brief = document.createElement("span");
    brief.className = "loom-knot__brief";
    brief.append(createText("strong", "loom-knot__name", project.name));
    brief.append(createText("span", "loom-knot__ownership", project.ownership));
    brief.append(createText("span", "loom-knot__proof", project.proof));

    button.append(crossing, brief);
    wrapper.append(button, createAnnotation(project));
    field.append(wrapper);
    wrapperById.set(project.id, wrapper);
    buttonById.set(project.id, button);
  });

  strandOrder.slice(1).forEach((strand) => {
    const count = projects.filter((project) => project.strands.includes(strand)).length;
    const output = root.querySelector(`[data-strand-count="${strand}"]`);
    if (output) output.textContent = `${count} crossing${count === 1 ? "" : "s"}`;
  });

  const effectiveStrand = () => previewStrand || state.strand;
  const visibleProject = () => previewProject || state.project;

  const render = () => {
    const strand = effectiveStrand();
    const shownProject = visibleProject();
    const selected = state.project ? projectById.get(state.project) : null;
    const shown = shownProject ? projectById.get(shownProject) : null;
    root.dataset.activeStrand = state.strand;
    root.dataset.renderStrand = strand;
    root.dataset.selectedProject = state.project || "";

    controls.forEach((button) => {
      const isSelected = button.dataset.strandControl === state.strand;
      button.setAttribute("aria-pressed", String(isSelected));
    });

    projects.forEach((project) => {
      const wrapper = wrapperById.get(project.id);
      const button = buttonById.get(project.id);
      const relevant = strand === "all" || project.strands.includes(strand);
      const isSelected = state.project === project.id;
      const isPreviewed = shownProject === project.id;
      wrapper.classList.toggle("is-muted", !relevant && !isSelected && !isPreviewed);
      wrapper.classList.toggle("is-relevant", relevant);
      wrapper.classList.toggle("is-selected", isSelected);
      wrapper.classList.toggle("is-previewed", isPreviewed);
      button.setAttribute("aria-pressed", String(isSelected));
      button.setAttribute("aria-expanded", String(isPreviewed));
      const annotation = wrapper.querySelector(".loom-annotation");
      annotation.hidden = !isPreviewed;
    });

    strandLines.forEach((line, id) => {
      line.classList.toggle("is-project-linked", Boolean(shown?.strands.includes(id)));
    });

    release.hidden = state.strand === "all" && !state.project;
    if (shown) {
      status.textContent = `${shown.name} · ${shown.ownership} · evidence: ${shown.proof}.`;
    } else if (strand !== "all") {
      const count = projects.filter((project) => project.strands.includes(strand)).length;
      status.textContent = `${strandLabels[strand]} strand · ${count} relevant project briefs illuminated.`;
    } else {
      status.textContent = "Whole textile · 16 readable project briefs · 18 canonical evidence links.";
    }
    document.title = selected ? `${selected.name} · Evidence Loom` : "Work Round 03 · Evidence Loom";
  };

  const writeUrl = (mode = "push") => {
    const url = new URL(window.location.href);
    if (state.strand === "all") url.searchParams.delete("strand");
    else url.searchParams.set("strand", state.strand);
    if (state.project) url.searchParams.set("project", state.project);
    else url.searchParams.delete("project");
    const historyState = { evidenceLoom: true, project: state.project, strand: state.strand };
    window.history[mode === "replace" ? "replaceState" : "pushState"](historyState, "", url);
  };

  const restoreFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const requestedStrand = params.get("strand");
    const requestedProject = params.get("project");
    state.strand = strandOrder.includes(requestedStrand) ? requestedStrand : "all";
    state.project = projectById.has(requestedProject) ? requestedProject : null;
    previewProject = null;
    previewStrand = null;
    render();
  };

  const chooseStrand = (strand) => {
    if (!strandOrder.includes(strand)) return;
    state.strand = strand;
    previewStrand = null;
    render();
    writeUrl();
  };

  const chooseProject = (id) => {
    if (!projectById.has(id)) return;
    state.project = state.project === id ? null : id;
    previewProject = id;
    render();
    writeUrl();
  };

  controls.forEach((button) => {
    const strand = button.dataset.strandControl;
    button.addEventListener("click", () => chooseStrand(strand));
    button.addEventListener("pointerenter", () => {
      previewStrand = strand;
      render();
    });
    button.addEventListener("pointerleave", () => {
      previewStrand = null;
      render();
    });
    button.addEventListener("focus", () => {
      previewStrand = strand;
      render();
    });
    button.addEventListener("blur", () => {
      previewStrand = null;
      render();
    });
  });

  root.querySelector(".loom-controls")?.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const current = Math.max(0, controls.indexOf(document.activeElement));
    const next = event.key === "Home" ? 0
      : event.key === "End" ? controls.length - 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (current - 1 + controls.length) % controls.length
          : (current + 1) % controls.length;
    controls[next].focus();
    event.preventDefault();
  });

  projects.forEach((project) => {
    const wrapper = wrapperById.get(project.id);
    const button = buttonById.get(project.id);
    button.addEventListener("click", () => chooseProject(project.id));
    wrapper.addEventListener("pointerenter", () => {
      previewProject = project.id;
      render();
    });
    wrapper.addEventListener("pointerleave", () => {
      previewProject = null;
      render();
    });
    wrapper.addEventListener("focusin", () => {
      previewProject = project.id;
      render();
    });
    wrapper.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (wrapper.contains(document.activeElement)) return;
        if (previewProject === project.id) previewProject = null;
        render();
      }, 0);
    });
  });

  field.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = projects.map((project) => buttonById.get(project.id));
    const current = Math.max(0, buttons.indexOf(document.activeElement));
    const next = event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (current - 1 + buttons.length) % buttons.length
          : (current + 1) % buttons.length;
    buttons[next].focus();
    event.preventDefault();
  });

  release.addEventListener("click", () => {
    state.project = null;
    state.strand = "all";
    previewProject = null;
    previewStrand = null;
    render();
    writeUrl();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || (state.strand === "all" && !state.project)) return;
    state.project = null;
    state.strand = "all";
    previewProject = null;
    previewStrand = null;
    render();
    writeUrl();
  });

  document.addEventListener("visibilitychange", () => {
    root.dataset.paused = String(document.hidden);
  });
  window.addEventListener("popstate", restoreFromUrl);

  restoreFromUrl();
  writeUrl("replace");
})();
