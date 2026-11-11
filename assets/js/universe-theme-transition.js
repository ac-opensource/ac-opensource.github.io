(function () {
  "use strict";

  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ARRIVAL_KEY = "ac.universe-perspective.v1";
  const TRAVEL_VERSION = 9;
  const MAX_ARRIVAL_AGE = 8000;
  // The source page is covered by its own sky before the document changes, so
  // the unavoidable hold between two documents lands on a still frame.
  const DEPARTURE_MS = 200;
  // A navigation that never commits must hand the page back.
  const STALLED_DEPARTURE_MS = 5000;
  const ARRIVAL_MS = 720;
  // The destination stays covered until it is parsed and its landmark is
  // decoded, so the reveal never competes with the page's own start-up work.
  const REVEAL_WAIT_CAP_MS = 1200;
  const VISUAL_WAIT_CAP_MS = 320;
  // Start-up work often arrives in a second wave (data resolving after the
  // parse). The reveal begins on the first two back-to-back frames that are
  // on time, or after this long at most.
  const QUIET_FRAME_MS = 34;
  const QUIET_WAIT_CAP_MS = 400;
  const SURFACE_SHIFT_MS = 220;
  const MAX_COPY_STAGGER = 5;
  const STYLE_HREF = "/assets/css/universe-perspective-navigation.css?v=20261110-fade-through1";
  const timers = new Set();
  const warmedDestinations = new Set();
  let transitionInFlight = false;
  let activeViewTransition = null;
  let travelGeneration = 0;
  let arrivalGeneration = null;
  let arrivalStartedAt = 0;
  let revealComplete = true;
  let lastTravel = null;
  let pendingDeparture = null;

  const DESTINATIONS = Object.freeze({
    home: Object.freeze({ key: "home", label: "Dashboard", mapId: "home", x: 50, y: 52, depth: 1, magnification: 1 }),
    about: Object.freeze({ key: "about", label: "About", mapId: "about", x: 12, y: 70, depth: 4.5, magnification: 1.6 }),
    profile: Object.freeze({ key: "profile", label: "Skills", mapId: "profile", x: 25, y: 24, depth: 7.4, magnification: 3.2 }),
    work: Object.freeze({ key: "work", label: "Portfolio", mapId: "work", x: 44, y: 15, depth: 3.1, magnification: 2.4 }),
    projects: Object.freeze({ key: "projects", label: "Production apps", mapId: "projects", x: 71, y: 26, depth: 8.8, magnification: 5.6 }),
    logs: Object.freeze({ key: "logs", label: "Logs", mapId: "threads", x: 87, y: 69, depth: 6.5, magnification: 2.8 }),
    contact: Object.freeze({ key: "contact", label: "Contact", mapId: "contact", x: 59, y: 88, depth: 4, magnification: 1.8 }),
    resume: Object.freeze({ key: "resume", label: "Resume", mapId: "work", x: 52, y: 20, depth: 6.2, magnification: 4.4 }),
    signals: Object.freeze({ key: "signals", label: "Signals", mapId: "contact", x: 66, y: 82, depth: 6.9, magnification: 3.6 }),
    search: Object.freeze({ key: "search", label: "Evidence search", mapId: "threads", x: 80, y: 52, depth: 5.4, magnification: 3.8 }),
  });

  // The defining illustration of each destination. It resolves first; the
  // copy beside its heading follows in reading order.
  const TARGET_VISUALS = Object.freeze({
    home: "[data-camera-window]",
    about: "#stellar-spectrum-panel",
    profile: "#stellar-spectrum-panel",
    work: ".work-hero__art",
    projects: ".work-bitcoin-stage",
    logs: "#galaxy-field, .galaxy-sky",
    article: ".article-region__hero",
    contact: "[data-payload-visual]",
    resume: "[data-resume-signature-visual]",
    signals: ".signals-hero__telemetry",
    search: ".evidence-search__console",
  });

  function motionIsReduced() {
    return reducedMotion.matches;
  }

  function now() {
    return typeof window.performance?.now === "function" ? window.performance.now() : Date.now();
  }

  function schedule(callback, delay) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function clearTimers() {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizedPath(pathname) {
    const path = String(pathname || "/").replace(/\/index\.html$/, "/");
    return path === "/about/" ? "/about.html" : path;
  }

  function stableArticleOffset(pathname) {
    let hash = 0;
    for (const character of pathname) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
    return {
      x: (hash % 11) - 5,
      y: (Math.floor(hash / 11) % 9) - 4,
    };
  }

  function articleDestination(pathname) {
    const offset = stableArticleOffset(pathname);
    return Object.freeze({
      key: "article",
      label: "Log detail",
      mapId: "threads",
      x: 87 + offset.x,
      y: 62 + offset.y,
      depth: 8.4 + ((offset.x + offset.y) * 0.08),
      magnification: 6.4,
    });
  }

  function destinationForLocation(pathname, hash = "") {
    const path = normalizedPath(pathname);
    if (path === "/" || path === "") return DESTINATIONS.home;
    if (path === "/about.html") {
      return hash === "#profile-map" || hash === "#profile-map-evidence"
        ? DESTINATIONS.profile
        : DESTINATIONS.about;
    }
    if (path === "/work.html") return hash === "#production-work" ? DESTINATIONS.projects : DESTINATIONS.work;
    if (path === "/blog/") return DESTINATIONS.logs;
    if (path.startsWith("/blog/") && path.endsWith(".html")) return articleDestination(path);
    if (path === "/contact.html") return DESTINATIONS.contact;
    if (path === "/resume.html") return DESTINATIONS.resume;
    if (path === "/signals.html") return DESTINATIONS.signals;
    if (path === "/search.html") return DESTINATIONS.search;
    return null;
  }

  function currentDestination() {
    return destinationForLocation(window.location.pathname, window.location.hash) || DESTINATIONS.home;
  }

  function aboutSurface() {
    if (["light", "dark"].includes(root.dataset.aboutTheme)) return root.dataset.aboutTheme;
    try {
      return window.localStorage.getItem("about-theme") === "light" ? "light" : "dark";
    } catch (_error) {
      return "dark";
    }
  }

  function surfaceForDestination(destination) {
    if (destination.key === "about" || destination.key === "profile") return aboutSurface();
    if (destination.key === "logs" || destination.key === "article") {
      if (["light", "dark"].includes(root.dataset.logsTheme)) return root.dataset.logsTheme;
      try { return window.localStorage.getItem("logs-theme") === "light" ? "light" : "dark"; }
      catch (_error) { return "dark"; }
    }
    return "light";
  }

  function skyPalette(source, destination) {
    const fromSurface = surfaceForDestination(source);
    const toSurface = surfaceForDestination(destination);
    if (fromSurface === "light" && toSurface === "light") {
      return {
        tone: "light",
        from: "#faf9f4",
        middle: "#f3f4ef",
        to: "#faf9f4",
        targetCore: "rgba(31, 92, 186, 0.96)",
        targetHalo: "rgba(31, 92, 186, 0.34)",
        starFar: "rgba(54, 79, 105, 0.7)",
        starMiddle: "rgba(31, 92, 186, 0.8)",
        starNear: "rgba(18, 122, 121, 0.82)",
      };
    }
    if (fromSurface === "dark" && toSurface === "dark") {
      return {
        tone: "dark",
        from: "#020817",
        middle: "#020817",
        to: "#020817",
        targetCore: "rgba(237, 246, 255, 0.94)",
        targetHalo: "rgba(126, 182, 255, 0.38)",
        starFar: "rgba(183, 216, 255, 0.68)",
        starMiddle: "rgba(126, 182, 255, 0.78)",
        starNear: "rgba(121, 232, 222, 0.72)",
      };
    }
    return {
      tone: "twilight",
      from: fromSurface === "dark" ? "#020817" : "#faf9f4",
      middle: fromSurface === "dark" ? "#020817" : "#faf9f4",
      to: toSurface === "dark" ? "#020817" : "#faf9f4",
      targetCore: "rgba(72, 137, 238, 0.98)",
      targetHalo: "rgba(72, 137, 238, 0.38)",
      starFar: "rgba(83, 119, 153, 0.72)",
      starMiddle: "rgba(72, 137, 238, 0.82)",
      starNear: "rgba(37, 151, 146, 0.82)",
    };
  }

  // The colour the page really paints, so the cover is indistinguishable from
  // the page it settles over. Falls back to the palette when it cannot be read.
  function pageSurface(fallback) {
    if (typeof window.getComputedStyle !== "function") return fallback;
    for (const element of [document.body, root]) {
      if (!element) continue;
      let color = "";
      try {
        color = window.getComputedStyle(element).backgroundColor || "";
      } catch (_error) {
        color = "";
      }
      const channels = color.match(/[\d.]+/g);
      if (!channels || channels.length < 3) continue;
      if (channels.length >= 4 && Number(channels[3]) < 1) continue;
      return color;
    }
    return fallback;
  }

  function surfacesDiffer(first, second) {
    const read = (color) => (String(color || "").match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const a = read(first);
    const b = read(second);
    if (a.length < 3 || b.length < 3) return false;
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) > 24;
  }

  function directionFor(deltaX, deltaY) {
    if (Math.abs(deltaX) < 4 && Math.abs(deltaY) < 4) return "depth";
    if (Math.abs(deltaX) >= Math.abs(deltaY) * 0.55 && Math.abs(deltaY) >= Math.abs(deltaX) * 0.55) {
      return `${deltaY > 0 ? "south" : "north"}${deltaX > 0 ? "east" : "west"}`;
    }
    if (Math.abs(deltaX) >= Math.abs(deltaY)) return deltaX > 0 ? "east" : "west";
    return deltaY > 0 ? "south" : "north";
  }

  function createTravel(source, destination, targetUrl) {
    const deltaX = destination.x - source.x;
    const deltaY = destination.y - source.y;
    const deltaDepth = destination.depth - source.depth;
    const angularDistance = Math.hypot(deltaX, deltaY);
    const cameraX = clamp(deltaX * -0.09, -4.5, 4.5);
    const cameraY = clamp(deltaY * -0.065, -3.5, 3.5);
    const cameraZ = clamp(deltaDepth * -24, -150, 150);
    const magnificationRatio = destination.magnification / source.magnification;
    const magnificationShift = Math.abs(Math.log2(magnificationRatio));
    const cameraScale = clamp(1.035 + (angularDistance * 0.0005) + (magnificationShift * 0.022), 1.04, 1.1);
    const cameraTiltX = clamp(deltaY * 0.011, -0.62, 0.62);
    const cameraTiltY = clamp(deltaX * -0.013, -0.78, 0.78);
    const skyX = clamp(deltaX * -0.82, -58, 58);
    const skyY = clamp(deltaY * -0.62, -46, 46);
    const targetEntryDistance = clamp(58 + (angularDistance * 0.3), 60, 78);
    const targetEntryX = angularDistance < 1 ? 0 : (deltaX / angularDistance) * targetEntryDistance;
    const targetEntryY = angularDistance < 1 ? 0 : (deltaY / angularDistance) * targetEntryDistance;
    const targetStartScale = clamp(1 / Math.sqrt(magnificationRatio), 0.46, 1.7);
    const palette = skyPalette(source, destination);
    const depthDirection = Math.abs(deltaDepth) < 0.25 ? "level" : deltaDepth > 0 ? "farther" : "nearer";
    // The landmark settles in place: a short drift along the bearing and a
    // small change of scale along the depth axis, never a sheet crossing the
    // screen.
    const depthSign = depthDirection === "farther" ? -1 : depthDirection === "nearer" ? 1 : 0;
    const depthShift = clamp(Math.abs(deltaDepth) / 8, 0.25, 1);
    const visualEntryX = targetEntryX * 0.03;
    const visualEntryY = targetEntryY * 0.03;
    const visualStartScale = 1 + (depthSign * 0.038 * depthShift) - (depthSign === 0 ? 0.024 : 0);
    const duration = Math.round(clamp(
      620 + (angularDistance * 1.7) + (Math.abs(deltaDepth) * 10),
      660,
      780
    ));
    return {
      version: TRAVEL_VERSION,
      motionModel: "observer-camera-3d",
      searchModel: "directional-guiding-scope",
      transitionModel: "fade-through",
      createdAt: Date.now(),
      destinationUrl: `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`,
      from: source.key,
      fromLabel: source.label,
      fromDepth: source.depth,
      fromMagnification: source.magnification,
      to: destination.key,
      toLabel: destination.label,
      toMapId: destination.mapId,
      toDepth: destination.depth,
      toMagnification: destination.magnification,
      direction: directionFor(deltaX, deltaY),
      depthDirection,
      duration,
      departure: DEPARTURE_MS,
      searchStart: 0.22,
      searchEnd: 0.68,
      cameraX,
      cameraY,
      cameraZ,
      cameraScale,
      cameraTiltX,
      cameraTiltY,
      skyX,
      skyY,
      // Parallax stays inside the planes' overscan, so no plane edge is ever
      // exposed while the field settles.
      farX: skyX * 0.04,
      farY: skyY * 0.04,
      middleX: skyX * 0.09,
      middleY: skyY * 0.09,
      nearX: skyX * 0.16,
      nearY: skyY * 0.16,
      farScale: 1 + (depthSign * 0.012 * depthShift),
      middleScale: 1 + (depthSign * 0.03 * depthShift),
      nearScale: 1 + (depthSign * 0.062 * depthShift),
      targetEntryX,
      targetEntryY,
      targetStartScale,
      visualEntryX,
      visualEntryY,
      visualStartScale,
      surfaceFrom: pageSurface(palette.from),
      skyTone: palette.tone,
      skyFrom: palette.from,
      skyMiddle: palette.middle,
      skyTo: palette.to,
      targetCore: palette.targetCore,
      targetHalo: palette.targetHalo,
      starFar: palette.starFar,
      starMiddle: palette.starMiddle,
      starNear: palette.starNear,
      focusX: clamp(destination.x, 22, 78),
      focusY: clamp(destination.y, 20, 80),
    };
  }

  function installDepthField() {
    if (!document.body || document.querySelector("[data-universe-depth-field]")) return;
    const field = document.createElement("div");
    field.className = "universe-depth-field";
    field.dataset.universeDepthField = "";
    field.dataset.tone = currentDestination().key === "about" ? "dark" : "light";
    field.setAttribute("aria-hidden", "true");
    field.innerHTML = `
      <i class="universe-depth-field__veil" data-universe-veil></i>
      <i class="universe-depth-field__plane universe-depth-field__plane--far" data-universe-depth-plane="far"></i>
      <i class="universe-depth-field__plane universe-depth-field__plane--middle" data-universe-depth-plane="middle"></i>
      <i class="universe-depth-field__plane universe-depth-field__plane--near" data-universe-depth-plane="near"></i>
      <i class="universe-depth-field__supernova" data-universe-work-supernova></i>
      <i class="universe-depth-field__target" data-universe-target-cue></i>
    `;
    document.body.prepend(field);
    // An arriving document needs its real surface for the cover right away.
    // A plain load does not, and is spared the early style calculation.
    if (root.dataset.universeMotion === "arrive") applyDestinationSurface();
  }

  // The surface this document really paints. It backs the arrival cover and
  // the fade-through of travel the controller did not stage.
  function applyDestinationSurface() {
    root.style.setProperty("--universe-surface-to", pageSurface(
      surfaceForDestination(currentDestination()) === "dark" ? "#020817" : "#faf9f4"
    ));
  }

  // The cover has to exist in the destination's very first frame, so the field
  // is mounted the moment the parser creates <body>, not at DOMContentLoaded.
  function installDepthFieldWhenPossible() {
    if (document.body) {
      installDepthField();
      return;
    }
    if (typeof window.MutationObserver === "function") {
      const observer = new window.MutationObserver(() => {
        if (!document.body) return;
        observer.disconnect();
        installDepthField();
      });
      observer.observe(root, { childList: true });
    }
    document.addEventListener("DOMContentLoaded", installDepthField, { once: true });
  }

  function ensureStylesheet() {
    if (document.querySelector("link[data-universe-perspective-styles]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = STYLE_HREF;
    link.dataset.universePerspectiveStyles = "";
    document.head.append(link);
  }

  function crossDocumentTransitionsSupported() {
    return "onpageswap" in window
      && "onpagereveal" in window
      && typeof window.CSS?.supports === "function"
      && window.CSS.supports("view-transition-name: universe-page");
  }

  // Departure writes the travel geometry onto the depth field alone: an
  // inherited custom property set on the root would restyle the whole page on
  // the click. Arrival runs before the body is parsed, so the root is free.
  function applyTravel(travel, host = root) {
    lastTravel = travel;
    root.dataset.universeTravel = travel.direction;
    root.dataset.universeDepthTravel = travel.depthDirection;
    root.dataset.universePerspectiveFrom = travel.from;
    root.dataset.universePerspectiveTo = travel.to;
    root.dataset.universeSky = travel.skyTone;
    const set = (name, value) => host.style.setProperty(name, value);
    set("--universe-perspective-duration", `${travel.duration || ARRIVAL_MS}ms`);
    set("--universe-depart-duration", `${travel.departure || DEPARTURE_MS}ms`);
    set("--universe-surface-from", travel.surfaceFrom || travel.skyFrom);
    set("--universe-focus-x", `${travel.focusX.toFixed(2)}%`);
    set("--universe-focus-y", `${travel.focusY.toFixed(2)}%`);
    set("--universe-target-core", travel.targetCore);
    set("--universe-target-halo", travel.targetHalo);
    set("--universe-slew-star-far", travel.starFar);
    set("--universe-slew-star-middle", travel.starMiddle);
    set("--universe-slew-star-near", travel.starNear);
    // Each plane waits at the offset the observer has yet to cross and glides
    // home as the destination resolves: the nearest stars travel furthest.
    set("--universe-far-x", `${(-travel.farX).toFixed(2)}vw`);
    set("--universe-far-y", `${(-travel.farY).toFixed(2)}vh`);
    set("--universe-far-scale", (travel.farScale || 1).toFixed(4));
    set("--universe-middle-x", `${(-travel.middleX).toFixed(2)}vw`);
    set("--universe-middle-y", `${(-travel.middleY).toFixed(2)}vh`);
    set("--universe-middle-scale", (travel.middleScale || 1).toFixed(4));
    set("--universe-near-x", `${(-travel.nearX).toFixed(2)}vw`);
    set("--universe-near-y", `${(-travel.nearY).toFixed(2)}vh`);
    set("--universe-near-scale", (travel.nearScale || 1).toFixed(4));
    if (host === root) {
      set("--universe-visual-entry-x", `${(travel.visualEntryX || 0).toFixed(2)}vw`);
      set("--universe-visual-entry-y", `${(travel.visualEntryY || 0).toFixed(2)}vh`);
      set("--universe-visual-start-scale", (travel.visualStartScale || 0.976).toFixed(4));
    }
  }

  function targetVisuals() {
    const selector = TARGET_VISUALS[currentDestination().key];
    if (!selector) return [];
    try {
      return [...document.querySelectorAll(selector)];
    } catch (_error) {
      return [];
    }
  }

  // Tag the landmark and the copy stacked with the page heading. CSS resolves
  // the landmark first and then each line of copy, one step apart.
  function markArrivalTargets() {
    const visuals = targetVisuals();
    visuals.forEach((visual) => { visual.dataset.universeTargetVisual = ""; });
    const heading = document.querySelector("main h1");
    const stack = heading?.parentElement;
    if (!heading || !stack) return;
    const lines = [...stack.children].filter((line) => !visuals.some((visual) => line.contains(visual)));
    const copy = lines.length && lines.length <= 8 && lines.includes(heading) ? lines : [heading];
    copy.forEach((line, index) => {
      line.dataset.universeCopy = "";
      line.style.setProperty("--universe-copy-index", String(Math.min(index, MAX_COPY_STAGGER - 1)));
    });
    // The Portfolio detonation is centred on its landmark.
    const field = document.querySelector("[data-universe-depth-field]");
    const bounds = visuals[0]?.getBoundingClientRect?.();
    if (field && bounds && bounds.width > 0 && bounds.height > 0) {
      field.style.setProperty("--universe-visual-x", `${(bounds.left + (bounds.width / 2)).toFixed(1)}px`);
      field.style.setProperty("--universe-visual-y", `${(bounds.top + (bounds.height / 2)).toFixed(1)}px`);
    }
  }

  function clearArrivalTargets() {
    document.querySelectorAll("[data-universe-target-visual]").forEach((visual) => {
      delete visual.dataset.universeTargetVisual;
    });
    document.querySelectorAll("[data-universe-copy]").forEach((line) => {
      delete line.dataset.universeCopy;
      line.style.removeProperty("--universe-copy-index");
    });
  }

  function clearTravelState({ keepLast = true, generation = null } = {}) {
    if (generation !== null && generation !== travelGeneration) return;
    clearTimers();
    transitionInFlight = false;
    pendingDeparture = null;
    activeViewTransition = null;
    revealComplete = true;
    clearArrivalTargets();
    root.dataset.universePerspective = "ready";
    delete root.dataset.universeMotion;
    delete root.dataset.universePhase;
    delete root.dataset.universeTravel;
    delete root.dataset.universeDepthTravel;
    delete root.dataset.universePerspectiveFrom;
    delete root.dataset.universePerspectiveTo;
    delete root.dataset.universeSky;
    if (!keepLast) lastTravel = null;
    document.dispatchEvent(new CustomEvent("universe-perspective:settled", {
      detail: { generation: travelGeneration },
    }));
  }

  function skipActiveTransition() {
    const transition = activeViewTransition;
    activeViewTransition = null;
    if (!transition) return;
    try {
      transition.skipTransition();
    } catch (_error) {
      // The transition may already be settling. The new navigation still wins.
    }
  }

  function storeArrival(travel) {
    try {
      window.sessionStorage.setItem(ARRIVAL_KEY, JSON.stringify(travel));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function takeArrival() {
    let serialized = null;
    try {
      serialized = window.sessionStorage.getItem(ARRIVAL_KEY);
      window.sessionStorage.removeItem(ARRIVAL_KEY);
    } catch (_error) {
      return null;
    }
    if (!serialized) return null;
    try {
      const travel = JSON.parse(serialized);
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (!travel
        || travel.version !== TRAVEL_VERSION
        || travel.motionModel !== "observer-camera-3d"
        || travel.searchModel !== "directional-guiding-scope"
        || Date.now() - travel.createdAt > MAX_ARRIVAL_AGE
        || travel.createdAt - Date.now() > 1000
        || travel.destinationUrl !== currentUrl) return null;
      return travel;
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

  function inFlightAnchorAtPoint(event) {
    if (!transitionInFlight || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    const candidates = document.querySelectorAll([
      "[data-universe-route-map] a[href]",
      "#site-nav a[href]",
      ".site-topbar a[href]",
      ".signals-topbar a[href]",
    ].join(","));
    return [...candidates].find((candidate) => {
      const style = window.getComputedStyle(candidate);
      const bounds = candidate.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && style.pointerEvents !== "none"
        && bounds.width > 0
        && bounds.height > 0
        && event.clientX >= bounds.left
        && event.clientX <= bounds.right
        && event.clientY >= bounds.top
        && event.clientY <= bounds.bottom;
    }) || null;
  }

  function announceDeparture(travel) {
    document.dispatchEvent(new CustomEvent("universe-perspective:depart", {
      detail: {
        direction: travel.direction,
        depthDirection: travel.depthDirection,
        from: travel.from,
        magnification: travel.toMagnification,
        mapId: travel.toMapId,
        retargeted: travel.retargeted,
        to: travel.to,
      },
    }));
  }

  function completeDeparture(generation) {
    if (!pendingDeparture || generation !== travelGeneration || pendingDeparture.generation !== generation) return;
    const href = pendingDeparture.href;
    pendingDeparture = null;
    try {
      window.location.assign(href);
    } catch (_error) {
      clearTravelState({ keepLast: false, generation });
    }
  }

  function documentLinkTypeSupported(type) {
    try {
      return Boolean(window.HTMLScriptElement?.supports?.(type));
    } catch (_error) {
      return false;
    }
  }

  // Fetch the destination document while the source is still being covered,
  // so the swap waits on the animation and not on the network.
  function warmDestination(targetUrl) {
    const href = `${targetUrl.origin}${targetUrl.pathname}${targetUrl.search}`;
    if (warmedDestinations.has(href) || !document.head) return;
    warmedDestinations.add(href);
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = href;
    link.dataset.universeWarmedDestination = "";
    document.head.append(link);
  }

  // Where the browser can do it natively, fetch a destination as soon as the
  // pointer commits to it. Only the document is fetched; nothing runs early.
  function installSpeculativePrefetch() {
    if (!document.head || !documentLinkTypeSupported("speculationrules")) return false;
    const rules = document.createElement("script");
    rules.type = "speculationrules";
    rules.dataset.universeSpeculation = "";
    rules.textContent = JSON.stringify({
      prefetch: [{
        where: {
          and: [
            { href_matches: "/*" },
            { not: { href_matches: "/assets/*" } },
            { not: { href_matches: "/*.pdf" } },
            { not: { href_matches: "/*.xml" } },
            { not: { selector_matches: "[download], [target=_blank], [rel~=external]" } },
          ],
        },
        eagerness: "moderate",
      }],
    });
    document.head.append(rules);
    return true;
  }

  function beginDeparture(event, anchor, targetUrl, destination, { proxied = false } = {}) {
    const retargeted = transitionInFlight;
    const generation = ++travelGeneration;
    if (retargeted) {
      skipActiveTransition();
      clearTimers();
      transitionInFlight = false;
    }

    const travel = createTravel(currentDestination(), destination, targetUrl);
    travel.retargeted = retargeted;
    transitionInFlight = true;
    revealComplete = true;
    clearArrivalTargets();
    installDepthField();
    applyTravel(travel, document.querySelector("[data-universe-depth-field]") || root);
    storeArrival(travel);
    delete root.dataset.universePhase;
    root.dataset.universePerspective = "departing";
    root.dataset.universeMotion = "depart";
    announceDeparture(travel);

    if (motionIsReduced()) {
      clearTravelState({ generation });
      return;
    }

    event.preventDefault();
    // A pointer press already triggers the native prefetch; a keyboard or
    // synthetic activation has not, and other engines need the hint too.
    if (!speculativePrefetch || event.detail === 0) warmDestination(targetUrl);
    pendingDeparture = { generation, href: targetUrl.href };
    const departureDelay = travel.departure || DEPARTURE_MS;
    schedule(() => completeDeparture(generation), departureDelay);
    schedule(() => clearTravelState({ generation }), departureDelay + STALLED_DEPARTURE_MS);
  }

  function settleArrival(generation) {
    if (generation !== travelGeneration || !revealComplete || activeViewTransition) return;
    clearTravelState({ generation });
  }

  function beginReveal(generation) {
    if (generation !== travelGeneration
      || root.dataset.universeMotion !== "arrive"
      || root.dataset.universePhase === "reveal") return;
    markArrivalTargets();
    root.dataset.universePhase = "reveal";
    schedule(() => {
      revealComplete = true;
      settleArrival(generation);
    }, (lastTravel?.duration || ARRIVAL_MS) + 80);
  }

  function whenDocumentParsed(callback) {
    if (document.readyState !== "loading") callback();
    else document.addEventListener("DOMContentLoaded", callback, { once: true });
  }

  function whenTargetVisualDecoded(callback) {
    const pending = targetVisuals()
      .flatMap((visual) => (visual.matches?.("img") ? [visual] : [...visual.querySelectorAll("img")]))
      .filter((image) => !image.complete && image.loading !== "lazy" && typeof image.decode === "function");
    if (!pending.length) {
      callback();
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      callback();
    };
    schedule(finish, VISUAL_WAIT_CAP_MS);
    Promise.all(pending.map((image) => image.decode().catch(() => {}))).then(finish);
  }

  function whenFramesAreOnTime(callback) {
    const deadline = now() + QUIET_WAIT_CAP_MS;
    let previous = 0;
    let onTime = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      callback();
    };
    const step = () => {
      if (finished) return;
      const time = now();
      if (previous) onTime = time - previous <= QUIET_FRAME_MS ? onTime + 1 : 0;
      previous = time;
      if (onTime >= 2 || time >= deadline) finish();
      else window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
    // A renderer too starved to deliver frames must not hold the cover.
    schedule(finish, QUIET_WAIT_CAP_MS + 60);
  }

  // Hold the cover until the destination has been parsed, its deferred
  // scripts have run, its landmark is decoded and the main thread is keeping
  // up with the display. Nothing moves until the page can move smoothly.
  function prepareReveal(generation, travel) {
    let started = false;
    const start = () => {
      if (started || generation !== travelGeneration) return;
      started = true;
      // Let the sky finish changing colour before content shows through it.
      const mixedSurface = surfacesDiffer(travel.surfaceFrom, pageSurface(travel.surfaceFrom));
      const earliest = arrivalStartedAt + (mixedSurface ? SURFACE_SHIFT_MS - 40 : 0);
      const reveal = () => whenFramesAreOnTime(() => beginReveal(generation));
      const wait = earliest - now();
      if (wait > 0) schedule(reveal, wait);
      else reveal();
    };
    schedule(start, REVEAL_WAIT_CAP_MS);
    whenDocumentParsed(() => whenTargetVisualDecoded(start));
  }

  ensureStylesheet();
  installDepthFieldWhenPossible();
  const crossDocument = crossDocumentTransitionsSupported();
  const speculativePrefetch = installSpeculativePrefetch();
  root.dataset.universeCrossDocument = crossDocument ? "true" : "false";
  root.dataset.universePerspective = "ready";

  const arrival = takeArrival();
  if (arrival && !motionIsReduced()) {
    arrivalGeneration = ++travelGeneration;
    arrivalStartedAt = now();
    transitionInFlight = true;
    revealComplete = false;
    applyTravel(arrival);
    root.dataset.universePerspective = "arriving";
    root.dataset.universeMotion = "arrive";
    root.dataset.universePhase = "cover";
    prepareReveal(arrivalGeneration, arrival);
  }

  window.addEventListener("pageswap", (event) => {
    if (event.viewTransition) activeViewTransition = event.viewTransition;
  });

  window.addEventListener("pagereveal", (event) => {
    // History traversal and links outside the field fade through this
    // document's own surface.
    if (event.viewTransition && !root.dataset.universeMotion) applyDestinationSurface();
    if (!arrival || motionIsReduced()) return;
    if (!event.viewTransition) {
      // Capability support does not guarantee a transition for this navigation.
      root.dataset.universeCrossDocument = "false";
      return;
    }
    const transition = event.viewTransition;
    activeViewTransition = transition;
    transition.finished.finally(() => {
      if (activeViewTransition === transition) activeViewTransition = null;
      settleArrival(arrivalGeneration);
    });
  });

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    const directAnchor = target?.closest("a[href]");
    const anchor = directAnchor instanceof HTMLAnchorElement ? directAnchor : inFlightAnchorAtPoint(event);
    if (!(anchor instanceof HTMLAnchorElement) || !plainActivation(event, anchor)) return;
    if (anchor.hasAttribute("data-route-signal-link")) return;

    let targetUrl;
    try {
      targetUrl = new URL(anchor.href, window.location.href);
    } catch (_error) {
      return;
    }
    if (targetUrl.origin !== window.location.origin) return;
    if (`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}` === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;

    const destination = destinationForLocation(targetUrl.pathname, targetUrl.hash);
    if (!destination) return;
    if (normalizedPath(targetUrl.pathname) === normalizedPath(window.location.pathname)) return;
    beginDeparture(event, anchor, targetUrl, destination, { proxied: anchor !== directAnchor });
  }, true);

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) clearTravelState({ keepLast: false });
  });

  function settleForMotionPreference() {
    if (!motionIsReduced()) return;
    skipActiveTransition();
    // Stop the visual delay without dropping the navigation already intercepted.
    completeDeparture(travelGeneration);
    clearTravelState({ keepLast: false });
  }

  reducedMotion.addEventListener?.("change", settleForMotionPreference);

  window.UniversePerspective = Object.freeze({
    snapshot() {
      const current = currentDestination();
      return Object.freeze({
        current: current.key,
        currentMapId: current.mapId,
        depth: current.depth,
        depthPlanes: document.querySelectorAll("[data-universe-depth-plane]").length,
        magnification: current.magnification,
        model: "observer-camera-3d",
        searchModel: "directional-guiding-scope",
        crossDocument,
        lastTravel: lastTravel ? Object.freeze({ ...lastTravel }) : null,
        motion: root.dataset.universeMotion || null,
        activeTransition: Boolean(activeViewTransition),
        pendingCleanup: timers.size,
        phase: root.dataset.universePhase || null,
        prefetch: speculativePrefetch ? "speculation-rules" : "link",
        ready: root.dataset.universePerspective || "pending",
        retargetable: true,
        targetVisual: TARGET_VISUALS[current.key] || null,
        transitionModel: "fade-through",
        stylesheet: Boolean(document.querySelector("link[data-universe-perspective-styles]")),
      });
    },
  });
})();
