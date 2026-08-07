(() => {
  const flagship = document.querySelector("[data-flagship]");
  const status = document.querySelector("[data-deck-status]");
  if (!flagship) return;

  const projects = Array.from(document.querySelectorAll("[data-project]"));
  const evidenceLinks = Array.from(document.querySelectorAll("[data-evidence-link]"));
  const projectIds = new Set(projects.map((project) => project.dataset.projectId).filter(Boolean));
  const kindCount = (kind) => projects.filter((project) => project.dataset.kind === kind).length;

  document.documentElement.dataset.flagshipDeck = "enhanced";

  if (status) {
    status.textContent = `${projectIds.size} projects · ${kindCount("production")} production · ${kindCount("archive")} archive · ${kindCount("public")} public · ${evidenceLinks.length} evidence links`;
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  let frame = 0;
  let pendingPoint = null;

  const clearDepth = () => {
    pendingPoint = null;
    flagship.style.removeProperty("--halo-x");
    flagship.style.removeProperty("--halo-y");
    flagship.style.removeProperty("--orbit-x");
    flagship.style.removeProperty("--orbit-y");
    flagship.style.removeProperty("--screens-x");
    flagship.style.removeProperty("--screens-y");
  };

  const paintDepth = () => {
    frame = 0;
    if (!pendingPoint || reducedMotion.matches || !finePointer.matches) {
      clearDepth();
      return;
    }

    const rect = flagship.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(-1, Math.min(1, ((pendingPoint.x - rect.left) / rect.width - 0.5) * 2));
    const y = Math.max(-1, Math.min(1, ((pendingPoint.y - rect.top) / rect.height - 0.5) * 2));

    flagship.style.setProperty("--halo-x", `${(x * 18).toFixed(2)}px`);
    flagship.style.setProperty("--halo-y", `${(y * 14).toFixed(2)}px`);
    flagship.style.setProperty("--orbit-x", `${(-x * 8).toFixed(2)}px`);
    flagship.style.setProperty("--orbit-y", `${(-y * 6).toFixed(2)}px`);
    flagship.style.setProperty("--screens-x", `${(x * 12).toFixed(2)}px`);
    flagship.style.setProperty("--screens-y", `${(y * 8).toFixed(2)}px`);
  };

  const queueDepth = (event) => {
    if (reducedMotion.matches || !finePointer.matches) return;
    pendingPoint = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(paintDepth);
  };

  flagship.addEventListener("pointermove", queueDepth, { passive: true });
  flagship.addEventListener("pointerleave", clearDepth, { passive: true });
  reducedMotion.addEventListener("change", clearDepth);
  finePointer.addEventListener("change", clearDepth);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearDepth();
  });
})();
