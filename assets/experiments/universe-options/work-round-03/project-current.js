(() => {
  const current = document.querySelector("[data-current]");
  if (!current) return;

  const projects = [...current.querySelectorAll("[data-project]")];
  const status = current.querySelector("[data-current-status]");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let activeIndex = null;

  if (!projects.length) return;

  const titleFor = (project) => project.querySelector(".segment-copy strong")?.textContent.trim() || "Project";

  const writeStatus = (message) => {
    if (status) status.textContent = message;
  };

  const setActive = (index, { focus = false } = {}) => {
    const nextIndex = (index + projects.length) % projects.length;
    activeIndex = nextIndex;

    projects.forEach((project, projectIndex) => {
      const active = projectIndex === nextIndex;
      const trigger = project.querySelector("[data-project-trigger]");
      project.classList.toggle("is-active", active);
      trigger?.setAttribute("aria-pressed", String(active));
    });

    const project = projects[nextIndex];
    writeStatus(`${titleFor(project)} emphasized · ${project.dataset.kind} · project ${nextIndex + 1} of ${projects.length}. Its role, system, and evidence remain visible in the band.`);
    if (focus) project.querySelector("[data-project-trigger]")?.focus({ preventScroll: false });
  };

  const release = () => {
    activeIndex = null;
    projects.forEach((project) => {
      project.classList.remove("is-active");
      project.querySelector("[data-project-trigger]")?.setAttribute("aria-pressed", "false");
    });
    writeStatus("All 16 projects, roles, systems, and evidence links are visible in the native-scroll index.");
  };

  projects.forEach((project, index) => {
    const trigger = project.querySelector("[data-project-trigger]");
    const annotation = project.querySelector("[data-project-annotation]");

    trigger?.removeAttribute("disabled");
    trigger?.removeAttribute("aria-expanded");
    trigger?.setAttribute("aria-pressed", "false");
    trigger?.setAttribute("aria-label", `Emphasize ${titleFor(project)}, ${project.dataset.kind} project`);
    annotation?.setAttribute("aria-hidden", "false");
    if (annotation && "inert" in annotation) annotation.inert = false;

    trigger?.addEventListener("click", () => {
      if (activeIndex === index) release();
      else setActive(index);
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']")) return;

    const focusedTrigger = event.target instanceof HTMLElement
      ? event.target.closest("[data-project-trigger]")
      : null;
    const traversalKey = event.key === "ArrowLeft"
      || event.key === "ArrowRight"
      || event.key === "ArrowUp"
      || event.key === "ArrowDown"
      || event.key === "Home"
      || event.key === "End";
    if (traversalKey && !focusedTrigger) return;
    const focusedProject = focusedTrigger?.closest("[data-project]");
    const focusedIndex = focusedProject ? projects.indexOf(focusedProject) : -1;
    const traversalIndex = activeIndex === null ? focusedIndex : activeIndex;

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(traversalIndex - 1, { focus: true });
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      setActive(traversalIndex + 1, { focus: true });
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0, { focus: true });
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(projects.length - 1, { focus: true });
    } else if (event.key === "Escape" && activeIndex !== null) {
      event.preventDefault();
      release();
    }
  });

  if (!reducedMotion && "IntersectionObserver" in window) {
    current.classList.add("can-animate");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-entered");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8%", threshold: 0.06 });
    projects.forEach((project) => observer.observe(project));
  } else {
    projects.forEach((project) => project.classList.add("is-entered"));
  }
})();
