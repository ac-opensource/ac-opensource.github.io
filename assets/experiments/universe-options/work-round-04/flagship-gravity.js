(() => {
  const stage = document.querySelector("[data-gravity-stage]");
  if (!stage) return;

  const satellites = Array.from(stage.querySelectorAll("[data-satellite]"));
  const controls = satellites.map((satellite) => satellite.querySelector("[data-satellite-select]")).filter(Boolean);
  const status = stage.querySelector("[data-gravity-status]");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;

  const projectNames = new Map(satellites.map((satellite) => [
    satellite.dataset.projectId,
    satellite.querySelector("strong")?.textContent.trim() || "Production system"
  ]));

  const setSelection = (id = "bitcoin-wallet", announce = true) => {
    const nextId = projectNames.has(id) ? id : "bitcoin-wallet";
    stage.dataset.selected = nextId;

    satellites.forEach((satellite) => {
      const active = satellite.dataset.projectId === nextId;
      satellite.classList.toggle("is-active", active);
      const control = satellite.querySelector("[data-satellite-select]");
      control?.setAttribute("aria-pressed", String(active));
    });

    if (!announce || !status) return;
    status.textContent = nextId === "bitcoin-wallet"
      ? "Bitcoin.com Wallet · primary production system. ITVX, OCBC Business, openpay, and MySTC · additional shipped products."
      : `${projectNames.get(nextId)} · selected production credential. Bitcoin.com Wallet remains the primary production system.`;
  };

  controls.forEach((control, index) => {
    control.disabled = false;

    control.addEventListener("click", () => {
      const id = satellites[index].dataset.projectId;
      setSelection(stage.dataset.selected === id ? "bitcoin-wallet" : id);
    });

    control.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Escape"].includes(event.key)) return;
      event.preventDefault();

      if (event.key === "Escape") {
        setSelection("bitcoin-wallet");
        control.blur();
        return;
      }

      let nextIndex = index;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = controls.length - 1;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + controls.length) % controls.length;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % controls.length;

      controls[nextIndex].focus();
      setSelection(satellites[nextIndex].dataset.projectId);
    });
  });

  const resetParallax = () => {
    stage.style.setProperty("--gravity-x", "0px");
    stage.style.setProperty("--gravity-y", "0px");
  };

  const updateParallax = (event) => {
    if (reduceMotion.matches) return;
    const bounds = stage.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 12;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 10;

    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      stage.style.setProperty("--gravity-x", `${x.toFixed(2)}px`);
      stage.style.setProperty("--gravity-y", `${y.toFixed(2)}px`);
    });
  };

  stage.addEventListener("pointermove", updateParallax, { passive: true });
  stage.addEventListener("pointerleave", resetParallax);
  reduceMotion.addEventListener?.("change", resetParallax);

  setSelection("bitcoin-wallet", false);
})();
