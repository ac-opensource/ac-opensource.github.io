(() => {
  "use strict";

  // Logs choreography. On a direct visit the galaxy forms: the disk spins up
  // from its core, the nucleus ignites, and entries light up along the arms.
  // Below the hero the archive reveals as it scrolls into view. Content that
  // has already painted is never hidden and replayed.
  const root = document.documentElement;
  const hero = document.querySelector(".galaxy-hero");
  const field = document.getElementById("galaxy-field");
  const archive = document.querySelector(".galaxy-index");
  if (!hero || !field || !archive || !("IntersectionObserver" in window)) return;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const forced = matchMedia("(forced-colors: active)");
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
  const allowed = () => !reduced.matches && !forced.matches;
  if (!allowed() || typeof Element.prototype.animate !== "function") return;

  const ease = "cubic-bezier(.16,1,.3,1)";
  const running = new Set();

  const play = (element, keyframes, options) => {
    if (!element || !allowed()) return null;
    try {
      const animation = element.animate(keyframes, options);
      running.add(animation);
      animation.finished.catch(() => {}).finally(() => running.delete(animation));
      return animation;
    } catch {
      return null;
    }
  };

  // ---------- Galaxy formation ----------
  // The renderer simulates the formation itself (spiral-galaxy-archive.js:
  // a turbulent cloud collapses, spins up, flattens and lights inside-out).
  // This script only decides when it should play and when each article,
  // a star on its arm, switches on once the gas at its radius has settled.
  const formationWanted = () => root.dataset.universeMotion !== "arrive"
    && scrollY < 40
    && !location.hash
    && location.search.length <= 1
    && !document.hidden;

  const form = () => {
    field.querySelectorAll(".galaxy-node").forEach((node) => {
      const radius = Number(node.dataset.progress) || 0;
      node.style.setProperty("--node-form-at", (0.36 + radius * 0.45).toFixed(3));
    });
    hero.dispatchEvent(new CustomEvent("galaxy:form"));
  };

  // Formation plays where it can be seen: immediately when the galaxy is on
  // screen, or just before it scrolls in on stacked (mobile) layouts.
  const formWhenVisible = () => {
    if (field.getBoundingClientRect().top < innerHeight) {
      form();
      return;
    }
    hero.dataset.galaxyFormation = "waiting";
    const approach = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      approach.disconnect();
      // A filter or saved view chosen meanwhile owns the galaxy; never replay over it.
      if (allowed() && location.search.length <= 1 && hero.dataset.merger !== "remnant") form();
      else hero.dataset.galaxyFormation = "skipped";
    }, { rootMargin: "0px 0px 20% 0px" });
    approach.observe(field);
  };

  if (field.dataset.ready === "true" || !formationWanted()) {
    hero.dataset.galaxyFormation = "skipped";
  } else {
    // The archive builds its nodes asynchronously. Start in the same task it
    // marks the field ready, before the first galaxy frame is painted.
    const readiness = new MutationObserver(() => {
      if (field.dataset.ready !== "true") return;
      readiness.disconnect();
      window.clearTimeout(fallback);
      if (formationWanted()) formWhenVisible();
      else hero.dataset.galaxyFormation = "skipped";
    });
    const fallback = window.setTimeout(() => {
      readiness.disconnect();
      hero.dataset.galaxyFormation = "skipped";
    }, 4000);
    readiness.observe(field, { attributes: true, attributeFilter: ["data-ready"] });
  }

  // ---------- Archive reveals ----------
  const scopes = [];

  const splitWords = (heading) => {
    if (!heading || heading.dataset.lmSplit) return;
    heading.dataset.lmSplit = "true";
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
          word.className = "lm-word";
          inner.className = "lm-word__inner";
          inner.textContent = part;
          inner.style.setProperty("--lm-i", String(index));
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
    Array.from(container.querySelectorAll(selector)).forEach((element, index) => {
      element.dataset.lmStep = "";
      element.style.setProperty("--lm-i", String(index));
    });
  };

  const register = (element, kind) => {
    if (!element) return;
    element.dataset.lmScope = kind;
    scopes.push(element);
  };

  const indexHead = archive.querySelector(".galaxy-index__header");
  if (indexHead) {
    splitWords(indexHead.querySelector("h2"));
    steps(indexHead, ":scope > p");
    register(indexHead, "head");
  }
  archive.querySelectorAll(".galaxy-group__header").forEach((header) => register(header, "rise"));
  archive.querySelectorAll(".galaxy-feature").forEach((card) => {
    steps(card, ".galaxy-feature__meta, .galaxy-feature__title, .galaxy-feature__summary");
    register(card, "card");
  });
  archive.querySelectorAll(".galaxy-list > article").forEach((entry) => {
    steps(entry, ".galaxy-entry__body > *");
    register(entry, "entry");
  });
  const status = document.getElementById("infinite-status")?.parentElement;
  if (status && archive.contains(status)) register(status, "rise");

  const onScreen = (element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.bottom > 0 && bounds.top < innerHeight;
  };

  scopes.forEach((element) => {
    if (!onScreen(element)) return;
    element.classList.add("lm-instant", "lm-in");
    requestAnimationFrame(() => requestAnimationFrame(() => element.classList.remove("lm-instant")));
  });

  const progress = document.createElement("span");
  progress.className = "lm-progress";
  progress.setAttribute("aria-hidden", "true");
  document.getElementById("site-topbar")?.append(progress);
  root.dataset.logsMotion = "on";

  const revealObserver = new IntersectionObserver((entries) => {
    entries
      .filter((entry) => entry.isIntersecting)
      .sort((first, second) => (first.boundingClientRect.top - second.boundingClientRect.top)
        || (first.boundingClientRect.left - second.boundingClientRect.left))
      .forEach((entry, order) => {
        revealObserver.unobserve(entry.target);
        entry.target.style.setProperty("--lm-delay", `${Math.min(order, 5) * 110}ms`);
        entry.target.classList.add("lm-in");
      });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
  scopes.filter((element) => !element.classList.contains("lm-in")).forEach((element) => revealObserver.observe(element));

  // ---------- Live counts tick when a filter changes them ----------
  const counters = [document.getElementById("galaxy-count"), ...archive.querySelectorAll("[data-galaxy-group-count]")].filter(Boolean);
  const countObserver = new MutationObserver((mutations) => {
    new Set(mutations.map((mutation) => mutation.target.nodeType === Node.TEXT_NODE ? mutation.target.parentElement : mutation.target))
      .forEach((counter) => {
        if (!counter || !onScreen(counter)) return;
        play(counter, [
          { opacity: 0, translate: "0 -0.45em" },
          { opacity: 1, translate: "0 0" }
        ], { duration: 420, easing: ease });
      });
  });
  counters.forEach((counter) => countObserver.observe(counter, { childList: true, characterData: true, subtree: true }));

  // ---------- Start here: cards lean toward the pointer ----------
  archive.querySelectorAll(".galaxy-feature").forEach((card) => {
    const glint = document.createElement("span");
    glint.className = "lm-glint";
    glint.setAttribute("aria-hidden", "true");
    card.append(glint);
    const state = { x: 0, y: 0, tx: 0, ty: 0, frame: 0 };
    const step = () => {
      state.frame = 0;
      state.x += (state.tx - state.x) * 0.14;
      state.y += (state.ty - state.y) * 0.14;
      card.style.setProperty("--lm-tx", state.x.toFixed(4));
      card.style.setProperty("--lm-ty", state.y.toFixed(4));
      if (Math.abs(state.tx - state.x) > 0.001 || Math.abs(state.ty - state.y) > 0.001) state.frame = requestAnimationFrame(step);
    };
    const kick = () => {
      if (!state.frame) state.frame = requestAnimationFrame(step);
    };
    card.addEventListener("pointermove", (event) => {
      if (!finePointer.matches || root.dataset.logsMotion !== "on") return;
      const bounds = card.getBoundingClientRect();
      const px = event.clientX - bounds.left;
      const py = event.clientY - bounds.top;
      card.style.setProperty("--lm-px", `${px.toFixed(1)}px`);
      card.style.setProperty("--lm-py", `${py.toFixed(1)}px`);
      card.classList.add("lm-hover");
      state.tx = (px / bounds.width) * 2 - 1;
      state.ty = (py / bounds.height) * 2 - 1;
      kick();
    }, { passive: true });
    card.addEventListener("pointerleave", () => {
      card.classList.remove("lm-hover");
      state.tx = 0;
      state.ty = 0;
      kick();
    });
  });

  // If motion becomes unwelcome mid-visit, settle everything immediately.
  const stand = () => {
    if (allowed()) return;
    revealObserver.disconnect();
    countObserver.disconnect();
    running.forEach((animation) => animation.finish?.());
    scopes.forEach((element) => element.classList.add("lm-in"));
    delete root.dataset.logsMotion;
  };
  reduced.addEventListener?.("change", stand);
  forced.addEventListener?.("change", stand);
})();
