(() => {
  const root = document.querySelector("[data-shipyard]");
  if (!root) return;

  const vessels = [...root.querySelectorAll("[data-vessel]")];
  const panels = [...root.querySelectorAll("[data-vessel-panel]")];
  const router = root.querySelector("[data-capability-router]");
  const routeStatus = root.querySelector("[data-route-status]");
  const position = root.querySelector("[data-vessel-position]");
  const pager = root.querySelector("[data-vessel-pager]");
  const previous = root.querySelector("[data-vessel-previous]");
  const next = root.querySelector("[data-vessel-next]");
  const validIds = new Set(vessels.map((vessel) => vessel.dataset.vessel));

  if (router) router.hidden = false;
  if (pager) pager.hidden = false;

  const fromLocation = () => {
    const query = new URLSearchParams(window.location.search).get("vessel");
    if (query && validIds.has(query)) return query;
    const hash = window.location.hash.replace(/^#inspect-/, "");
    return validIds.has(hash) ? hash : vessels[0].dataset.vessel;
  };

  const selectVessel = (id, { history = true } = {}) => {
    if (!validIds.has(id)) return;
    const selectedIndex = vessels.findIndex((vessel) => vessel.dataset.vessel === id);
    root.dataset.activeVessel = id;

    vessels.forEach((vessel) => {
      const active = vessel.dataset.vessel === id;
      vessel.classList.toggle("is-active", active);
      vessel.toggleAttribute("aria-current", active);
    });

    panels.forEach((panel) => {
      const active = panel.dataset.vesselPanel === id;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });

    if (position) position.textContent = `Vessel ${String(selectedIndex + 1).padStart(2, "0")} of ${String(vessels.length).padStart(2, "0")}`;

    if (history) {
      const url = new URL(window.location.href);
      url.searchParams.set("vessel", id);
      url.hash = "inspection-berth";
      window.history.pushState({ vessel: id }, "", url);
    }
  };

  vessels.forEach((vessel, index) => {
    vessel.addEventListener("click", (event) => {
      event.preventDefault();
      selectVessel(vessel.dataset.vessel);
    });
    vessel.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
      const target = vessels[(index + direction + vessels.length) % vessels.length];
      target.focus();
      selectVessel(target.dataset.vessel);
    });
  });

  const step = (amount) => {
    const current = vessels.findIndex((vessel) => vessel.classList.contains("is-active"));
    const target = vessels[(current + amount + vessels.length) % vessels.length];
    selectVessel(target.dataset.vessel);
    target.focus({ preventScroll: true });
  };

  previous?.addEventListener("click", () => step(-1));
  next?.addEventListener("click", () => step(1));

  router?.querySelectorAll("[data-capability]").forEach((button) => {
    button.addEventListener("click", () => {
      const capability = button.dataset.capability;
      const wasActive = button.getAttribute("aria-pressed") === "true";
      router.querySelectorAll("[data-capability]").forEach((candidate) => candidate.setAttribute("aria-pressed", "false"));
      button.setAttribute("aria-pressed", String(!wasActive));
      root.querySelector(".dock-field")?.classList.toggle("has-route", !wasActive);

      let matches = 0;
      vessels.forEach((vessel) => {
        const matched = !wasActive && vessel.dataset.stages.split(" ").includes(capability);
        vessel.classList.toggle("is-match", matched);
        if (matched) matches += 1;
      });

      if (routeStatus) {
        routeStatus.textContent = wasActive
          ? "All production vessels are ready."
          : `${matches} production ${matches === 1 ? "vessel routes" : "vessels route"} through ${button.textContent.trim().toLowerCase()}.`;
      }
    });
  });

  window.addEventListener("popstate", () => selectVessel(fromLocation(), { history: false }));
  selectVessel(fromLocation(), { history: false });
})();
