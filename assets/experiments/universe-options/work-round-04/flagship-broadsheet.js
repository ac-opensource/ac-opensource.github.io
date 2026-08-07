(() => {
  const broadsheet = document.querySelector("[data-broadsheet]");
  if (!broadsheet) return;

  const controls = [...broadsheet.querySelectorAll("[data-lens]")];
  const facetedEntries = [...broadsheet.querySelectorAll("[data-facets]")];
  const status = broadsheet.querySelector("[data-lens-status]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lensNames = {
    all: "All systems",
    product: "Product",
    architecture: "Architecture",
    platform: "Platform",
    reliability: "Reliability",
    release: "Release"
  };

  if (!controls.length) return;

  const entryTitle = (entry) => {
    if (entry.dataset.projectId === "bitcoin-wallet") return "Bitcoin.com Wallet";
    return entry.querySelector("h2, h3")?.textContent.trim() || "Production system";
  };

  const hasFacet = (entry, facet) => {
    if (facet === "all") return true;
    return (entry.dataset.facets || "").split(/\s+/).includes(facet);
  };

  const setLens = (facet, { focus = false } = {}) => {
    const nextFacet = lensNames[facet] ? facet : "all";
    broadsheet.dataset.activeLens = nextFacet;

    controls.forEach((control) => {
      const active = control.dataset.lens === nextFacet;
      control.setAttribute("aria-pressed", String(active));
      if (active && focus) control.focus({ preventScroll: true });
    });

    const matchingNames = [];
    facetedEntries.forEach((entry) => {
      const matches = hasFacet(entry, nextFacet);
      entry.classList.toggle("is-lens-match", matches);
      if (matches && entry.matches("[data-project]")) matchingNames.push(entryTitle(entry));
    });

    if (!status) return;
    status.textContent = nextFacet === "all"
      ? "Showing evidence across all five production systems."
      : `${lensNames[nextFacet]} evidence: ${matchingNames.join(", ")}.`;
  };

  controls.forEach((control, index) => {
    control.removeAttribute("disabled");
    control.addEventListener("click", () => {
      const requested = control.dataset.lens || "all";
      const current = broadsheet.dataset.activeLens || "all";
      setLens(requested === current && requested !== "all" ? "all" : requested);
    });

    control.addEventListener("keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      let nextIndex = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % controls.length;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + controls.length) % controls.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = controls.length - 1;
      if (nextIndex === null) return;

      event.preventDefault();
      setLens(controls[nextIndex].dataset.lens || "all", { focus: true });
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || (broadsheet.dataset.activeLens || "all") === "all") return;
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
    event.preventDefault();
    setLens("all", { focus: true });
  });

  setLens("all");
  if (reducedMotion) {
    broadsheet.classList.add("is-ready");
  } else {
    requestAnimationFrame(() => requestAnimationFrame(() => broadsheet.classList.add("is-ready")));
  }
})();
