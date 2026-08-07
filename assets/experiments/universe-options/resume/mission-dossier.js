(() => {
  const lensControls = document.querySelector("[data-dossier-lens-controls]");
  const printButton = document.querySelector("[data-print-dossier]");
  const progress = document.querySelector("[data-dossier-progress]");
  const progressNumber = document.querySelector("[data-dossier-number]");
  const progressLabel = document.querySelector("[data-dossier-label]");
  const progressMeter = document.querySelector("[data-dossier-meter]");
  const roleFiles = [...document.querySelectorAll("[data-role-file]")];
  const dossierSections = [...document.querySelectorAll("[data-dossier-section], [data-role-file]")];
  const stepper = document.querySelector("[data-role-stepper]");
  const rolePosition = document.querySelector("[data-role-position]");
  let activeRoleIndex = 0;

  if (lensControls) lensControls.hidden = false;
  if (printButton) printButton.hidden = false;
  if (progress) progress.hidden = false;
  if (stepper) stepper.hidden = false;

  const lensFromLocation = () => new URLSearchParams(window.location.search).get("lens") === "evidence" ? "evidence" : "record";

  const setLens = (lens, { history = true } = {}) => {
    const nextLens = lens === "evidence" ? "evidence" : "record";
    document.body.dataset.dossierLens = nextLens;
    lensControls?.querySelectorAll("[data-lens]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.lens === nextLens)));
    if (history) {
      const url = new URL(window.location.href);
      if (nextLens === "record") url.searchParams.delete("lens");
      else url.searchParams.set("lens", nextLens);
      window.history.pushState({ lens: nextLens }, "", url);
    }
  };

  lensControls?.querySelectorAll("[data-lens]").forEach((button) => button.addEventListener("click", () => setLens(button.dataset.lens)));
  window.addEventListener("popstate", () => setLens(lensFromLocation(), { history: false }));
  setLens(lensFromLocation(), { history: false });
  printButton?.addEventListener("click", () => window.print());

  const updateRolePosition = (index) => {
    activeRoleIndex = Math.max(0, Math.min(roleFiles.length - 1, index));
    if (rolePosition) rolePosition.textContent = `File ${String(activeRoleIndex + 1).padStart(2, "0")} of ${String(roleFiles.length).padStart(2, "0")} · ${roleFiles[activeRoleIndex].dataset.roleName}`;
  };

  const openRole = (index) => {
    const nextIndex = (index + roleFiles.length) % roleFiles.length;
    updateRolePosition(nextIndex);
    window.location.hash = roleFiles[nextIndex].id;
  };
  document.querySelector("[data-role-previous]")?.addEventListener("click", () => openRole(activeRoleIndex - 1));
  document.querySelector("[data-role-next]")?.addEventListener("click", () => openRole(activeRoleIndex + 1));

  const roleLinks = [...document.querySelectorAll('.role-file-nav a[href^="#dossier-"]')];
  roleLinks.forEach((link, index) => link.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const next = roleLinks[(index + direction + roleLinks.length) % roleLinks.length];
    next.focus();
  }));

  const updateMeter = () => {
    const maximum = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const ratio = Math.max(0, Math.min(1, window.scrollY / maximum));
    if (progressMeter) progressMeter.style.height = `${(ratio * 100).toFixed(2)}%`;
  };
  let meterFrame = 0;
  window.addEventListener("scroll", () => {
    if (meterFrame) return;
    meterFrame = window.requestAnimationFrame(() => { updateMeter(); meterFrame = 0; });
  }, { passive: true });
  updateMeter();

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      const active = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!active) return;
      const sectionIndex = dossierSections.indexOf(active.target);
      if (progressNumber) progressNumber.textContent = String(sectionIndex + 1).padStart(2, "0");
      if (progressLabel) progressLabel.textContent = active.target.dataset.dossierSection || active.target.dataset.roleName || "Dossier";
      const roleIndex = roleFiles.indexOf(active.target);
      if (roleIndex >= 0) updateRolePosition(roleIndex);
    }, { rootMargin: "-27% 0px -27% 0px", threshold: [0, .2, .5, .8] });
    dossierSections.forEach((section) => observer.observe(section));
  }
  updateRolePosition(0);
})();
