(function (global) {
  const DEFAULT_TARGET = "AI-Native Software Engineer";
  const ROLE_PATTERN = /\b(mobile developer|mobile engineer|mobile engineering|mobile development|android developer|ios developer)\b/i;

  function shouldReduceMotion() {
    return global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function createAnimatedReplacement(fromText, toText, delayMs) {
    const wrapper = document.createElement("span");
    wrapper.className = "ai-rebrand";
    wrapper.dataset.state = "pending";
    wrapper.setAttribute("role", "text");
    wrapper.setAttribute("aria-label", toText);

    const from = document.createElement("span");
    from.className = "ai-rebrand-from";
    from.textContent = fromText;

    const to = document.createElement("span");
    to.className = "ai-rebrand-to";
    to.textContent = toText;
    to.setAttribute("aria-hidden", "true");

    const flare = document.createElement("span");
    flare.className = "ai-rebrand-flare";
    flare.setAttribute("aria-hidden", "true");

    wrapper.append(from, to, flare);

    const completeImmediately = () => {
      wrapper.classList.add("is-complete", "is-revealed");
      wrapper.style.width = "auto";
    };

    const startAnimation = () => {
      if (shouldReduceMotion()) {
        completeImmediately();
        return;
      }

      const fromWidth = Math.ceil(from.getBoundingClientRect().width);
      const toWidth = Math.ceil(to.getBoundingClientRect().width);
      wrapper.style.width = `${Math.max(fromWidth, toWidth) + 2}px`;

      global.setTimeout(() => {
        wrapper.classList.add("is-burning");
      }, delayMs);

      global.setTimeout(() => {
        wrapper.classList.add("is-revealed");
      }, delayMs + 760);

      global.setTimeout(() => {
        wrapper.classList.add("is-complete");
        wrapper.style.width = "auto";
      }, delayMs + 1450);
    };

    global.requestAnimationFrame(startAnimation);

    return wrapper;
  }

  function adjustIndefiniteArticle(beforeText, targetPhrase) {
    const before = String(beforeText || "");
    const target = String(targetPhrase || "").trim();
    if (!target) return before;

    // If a phrase like "a Mobile Engineer" becomes "AI ...", correct to "an ...".
    if (/^[aeiou]/i.test(target)) {
      return before.replace(/\b([aA])\s$/, (full, article) => (article === "A" ? "An " : "an "));
    }
    return before;
  }

  function findFirstMatchingTextNode(container) {
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const value = String(node.nodeValue || "");
          if (!value.trim()) return NodeFilter.FILTER_REJECT;

          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest(".ai-rebrand")) return NodeFilter.FILTER_REJECT;

          const tag = parent.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA") {
            return NodeFilter.FILTER_REJECT;
          }

          return ROLE_PATTERN.test(value) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );

    return walker.nextNode();
  }

  function applyToContainer(container) {
    if (!container) return false;

    const targetPhrase = container.dataset.aiRebrandTo || DEFAULT_TARGET;
    const configuredDelay = Number.parseInt(container.dataset.aiRebrandDelay || "0", 10);
    const delay = Number.isFinite(configuredDelay) ? Math.max(0, configuredDelay) : 0;
    const node = findFirstMatchingTextNode(container);
    if (!node) return false;

    const sourceText = String(node.nodeValue || "");
    const match = sourceText.match(ROLE_PATTERN);
    if (!match || typeof match.index !== "number") return false;

    const before = sourceText.slice(0, match.index);
    const fromText = match[0];
    const after = sourceText.slice(match.index + fromText.length);
    const normalizedBefore = adjustIndefiniteArticle(before, targetPhrase);
    const parent = node.parentNode;

    if (!parent) return false;

    if (normalizedBefore) parent.insertBefore(document.createTextNode(normalizedBefore), node);
    parent.insertBefore(createAnimatedReplacement(fromText, targetPhrase, delay), node);
    if (after) parent.insertBefore(document.createTextNode(after), node);
    parent.removeChild(node);

    container.dataset.aiRebrandProcessed = "1";
    return true;
  }

  function run(root = document) {
    const containers = root.querySelectorAll("[data-ai-rebrand-scope]");
    containers.forEach((container) => {
      if (container.dataset.aiRebrandProcessed === "1") return;
      applyToContainer(container);
    });
  }

  function refresh(selector) {
    let targets = [];
    if (typeof selector === "string" && selector.trim()) {
      targets = Array.from(document.querySelectorAll(selector));
    } else if (selector && selector.nodeType === 1) {
      targets = [selector];
    } else {
      targets = Array.from(document.querySelectorAll("[data-ai-rebrand-scope]"));
    }

    targets.forEach((target) => {
      delete target.dataset.aiRebrandProcessed;
    });
    run(document);
  }

  function startObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const target = mutation.target && mutation.target.nodeType === 1 ? mutation.target : mutation.target?.parentElement;
        if (!target) continue;

        const container = target.closest("[data-ai-rebrand-scope]");
        if (!container) continue;

        if (!container.querySelector(".ai-rebrand")) {
          delete container.dataset.aiRebrandProcessed;
          applyToContainer(container);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function boot() {
    run(document);
    startObserver();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  global.aiRebrand = {
    run,
    refresh
  };
})(window);
