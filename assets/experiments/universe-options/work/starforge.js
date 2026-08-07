(() => {
  const controls = document.querySelector("[data-assembly-controls]");
  const chapters = [...document.querySelectorAll("[data-forge-project]")];
  const progress = document.querySelector("[data-forge-progress]");
  const progressIndex = document.querySelector("[data-forge-index]");
  const progressLabel = document.querySelector("[data-forge-label]");
  const progressMeter = document.querySelector("[data-forge-meter]");

  if (controls) controls.hidden = false;
  if (progress) progress.hidden = false;

  const setMode = (mode, { history = true } = {}) => {
    const nextMode = mode === "exploded" ? "exploded" : "assembled";
    const anchor = chapters
      .map((chapter) => ({ chapter, distance: Math.abs(chapter.getBoundingClientRect().top - 96) }))
      .sort((a, b) => a.distance - b.distance)[0]?.chapter;
    const anchorTop = anchor?.getBoundingClientRect().top;
    document.body.dataset.assembly = nextMode;
    controls?.querySelectorAll("[data-assembly-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.assemblyMode === nextMode));
    });

    if (history) {
      const url = new URL(window.location.href);
      if (nextMode === "assembled") url.searchParams.delete("assembly");
      else url.searchParams.set("assembly", nextMode);
      window.history.pushState({ assembly: nextMode }, "", url);
    }

    if (anchor && Number.isFinite(anchorTop)) {
      window.requestAnimationFrame(() => {
        const delta = anchor.getBoundingClientRect().top - anchorTop;
        if (Math.abs(delta) > 1) window.scrollBy({ top: delta, left: 0, behavior: "instant" });
      });
    }
  };

  controls?.querySelectorAll("[data-assembly-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.assemblyMode));
  });

  const modeFromLocation = () => new URLSearchParams(window.location.search).get("assembly") === "exploded" ? "exploded" : "assembled";
  window.addEventListener("popstate", () => setMode(modeFromLocation(), { history: false }));
  setMode(modeFromLocation(), { history: false });

  const updateProgress = () => {
    const maximum = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const ratio = Math.min(1, Math.max(0, window.scrollY / maximum));
    if (progressMeter) progressMeter.style.height = `${(ratio * 100).toFixed(2)}%`;
  };

  let frame = 0;
  window.addEventListener("scroll", () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      updateProgress();
      frame = 0;
    });
  }, { passive: true });
  updateProgress();

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const index = chapters.indexOf(visible.target);
      if (progressIndex) progressIndex.textContent = String(index + 1).padStart(2, "0");
      if (progressLabel) progressLabel.textContent = visible.target.dataset.forgeProject;
    }, { rootMargin: "-28% 0px -28% 0px", threshold: [0, .2, .5, .8] });
    chapters.forEach((chapter) => observer.observe(chapter));
  }
})();
