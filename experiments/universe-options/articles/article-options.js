(() => {
  const root = document.documentElement;
  root.classList.remove("no-js");
  root.classList.add("js");

  const progress = document.querySelector("[data-reading-progress]");
  const activeTitle = document.querySelector("[data-active-title]");
  const headings = [...document.querySelectorAll("[data-article-copy] h2[id]")];
  const links = [...document.querySelectorAll("[data-section-link]")];

  const updateProgress = () => {
    const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const ratio = Math.min(1, Math.max(0, window.scrollY / scrollable));
    root.style.setProperty("--reading-progress", ratio.toFixed(4));
    if (progress) {
      progress.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    }
  };

  const setActive = (id) => {
    const heading = headings.find((item) => item.id === id);
    if (!heading) return;
    links.forEach((link) => {
      const active = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
    if (activeTitle) activeTitle.textContent = heading.textContent.trim();
  };

  let progressQueued = false;
  const queueProgress = () => {
    if (progressQueued) return;
    progressQueued = true;
    requestAnimationFrame(() => {
      updateProgress();
      progressQueued = false;
    });
  };

  if ("IntersectionObserver" in window && headings.length) {
    const visible = new Map();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
        else visible.delete(entry.target.id);
      });
      if (visible.size) {
        const next = [...visible.entries()].sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))[0];
        setActive(next[0]);
      }
    }, { rootMargin: "-16% 0px -65% 0px", threshold: [0, .1, .5] });
    headings.forEach((heading) => observer.observe(heading));
  }

  window.addEventListener("scroll", queueProgress, { passive: true });
  window.addEventListener("resize", queueProgress, { passive: true });
  window.addEventListener("hashchange", () => setActive(location.hash.slice(1)));

  updateProgress();
  setActive(location.hash.slice(1) || headings[0]?.id);
})();
