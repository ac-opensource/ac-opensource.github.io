(function () {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ABOUT_PATH = "/about.html";
  const ARRIVAL_KEY = "universe-theme-arrival";
  const DURATION = 240;
  let transitionInFlight = false;
  let transitionMode = "";
  let overlay = null;
  let navigationTimer = 0;
  let recoveryTimer = 0;

  function normalizedPath(pathname) {
    const path = pathname.replace(/\/index\.html$/, "/");
    return path === "/about/" ? ABOUT_PATH : path;
  }

  function aboutTheme() {
    const documentTheme = document.documentElement.dataset.aboutTheme;
    if (["light", "dark"].includes(documentTheme)) return documentTheme;
    try {
      return window.localStorage.getItem("about-theme") === "light" ? "light" : "dark";
    } catch (_error) {
      return "dark";
    }
  }

  function surfaceFor(pathname) {
    return normalizedPath(pathname) === ABOUT_PATH ? aboutTheme() : "light";
  }

  function washFor(surface) {
    if (surface === "dark") {
      return "radial-gradient(circle at 68% 44%, #0b244b 0%, #041126 42%, #020817 78%)";
    }
    return "radial-gradient(circle at 32% 42%, #ffffff 0%, #f5f7fb 48%, #faf9f4 82%)";
  }

  function syncTransitionAttribute() {
    if (transitionMode) {
      document.documentElement.dataset.themeTransition = transitionMode;
      document.body?.setAttribute("data-theme-transition", transitionMode);
    } else {
      delete document.documentElement.dataset.themeTransition;
      document.body?.removeAttribute("data-theme-transition");
    }
  }

  function cleanupTransition() {
    window.clearTimeout(navigationTimer);
    window.clearTimeout(recoveryTimer);
    navigationTimer = 0;
    recoveryTimer = 0;
    transitionInFlight = false;
    transitionMode = "";
    overlay?.remove();
    overlay = null;
    syncTransitionAttribute();
  }

  function createOverlay(surface, { arrival = false } = {}) {
    overlay?.remove();
    overlay = document.createElement("div");
    overlay.className = "universe-theme-wash";
    overlay.setAttribute("aria-hidden", "true");
    Object.assign(overlay.style, {
      position: "fixed",
      zIndex: "2147483646",
      inset: "0",
      opacity: arrival ? "1" : "0",
      pointerEvents: arrival ? "none" : "auto",
      background: washFor(surface),
      transition: `opacity ${DURATION}ms cubic-bezier(.22,.7,.22,1)`,
    });
    document.documentElement.append(overlay);
    syncTransitionAttribute();
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (overlay) overlay.style.opacity = arrival ? "0" : "1";
    }));
  }

  function rememberArrival(pathname, surface) {
    try {
      window.sessionStorage.setItem(ARRIVAL_KEY, JSON.stringify({
        expires: Date.now() + 7000,
        path: normalizedPath(pathname),
        surface,
      }));
    } catch (_error) {
      // The outgoing wash still softens the route change when storage is unavailable.
    }
  }

  function takeArrival() {
    try {
      const stored = window.sessionStorage.getItem(ARRIVAL_KEY);
      if (!stored) return null;
      window.sessionStorage.removeItem(ARRIVAL_KEY);
      const arrival = JSON.parse(stored);
      if (!arrival || arrival.expires < Date.now() || arrival.path !== normalizedPath(window.location.pathname)) return null;
      return arrival;
    } catch (_error) {
      return null;
    }
  }

  function plainActivation(event, anchor) {
    return event.button === 0
      && !event.metaKey
      && !event.ctrlKey
      && !event.shiftKey
      && !event.altKey
      && !anchor.hasAttribute("download")
      && (!anchor.target || anchor.target === "_self");
  }

  const arrival = takeArrival();
  if (arrival && !reducedMotion.matches && arrival.surface === surfaceFor(window.location.pathname)) {
    transitionInFlight = true;
    transitionMode = arrival.surface === "dark" ? "arrive-about" : "arrive-light";
    createOverlay(arrival.surface, { arrival: true });
    recoveryTimer = window.setTimeout(cleanupTransition, DURATION + 80);
  }

  document.addEventListener("DOMContentLoaded", syncTransitionAttribute, { once: true });

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || reducedMotion.matches) return;
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement) || !plainActivation(event, anchor)) return;
    if (transitionInFlight) {
      event.preventDefault();
      return;
    }
    if (anchor.hasAttribute("data-route-signal-link")) return;

    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    const currentPath = normalizedPath(window.location.pathname);
    const destinationPath = normalizedPath(destination.pathname);
    if (currentPath === destinationPath) return;

    const currentSurface = surfaceFor(currentPath);
    const destinationSurface = surfaceFor(destinationPath);
    if (currentSurface === destinationSurface) return;

    event.preventDefault();
    transitionInFlight = true;
    transitionMode = destinationSurface === "dark" ? "to-about" : "from-about";
    rememberArrival(destinationPath, destinationSurface);
    createOverlay(destinationSurface);
    navigationTimer = window.setTimeout(() => {
      try {
        window.location.assign(destination.href);
      } catch (_error) {
        cleanupTransition();
      }
    }, 0);
    recoveryTimer = window.setTimeout(cleanupTransition, DURATION + 1200);
  }, true);

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) cleanupTransition();
  });
})();
