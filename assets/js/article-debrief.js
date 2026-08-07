(() => {
  "use strict";

  document.querySelectorAll("[data-article-debrief]").forEach((root) => {
    const body = root.querySelector("[data-debrief-body]");
    if (!body) return;

    const links = Array.from(root.querySelectorAll("[data-trajectory-link]"));
    const figures = Array.from(body.querySelectorAll("figure"));
    const linkedIds = new Set(links.map((link) => link.dataset.sectionId).filter(Boolean));
    const targets = Array.from(
      body.querySelectorAll("[data-debrief-heading][id], [data-article-figure][id]")
    ).filter((target) => linkedIds.has(target.id));
    if (!targets.length || !links.length) return;

    const targetById = new Map(targets.map((target) => [target.id, target]));
    let activeId = "";
    let frame = 0;

    function setActive(id) {
      if (!targetById.has(id) || activeId === id) return;
      activeId = id;
      root.dataset.activeSection = id;

      targets.forEach((target) => {
        target.dataset.active = String(target.id === id);
      });
      links.forEach((link) => {
        const selected = link.dataset.sectionId === id;
        link.dataset.active = String(selected);
        if (selected) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });

      const activeTarget = targetById.get(id);
      const activeContainer = activeTarget?.closest("section, aside");
      figures.forEach((figure) => {
        const selectedFigure = figure === activeTarget;
        const relatedSectionFigure = !activeTarget?.matches("figure") && Boolean(activeContainer?.contains(figure));
        figure.dataset.debriefRelated = String(selectedFigure || relatedSectionFigure);
      });
    }

    function activeTargetFromViewport() {
      const threshold = Math.min(window.innerHeight * 0.3, 260);
      let candidate = targets[0];

      for (const target of targets) {
        if (target.getBoundingClientRect().top <= threshold) candidate = target;
        else break;
      }

      const nearDocumentEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      return nearDocumentEnd ? targets.at(-1) : candidate;
    }

    function updateFromViewport() {
      frame = 0;
      if (document.hidden) return;
      setActive(activeTargetFromViewport().id);
    }

    function scheduleViewportUpdate() {
      if (frame || document.hidden) return;
      frame = window.requestAnimationFrame(updateFromViewport);
    }

    function hashTargetId() {
      try {
        return decodeURIComponent(window.location.hash.replace(/^#/, ""));
      } catch (_error) {
        return window.location.hash.replace(/^#/, "");
      }
    }

    links.forEach((link) => {
      link.addEventListener("click", () => {
        const id = link.dataset.sectionId || "";
        if (targetById.has(id)) setActive(id);
        const details = link.closest("[data-trajectory-details]");
        if (details) details.open = false;
      });
    });

    window.addEventListener("scroll", scheduleViewportUpdate, { passive: true });
    window.addEventListener("resize", scheduleViewportUpdate, { passive: true });
    window.addEventListener("hashchange", () => {
      const id = hashTargetId();
      if (targetById.has(id)) setActive(id);
      else scheduleViewportUpdate();
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleViewportUpdate();
    });

    const hashId = hashTargetId();
    setActive(targetById.has(hashId) ? hashId : targets[0].id);
    scheduleViewportUpdate();
  });
})();
