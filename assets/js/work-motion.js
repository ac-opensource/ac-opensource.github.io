(() => {
  "use strict";

  // Page choreography for Work. Content is visible by default; this script
  // arms entrances only for sections still below the fold, so nothing that
  // has already painted disappears and replays.
  const root = document.documentElement;
  const page = document.querySelector(".work-page");
  if (!page || !("IntersectionObserver" in window)) return;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const forced = matchMedia("(forced-colors: active)");
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
  const allowed = () => !reduced.matches && !forced.matches;
  if (!allowed()) return;

  const scopes = [];
  const timers = new Set();
  let revealObserver = null;
  let liveObserver = null;

  const later = (callback, delay) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  };

  // Wrap each word for a kinetic rise; the heading's text content is unchanged.
  const splitWords = (heading) => {
    if (!heading || heading.dataset.wmSplit) return;
    heading.dataset.wmSplit = "true";
    let index = 0;
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child);
          return;
        }
        if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) return;
        const fragment = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (!part.trim()) {
            fragment.append(part);
            return;
          }
          const word = document.createElement("span");
          const inner = document.createElement("span");
          word.className = "wm-word";
          inner.className = "wm-word__inner";
          inner.textContent = part;
          inner.style.setProperty("--wm-i", String(index));
          index += 1;
          word.append(inner);
          fragment.append(word);
        });
        child.replaceWith(fragment);
      });
    };
    walk(heading);
  };

  const steps = (container, selector) => {
    Array.from(container?.querySelectorAll(selector) || []).forEach((element, index) => {
      element.dataset.wmStep = "";
      element.style.setProperty("--wm-i", String(index));
    });
  };

  const indexed = (container, selector, property) => {
    Array.from(container?.querySelectorAll(selector) || []).forEach((element, index) => {
      element.style.setProperty(property, String(index));
    });
  };

  const register = (element, kind) => {
    if (!element) return;
    element.dataset.wmScope = kind;
    scopes.push(element);
  };

  page.querySelectorAll(".work-section__head").forEach((head) => {
    splitWords(head.querySelector("h2"));
    register(head, "head");
  });
  page.querySelectorAll(".work-case").forEach((card) => {
    steps(card, ".work-case__body > :not(.work-eyebrow)");
    indexed(card, ".work-chip", "--wm-c");
    register(card, "case");
  });
  page.querySelectorAll(".work-public-card").forEach((card) => {
    steps(card, ".work-public-card__body > :not(.work-eyebrow)");
    indexed(card, ".work-chip", "--wm-c");
    indexed(card, ".work-memory-art__head, .work-memory-art__row", "--wm-r");
    register(card, "card");
  });
  const cta = page.querySelector(".work-cta");
  if (cta) {
    splitWords(cta.querySelector("h2"));
    steps(cta, ":scope > div:first-child > p");
    indexed(cta, ".work-cta__actions .work-button", "--wm-c");
    register(cta, "cta");
  }

  const settle = (element, delay) => {
    later(() => element.classList.add("wm-settled"), delay + 1500);
  };

  const reveal = (element, delay = 0) => {
    element.style.setProperty("--wm-delay", `${Math.round(delay)}ms`);
    element.classList.add("wm-in");
    settle(element, delay);
  };

  const revealInstantly = (element) => {
    element.classList.add("wm-instant", "wm-in", "wm-settled");
    requestAnimationFrame(() => requestAnimationFrame(() => element.classList.remove("wm-instant")));
  };

  const onScreen = (element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.bottom > 0 && bounds.top < innerHeight;
  };

  // Anything already painted keeps its place; only below-the-fold work waits.
  scopes.forEach((element) => {
    if (onScreen(element)) revealInstantly(element);
  });

  const progress = document.createElement("span");
  progress.className = "wm-progress";
  progress.setAttribute("aria-hidden", "true");
  document.getElementById("site-topbar")?.append(progress);
  root.dataset.workMotion = "on";

  revealObserver = new IntersectionObserver((entries) => {
    entries
      .filter((entry) => entry.isIntersecting)
      .sort((first, second) => (first.boundingClientRect.top - second.boundingClientRect.top)
        || (first.boundingClientRect.left - second.boundingClientRect.left))
      .forEach((entry, order) => {
        revealObserver.unobserve(entry.target);
        reveal(entry.target, order * 120);
      });
  }, { rootMargin: "0px 0px -10% 0px", threshold: 0.06 });
  scopes.filter((element) => !element.classList.contains("wm-in")).forEach((element) => revealObserver.observe(element));

  // Looping illustrations only run while they are on screen.
  liveObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => entry.target.classList.toggle("wm-live", entry.isIntersecting));
  }, { threshold: 0.2 });
  page.querySelectorAll(".work-agent-art").forEach((art) => liveObserver.observe(art));

  // Pointer light and gallery tilt, eased toward the pointer each frame.
  const surfaces = Array.from(page.querySelectorAll(".work-case, .work-public-card, .work-cta"));
  surfaces.forEach((surface) => {
    const glint = document.createElement("span");
    glint.className = "wm-glint";
    glint.setAttribute("aria-hidden", "true");
    surface.append(glint);
    const state = { x: 0, y: 0, tx: 0, ty: 0, frame: 0 };
    const step = () => {
      state.frame = 0;
      state.x += (state.tx - state.x) * 0.14;
      state.y += (state.ty - state.y) * 0.14;
      surface.style.setProperty("--wm-tx", state.x.toFixed(4));
      surface.style.setProperty("--wm-ty", state.y.toFixed(4));
      if (Math.abs(state.tx - state.x) > 0.001 || Math.abs(state.ty - state.y) > 0.001) {
        state.frame = requestAnimationFrame(step);
      }
    };
    const kick = () => {
      if (!state.frame) state.frame = requestAnimationFrame(step);
    };
    surface.addEventListener("pointermove", (event) => {
      if (!finePointer.matches || root.dataset.workMotion !== "on") return;
      const bounds = surface.getBoundingClientRect();
      const px = event.clientX - bounds.left;
      const py = event.clientY - bounds.top;
      surface.style.setProperty("--wm-px", `${px.toFixed(1)}px`);
      surface.style.setProperty("--wm-py", `${py.toFixed(1)}px`);
      surface.classList.add("wm-hover");
      state.tx = (px / bounds.width) * 2 - 1;
      state.ty = (py / bounds.height) * 2 - 1;
      kick();
    }, { passive: true });
    surface.addEventListener("pointerleave", () => {
      surface.classList.remove("wm-hover");
      state.tx = 0;
      state.ty = 0;
      kick();
    });
  });

  const play = (element, keyframes, options) => {
    if (root.dataset.workMotion !== "on" || typeof element?.animate !== "function") return null;
    try {
      return element.animate(keyframes, options);
    } catch {
      return null;
    }
  };

  // Briefing: the underline slides between lenses and the new lens docks in.
  const briefing = page.querySelector("[data-work-briefing]");
  if (briefing) {
    let activeTab = briefing.querySelector("[data-brief-preset].is-active");
    const panelObserver = new MutationObserver((mutations) => {
      const panel = mutations
        .map((mutation) => mutation.target)
        .find((target) => target.matches?.("[data-brief-panel]") && !target.hidden);
      const nextTab = briefing.querySelector("[data-brief-preset].is-active");
      if (!panel || !nextTab || nextTab === activeTab) return;
      const previousTab = activeTab;
      activeTab = nextTab;
      if (briefing.dataset.briefMotion === "running" || !onScreen(panel)) return;
      if (previousTab) {
        const from = previousTab.getBoundingClientRect();
        const to = nextTab.getBoundingClientRect();
        const inset = 24;
        play(nextTab, [
          { transform: `translateX(${(from.left - to.left).toFixed(1)}px) scaleX(${((from.width - inset) / Math.max(1, to.width - inset)).toFixed(4)})` },
          { transform: "none" }
        ], { duration: 560, easing: "cubic-bezier(.16,1,.3,1)", pseudoElement: "::after" });
      }
      const direction = previousTab && previousTab.compareDocumentPosition(nextTab) & Node.DOCUMENT_POSITION_PRECEDING ? -1 : 1;
      play(panel.querySelector(":scope > header"), [
        { opacity: 0, translate: `${direction * 1.4}rem 0` },
        { opacity: 1, translate: "0 0" }
      ], { duration: 620, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
      panel.querySelectorAll(".work-briefing__beats > div, :scope > footer").forEach((element, index) => {
        play(element, [
          { opacity: 0, translate: "0 1.1rem" },
          { opacity: 1, translate: "0 0" }
        ], { duration: 640, delay: 90 + index * 70, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
      });
    });
    briefing.querySelectorAll("[data-brief-panel]").forEach((panel) => {
      panelObserver.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
    });
  }

  // Archive: cards deal out of the dossier as it opens.
  const archive = page.querySelector("[data-work-archive-dossier]");
  archive?.addEventListener("toggle", () => {
    if (!archive.open) return;
    play(archive.querySelector(".work-archive-dossier__intro"), [
      { opacity: 0, translate: "0 0.8rem" },
      { opacity: 1, translate: "0 0" }
    ], { duration: 520, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
    archive.querySelectorAll(".work-archive-card").forEach((card, index) => {
      play(card, [
        { opacity: 0, translate: "0 2rem", rotate: `${index % 2 ? 1.4 : -1.4}deg` },
        { opacity: 1, translate: "0 0", rotate: "0deg" }
      ], { duration: 760, delay: 60 + index * 55, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
    });
  });

  // If motion becomes unwelcome mid-visit, settle everything immediately.
  const stand = () => {
    if (allowed()) return;
    revealObserver?.disconnect();
    liveObserver?.disconnect();
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    scopes.forEach((element) => element.classList.add("wm-in", "wm-settled"));
    page.querySelectorAll(".wm-live").forEach((element) => element.classList.remove("wm-live"));
    delete root.dataset.workMotion;
  };
  reduced.addEventListener?.("change", stand);
  forced.addEventListener?.("change", stand);
})();
