(() => {
  const root = document.documentElement;
  root.classList.remove("no-js");
  root.classList.add("js");

  const theater = document.querySelector("[data-theater]");
  if (!theater) return;

  const scenes = [...theater.querySelectorAll("[data-scene]")];
  const counter = document.querySelector("[data-counter]");
  const status = theater.querySelector("[data-status]");
  const positionLabel = theater.querySelector("[data-position-label]");
  const positionButtons = [...theater.querySelectorAll("[data-position-button]")];
  const previousButton = theater.querySelector("[data-previous]");
  const nextButton = theater.querySelector("[data-next]");
  const indexByProject = new Map(scenes.map((scene, index) => [scene.dataset.project, index]));

  if (!scenes.length) return;

  let activeIndex = 0;
  let swipeStart = null;

  const wrap = (index) => (index + scenes.length) % scenes.length;

  const indexFromHash = () => {
    const project = decodeURIComponent(window.location.hash.slice(1));
    return indexByProject.has(project) ? indexByProject.get(project) : null;
  };

  const historyUrl = (scene) => {
    const url = new URL(window.location.href);
    url.hash = scene.dataset.project;
    return `${url.pathname}${url.search}${url.hash}`;
  };

  const showScene = (requestedIndex, { historyMode = "push", direction } = {}) => {
    const nextIndex = wrap(requestedIndex);
    const nextScene = scenes[nextIndex];
    const inferredDirection = nextIndex === activeIndex ? "forward" : nextIndex > activeIndex ? "forward" : "backward";

    theater.dataset.direction = direction || inferredDirection;
    theater.dataset.project = nextScene.dataset.project;
    theater.dataset.kind = nextScene.dataset.kind;

    scenes.forEach((scene, index) => {
      const isActive = index === nextIndex;
      scene.classList.toggle("is-active", isActive);
      scene.setAttribute("aria-hidden", String(!isActive));
      if ("inert" in scene) scene.inert = !isActive;
    });

    positionButtons.forEach((button) => {
      const isCurrent = button.dataset.positionButton === nextScene.dataset.project;
      if (isCurrent) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });

    activeIndex = nextIndex;
    const number = String(nextIndex + 1).padStart(2, "0");
    const title = nextScene.dataset.title;
    const kind = nextScene.dataset.kind;

    if (counter) counter.textContent = `${number} / ${scenes.length}`;
    if (positionLabel) positionLabel.textContent = `${number} · ${title}`;
    if (status) status.textContent = `${title} · ${kind} · scene ${nextIndex + 1} of ${scenes.length}`;

    nextScene.scrollTop = 0;

    if (historyMode === "replace") {
      window.history.replaceState({ project: nextScene.dataset.project }, "", historyUrl(nextScene));
    } else if (historyMode === "push" && indexFromHash() !== nextIndex) {
      window.history.pushState({ project: nextScene.dataset.project }, "", historyUrl(nextScene));
    }
  };

  const move = (delta) => {
    showScene(activeIndex + delta, {
      direction: delta < 0 ? "backward" : "forward",
    });
  };

  previousButton?.addEventListener("click", () => move(-1));
  nextButton?.addEventListener("click", () => move(1));

  positionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const index = indexByProject.get(button.dataset.positionButton);
      if (index === undefined) return;
      showScene(index, { direction: index < activeIndex ? "backward" : "forward" });
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']")) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      move(1);
    } else if (event.key === "Home") {
      event.preventDefault();
      showScene(0, { direction: "backward" });
    } else if (event.key === "End") {
      event.preventDefault();
      showScene(scenes.length - 1, { direction: "forward" });
    }
  });

  theater.addEventListener("pointerdown", (event) => {
    if (event.isPrimary === false || event.button > 0 || event.target.closest("a, button")) return;
    if (event.pointerType === "mouse") event.preventDefault();
    swipeStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
    };
  });

  theater.addEventListener("pointercancel", () => {
    swipeStart = null;
  });

  theater.addEventListener("pointerup", (event) => {
    if (!swipeStart || event.pointerId !== swipeStart.id) return;

    const deltaX = event.clientX - swipeStart.x;
    const deltaY = event.clientY - swipeStart.y;
    const elapsed = performance.now() - swipeStart.time;
    swipeStart = null;

    if (elapsed > 900 || Math.abs(deltaX) < 55 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return;
    move(deltaX < 0 ? 1 : -1);
  });

  window.addEventListener("popstate", () => {
    const index = indexFromHash();
    showScene(index ?? 0, {
      historyMode: "none",
      direction: (index ?? 0) < activeIndex ? "backward" : "forward",
    });
  });

  const initialIndex = indexFromHash() ?? 0;
  showScene(initialIndex, { historyMode: "replace", direction: "forward" });
})();
