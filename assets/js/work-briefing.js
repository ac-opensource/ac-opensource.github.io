(function () {
  "use strict";

  const DEFAULT_BRIEF = "android-leadership";
  const BRIEFS = Object.freeze({
    "android-leadership": "Android leadership",
    "cross-platform-systems": "Cross-platform systems",
    "fintech-reliability": "Fintech reliability",
    "agent-first-delivery": "Agent-first delivery"
  });

  const briefing = document.querySelector("[data-work-briefing]");
  if (!briefing) return;
  const archiveDossier = document.querySelector("[data-work-archive-dossier]");

  const presets = Array.from(briefing.querySelectorAll("[data-brief-preset]"));
  const panels = Array.from(briefing.querySelectorAll("[data-brief-panel]"));
  const heading = briefing.querySelector("#briefing-title");
  const shareControls = briefing.querySelector("[data-brief-share]");
  const copyButton = briefing.querySelector("[data-brief-copy]");
  const status = briefing.querySelector("[data-brief-status]");
  if (!presets.length || !panels.length || !heading || !shareControls || !copyButton || !status) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let arrivalObserver = null;
  let routeFallback = 0;
  let routeSettledHandler = null;
  const briefRails = [];

  const validBrief = (value) => Object.prototype.hasOwnProperty.call(BRIEFS, value);

  function updateBriefRail(rail) {
    const cards = Array.from(rail.beats.children);
    if (!cards.length) return;
    const maxScroll = Math.max(0, rail.beats.scrollWidth - rail.beats.clientWidth);
    const centers = cards.map((card) => card.offsetLeft + card.offsetWidth / 2);
    const viewportCenter = rail.beats.scrollLeft + rail.beats.clientWidth / 2;
    const index = centers.reduce((closest, center, candidate) => (
      Math.abs(center - viewportCenter) < Math.abs(centers[closest] - viewportCenter) ? candidate : closest
    ), 0);
    rail.shell.dataset.railEnd = String(maxScroll <= 1 || rail.beats.scrollLeft >= maxScroll - 2);
    rail.shell.style.setProperty("--brief-rail-progress", `${((index + 1) / cards.length * 100).toFixed(3)}%`);
    rail.status.textContent = `${index + 1} / ${cards.length}${index + 1 < cards.length ? " · swipe" : " · complete"}`;
  }

  function createBriefRails() {
    panels.forEach((panel) => {
      const beats = panel.querySelector(".work-briefing__beats");
      if (!beats || beats.closest(".work-briefing__rail-shell")) return;
      const shell = document.createElement("div");
      shell.className = "work-briefing__rail-shell";
      beats.before(shell);
      shell.append(beats);
      const cue = document.createElement("p");
      cue.className = "work-briefing__rail-cue";
      cue.setAttribute("aria-hidden", "true");
      cue.innerHTML = '<span>Proof beats</span><i><b></b></i><span data-brief-rail-status>1 / 3 · swipe</span>';
      shell.append(cue);
      const rail = { beats, shell, status: cue.querySelector("[data-brief-rail-status]") };
      briefRails.push(rail);
      beats.addEventListener("scroll", () => updateBriefRail(rail), { passive: true });
      updateBriefRail(rail);
    });
  }

  function syncBriefRails() {
    window.requestAnimationFrame(() => briefRails.forEach(updateBriefRail));
  }

  function fragmentTarget() {
    if (!window.location.hash) return null;
    try {
      return document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    } catch {
      return document.getElementById(window.location.hash.slice(1));
    }
  }

  function briefFromFragment() {
    const panel = fragmentTarget()?.closest("[data-brief-panel]");
    return validBrief(panel?.dataset.briefPanel) ? panel.dataset.briefPanel : null;
  }

  function revealArchivedTarget() {
    const target = fragmentTarget();
    if (archiveDossier && target && (target === archiveDossier || archiveDossier.contains(target))) {
      archiveDossier.open = true;
      target.scrollIntoView({ behavior: "instant", block: "start" });
    }
  }

  function briefFromUrl() {
    const fragmentBrief = briefFromFragment();
    if (fragmentBrief) return fragmentBrief;
    const requested = new URL(window.location.href).searchParams.get("brief");
    return validBrief(requested) ? requested : DEFAULT_BRIEF;
  }

  function briefingUrl(brief, { absolute = false } = {}) {
    const url = new URL(window.location.href);
    url.searchParams.set("brief", brief);
    url.hash = "briefing";
    return absolute ? url.href : `${url.pathname}${url.search}${url.hash}`;
  }

  function setStatus(brief, message = "selected") {
    status.textContent = `${BRIEFS[brief]} briefing ${message}.`;
  }

  function applyBrief(brief, { historyMode = null } = {}) {
    const nextBrief = validBrief(brief) ? brief : DEFAULT_BRIEF;
    const previousBrief = validBrief(briefing.dataset.activeBrief)
      ? briefing.dataset.activeBrief
      : null;
    briefing.dataset.activeBrief = nextBrief;

    presets.forEach((preset) => {
      const selected = preset.dataset.briefPreset === nextBrief;
      preset.classList.toggle("is-active", selected);
      preset.setAttribute("role", "tab");
      preset.setAttribute("aria-selected", String(selected));
      preset.setAttribute("tabindex", selected ? "0" : "-1");
      if (selected) preset.setAttribute("aria-current", "true");
      else preset.removeAttribute("aria-current");
      const panel = panels.find((candidate) => candidate.dataset.briefPanel === preset.dataset.briefPreset);
      if (panel) preset.setAttribute("aria-controls", panel.id);
    });

    panels.forEach((panel) => {
      const selected = panel.dataset.briefPanel === nextBrief;
      panel.classList.toggle("is-active", selected);
      panel.hidden = !selected;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("tabindex", "0");
      const tab = presets.find((candidate) => candidate.dataset.briefPreset === panel.dataset.briefPanel);
      if (tab) {
        if (!tab.id) tab.id = `brief-tab-${panel.dataset.briefPanel}`;
        panel.setAttribute("aria-labelledby", tab.id);
      }
    });

    if (previousBrief !== nextBrief && (historyMode === "push" || historyMode === "replace")) {
      window.history[`${historyMode}State`]({
        ...(window.history.state || {}),
        workBrief: nextBrief
      }, "", briefingUrl(nextBrief));
    }

    setStatus(nextBrief);
    syncBriefRails();
  }

  function applyLocation() {
    applyBrief(briefFromUrl());
  }

  function focusDestination(target = heading) {
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }

  function focusTargetForDestination(target) {
    return target === briefing || target.id === "briefing" ? briefing : target;
  }

  function destinationForHash() {
    const target = fragmentTarget();
    if (target?.closest("[data-work-briefing]")) return target;
    return heading;
  }

  function arriveAtBriefing({ focus = false, target = destinationForHash() } = {}) {
    const panel = target.closest("[data-brief-panel]");
    if (validBrief(panel?.dataset.briefPanel)) applyBrief(panel.dataset.briefPanel);
    target.scrollIntoView({ behavior: "instant", block: target === heading ? "start" : "center" });
    if (focus) focusDestination(focusTargetForDestination(target));
    configureArrivalMotion({ immediate: true });
  }

  function universeArrivalActive() {
    return document.documentElement.dataset.universePerspective === "arriving"
      || document.documentElement.dataset.universeMotion === "arrive";
  }

  function waitForUniverseSettlement(callback) {
    if (routeSettledHandler) {
      document.removeEventListener("universe-perspective:settled", routeSettledHandler);
      routeSettledHandler = null;
    }
    window.clearTimeout(routeFallback);
    routeFallback = 0;
    if (reduceMotion.matches || !universeArrivalActive()) {
      callback();
      return;
    }
    briefing.dataset.briefMotion = "waiting-route";
    const settled = () => {
      if (routeSettledHandler !== settled) return;
      document.removeEventListener("universe-perspective:settled", routeSettledHandler);
      routeSettledHandler = null;
      window.clearTimeout(routeFallback);
      routeFallback = 0;
      callback();
    };
    routeSettledHandler = settled;
    document.addEventListener("universe-perspective:settled", settled, { once: true });
    routeFallback = window.setTimeout(settled, 900);
  }

  function finishArrivalMotion() {
    if (reduceMotion.matches) {
      briefing.dataset.briefMotion = "reduced";
      return;
    }
    briefing.dataset.briefMotion = "complete";
  }

  function beginArrivalMotion() {
    if (briefing.dataset.briefMotion !== "pending") return;
    arrivalObserver?.disconnect();
    arrivalObserver = null;
    if (universeArrivalActive()) {
      waitForUniverseSettlement(configureArrivalMotion);
      return;
    }
    briefing.dataset.briefMotion = "running";

    window.requestAnimationFrame(() => {
      const animations = typeof briefing.getAnimations === "function"
        ? briefing.getAnimations({ subtree: true })
        : [];
      if (!animations.length) {
        finishArrivalMotion();
        return;
      }
      Promise.allSettled(animations.map((animation) => animation.finished)).then(finishArrivalMotion);
    });
  }

  function configureArrivalMotion({ immediate = false } = {}) {
    arrivalObserver?.disconnect();
    arrivalObserver = null;

    if (reduceMotion.matches) {
      briefing.dataset.briefMotion = "reduced";
      return;
    }
    if (briefing.dataset.briefMotion === "complete") return;

    if (universeArrivalActive()) {
      waitForUniverseSettlement(configureArrivalMotion);
      return;
    }

    briefing.dataset.briefMotion = "pending";
    if (immediate) {
      beginArrivalMotion();
      return;
    }
    if (!("IntersectionObserver" in window)) {
      beginArrivalMotion();
      return;
    }
    arrivalObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) beginArrivalMotion();
    }, { rootMargin: "0px 0px -10%", threshold: 0.12 });
    arrivalObserver.observe(briefing);
  }

  async function copyBriefingLink() {
    const activeBrief = validBrief(briefing.dataset.activeBrief)
      ? briefing.dataset.activeBrief
      : DEFAULT_BRIEF;
    const shareUrl = briefingUrl(activeBrief, { absolute: true });
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const input = document.createElement("textarea");
        input.value = shareUrl;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        input.select();
        if (!document.execCommand("copy")) throw new Error("Copy command was unavailable.");
        input.remove();
      }
      setStatus(activeBrief, "link copied");
    } catch {
      window.history.replaceState({
        ...(window.history.state || {}),
        workBrief: activeBrief
      }, "", briefingUrl(activeBrief));
      setStatus(activeBrief, "link ready in the address bar");
    }
  }

  createBriefRails();
  briefing.querySelector("[data-brief-presets]")?.setAttribute("role", "tablist");
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement) || link.matches("[data-brief-preset]")) return;
    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin
      || destination.pathname !== window.location.pathname
      || destination.search !== window.location.search
      || !destination.hash) return;
    let target;
    try {
      target = document.getElementById(decodeURIComponent(destination.hash.slice(1)));
    } catch {
      target = document.getElementById(destination.hash.slice(1));
    }
    if (!target?.closest("[data-work-briefing]")) return;

    event.preventDefault();
    focusDestination(focusTargetForDestination(target));
    if (`${window.location.pathname}${window.location.search}${window.location.hash}`
      !== `${destination.pathname}${destination.search}${destination.hash}`) {
      window.history.pushState({ ...(window.history.state || {}), workBriefArrival: true }, "",
        `${destination.pathname}${destination.search}${destination.hash}`);
    }
    arriveAtBriefing({ focus: true, target });
  });
  presets.forEach((preset, index) => {
    preset.addEventListener("click", (event) => {
      event.preventDefault();
      applyBrief(preset.dataset.briefPreset, { historyMode: "push" });
    });
    preset.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + presets.length) % presets.length;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % presets.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = presets.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      const nextPreset = presets[nextIndex];
      applyBrief(nextPreset.dataset.briefPreset, { historyMode: "push" });
      nextPreset.focus();
    });
  });

  copyButton.addEventListener("click", copyBriefingLink);
  window.addEventListener("resize", syncBriefRails, { passive: true });
  window.addEventListener("popstate", () => {
    applyLocation();
    revealArchivedTarget();
  });
  window.addEventListener("hashchange", () => {
    applyLocation();
    revealArchivedTarget();
  });
  window.addEventListener("pageshow", () => {
    applyLocation();
    revealArchivedTarget();
  });

  const url = new URL(window.location.href);
  const requestedBrief = url.searchParams.get("brief");
  applyLocation();
  revealArchivedTarget();
  if (requestedBrief && !validBrief(requestedBrief)) {
    url.searchParams.delete("brief");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  shareControls.hidden = false;
  const initialTarget = fragmentTarget();
  const initialBriefingTarget = initialTarget?.closest("[data-work-briefing]") ? initialTarget : null;
  if (initialBriefingTarget) {
    waitForUniverseSettlement(() => arriveAtBriefing({ target: initialBriefingTarget }));
  } else {
    configureArrivalMotion();
  }
  if (typeof reduceMotion.addEventListener === "function") {
    reduceMotion.addEventListener("change", configureArrivalMotion);
  } else if (typeof reduceMotion.addListener === "function") {
    reduceMotion.addListener(configureArrivalMotion);
  }
})();
