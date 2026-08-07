(() => {
  const rail = document.querySelector("[data-career-rail]");
  const printButton = document.querySelector("[data-print-chart]");
  const status = document.querySelector("[data-chart-status]");
  const observations = [...document.querySelectorAll("[data-career-star]")];
  const heroStars = [...document.querySelectorAll(".career-sky [data-career-link]")];
  const railStars = [...document.querySelectorAll(".career-rail [data-career-link]")];

  if (rail) rail.hidden = false;
  if (printButton) printButton.hidden = false;
  printButton?.addEventListener("click", () => window.print());

  const setActive = (id) => {
    const active = observations.find((observation) => observation.dataset.careerStar === id);
    if (!active) return;
    observations.forEach((observation) => observation.classList.toggle("is-active", observation === active));
    document.querySelectorAll("[data-career-link]").forEach((link) => {
      const selected = link.dataset.careerLink === id;
      link.classList.toggle("is-active", selected);
      link.toggleAttribute("aria-current", selected);
    });
    if (status) status.textContent = `[observing · ${active.dataset.careerName} · ${String(observations.indexOf(active) + 1).padStart(2, "0")}/07]`;
  };

  const addArrowNavigation = (links) => links.forEach((link, index) => link.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    links[(index + direction + links.length) % links.length].focus();
  }));
  addArrowNavigation(heroStars);
  addArrowNavigation(railStars);

  document.querySelectorAll("[data-career-link]").forEach((link) => link.addEventListener("click", () => setActive(link.dataset.careerLink)));
  window.addEventListener("hashchange", () => {
    const target = observations.find((observation) => `#${observation.id}` === window.location.hash);
    if (target) setActive(target.dataset.careerStar);
  });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActive(visible.target.dataset.careerStar);
    }, { rootMargin: "-28% 0px -28% 0px", threshold: [0, .2, .5, .8] });
    observations.forEach((observation) => observer.observe(observation));
  }

  const initial = observations.find((observation) => `#${observation.id}` === window.location.hash) || observations[0];
  setActive(initial.dataset.careerStar);
})();
