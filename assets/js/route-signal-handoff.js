(() => {
  "use strict";

  const STORAGE_KEY = "ac.route-signal.v1";
  const HISTORY_KEY = "__acRouteSignal";
  const MAX_AGE_MS = 5000;
  const MAX_CLOCK_SKEW_MS = 1000;
  const SIGNAL_KEYS = ["createdAt", "destination", "source", "token", "version"];
  const TIMINGS = Object.freeze({
    normal: Object.freeze({ departure: 160, settle: 180, arrival: 620 }),
    reduced: Object.freeze({ departure: 40, settle: 0, arrival: 460 }),
    constrained: Object.freeze({ departure: 40, settle: 0, arrival: 420 })
  });
  const ROUTES = Object.freeze({
    work: Object.freeze({
      path: "/work.html",
      locking: "LOCKING PORTFOLIO TRAJECTORY",
      resolved: "TRAJECTORY LOCK ACQUIRED · PORTFOLIO READY"
    }),
    contact: Object.freeze({
      path: "/contact.html",
      locking: "ACQUIRING CONTACT LOCK",
      resolved: "TELEMETRY LOCK ACQUIRED · CONTACT READY"
    })
  });
  const TOKEN_PATTERN = /^[a-z0-9-]{16,64}$/i;
  const timers = new Set();
  let outboundInFlight = false;
  let activeReceiver = null;
  let activeSourceLink = null;

  const schedule = (callback, delay) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
    return timer;
  };

  const clearTimers = () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
  };

  const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const normalizedPath = (value) => {
    const path = value || "/";
    return path === "/index.html" ? "/" : path;
  };

  const currentPage = () => document.body?.dataset.routeSignalPage || "";

  const navigationIsReplay = () => {
    const navigationEntry = window.performance?.getEntriesByType?.("navigation")?.[0];
    if (navigationEntry) return navigationEntry.type === "reload" || navigationEntry.type === "back_forward";
    return window.performance?.navigation?.type === 1 || window.performance?.navigation?.type === 2;
  };

  const isDashboardReferrer = (referrer, expectedOrigin) => {
    if (!referrer || !expectedOrigin) return false;
    try {
      const url = new URL(referrer);
      return url.origin === expectedOrigin && normalizedPath(url.pathname) === "/" && !url.search;
    } catch (_error) {
      return false;
    }
  };

  const resolveMode = ({
    reduced = false,
    hidden = false,
    saveData = false,
    effectiveType = "",
    deviceMemory,
    hardwareConcurrency
  } = {}) => {
    if (reduced) return "reduced";
    if (
      hidden ||
      saveData ||
      String(effectiveType).toLowerCase() === "slow-2g" ||
      String(effectiveType).toLowerCase() === "2g" ||
      (Number.isFinite(deviceMemory) && deviceMemory <= 2) ||
      (Number.isFinite(hardwareConcurrency) && hardwareConcurrency <= 2)
    ) return "constrained";
    return "normal";
  };

  const signalMode = () => {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return resolveMode({
      reduced: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
      hidden: document.visibilityState === "hidden",
      saveData: connection?.saveData,
      effectiveType: connection?.effectiveType,
      deviceMemory: navigator.deviceMemory,
      hardwareConcurrency: navigator.hardwareConcurrency
    });
  };

  const createToken = () => {
    try {
      if (typeof window.crypto?.randomUUID === "function") return window.crypto.randomUUID();
      if (typeof window.crypto?.getRandomValues === "function") {
        const values = new Uint32Array(4);
        window.crypto.getRandomValues(values);
        return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("");
      }
    } catch (_error) {
      return "";
    }
    return "";
  };

  const replaceHistoryMarker = (marker) => {
    try {
      const currentState = isRecord(window.history.state) ? window.history.state : {};
      window.history.replaceState({ ...currentState, [HISTORY_KEY]: marker }, "", window.location.href);
      return true;
    } catch (_error) {
      return false;
    }
  };

  const clearHistoryMarker = (phase) => {
    try {
      if (!isRecord(window.history.state)) return;
      const marker = window.history.state[HISTORY_KEY];
      if (!isRecord(marker) || (phase && marker.phase !== phase)) return;
      const nextState = { ...window.history.state };
      delete nextState[HISTORY_KEY];
      window.history.replaceState(Object.keys(nextState).length ? nextState : null, "", window.location.href);
    } catch (_error) {
      // The marker is progressive enhancement; an unavailable history API stays inert.
    }
  };

  const discardStoredSignal = () => {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch (_error) {
      // Storage may be unavailable in hardened browsing modes.
    }
  };

  const storeSignal = (signal) => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(signal));
      return true;
    } catch (_error) {
      return false;
    }
  };

  const takeStoredSignal = () => {
    let serialized = null;
    try {
      serialized = window.sessionStorage.getItem(STORAGE_KEY);
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch (_error) {
      return null;
    }
    if (!serialized) return null;
    try {
      return JSON.parse(serialized);
    } catch (_error) {
      return null;
    }
  };

  const validSignal = (signal, destination, now = Date.now()) => {
    if (!isRecord(signal)) return false;
    if (Object.keys(signal).sort().join("|") !== SIGNAL_KEYS.join("|")) return false;
    if (signal.version !== 1 || signal.source !== "dashboard" || signal.destination !== destination) return false;
    if (!TOKEN_PATTERN.test(signal.token) || !Number.isFinite(signal.createdAt)) return false;
    const age = now - signal.createdAt;
    return age >= -MAX_CLOCK_SKEW_MS && age <= MAX_AGE_MS;
  };

  const isPlainActivation = ({
    defaultPrevented = false,
    button = 0,
    metaKey = false,
    ctrlKey = false,
    shiftKey = false,
    altKey = false,
    download = false,
    target = ""
  } = {}) => {
    const normalizedTarget = String(target).toLowerCase();
    return !defaultPrevented &&
      button === 0 &&
      !metaKey &&
      !ctrlKey &&
      !shiftKey &&
      !altKey &&
      !download &&
      (!normalizedTarget || normalizedTarget === "_self");
  };

  const plainPrimaryActivation = (event, anchor) => {
    return isPlainActivation({
      defaultPrevented: event.defaultPrevented,
      button: event.button,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      download: anchor.hasAttribute("download"),
      target: anchor.getAttribute("target") || ""
    });
  };

  const exactSignalDestination = (anchor) => {
    const destination = anchor.dataset.routeSignalDestination || "";
    const route = ROUTES[destination];
    if (!route) return null;
    let url;
    try {
      url = new URL(anchor.href, window.location.href);
    } catch (_error) {
      return null;
    }
    if (url.origin !== window.location.origin) return null;
    if (normalizedPath(url.pathname) !== route.path || url.search || url.hash) return null;
    return { destination, route, url };
  };

  const hideEmitter = () => {
    const emitter = document.querySelector("[data-route-signal-emitter]");
    if (emitter) {
      emitter.hidden = true;
      delete emitter.dataset.routeSignalState;
    }
    if (activeSourceLink) {
      delete activeSourceLink.dataset.routeSignalActive;
      activeSourceLink = null;
    }
    if (document.body) delete document.body.dataset.routeSignalOutbound;
  };

  const showEmitter = (anchor, destination, mode) => {
    const emitter = document.querySelector("[data-route-signal-emitter]");
    const label = emitter?.querySelector("[data-route-signal-emitter-label]");
    if (!emitter || !label) return;
    document.body.dataset.routeSignalMode = mode;
    document.body.dataset.routeSignalOutbound = destination;
    label.textContent = `DESTINATION ID · ${destination.toUpperCase()}`;
    emitter.dataset.routeSignalState = "transmitting";
    emitter.hidden = false;
    anchor.dataset.routeSignalActive = "true";
    activeSourceLink = anchor;
  };

  const hideReceiver = () => {
    document.querySelectorAll("[data-route-signal-receiver]").forEach((receiver) => {
      receiver.hidden = true;
      delete receiver.dataset.routeSignalState;
    });
    activeReceiver = null;
    if (document.body) delete document.body.dataset.routeSignalArrival;
  };

  const showReceiver = (destination, route, mode) => {
    const receiver = document.querySelector(`[data-route-signal-receiver="${destination}"]`);
    const state = receiver?.querySelector("[data-route-signal-receiver-state]");
    if (!receiver || !state) return;
    document.body.dataset.routeSignalMode = mode;
    document.body.dataset.routeSignalArrival = destination;
    state.textContent = route.locking;
    receiver.dataset.routeSignalState = "receiving";
    receiver.hidden = false;
    activeReceiver = receiver;
    const timing = TIMINGS[mode] || TIMINGS.constrained;
    schedule(() => {
      if (activeReceiver !== receiver) return;
      receiver.dataset.routeSignalState = "resolved";
      state.textContent = route.resolved;
    }, timing.settle);
    schedule(() => {
      if (activeReceiver === receiver) hideReceiver();
    }, timing.arrival);
  };

  const emitSignal = (event, anchor, destinationData) => {
    if (!plainPrimaryActivation(event, anchor)) return;
    if (outboundInFlight) {
      event.preventDefault();
      return;
    }

    const token = createToken();
    if (!token || !TOKEN_PATTERN.test(token)) return;
    const createdAt = Date.now();
    const signal = {
      version: 1,
      token,
      source: "dashboard",
      destination: destinationData.destination,
      createdAt
    };
    if (!storeSignal(signal)) return;
    if (!replaceHistoryMarker({
      phase: "outbound",
      source: "dashboard",
      destination: destinationData.destination,
      createdAt
    })) {
      discardStoredSignal();
      return;
    }

    event.preventDefault();
    outboundInFlight = true;
    const mode = signalMode();
    showEmitter(anchor, destinationData.destination, mode);
    document.dispatchEvent(new CustomEvent("route-signal:emit", {
      detail: { source: "dashboard", destination: destinationData.destination }
    }));
    const timing = TIMINGS[mode] || TIMINGS.constrained;
    schedule(hideEmitter, 500);
    schedule(() => window.location.assign(destinationData.url.href), timing.departure);
  };

  const onDocumentClick = (event) => {
    if (currentPage() !== "dashboard") return;
    const eventElement = event.target instanceof Element ? event.target : event.target?.parentElement;
    const anchor = eventElement?.closest?.("a[data-route-signal-link]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const destinationData = exactSignalDestination(anchor);
    if (!destinationData) return;
    emitSignal(event, anchor, destinationData);
  };

  const receiveSignal = () => {
    const destination = currentPage();
    const route = ROUTES[destination];
    if (!route || normalizedPath(window.location.pathname) !== route.path) return;
    const signal = takeStoredSignal();
    if (
      !signal ||
      navigationIsReplay() ||
      !isDashboardReferrer(document.referrer, window.location.origin) ||
      !validSignal(signal, destination)
    ) return;
    const resolvedAt = Date.now();
    replaceHistoryMarker({
      phase: "resolved",
      source: "dashboard",
      destination,
      resolvedAt
    });
    showReceiver(destination, route, signalMode());
    document.dispatchEvent(new CustomEvent("route-signal:receive", {
      detail: { source: "dashboard", destination }
    }));
  };

  const resetVisualState = () => {
    clearTimers();
    hideEmitter();
    hideReceiver();
    outboundInFlight = false;
  };

  const initialize = () => {
    if (!document.body) return;
    document.body.dataset.routeSignalReady = "true";
    if (currentPage() === "dashboard") {
      discardStoredSignal();
      clearHistoryMarker("outbound");
      document.addEventListener("click", onDocumentClick);
    } else {
      receiveSignal();
    }

    window.addEventListener("pagehide", resetVisualState);
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      resetVisualState();
      discardStoredSignal();
      clearHistoryMarker("outbound");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") hideReceiver();
    });
  };

  if (typeof module === "object" && module.exports) {
    module.exports = { ROUTES, SIGNAL_KEYS, TIMINGS, isDashboardReferrer, isPlainActivation, resolveMode, validSignal };
  }
  if (typeof window === "undefined" || typeof document === "undefined") return;
  initialize();
})();
