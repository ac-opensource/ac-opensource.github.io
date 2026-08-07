(() => {
  const root = document.documentElement;
  const atlas = document.querySelector("[data-atlas]");
  if (!atlas) return;

  const viewport = atlas.querySelector("[data-viewport]");
  const canvas = atlas.querySelector("[data-canvas]");
  const worlds = [...atlas.querySelectorAll("[data-world]")];
  const previousButton = atlas.querySelector("[data-previous]");
  const nextButton = atlas.querySelector("[data-next]");
  const returnButton = atlas.querySelector("[data-return]");
  const position = atlas.querySelector("[data-position]");
  const status = atlas.querySelector("[data-status]");
  const indexByProject = new Map(worlds.map((world, index) => [world.dataset.project, index]));

  if (!viewport || !canvas || !worlds.length) return;

  const canvasWidth = 3200;
  const canvasHeight = 2200;
  let activeIndex = null;
  let gesture = null;
  let resizeFrame = 0;

  const configuredScale = (property) => {
    const value = Number.parseFloat(getComputedStyle(root).getPropertyValue(property));
    return Number.isFinite(value) ? value : 1;
  };

  const setCanvasTransform = (x, y, scale) => {
    atlas.style.setProperty("--canvas-x", `${x}px`);
    atlas.style.setProperty("--canvas-y", `${y}px`);
    atlas.style.setProperty("--canvas-scale", String(scale));
  };

  const positionOverview = () => {
    const scale = configuredScale("--overview-scale");
    const x = (viewport.clientWidth - canvasWidth * scale) / 2;
    const y = (viewport.clientHeight - canvasHeight * scale) / 2;
    setCanvasTransform(x, y, scale);
  };

  const positionFocusedWorld = (world) => {
    const scale = configuredScale("--focus-scale");
    const focusY = matchMedia("(max-width: 700px)").matches ? 0.43 : 0.5;
    const x = viewport.clientWidth / 2 - Number(world.dataset.x) * scale;
    const y = viewport.clientHeight * focusY - Number(world.dataset.y) * scale;
    setCanvasTransform(x, y, scale);
  };

  const projectFromLocation = () => {
    const prefix = "#world-";
    if (!window.location.hash.startsWith(prefix)) return null;
    const project = decodeURIComponent(window.location.hash.slice(prefix.length));
    return indexByProject.has(project) ? project : null;
  };

  const locationForProject = (project) => {
    const url = new URL(window.location.href);
    url.hash = `world-${project}`;
    return `${url.pathname}${url.search}${url.hash}`;
  };

  const overviewLocation = () => {
    const url = new URL(window.location.href);
    url.hash = "";
    return `${url.pathname}${url.search}`;
  };

  const setWorldAccessibility = (world, isActive, isOverview) => {
    const trigger = world.querySelector("[data-world-trigger]");
    const satellites = world.querySelector("[data-world-satellites]");
    const links = [...world.querySelectorAll("[data-evidence-link]")];

    trigger?.setAttribute("aria-pressed", String(isActive));
    if (isActive) trigger?.setAttribute("aria-current", "true");
    else trigger?.removeAttribute("aria-current");
    if (trigger) trigger.tabIndex = isOverview || isActive ? 0 : -1;

    satellites?.setAttribute("aria-hidden", String(!isActive));
    if (satellites && "inert" in satellites) satellites.inert = !isActive;
    links.forEach((link) => {
      link.tabIndex = isActive ? 0 : -1;
    });
  };

  const writeHistory = (project, mode) => {
    if (mode === "none") return;
    const url = project ? locationForProject(project) : overviewLocation();
    const state = project ? { project } : { project: null };
    if (mode === "replace") window.history.replaceState(state, "", url);
    else window.history.pushState(state, "", url);
  };

  const showOverview = ({ historyMode = "push", restoreFocus = false } = {}) => {
    const previousWorld = activeIndex === null ? null : worlds[activeIndex];
    activeIndex = null;
    atlas.dataset.mode = "overview";
    atlas.removeAttribute("data-project");
    atlas.removeAttribute("data-kind");

    worlds.forEach((world) => {
      world.classList.remove("is-active");
      setWorldAccessibility(world, false, true);
    });

    returnButton.hidden = true;
    position.textContent = "OVERVIEW · 16 WORLDS";
    status.textContent = "Atlas overview. Choose any authored project world.";
    positionOverview();
    writeHistory(null, historyMode);

    if (restoreFocus) previousWorld?.querySelector("[data-world-trigger]")?.focus({ preventScroll: true });
  };

  const showWorld = (requestedIndex, { historyMode = "push", focusTrigger = false } = {}) => {
    const nextIndex = (requestedIndex + worlds.length) % worlds.length;
    const world = worlds[nextIndex];
    const project = world.dataset.project;

    activeIndex = nextIndex;
    atlas.dataset.mode = "focus";
    atlas.dataset.project = project;
    atlas.dataset.kind = world.dataset.kind;

    worlds.forEach((candidate, index) => {
      const isActive = index === nextIndex;
      candidate.classList.toggle("is-active", isActive);
      setWorldAccessibility(candidate, isActive, false);
    });

    returnButton.hidden = false;
    position.textContent = `${world.dataset.ordinal} / ${String(worlds.length).padStart(2, "0")} · ${world.dataset.kind.toUpperCase()}`;
    status.textContent = `${world.dataset.title} world focused. Its real surfaces, role, system record, and evidence are in orbit.`;
    positionFocusedWorld(world);

    if (projectFromLocation() !== project) writeHistory(project, historyMode);
    if (focusTrigger) world.querySelector("[data-world-trigger]")?.focus({ preventScroll: true });
  };

  const move = (delta, focusTrigger = false) => {
    const start = activeIndex === null ? (delta < 0 ? worlds.length : -1) : activeIndex;
    showWorld(start + delta, { focusTrigger });
  };

  worlds.forEach((world, index) => {
    world.querySelector("[data-world-trigger]")?.addEventListener("click", () => {
      if (activeIndex === index) return;
      showWorld(index);
    });
  });

  previousButton?.addEventListener("click", () => move(-1));
  nextButton?.addEventListener("click", () => move(1));
  returnButton?.addEventListener("click", () => showOverview({ restoreFocus: true }));

  window.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']")) return;

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(-1, true);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(1, true);
    } else if (event.key === "Home") {
      event.preventDefault();
      showWorld(0, { focusTrigger: true });
    } else if (event.key === "End") {
      event.preventDefault();
      showWorld(worlds.length - 1, { focusTrigger: true });
    } else if (event.key === "Escape" && activeIndex !== null) {
      event.preventDefault();
      showOverview({ restoreFocus: true });
    }
  });

  viewport.addEventListener("pointerdown", (event) => {
    if (event.isPrimary === false || event.button > 0 || event.target.closest("a, button")) return;
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
    };
  });

  viewport.addEventListener("pointercancel", () => {
    gesture = null;
  });

  viewport.addEventListener("pointerup", (event) => {
    if (!gesture || gesture.id !== event.pointerId) return;

    const deltaX = event.clientX - gesture.x;
    const deltaY = event.clientY - gesture.y;
    const elapsed = performance.now() - gesture.time;
    gesture = null;

    if (elapsed > 1100 || Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 48) return;
    if (Math.abs(deltaX) >= Math.abs(deltaY)) move(deltaX < 0 ? 1 : -1);
    else move(deltaY < 0 ? 1 : -1);
  });

  const syncFromLocation = () => {
    const project = projectFromLocation();
    if (!project) {
      showOverview({ historyMode: "none" });
      return;
    }
    showWorld(indexByProject.get(project), { historyMode: "none" });
  };

  window.addEventListener("popstate", syncFromLocation);

  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (activeIndex === null) positionOverview();
      else positionFocusedWorld(worlds[activeIndex]);
    });
  });

  syncFromLocation();
})();
