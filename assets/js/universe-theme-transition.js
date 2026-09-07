(function () {
  "use strict";

  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ARRIVAL_KEY = "ac.universe-perspective.v1";
  const MAX_ARRIVAL_AGE = 8000;
  const FALLBACK_DEPARTURE_MS = 720;
  const ARRIVAL_MS = 1320;
  const STYLE_HREF = "/assets/css/universe-perspective-navigation.css?v=20260820-fast-travel1";
  const forcedColors = window.matchMedia("(forced-colors: active)");
  const timers = new Set();
  let pendingDestination = null;
  let transitionInFlight = false;
  let activeViewTransition = null;
  let travelGeneration = 0;
  let arrivalGeneration = null;
  let lastTravel = null;

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

  function motionIsReduced() {
    return reducedMotion.matches || forcedColors.matches;
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
    return destination.key === "about" || destination.key === "profile" ? aboutSurface() : "light";
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

  const LANDMARKS = Object.freeze({
    home: "[data-camera-window]", work: ".work-hero__art",
    projects: ".work-bitcoin-stage", about: "#stellar-spectrum-panel",
    profile: "#stellar-spectrum-panel", logs: "#galaxy-sky",
    article: ".article-region__hero", contact: "[data-payload-visual]",
    resume: "[data-resume-signature-visual]", signals: ".signals-hero__telemetry",
    search: ".evidence-search__console",
  });

  function landmarkOffset(key, focusX, focusY) {
    const landmark = document.querySelector(LANDMARKS[key] || "main");
    if (!landmark) return { x: 0, y: 0 };
    // Live fallback arrivals already translate the element. Measure its resting
    // box, otherwise a second alignment would cancel the first flight offset.
    const animation = landmark.style.getPropertyValue("animation");
    const priority = landmark.style.getPropertyPriority("animation");
    landmark.style.setProperty("animation", "none", "important");
    const bounds = landmark.getBoundingClientRect();
    if (animation) landmark.style.setProperty("animation", animation, priority);
    else landmark.style.removeProperty("animation");
    if (!bounds.width || !bounds.height) return { x: 0, y: 0 };
    return {
      x: window.innerWidth * focusX / 100 - (bounds.left + bounds.width / 2),
      y: window.innerHeight * focusY / 100 - (bounds.top + bounds.height / 2),
    };
  }

  function alignArrivalLandmark() {
    if (!lastTravel || root.dataset.universeMotion !== "arrive") return;
    const offset = landmarkOffset(lastTravel.to, lastTravel.focusX, lastTravel.focusY);
    root.style.setProperty("--universe-landmark-x", `${offset.x.toFixed(2)}px`);
    root.style.setProperty("--universe-landmark-y", `${offset.y.toFixed(2)}px`);
    installCurvedPath(lastTravel, offset);
  }

  function installCurvedPath(travel, arrivalOffset) {
    let style = document.querySelector("style[data-universe-trajectory]");
    if (!style) {
      style = document.createElement("style");
      style.dataset.universeTrajectory = "";
      document.head.append(style);
    }
    const bendX = (travel.curveX || 0) * window.innerWidth / 100;
    const bendY = (travel.curveY || 0) * window.innerHeight / 100;
    const cubic = (a, b, c, d, t) => {
      const u = 1 - t;
      return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
    };
    // Sample a cubic spatial arc; adjacent samples share the curve's tangent.
    // CSS interpolates the samples on the compositor without a frame loop.
    const frames = Array.from({ length: 41 }, (_, index) => {
      const t = index / 40;
      const x = cubic(arrivalOffset.x, arrivalOffset.x + bendX, bendX * 0.6, 0, t);
      const y = cubic(arrivalOffset.y, arrivalOffset.y + bendY, bendY * 0.6, 0, t);
      const z = cubic(-620, -420 - (travel.curveZ || 0), 100, 0, t);
      const scale = 0.018 + 0.982 * t * t;
      return `${(56 + 44 * t).toFixed(2)}% { opacity: ${Math.min(1, t * 10).toFixed(3)}; transform: translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateX(${((travel.cameraTiltX || 0) * (1 - t)).toFixed(2)}deg) rotateY(${((travel.cameraTiltY || 0) * (1 - t)).toFixed(2)}deg) scale(${scale.toFixed(5)}); }`;
    });
    const release = Array.from({ length: 25 }, (_, index) => {
      const t = index / 24;
      const x = cubic(0, -bendX * 0.7, (travel.sourceOffsetX || 0) * 0.6 - bendX * 0.3, travel.sourceOffsetX || 0, t);
      const y = cubic(0, -bendY * 0.7, (travel.sourceOffsetY || 0) * 0.6 - bendY * 0.3, travel.sourceOffsetY || 0, t);
      const z = cubic(0, -80, -380, -650, t);
      return `${(34 * t).toFixed(2)}% { opacity: ${(t === 1 ? 0 : 1 - t * 0.7).toFixed(3)}; transform: translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) scale(${(0.006 + 0.994 * Math.pow(1 - t, 3)).toFixed(5)}); }`;
    });
    style.textContent = `@keyframes universe-world-arrive { 0% { opacity: 0; } ${frames.join("\n")} }
@keyframes universe-visual-release { ${release.join("\n")} 100% { opacity: 0; } }`;
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
    const cameraZ = clamp(deltaDepth * 24, -150, 150);
    const magnificationRatio = destination.magnification / source.magnification;
    const magnificationShift = Math.abs(Math.log2(magnificationRatio));
    const cameraScale = clamp(1.035 + (angularDistance * 0.0005) + (magnificationShift * 0.022), 1.04, 1.1);
    const cameraTiltX = clamp(deltaY * 0.11, -8, 8);
    const cameraTiltY = clamp(deltaX * -0.14, -11, 11);
    const skyX = clamp(deltaX * -0.82, -58, 58);
    const skyY = clamp(deltaY * -0.62, -46, 46);
    const targetEntryDistance = clamp(58 + (angularDistance * 0.3), 60, 78);
    const targetEntryX = angularDistance < 1 ? 0 : (deltaX / angularDistance) * targetEntryDistance;
    const targetEntryY = angularDistance < 1 ? 0 : (deltaY / angularDistance) * targetEntryDistance;
    const targetStartScale = clamp(1 / Math.sqrt(magnificationRatio), 0.46, 1.7);
    const palette = skyPalette(source, destination);
    const depthDirection = Math.abs(deltaDepth) < 0.25 ? "level" : deltaDepth > 0 ? "farther" : "nearer";
    const duration = Math.round(clamp(
      1160 + (angularDistance * 1.7) + (Math.abs(deltaDepth) * 10),
      1240,
      1420
    ));
    // A fixed atlas supplies X, Y and Z. Reverse trips use the same bend,
    // traversed from the other end, instead of choosing a random entrance.
    const deltaZ = deltaDepth * 12;
    const distance3D = Math.hypot(deltaX, deltaY, deltaZ);
    const yaw = Math.atan2(deltaX, deltaZ || 0.001);
    const pitch = Math.atan2(deltaY, Math.hypot(deltaX, deltaZ));
    const focusX = clamp(50 + Math.sin(yaw) * 52, 2, 98);
    const focusY = clamp(48 + Math.sin(pitch) * 42, 8, 90);
    const orientation = source.x !== destination.x
      ? Math.sign(destination.x - source.x)
      : Math.sign(destination.y - source.y) || 1;
    const bend = clamp(distance3D * 0.24, 12, 28);
    const curveX = angularDistance ? (-deltaY / angularDistance) * bend * orientation : bend;
    const curveY = angularDistance ? (deltaX / angularDistance) * bend * 0.7 * orientation : bend * 0.5;
    const sourceOffset = landmarkOffset(source.key, 100 - focusX, 96 - focusY);
    return {
      version: 8,
      travelMethod: "curved-spatial-continuity",
      worldFrom: [source.x, source.y, source.depth * 12],
      worldTo: [destination.x, destination.y, destination.depth * 12],
      distance3D,
      headingYaw: yaw * 180 / Math.PI,
      headingPitch: pitch * 180 / Math.PI,
      curveX,
      curveY,
      curveZ: clamp(distance3D * 1.2, 36, 140),
      sourceOffsetX: sourceOffset.x,
      sourceOffsetY: sourceOffset.y,
      motionModel: "observer-camera-3d",
      searchModel: "directional-guiding-scope",
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
      searchStart: 0.28,
      searchEnd: 0.60,
      cameraX,
      cameraY,
      cameraZ,
      cameraScale,
      cameraTiltX,
      cameraTiltY,
      skyX,
      skyY,
      farX: skyX * 0.28,
      farY: skyY * 0.28,
      middleX: skyX * 0.66,
      middleY: skyY * 0.66,
      nearX: skyX * 1.18,
      nearY: skyY * 1.18,
      targetEntryX,
      targetEntryY,
      targetStartScale,
      skyTone: palette.tone,
      skyFrom: palette.from,
      skyMiddle: palette.middle,
      skyTo: palette.to,
      targetCore: palette.targetCore,
      targetHalo: palette.targetHalo,
      starFar: palette.starFar,
      starMiddle: palette.starMiddle,
      starNear: palette.starNear,
      focusX,
      focusY,
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
      <i class="universe-depth-field__plane universe-depth-field__plane--far" data-universe-depth-plane="far"></i>
      <i class="universe-depth-field__plane universe-depth-field__plane--middle" data-universe-depth-plane="middle"></i>
      <i class="universe-depth-field__plane universe-depth-field__plane--near" data-universe-depth-plane="near"></i>
      <i class="universe-depth-field__supernova" data-universe-work-supernova></i>
      <i class="universe-depth-field__target" data-universe-target-cue></i>
    `;
    document.body.prepend(field);
    alignArrivalLandmark();
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

  function applyTravel(travel) {
    lastTravel = travel;
    root.style.setProperty("--universe-arrival-animation", "universe-world-arrive");
    root.style.setProperty("--universe-release-x", `${Number(travel.sourceOffsetX || 0).toFixed(2)}px`);
    root.style.setProperty("--universe-release-y", `${Number(travel.sourceOffsetY || 0).toFixed(2)}px`);
    root.dataset.universeTravel = travel.direction;
    root.dataset.universeDepthTravel = travel.depthDirection;
    root.dataset.universePerspectiveFrom = travel.from;
    root.dataset.universePerspectiveTo = travel.to;
    root.style.setProperty("--universe-perspective-duration", `${travel.duration || ARRIVAL_MS}ms`);
    root.style.setProperty("--universe-camera-x", `${travel.cameraX.toFixed(2)}vw`);
    root.style.setProperty("--universe-camera-y", `${travel.cameraY.toFixed(2)}vh`);
    root.style.setProperty("--universe-curve-x", `${Number(travel.curveX || 0).toFixed(2)}vw`);
    root.style.setProperty("--universe-curve-y", `${Number(travel.curveY || 0).toFixed(2)}vh`);
    root.style.setProperty("--universe-camera-z", `${travel.cameraZ.toFixed(2)}px`);
    root.style.setProperty("--universe-camera-scale", travel.cameraScale.toFixed(4));
    root.style.setProperty("--universe-camera-tilt-x", `${travel.cameraTiltX.toFixed(2)}deg`);
    root.style.setProperty("--universe-camera-tilt-y", `${travel.cameraTiltY.toFixed(2)}deg`);
    root.style.setProperty("--universe-focus-x", `${travel.focusX.toFixed(2)}%`);
    root.style.setProperty("--universe-focus-y", `${travel.focusY.toFixed(2)}%`);
    root.style.setProperty("--universe-target-entry-x", `${travel.targetEntryX.toFixed(2)}vw`);
    root.style.setProperty("--universe-target-entry-y", `${travel.targetEntryY.toFixed(2)}vh`);
    root.style.setProperty("--universe-target-start-scale", travel.targetStartScale.toFixed(4));
    root.style.setProperty("--universe-source-exit-x", `${(travel.targetEntryX * -0.42).toFixed(2)}vw`);
    root.style.setProperty("--universe-source-exit-y", `${(travel.targetEntryY * -0.42).toFixed(2)}vh`);
    root.style.setProperty("--universe-source-exit-z", `${(travel.cameraZ * -0.28).toFixed(2)}px`);
    root.style.setProperty("--universe-source-tilt-x", `${(travel.cameraTiltX * -0.5).toFixed(2)}deg`);
    root.style.setProperty("--universe-source-tilt-y", `${(travel.cameraTiltY * -0.5).toFixed(2)}deg`);
    root.style.setProperty("--universe-sky-from", travel.skyFrom);
    root.style.setProperty("--universe-sky-middle", travel.skyMiddle);
    root.style.setProperty("--universe-sky-to", travel.skyTo);
    root.style.setProperty("--universe-target-core", travel.targetCore);
    root.style.setProperty("--universe-target-halo", travel.targetHalo);
    root.style.setProperty("--universe-slew-star-far", travel.starFar);
    root.style.setProperty("--universe-slew-star-middle", travel.starMiddle);
    root.style.setProperty("--universe-slew-star-near", travel.starNear);
    root.style.setProperty("--universe-observer-x", `${(travel.cameraX * 0.18).toFixed(2)}vw`);
    root.style.setProperty("--universe-observer-y", `${(travel.cameraY * 0.18).toFixed(2)}vh`);
    root.style.setProperty("--universe-observer-z", `${(travel.cameraZ * 0.22).toFixed(2)}px`);
    root.style.setProperty("--universe-far-x", `${travel.farX.toFixed(2)}vw`);
    root.style.setProperty("--universe-far-y", `${travel.farY.toFixed(2)}vh`);
    root.style.setProperty("--universe-far-z", `${(travel.cameraZ * 0.18).toFixed(2)}px`);
    root.style.setProperty("--universe-middle-x", `${travel.middleX.toFixed(2)}vw`);
    root.style.setProperty("--universe-middle-y", `${travel.middleY.toFixed(2)}vh`);
    root.style.setProperty("--universe-middle-z", `${(travel.cameraZ * 0.52).toFixed(2)}px`);
    root.style.setProperty("--universe-near-x", `${travel.nearX.toFixed(2)}vw`);
    root.style.setProperty("--universe-near-y", `${travel.nearY.toFixed(2)}vh`);
    root.style.setProperty("--universe-near-z", `${travel.cameraZ.toFixed(2)}px`);
  }

  function clearTravelState({ keepLast = true, generation = null } = {}) {
    if (generation !== null && generation !== travelGeneration) return;
    clearTimers();
    transitionInFlight = false;
    pendingDestination = null;
    activeViewTransition = null;
    root.dataset.universePerspective = "ready";
    delete root.dataset.universeMotion;
    delete root.dataset.universeTravel;
    delete root.dataset.universeDepthTravel;
    delete root.dataset.universePerspectiveFrom;
    delete root.dataset.universePerspectiveTo;
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
        || travel.version !== 8
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
    applyTravel(travel);
    storeArrival(travel);
    root.dataset.universePerspective = "departing";
    root.dataset.universeMotion = "depart";
    announceDeparture(travel);

    if (motionIsReduced()) {
      clearTravelState({ generation });
      return;
    }

    if (root.dataset.universeCrossDocument === "true") {
      event.preventDefault();
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        if (generation !== travelGeneration) return;
        try {
          window.location.assign(targetUrl.href);
        } catch (_error) {
          clearTravelState({ keepLast: false, generation });
        }
      }));
      return;
    }

    event.preventDefault();
    pendingDestination = targetUrl.href;
    const departureDelay = Math.round((travel.duration || FALLBACK_DEPARTURE_MS) * 0.56);
    schedule(() => {
      try {
        window.location.assign(targetUrl.href);
      } catch (_error) {
        clearTravelState({ keepLast: false, generation });
      }
    }, departureDelay);
    schedule(() => clearTravelState({ generation }), departureDelay + 1200);
  }

  ensureStylesheet();
  if (document.body) installDepthField();
  else document.addEventListener("DOMContentLoaded", installDepthField, { once: true });
  const crossDocument = crossDocumentTransitionsSupported();
  root.dataset.universeCrossDocument = crossDocument ? "true" : "false";
  root.dataset.universePerspective = "ready";

  const arrival = takeArrival();
  if (arrival && !motionIsReduced()) {
    arrivalGeneration = ++travelGeneration;
    transitionInFlight = true;
    applyTravel(arrival);
    root.dataset.universePerspective = "arriving";
    root.dataset.universeMotion = "arrive";
    if (!crossDocument) {
      schedule(() => clearTravelState({ generation: arrivalGeneration }), (arrival.duration || ARRIVAL_MS) + 120);
    }
  }

  window.addEventListener("pageswap", (event) => {
    if (event.viewTransition) activeViewTransition = event.viewTransition;
  });

  window.addEventListener("pagereveal", (event) => {
    installDepthField();
    if (!arrival || motionIsReduced()) return;
    alignArrivalLandmark();
    if (!event.viewTransition) {
      root.dataset.universeCrossDocument = "false";
      schedule(() => clearTravelState({ generation: arrivalGeneration }), (arrival.duration || ARRIVAL_MS) + 120);
      return;
    }
    const transition = event.viewTransition;
    activeViewTransition = transition;
    transition.finished.finally(() => {
      if (activeViewTransition === transition) activeViewTransition = null;
      clearTravelState({ generation: arrivalGeneration });
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
    const destination = pendingDestination;
    skipActiveTransition();
    clearTravelState({ keepLast: false });
    if (destination) window.location.assign(destination);
  }

  reducedMotion.addEventListener?.("change", settleForMotionPreference);
  forcedColors.addEventListener?.("change", settleForMotionPreference);

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
        ready: root.dataset.universePerspective || "pending",
        retargetable: true,
        stylesheet: Boolean(document.querySelector("link[data-universe-perspective-styles]")),
      });
    },
  });
})();
