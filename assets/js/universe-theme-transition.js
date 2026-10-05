(function () {
  "use strict";

  // Every route is a place in one universe. A navigation is a camera flight:
  // the current page collapses into the object it is about, the camera rises,
  // crosses the sky past the other routes, and dives into the destination's
  // object until that object opens out into the next page.
  //
  // Chromium and Safari fly the whole path inside one cross-document view
  // transition: the old page is a snapshot placed in the world, the new page is
  // live, and a canvas renders the sky between them. Other browsers split the
  // same flight across the two documents and hand off in open space.

  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ARRIVAL_KEY = "ac.universe-perspective.v1";
  const RECORD_VERSION = 9;
  const MOTION_MODEL = "cosmic-camera";
  const PATH_MODEL = "van-wijk-nuij";
  const MAX_ARRIVAL_AGE = 8000;
  const STYLE_HREF = "/assets/css/universe-perspective-navigation.css?v=20261005-cosmic1";
  const RHO = 2.2;
  const IRIS_MS = 280;
  const IRIS_CLOSE = 0.72;
  const FALLBACK_HANDOFF = 0.44;
  const FALLBACK_DEPARTURE_MS = 720;
  const ABANDONED_DEPARTURE_MS = 6000;
  const ARRIVAL_HOLD_LIMIT_MS = 420;
  const LENS_CORE = 0.6;
  const LENS_SHOULDER = 0.82;
  const LENS_SHOULDER_ALPHA = 0.5;
  const timers = new Set();
  let transitionInFlight = false;
  let activeViewTransition = null;
  let travelGeneration = 0;
  let arrivalGeneration = null;
  let lastTravel = null;
  let pendingDeparture = null;
  let activeScene = null;
  let lastFlightStats = null;

  // World units are arbitrary but shared: x grows east, y grows south, and a
  // landmark's r is the radius its hero visual occupies in that space. Bearings
  // follow the floating sky map so the flight heads where the map points.
  const DESTINATIONS = Object.freeze({
    home: destination("home", "Dashboard", "home", 1, 1, "[data-camera-window]",
      { x: 0, y: 0, r: 1, kind: "orbital", tag: "00 HOME" }),
    about: destination("about", "About", "about", 4.5, 1.6, "#profile-map",
      { x: -9.6, y: 4.4, r: 2.6, kind: "nebula", tag: "01 ABOUT" }),
    profile: destination("profile", "Skills", "profile", 7.4, 3.2, null,
      { x: -8.1, y: 2.6, r: 0.62, kind: "tree", tag: "02 SKILLS" }),
    work: destination("work", "Portfolio", "work", 3.1, 2.4, ".work-hero__art",
      { x: -1.2, y: -7.4, r: 1.5, kind: "supernova", tag: "03 PORTFOLIO" }),
    projects: destination("projects", "Production apps", "projects", 8.8, 5.6, null,
      { x: 1.5, y: -6.6, r: 0.42, kind: "cluster", tag: "04 PRODUCTION" }),
    logs: destination("logs", "Logs", "threads", 6.5, 2.8, "#galaxy-field",
      { x: 17.5, y: 8.2, r: 6.4, kind: "galaxy", tag: "05 LOGS" }),
    contact: destination("contact", "Contact", "contact", 4, 1.8, "[data-payload-visual]",
      { x: 0.8, y: 2.9, r: 0.32, kind: "probe", tag: "06 CONTACT" }),
    resume: destination("resume", "Resume", "work", 6.2, 4.4, "[data-resume-signature-visual]",
      { x: 1.9, y: -4.2, r: 0.55, kind: "chart", tag: "07 RÉSUMÉ" }),
    signals: destination("signals", "Signals", "contact", 6.9, 3.6, ".signals-hero__telemetry",
      { x: 2.4, y: 3.9, r: 0.26, kind: "beacon", tag: "08 SIGNALS" }),
    search: destination("search", "Evidence search", "threads", 5.4, 3.8, ".evidence-search__console",
      { x: 3.2, y: 0.4, r: 9, kind: "survey", tag: "09 SEARCH" }),
  });
  const LANDMARK_KEYS = ["search", "logs", "about", "work", "home", "resume", "projects", "profile", "contact", "signals"];
  const CHART_LINES = [
    ["home", "contact"], ["contact", "signals"], ["home", "about"], ["about", "profile"],
    ["home", "resume"], ["resume", "work"], ["work", "projects"], ["home", "logs"],
  ];
  const HAZES = [
    { x: -9.6, y: 4.4, r: 7.5, rgb: [96, 120, 230] },
    { x: -1.2, y: -7.4, r: 5.5, rgb: [233, 139, 39] },
    { x: 17.5, y: 8.2, r: 15, rgb: [92, 96, 214] },
    { x: 0.6, y: 0.8, r: 4.5, rgb: [40, 150, 170] },
  ];
  const GALAXY_TILT = 0.58;
  const GALAXY_ROTATION = -0.42;

  function destination(key, label, mapId, depth, magnification, focus, landmark) {
    return Object.freeze({ key, label, mapId, depth, magnification, focus, landmark: Object.freeze(landmark) });
  }

  function motionIsReduced() {
    return reducedMotion.matches;
  }

  function now() {
    return window.performance?.now ? window.performance.now() : Date.now();
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

  function lerp(from, to, amount) {
    return from + (to - from) * amount;
  }

  function smoothstep(edge0, edge1, value) {
    const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return x * x * (3 - 2 * x);
  }

  // Cubic Bézier easing solved for x, so the camera can accelerate decisively
  // and spend most of the flight settling onto the destination.
  function bezier(x1, y1, x2, y2) {
    const ax = 1 + 3 * x1 - 3 * x2;
    const bx = 3 * x2 - 6 * x1;
    const cx = 3 * x1;
    const ay = 1 + 3 * y1 - 3 * y2;
    const by = 3 * y2 - 6 * y1;
    const cy = 3 * y1;
    const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
    const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let index = 0; index < 6; index += 1) {
        const error = sampleX(t) - x;
        const slope = slopeX(t);
        if (Math.abs(error) < 1e-5 || Math.abs(slope) < 1e-6) break;
        t -= error / slope;
      }
      t = clamp(t, 0, 1);
      return ((ay * t + by) * t + cy) * t;
    };
  }

  const flightEase = bezier(0.58, 0, 0.16, 1);
  const irisEase = bezier(0.2, 0.7, 0.3, 1);

  function stableHash(text) {
    let hash = 2166136261;
    for (const character of String(text)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function normalizedPath(pathname) {
    const path = String(pathname || "/").replace(/\/index\.html$/, "/");
    return path === "/about/" ? "/about.html" : path;
  }

  function galaxyProject(x, y) {
    const inclined = y * GALAXY_TILT;
    return {
      x: x * Math.cos(GALAXY_ROTATION) - inclined * Math.sin(GALAXY_ROTATION),
      y: x * Math.sin(GALAXY_ROTATION) + inclined * Math.cos(GALAXY_ROTATION),
    };
  }

  // Four logarithmic arms in unit galaxy radii; the archive's entries and the
  // rendered spiral share this curve, so a log entry is a star on a real arm.
  function galaxyArmPoint(arm, along, spread = 0) {
    const radius = 0.1 + 0.86 * along;
    const theta = arm * Math.PI / 2 + Math.log(radius / 0.1) / 0.36 + spread;
    return galaxyProject(radius * Math.cos(theta), radius * Math.sin(theta));
  }

  function articleDestination(pathname) {
    const seed = stableHash(pathname);
    const galaxy = DESTINATIONS.logs.landmark;
    const point = galaxyArmPoint(seed % 4, 0.3 + ((seed >>> 4) % 997) / 997 * 0.56, (((seed >>> 14) % 101) / 101 - 0.5) * 0.16);
    return Object.freeze({
      key: "article",
      label: "Log detail",
      mapId: "threads",
      depth: 8.4,
      magnification: 6.4,
      focus: ".article-region__hero",
      landmark: Object.freeze({
        x: galaxy.x + point.x * galaxy.r,
        y: galaxy.y + point.y * galaxy.r,
        r: 0.12,
        kind: "star",
        tag: "LOG ENTRY",
      }),
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

  function destinationForRecord(key, path) {
    if (key === "article") return articleDestination(normalizedPath(path));
    return DESTINATIONS[key] || DESTINATIONS.home;
  }

  function aboutSurface() {
    if (["light", "dark"].includes(root.dataset.aboutTheme)) return root.dataset.aboutTheme;
    try {
      return window.localStorage.getItem("about-theme") === "light" ? "light" : "dark";
    } catch (_error) {
      return "dark";
    }
  }

  function surfaceForDestination(target) {
    if (target.key === "about" || target.key === "profile") return aboutSurface();
    if (target.key === "logs" || target.key === "article") {
      if (["light", "dark"].includes(root.dataset.logsTheme)) return root.dataset.logsTheme;
      try { return window.localStorage.getItem("logs-theme") === "light" ? "light" : "dark"; }
      catch (_error) { return "dark"; }
    }
    return "light";
  }

  function directionFor(deltaX, deltaY) {
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return "depth";
    if (Math.abs(deltaX) >= Math.abs(deltaY) * 0.55 && Math.abs(deltaY) >= Math.abs(deltaX) * 0.55) {
      return `${deltaY > 0 ? "south" : "north"}${deltaX > 0 ? "east" : "west"}`;
    }
    if (Math.abs(deltaX) >= Math.abs(deltaY)) return deltaX > 0 ? "east" : "west";
    return deltaY > 0 ? "south" : "north";
  }

  function viewportSize() {
    const width = Math.max(1, Math.round(window.innerWidth || root.clientWidth || 1280));
    const height = Math.max(1, Math.round(window.innerHeight || root.clientHeight || 800));
    return { w: width, h: height };
  }

  // World units project against the viewport's long edge, so a portrait phone
  // sees the same spacious sky as a desktop instead of a squeezed strip.
  function projectionBase(viewport) {
    return Math.max(viewport.w, viewport.h);
  }

  // A focus is where the page's own object sits on screen: the orbital window,
  // the supernova, the nebula. The page dissolves into, and unfolds out of, it.
  function defaultFocus(viewport) {
    return { x: viewport.w / 2, y: viewport.h * 0.54, r: 0.24 * Math.min(viewport.w, viewport.h) };
  }

  function measureFocus(target, viewport = viewportSize()) {
    const fallback = defaultFocus(viewport);
    if (!target?.focus || typeof document.querySelector !== "function") return fallback;
    let element = null;
    try { element = document.querySelector(target.focus); } catch (_error) { return fallback; }
    if (!element?.getBoundingClientRect) return fallback;
    const bounds = element.getBoundingClientRect();
    const left = Math.max(bounds.left, 0);
    const right = Math.min(bounds.right, viewport.w);
    const top = Math.max(bounds.top, 56);
    const bottom = Math.min(bounds.bottom, viewport.h);
    // A hero mostly below the fold is not what the visitor is looking at.
    if (right - left < Math.min(bounds.width, viewport.w) * 0.35
      || bottom - top < Math.min(bounds.height, viewport.h) * 0.35
      || right - left < 48 || bottom - top < 48) return fallback;
    const minimum = Math.min(viewport.w, viewport.h);
    return {
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      r: clamp(Math.min(right - left, bottom - top) / 2, minimum * 0.12, minimum * 0.46),
    };
  }

  function scaleFocus(focus, from, to) {
    if (!focus || !from || (from.w === to.w && from.h === to.h)) return focus;
    return { x: focus.x * to.w / from.w, y: focus.y * to.h / from.h, r: focus.r * Math.min(to.w / from.w, to.h / from.h) };
  }

  // The camera that shows a page exactly: its landmark sits under the page's
  // focus at the size the hero occupies.
  function pageCamera(landmark, focus, viewport) {
    const base = projectionBase(viewport);
    const w = landmark.r * base / Math.max(focus.r, 1);
    return {
      x: landmark.x - (focus.x - viewport.w / 2) * w / base,
      y: landmark.y - (focus.y - viewport.h / 2) * w / base,
      w,
    };
  }

  // van Wijk & Nuij, "Smooth and efficient zooming and panning" (2003): the
  // perceptually shortest path between two views rises, crosses, and descends.
  function zoomPath(from, to, rho = RHO) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const d2 = dx * dx + dy * dy;
    const rho2 = rho * rho;
    const rho4 = rho2 * rho2;
    if (d2 < 1e-12) {
      const S = Math.log(to.w / from.w) / rho;
      return {
        S: Math.abs(S),
        at(s) {
          return { x: from.x + s * dx, y: from.y + s * dy, w: from.w * Math.exp(rho * s * S) };
        },
      };
    }
    const d1 = Math.sqrt(d2);
    const b0 = (to.w * to.w - from.w * from.w + rho4 * d2) / (2 * from.w * rho2 * d1);
    const b1 = (to.w * to.w - from.w * from.w - rho4 * d2) / (2 * to.w * rho2 * d1);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    const S = (r1 - r0) / rho;
    const coshR0 = Math.cosh(r0);
    const sinhR0 = Math.sinh(r0);
    return {
      S,
      at(s) {
        const distance = s * S;
        const u = from.w / (rho2 * d1) * (coshR0 * Math.tanh(rho * distance + r0) - sinhR0);
        return { x: from.x + u * dx, y: from.y + u * dy, w: from.w * coshR0 / Math.cosh(rho * distance + r0) };
      },
    };
  }

  function flightDuration(S) {
    return Math.round(clamp(700 + 280 * Math.abs(S), 950, 1600));
  }

  function planFlight(record, arrivalFocus, viewport) {
    const from = destinationForRecord(record.from, record.fromPath);
    const to = destinationForRecord(record.to, record.toPath);
    const source = scaleFocus(record.fromFocus, record.viewport, viewport) || defaultFocus(viewport);
    const plannedTarget = scaleFocus(record.toFocus, record.viewport, viewport) || defaultFocus(viewport);
    const start = pageCamera(from.landmark, source, viewport);
    const planned = pageCamera(to.landmark, plannedTarget, viewport);
    const path = zoomPath(start, planned);
    const plan = {
      from,
      to,
      viewport,
      sourceFocus: source,
      targetFocus: plannedTarget,
      start,
      end: planned,
      path,
      duration: record.duration || flightDuration(path.S),
      fromDark: record.fromSurface === "dark" ? 1 : 0,
      toDark: record.toSurface === "dark" ? 1 : 0,
      travelDusk: 0.74 * smoothstep(0.7, 1.9, Math.abs(path.S)),
      correction: null,
    };
    if (arrivalFocus) correctLanding(plan, arrivalFocus, 0);
    measureEnclosure(plan);
    return plan;
  }

  function peakWidth(plan) {
    let peak = 0;
    for (let index = 0; index <= 48; index += 1) peak = Math.max(peak, cameraAt(plan, index / 48).w);
    return peak;
  }

  function measureEnclosure(plan) {
    plan.peak = peakWidth(plan);
    plan.sourceEncloses = plan.peak <= plan.start.w * 1.04;
    plan.targetEncloses = plan.peak <= landingCamera(plan).w * 1.04;
  }

  // The departing page only knows where the destination's object usually is.
  // Once the new page has laid out, bend the second half of the flight onto its
  // measured focus; the change happens while that page is still far away.
  function correctLanding(plan, focus, from) {
    const measured = pageCamera(plan.to.landmark, focus, plan.viewport);
    plan.targetFocus = focus;
    const dx = measured.x - plan.end.x;
    const dy = measured.y - plan.end.y;
    const dw = Math.log(measured.w / plan.end.w);
    if (Math.abs(dx) + Math.abs(dy) < 1e-6 && Math.abs(dw) < 1e-6) return;
    if (from <= 0) {
      plan.end = measured;
      plan.path = zoomPath(plan.start, measured);
      plan.correction = null;
    } else {
      plan.correction = { from: clamp(from, 0, 0.9), dx, dy, dw, end: measured };
    }
    if (plan.peak !== undefined) measureEnclosure(plan);
  }

  function cameraAt(plan, t) {
    const progress = clamp(t, 0, 1);
    const camera = plan.path.at(flightEase(progress));
    if (plan.correction) {
      const blend = smoothstep(plan.correction.from, 1, progress);
      camera.x += plan.correction.dx * blend;
      camera.y += plan.correction.dy * blend;
      camera.w *= Math.exp(plan.correction.dw * blend);
    }
    return camera;
  }

  function landingCamera(plan) {
    return plan.correction ? plan.correction.end : plan.end;
  }

  function darknessAt(plan, t) {
    const surface = lerp(plan.fromDark, plan.toDark, smoothstep(0.28, 0.72, t));
    const dusk = plan.travelDusk * Math.pow(Math.sin(Math.PI * clamp(t, 0, 1)), 1.7);
    return clamp(Math.max(surface, dusk + surface * (1 - dusk)), 0, 1);
  }

  // Lens radius in page pixels: wide open at rest, closing to the hero as the
  // page recedes so a page never reads as a flat card floating in space.
  function fullLens(focus, viewport) {
    const corner = Math.max(
      Math.hypot(focus.x, focus.y),
      Math.hypot(viewport.w - focus.x, focus.y),
      Math.hypot(focus.x, viewport.h - focus.y),
      Math.hypot(viewport.w - focus.x, viewport.h - focus.y),
    );
    return corner / LENS_CORE + 2;
  }

  function heroLens(focus, viewport) {
    return Math.min(focus.r, Math.min(viewport.w, viewport.h) * 0.26) / 0.62;
  }

  function lensRadius(scale, focus, viewport) {
    const full = fullLens(focus, viewport);
    if (scale >= 1) return full;
    const hero = heroLens(focus, viewport);
    const open = Math.pow(smoothstep(0.42, 1, scale), 2.2);
    return hero + (full - hero) * open;
  }

  // Larger than the view (scale > 1) a page is only visible when the flight is
  // nested inside it — diving into the archive, or rising out of an entry back
  // to it. A page the camera will later look down on stays hidden until then.
  function pageOpacity(scale, enclosing = true) {
    if (scale <= 1) return smoothstep(0.14, 0.46, scale);
    if (!enclosing) return 1 - smoothstep(1, 1.02, scale);
    return 1 - smoothstep(1.35, 2.5, scale);
  }

  // The page rectangle also feathers as soon as it leaves rest, so no straight
  // edge ever crosses the sky.
  function pageFeather(scale, viewport) {
    if (scale >= 1) return 0;
    return Math.min(viewport.w, viewport.h) * 0.5 * (1 - smoothstep(0.55, 1, scale));
  }

  // How close the camera is to resting on a page: its scale, discounted by how
  // far off-centre the page sits. A page passing at full size on the far side
  // of the sky is still only its object, not an open page.
  function pageCloseness(scale, x, y, viewport) {
    if (scale > 1) return scale;
    return scale * Math.exp(-1.8 * Math.hypot(x, y) / Math.max(viewport.w, viewport.h));
  }

  function pageState(pageCameraState, camera, focus, viewport, { irisLimit = Infinity, enclosing = true } = {}) {
    const scale = pageCameraState.w / camera.w;
    const base = projectionBase(viewport);
    const x = (pageCameraState.x - camera.x) * base / camera.w;
    const y = (pageCameraState.y - camera.y) * base / camera.w;
    const closeness = pageCloseness(scale, x, y, viewport);
    return {
      scale,
      closeness,
      x,
      y,
      opacity: pageOpacity(closeness, enclosing),
      radius: Math.min(lensRadius(closeness, focus, viewport), irisLimit),
      feather: pageFeather(closeness, viewport),
      focus,
    };
  }

  // ---------------------------------------------------------------------------
  // Sky renderer
  // ---------------------------------------------------------------------------

  const SKY_RAMP = [
    [0, [250, 249, 244]],
    [0.2, [234, 237, 239]],
    [0.46, [138, 153, 180]],
    [0.72, [34, 48, 79]],
    [1, [3, 9, 22]],
  ];

  function ramp(stops, value) {
    const x = clamp(value, 0, 1);
    for (let index = 1; index < stops.length; index += 1) {
      if (x <= stops[index][0]) {
        const [p0, c0] = stops[index - 1];
        const [p1, c1] = stops[index];
        const amount = (x - p0) / (p1 - p0);
        return c0.map((channel, channelIndex) => Math.round(lerp(channel, c1[channelIndex], amount)));
      }
    }
    return stops[stops.length - 1][1];
  }

  function mixRgb(from, to, amount) {
    return from.map((channel, index) => Math.round(lerp(channel, to[index], amount)));
  }

  function rgba(rgb, alpha = 1) {
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamp(alpha, 0, 1).toFixed(3)})`;
  }

  function rgbHex(rgb) {
    return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }

  function palette(darkness) {
    const night = smoothstep(0.32, 0.68, darkness);
    return {
      darkness,
      night,
      sky: ramp(SKY_RAMP, darkness),
      star: mixRgb([46, 64, 88], [226, 236, 255], night),
      warmStar: mixRgb([92, 72, 52], [255, 226, 196], night),
      line: mixRgb([31, 92, 186], [150, 188, 255], night),
      label: mixRgb([74, 84, 96], [186, 204, 232], night),
      hud: mixRgb([31, 92, 186], [170, 205, 255], night),
    };
  }

  function hashCell(i, j, k, salt) {
    let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul((k + 64) | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  }

  function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeCanvas(size) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    return canvas;
  }

  // Each sprite is drawn once, in unit radii, with `pad` units of glow beyond
  // the landmark radius. They are luminous versions of each page's hero.
  const SPRITES = {
    orbital: { size: 256, pad: 1.5, draw(context, unit, center) {
      glow(context, center, unit * 1.5, [[0, "rgba(255,255,255,0.95)"], [0.05, "rgba(205,226,255,0.8)"], [0.16, "rgba(110,160,240,0.26)"], [0.55, "rgba(60,110,200,0.06)"], [1, "rgba(0,0,0,0)"]]);
    } },
    supernova: { size: 512, pad: 1.7, draw(context, unit, center, random) {
      glow(context, center, unit * 1.7, [[0, "rgba(255,255,255,1)"], [0.035, "rgba(255,246,214,0.98)"], [0.09, "rgba(255,170,72,0.85)"], [0.2, "rgba(223,100,44,0.42)"], [0.42, "rgba(60,110,210,0.2)"], [0.75, "rgba(40,80,190,0.05)"], [1, "rgba(0,0,0,0)"]]);
      context.globalCompositeOperation = "lighter";
      for (let index = 0; index < 90; index += 1) {
        const angle = random() * Math.PI * 2;
        const length = unit * (0.55 + random() * 1.05);
        context.strokeStyle = `rgba(255,${Math.round(150 + random() * 70)},${Math.round(70 + random() * 60)},${(0.05 + random() * 0.14).toFixed(3)})`;
        context.lineWidth = 0.6 + random() * 1.6;
        context.beginPath();
        context.moveTo(center + Math.cos(angle) * unit * 0.08, center + Math.sin(angle) * unit * 0.08);
        context.lineTo(center + Math.cos(angle) * length, center + Math.sin(angle) * length);
        context.stroke();
      }
      context.strokeStyle = "rgba(255,196,128,0.32)";
      context.lineWidth = unit * 0.035;
      context.beginPath();
      context.arc(center, center, unit * 0.98, 0, Math.PI * 2);
      context.stroke();
    } },
    nebula: { size: 640, pad: 1.25, draw(context, unit, center, random) {
      context.globalCompositeOperation = "lighter";
      const axis = -0.62;
      for (const side of [-1, 1]) {
        const lobeX = center + Math.cos(axis) * unit * 0.44 * side;
        const lobeY = center + Math.sin(axis) * unit * 0.44 * side;
        context.save();
        context.translate(lobeX, lobeY);
        context.rotate(axis);
        context.scale(1, 0.46);
        glow(context, 0, unit * 0.62, [[0, "rgba(255,206,140,0.5)"], [0.3, "rgba(232,150,92,0.32)"], [0.62, "rgba(92,132,232,0.22)"], [1, "rgba(0,0,0,0)"]], true);
        context.restore();
      }
      for (let index = 0; index < 140; index += 1) {
        const side = random() < 0.5 ? -1 : 1;
        const along = (0.08 + random() * 0.86) * side;
        const across = (random() - 0.5) * 0.5 * (1 - Math.abs(along) * 0.6);
        const x = center + (Math.cos(axis) * along - Math.sin(axis) * across) * unit;
        const y = center + (Math.sin(axis) * along + Math.cos(axis) * across) * unit;
        const warm = random() < 0.45;
        glow(context, [x, y], unit * (0.03 + random() * 0.09), [[0, warm ? "rgba(255,190,120,0.3)" : "rgba(120,170,255,0.32)"], [1, "rgba(0,0,0,0)"]]);
      }
      glow(context, center, unit * 0.3, [[0, "rgba(255,255,255,0.95)"], [0.12, "rgba(220,235,255,0.7)"], [0.4, "rgba(120,160,255,0.18)"], [1, "rgba(0,0,0,0)"]]);
    } },
    tree: { size: 256, pad: 1.4, draw(context, unit, center, random) {
      glow(context, center, unit * 1.3, [[0, "rgba(200,220,255,0.6)"], [0.3, "rgba(120,150,255,0.2)"], [1, "rgba(0,0,0,0)"]]);
      for (let index = 0; index < 9; index += 1) {
        const angle = random() * Math.PI * 2;
        const distance = unit * (0.25 + random() * 0.7);
        glow(context, [center + Math.cos(angle) * distance, center + Math.sin(angle) * distance], unit * 0.12, [[0, "rgba(230,240,255,0.9)"], [1, "rgba(0,0,0,0)"]]);
      }
    } },
    cluster: { size: 256, pad: 1.35, draw(context, unit, center, random) {
      glow(context, center, unit * 1.3, [[0, "rgba(190,215,255,0.32)"], [1, "rgba(0,0,0,0)"]]);
      for (let index = 0; index < 11; index += 1) {
        const angle = random() * Math.PI * 2;
        const distance = unit * Math.sqrt(random()) * 0.85;
        glow(context, [center + Math.cos(angle) * distance, center + Math.sin(angle) * distance], unit * (0.08 + random() * 0.12), [[0, "rgba(255,255,255,1)"], [0.25, "rgba(180,210,255,0.6)"], [1, "rgba(0,0,0,0)"]]);
      }
    } },
    galaxy: { size: 768, pad: 1.12, draw(context, unit, center) {
      drawGalaxyDisc(context, center, center, unit, 1);
      context.globalCompositeOperation = "lighter";
      galaxyParticles().forEach((particle) => {
        context.fillStyle = GALAXY_COLORS[particle.color];
        context.globalAlpha = particle.alpha;
        const size = particle.size;
        context.fillRect(center + particle.x * unit - size / 2, center + particle.y * unit - size / 2, size, size);
      });
      context.globalAlpha = 1;
      drawGalaxyCore(context, center, center, unit, 1);
    } },
    star: { size: 256, pad: 2.2, draw(context, unit, center) {
      glow(context, center, unit * 2.2, [[0, "rgba(255,255,255,1)"], [0.07, "rgba(220,255,240,0.85)"], [0.18, "rgba(90,230,190,0.26)"], [0.42, "rgba(200,90,220,0.07)"], [1, "rgba(0,0,0,0)"]]);
      context.globalCompositeOperation = "lighter";
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const reach = unit * 1.9;
        const gradient = context.createLinearGradient(center - dx * reach, center - dy * reach, center + dx * reach, center + dy * reach);
        gradient.addColorStop(0, "rgba(255,255,255,0)");
        gradient.addColorStop(0.5, "rgba(255,255,255,0.6)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = gradient;
        context.fillRect(center - (dx ? reach : unit * 0.03), center - (dy ? reach : unit * 0.03), dx ? reach * 2 : unit * 0.06, dy ? reach * 2 : unit * 0.06);
      }
    } },
    probe: { size: 128, pad: 2, draw(context, unit, center) {
      glow(context, center, unit * 2, [[0, "rgba(220,255,255,0.95)"], [0.12, "rgba(120,220,240,0.45)"], [0.45, "rgba(60,150,220,0.08)"], [1, "rgba(0,0,0,0)"]]);
    } },
    chart: { size: 256, pad: 1.3, draw(context, unit, center) {
      chartNodes().forEach(([x, y], index) => {
        glow(context, [center + x * unit, center + y * unit], unit * (index === 3 ? 0.2 : 0.12), [[0, "rgba(255,255,255,1)"], [0.3, "rgba(170,205,255,0.55)"], [1, "rgba(0,0,0,0)"]]);
      });
    } },
    beacon: { size: 128, pad: 2.2, draw(context, unit, center) {
      glow(context, center, unit * 2.2, [[0, "rgba(230,255,240,1)"], [0.1, "rgba(120,240,190,0.55)"], [0.4, "rgba(60,180,150,0.1)"], [1, "rgba(0,0,0,0)"]]);
    } },
  };

  const GALAXY_COLORS = ["rgb(170,196,255)", "rgb(205,212,245)", "rgb(236,224,222)", "rgb(255,232,200)", "rgb(255,150,200)"];
  let galaxyParticleCache = null;

  // One seeded population drives both the far sprite and the close-up field,
  // so diving into the archive never swaps one galaxy for another.
  function galaxyParticles() {
    if (galaxyParticleCache) return galaxyParticleCache;
    const random = seededRandom(stableHash("galaxy-arms"));
    galaxyParticleCache = [];
    galaxyParticleCache.buckets = new Map();
    for (let index = 0; index < 3400; index += 1) {
      const along = Math.pow(random(), 0.85);
      const spread = (random() + random() + random() - 1.5) * (0.14 + along * 0.2);
      const point = galaxyArmPoint(index % 4, along, spread);
      const wobble = (random() - 0.5) * 0.04;
      const pink = random() < 0.035;
      const warmth = (1 - along) ** 2;
      const particle = {
        x: point.x + wobble,
        y: point.y + wobble,
        color: pink ? 4 : Math.min(3, Math.floor(warmth * 4)),
        alpha: 0.18 + random() * 0.6,
        size: 0.7 + random() * (pink ? 2.2 : 1.4),
      };
      galaxyParticleCache.push(particle);
      const level = Math.min(3, Math.floor((particle.alpha - 0.18) / 0.15));
      const key = particle.color * 4 + level;
      if (!galaxyParticleCache.buckets.has(key)) {
        galaxyParticleCache.buckets.set(key, { color: particle.color, alpha: 0.255 + level * 0.15, particles: [] });
      }
      galaxyParticleCache.buckets.get(key).particles.push(particle);
    }
    return galaxyParticleCache;
  }

  function drawGalaxyDisc(context, x, y, unit, alpha) {
    context.save();
    context.translate(x, y);
    context.rotate(GALAXY_ROTATION);
    context.scale(1, GALAXY_TILT);
    context.globalAlpha = alpha;
    glow(context, 0, unit * 1.05, [[0, "rgba(255,240,214,0.9)"], [0.07, "rgba(220,214,255,0.55)"], [0.3, "rgba(120,140,230,0.18)"], [0.75, "rgba(70,90,200,0.05)"], [1, "rgba(0,0,0,0)"]], true);
    context.restore();
  }

  function drawGalaxyCore(context, x, y, unit, alpha) {
    context.globalAlpha = alpha;
    glow(context, [x, y], unit * 0.16, [[0, "rgba(255,255,250,1)"], [0.3, "rgba(255,236,200,0.6)"], [1, "rgba(0,0,0,0)"]]);
    context.globalAlpha = 1;
  }

  function glow(context, center, radius, stops, centered = false) {
    const [x, y] = Array.isArray(center) ? center : [center, center];
    const originX = centered ? 0 : x;
    const originY = centered ? 0 : y;
    const gradient = context.createRadialGradient(originX, originY, 0, originX, originY, radius);
    stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(originX, originY, radius, 0, Math.PI * 2);
    context.fill();
  }

  function chartNodes() {
    return [[-0.82, 0.3], [-0.5, -0.18], [-0.12, 0.12], [0.18, -0.36], [0.52, -0.08], [0.8, -0.52], [0.36, 0.44]];
  }

  const spriteCache = new Map();

  function spriteFor(kind) {
    if (spriteCache.has(kind)) return spriteCache.get(kind);
    const recipe = SPRITES[kind];
    let entry = null;
    if (recipe) {
      try {
        const canvas = makeCanvas(recipe.size);
        const context = canvas.getContext("2d");
        if (context) {
          const center = recipe.size / 2;
          recipe.draw(context, center / recipe.pad, center, seededRandom(stableHash(kind)));
          entry = { canvas, pad: recipe.pad };
        }
      } catch (_error) {
        entry = null;
      }
    }
    spriteCache.set(kind, entry);
    return entry;
  }

  function prepareSprites(kinds) {
    kinds.forEach((kind) => spriteFor(kind));
  }

  // Line art is the daylight rendering of the same objects: the light pages use
  // ink diagrams, so the chart sky draws landmarks the way those pages do.
  function drawLineArt(context, kind, x, y, radius, scale) {
    const hair = scale;
    context.lineWidth = hair;
    context.beginPath();
    switch (kind) {
      case "orbital":
        [0.42, 0.68, 0.95].forEach((ring) => context.ellipse(x, y, radius * ring, radius * ring * 0.36, -0.2, 0, Math.PI * 2));
        context.moveTo(x + radius * 0.08, y);
        context.arc(x, y, radius * 0.08, 0, Math.PI * 2);
        context.stroke();
        [[0.42, 0.7], [0.68, 2.5], [0.95, 4.3]].forEach(([ring, angle]) => {
          const px = x + Math.cos(angle) * radius * ring * Math.cos(-0.2) - Math.sin(angle) * radius * ring * 0.36 * Math.sin(-0.2);
          const py = y + Math.cos(angle) * radius * ring * Math.sin(-0.2) + Math.sin(angle) * radius * ring * 0.36 * Math.cos(-0.2);
          context.beginPath();
          context.arc(px, py, Math.max(1.4 * scale, radius * 0.035), 0, Math.PI * 2);
          context.fill();
        });
        return;
      case "supernova":
        [0.34, 0.62].forEach((ring) => {
          context.moveTo(x + radius * ring, y);
          context.arc(x, y, radius * ring, 0, Math.PI * 2);
        });
        for (let index = 0; index < 20; index += 1) {
          const angle = index / 20 * Math.PI * 2;
          context.moveTo(x + Math.cos(angle) * radius * 1.04, y + Math.sin(angle) * radius * 1.04);
          context.lineTo(x + Math.cos(angle) * radius * (index % 2 ? 1.16 : 1.28), y + Math.sin(angle) * radius * (index % 2 ? 1.16 : 1.28));
        }
        context.stroke();
        context.setLineDash([3 * scale, 4 * scale]);
        context.beginPath();
        context.arc(x, y, radius * 0.95, 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);
        return;
      case "nebula":
        [-1, 1].forEach((side) => {
          const lobeX = x + Math.cos(-0.62) * radius * 0.44 * side;
          const lobeY = y + Math.sin(-0.62) * radius * 0.44 * side;
          context.moveTo(lobeX + Math.cos(-0.62) * radius * 0.5, lobeY + Math.sin(-0.62) * radius * 0.5);
          context.ellipse(lobeX, lobeY, radius * 0.5, radius * 0.22, -0.62, 0, Math.PI * 2);
        });
        context.moveTo(x + radius * 0.06, y);
        context.arc(x, y, radius * 0.06, 0, Math.PI * 2);
        context.stroke();
        return;
      case "galaxy":
        for (let arm = 0; arm < 4; arm += 1) {
          for (let step = 0; step <= 36; step += 1) {
            const point = galaxyArmPoint(arm, step / 36);
            if (step === 0) context.moveTo(x + point.x * radius, y + point.y * radius);
            else context.lineTo(x + point.x * radius, y + point.y * radius);
          }
        }
        context.moveTo(x + radius * 0.98, y);
        context.save();
        context.translate(x, y);
        context.rotate(GALAXY_ROTATION);
        context.scale(1, GALAXY_TILT);
        context.moveTo(radius, 0);
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.restore();
        context.stroke();
        return;
      case "star":
        context.moveTo(x - radius * 1.8, y);
        context.lineTo(x + radius * 1.8, y);
        context.moveTo(x, y - radius * 1.8);
        context.lineTo(x, y + radius * 1.8);
        context.moveTo(x + radius * 0.4, y);
        context.arc(x, y, radius * 0.4, 0, Math.PI * 2);
        context.stroke();
        return;
      case "probe":
        context.rect(x - radius * 0.18, y - radius * 0.18, radius * 0.36, radius * 0.36);
        context.rect(x - radius * 0.86, y - radius * 0.1, radius * 0.56, radius * 0.2);
        context.rect(x + radius * 0.3, y - radius * 0.1, radius * 0.56, radius * 0.2);
        context.moveTo(x, y - radius * 0.18);
        context.lineTo(x, y - radius * 0.46);
        [0.7, 1.05].forEach((arc) => {
          context.moveTo(x + Math.cos(-2.2) * radius * arc, y + Math.sin(-2.2) * radius * arc);
          context.arc(x, y, radius * arc, -2.2, -0.94);
        });
        context.stroke();
        return;
      case "chart":
        chartNodes().forEach(([nx, ny], index) => {
          if (index === 0) context.moveTo(x + nx * radius, y + ny * radius);
          else context.lineTo(x + nx * radius, y + ny * radius);
        });
        context.stroke();
        chartNodes().forEach(([nx, ny]) => {
          context.beginPath();
          context.arc(x + nx * radius, y + ny * radius, Math.max(1.3 * scale, radius * 0.045), 0, Math.PI * 2);
          context.fill();
        });
        return;
      case "beacon":
        [0.45, 0.8, 1.15].forEach((arc) => {
          context.moveTo(x + Math.cos(-0.9) * radius * arc, y + Math.sin(-0.9) * radius * arc);
          context.arc(x, y, radius * arc, -0.9, 0.9);
          context.moveTo(x + Math.cos(Math.PI - 0.9) * radius * arc, y + Math.sin(Math.PI - 0.9) * radius * arc);
          context.arc(x, y, radius * arc, Math.PI - 0.9, Math.PI + 0.9);
        });
        context.moveTo(x + radius * 0.12, y);
        context.arc(x, y, radius * 0.12, 0, Math.PI * 2);
        context.stroke();
        return;
      case "tree":
        for (let index = 0; index < 7; index += 1) {
          const angle = index / 7 * Math.PI * 2 + 0.4;
          const nx = x + Math.cos(angle) * radius * (0.5 + (index % 3) * 0.2);
          const ny = y + Math.sin(angle) * radius * (0.5 + (index % 3) * 0.2);
          context.moveTo(x, y);
          context.lineTo(nx, ny);
          context.moveTo(nx + radius * 0.05, ny);
          context.arc(nx, ny, radius * 0.05, 0, Math.PI * 2);
        }
        context.stroke();
        return;
      case "cluster":
        for (let index = 0; index < 7; index += 1) {
          const angle = index * 2.4;
          const distance = radius * (0.2 + (index % 4) * 0.22);
          const nx = x + Math.cos(angle) * distance;
          const ny = y + Math.sin(angle) * distance;
          context.moveTo(nx + radius * 0.08, ny);
          context.arc(nx, ny, radius * 0.08, 0, Math.PI * 2);
        }
        context.stroke();
        return;
      case "survey":
        context.arc(x, y, radius, 0, Math.PI * 2);
        for (let index = 0; index < 72; index += 1) {
          const angle = index / 72 * Math.PI * 2;
          const inner = radius * (index % 6 === 0 ? 0.95 : 0.975);
          context.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
          context.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
        }
        context.stroke();
        context.setLineDash([2 * scale, 6 * scale]);
        context.beginPath();
        context.arc(x, y, radius * 0.66, 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);
        return;
      default:
        context.stroke();
    }
  }

  function landmarkHandoff(closeness, arriving = false) {
    if (closeness <= 1) return arriving ? 1 - smoothstep(0.26, 0.64, closeness) : 1 - smoothstep(0.42, 0.86, closeness);
    return smoothstep(1.15, 2, closeness);
  }

  function pageStates(plan, camera, irisLimit = Infinity) {
    return {
      source: pageState(plan.start, camera, plan.sourceFocus, plan.viewport, { irisLimit, enclosing: plan.sourceEncloses }),
      target: pageState(landingCamera(plan), camera, plan.targetFocus, plan.viewport, { enclosing: plan.targetEncloses }),
    };
  }

  function pageWeights(plan, camera) {
    const pages = pageStates(plan, camera);
    return { from: pages.source.closeness, to: pages.target.closeness };
  }

  function landmarkGlowWeight(kind, night) {
    const daylight = { supernova: 0.42, nebula: 0.3, galaxy: 0.22, star: 0.18 }[kind] || 0.08;
    return Math.max(night, daylight);
  }

  function createSky(canvas, { dpr = 1 } = {}) {
    const context = canvas?.getContext?.("2d");
    if (!context) return null;
    const ratio = clamp(dpr, 1, 1.75);
    let width = 0;
    let height = 0;
    let base = 1;
    const buckets = new Map();

    function resize(viewport) {
      width = viewport.w;
      height = viewport.h;
      base = projectionBase(viewport);
      const pixelWidth = Math.round(width * ratio);
      const pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    }

    function begin() {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
    }

    function clear() {
      begin();
      context.clearRect(0, 0, width, height);
    }

    function toScreen(camera, x, y) {
      return [width / 2 + (x - camera.x) * base / camera.w, height / 2 + (y - camera.y) * base / camera.w];
    }

    function fillSky(colors) {
      begin();
      context.fillStyle = rgbHex(colors.sky);
      context.fillRect(0, 0, width, height);
      if (colors.night > 0.02) {
        const vignette = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.2, width / 2, height / 2, Math.hypot(width, height) * 0.6);
        vignette.addColorStop(0, "rgba(0,0,0,0)");
        vignette.addColorStop(1, `rgba(0, 3, 10, ${(0.32 * colors.night).toFixed(3)})`);
        context.fillStyle = vignette;
        context.fillRect(0, 0, width, height);
      }
    }

    function drawHazes(camera, colors) {
      const strength = lerp(0.07, 0.22, colors.night);
      HAZES.forEach((haze) => {
        const [x, y] = toScreen(camera, haze.x, haze.y);
        const radius = haze.r * base / camera.w;
        if (radius < 8 || x + radius < 0 || x - radius > width || y + radius < 0 || y - radius > height) return;
        const fade = 1 - smoothstep(width * 3, width * 9, radius);
        if (fade <= 0) return;
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, rgba(haze.rgb, strength * fade));
        gradient.addColorStop(0.45, rgba(haze.rgb, strength * 0.35 * fade));
        gradient.addColorStop(1, rgba(haze.rgb, 0));
        context.fillStyle = gradient;
        context.fillRect(Math.max(0, x - radius), Math.max(0, y - radius), Math.min(width, radius * 2), Math.min(height, radius * 2));
      });
    }

    // Stars live in 3D between the camera and the page plane, in octaves of
    // depth: the camera's height equals its view width, so the field keeps the
    // same density at every scale and parallax comes from real perspective.
    function collectStars(camera, previous, colors, layer, speed) {
      buckets.clear();
      const h = camera.w;
      const ph = previous.w;
      const kTop = Math.floor(Math.log2(h));
      const shutter = speed > 0.001;
      for (let k = kTop - 4; k <= kTop + 3; k += 1) {
        const span = 2 ** k;
        const below = k > kTop;
        const ratio = below ? span / h : h / span;
        const octave = below
          ? smoothstep(1, 1.7, ratio) * (1 - smoothstep(4, 8, ratio)) * 0.6
          : smoothstep(1.05, 1.8, ratio) * (1 - smoothstep(7, 15, ratio));
        if (octave < 0.02) continue;
        const cell = span * (below ? 0.42 : 0.9);
        const depthFar = below ? h + 2 * span : h - span;
        const reachX = depthFar * width / base * 0.56 + cell;
        const reachY = depthFar * height / base * 0.56 + cell;
        const iMin = Math.floor((camera.x - reachX) / cell);
        const iMax = Math.floor((camera.x + reachX) / cell);
        const jMin = Math.floor((camera.y - reachY) / cell);
        const jMax = Math.floor((camera.y + reachY) / cell);
        if ((iMax - iMin + 1) * (jMax - jMin + 1) > 2400) continue;
        for (let i = iMin; i <= iMax; i += 1) {
          for (let j = jMin; j <= jMax; j += 1) {
            const fx = hashCell(i, j, k, 1);
            const fy = hashCell(i, j, k, 2);
            const fz = hashCell(i, j, k, 3);
            const z = below ? -span * (1 + fz) : span * (1 + fz);
            if (!below && z >= h) continue;
            const depth = h - z;
            if (depth <= h * 0.02) continue;
            const nearness = 1 - depth / h;
            const isNear = !below && depth < h * 0.34;
            if (layer === "near" && !isNear) continue;
            const worldX = (i + fx) * cell;
            const worldY = (j + fy) * cell;
            const sx = width / 2 + (worldX - camera.x) * base / depth;
            const sy = height / 2 + (worldY - camera.y) * base / depth;
            if (sx < -40 || sx > width + 40 || sy < -40 || sy > height + 40) continue;
            const brightness = 0.25 + 0.75 * hashCell(i, j, k, 4) ** 2;
            const size = clamp(base * span * (below ? 0.0011 : 0.0018) / depth, 0.5, 2.6);
            let alpha = brightness * octave * smoothstep(0.02, 0.16, depth / h) * (below ? 0.75 : 0.45 + 0.55 * nearness);
            if (layer === "near") alpha *= smoothstep(0.08, 0.4, speed);
            else if (isNear) alpha *= 1 - smoothstep(0.08, 0.4, speed);
            if (alpha < 0.03) continue;
            let tx = sx;
            let ty = sy;
            const previousDepth = ph - z;
            if (shutter && previousDepth > ph * 0.02) {
              tx = width / 2 + (worldX - previous.x) * base / previousDepth;
              ty = height / 2 + (worldY - previous.y) * base / previousDepth;
              const dx = sx - tx;
              const dy = sy - ty;
              const length = Math.hypot(dx, dy);
              const limit = width * 0.12;
              if (length > limit) {
                tx = sx - dx / length * limit;
                ty = sy - dy / length * limit;
              }
              if (length > size * 2) alpha *= Math.sqrt(clamp(size * 2.4 / length, 0.18, 1));
            }
            const warm = hashCell(i, j, k, 5) < 0.22;
            const level = Math.min(5, Math.floor(alpha * 6));
            const weight = size < 0.9 ? 0 : size < 1.6 ? 1 : 2;
            const key = `${warm ? 1 : 0}|${level}|${weight}`;
            if (!buckets.has(key)) buckets.set(key, { warm, alpha: (level + 0.5) / 6, width: [0.9, 1.4, 2.2][weight], segments: [] });
            buckets.get(key).segments.push(sx, sy, tx, ty);
          }
        }
      }
      return buckets;
    }

    function drawStars(camera, previous, colors, layer, speed) {
      collectStars(camera, previous, colors, layer, speed);
      context.lineCap = "round";
      buckets.forEach((bucket) => {
        context.strokeStyle = rgba(bucket.warm ? colors.warmStar : colors.star, bucket.alpha);
        context.lineWidth = bucket.width;
        context.beginPath();
        const segments = bucket.segments;
        for (let index = 0; index < segments.length; index += 4) {
          const x = segments[index];
          const y = segments[index + 1];
          let tx = segments[index + 2];
          let ty = segments[index + 3];
          if (Math.abs(tx - x) < 0.25 && Math.abs(ty - y) < 0.25) tx = x + 0.25;
          context.moveTo(x, y);
          context.lineTo(tx, ty);
        }
        context.stroke();
      });
    }

    function drawChart(camera, colors, plan, progress) {
      context.lineWidth = 1;
      const base = lerp(0.2, 0.16, colors.night);
      CHART_LINES.forEach(([from, to]) => {
        const a = DESTINATIONS[from].landmark;
        const b = DESTINATIONS[to].landmark;
        const [ax, ay] = toScreen(camera, a.x, a.y);
        const [bx, by] = toScreen(camera, b.x, b.y);
        const length = Math.hypot(bx - ax, by - ay);
        const alpha = base * smoothstep(40, 120, length) * (1 - smoothstep(width * 1.6, width * 3.2, length));
        if (alpha < 0.01) return;
        context.strokeStyle = rgba(colors.line, alpha);
        context.setLineDash([1.5, 5]);
        context.beginPath();
        context.moveTo(ax, ay);
        context.lineTo(bx, by);
        context.stroke();
      });
      context.setLineDash([]);
      if (!plan) return;
      const a = plan.from.landmark;
      const b = plan.to.landmark;
      const [ax, ay] = toScreen(camera, a.x, a.y);
      const [bx, by] = toScreen(camera, b.x, b.y);
      const routeAlpha = 0.62 * Math.sin(Math.PI * clamp(progress, 0, 1)) ** 0.7;
      if (routeAlpha < 0.01) return;
      context.strokeStyle = rgba(colors.hud, routeAlpha);
      context.lineWidth = 1.2;
      context.setLineDash([6, 7]);
      context.lineDashOffset = -progress * 160;
      context.beginPath();
      context.moveTo(ax, ay);
      context.lineTo(bx, by);
      context.stroke();
      context.setLineDash([]);
      context.lineDashOffset = 0;
    }

    // Close up, the archive galaxy is drawn star by star instead of scaling
    // its sprite, so a dive into an entry flies between real arm stars.
    function drawGalaxyField(x, y, radius, alpha, colors) {
      if (alpha < 0.02) return;
      context.globalCompositeOperation = colors.night > 0.5 ? "lighter" : "source-over";
      drawGalaxyDisc(context, x, y, radius, alpha * Math.max(0.35, colors.night));
      const sizeScale = clamp(radius / 520, 1, 5);
      const margin = 8;
      galaxyParticles().buckets.forEach((bucket) => {
        context.fillStyle = colors.night > 0.5 ? GALAXY_COLORS[bucket.color] : rgba(mixRgb(colors.star, [80, 96, 170], bucket.color / 4), 1);
        context.globalAlpha = bucket.alpha * alpha;
        context.beginPath();
        bucket.particles.forEach((particle) => {
          const px = x + particle.x * radius;
          const py = y + particle.y * radius;
          if (px < -margin || px > width + margin || py < -margin || py > height + margin) return;
          const size = clamp(particle.size * sizeScale, 0.8, 4.5);
          context.rect(px - size / 2, py - size / 2, size, size);
        });
        context.fill();
      });
      context.globalAlpha = 1;
      // Close up the core is a bulge, not a blown-out disc.
      drawGalaxyCore(context, x, y, radius * clamp(700 / radius, 0.35, 1), alpha * 0.55 * Math.max(0.4, colors.night));
      context.globalCompositeOperation = "source-over";
    }

    function drawLandmark(camera, landmark, colors, labelAlpha = 1, weight = 1) {
      const [x, y] = toScreen(camera, landmark.x, landmark.y);
      const radius = landmark.r * base / camera.w;
      const reach = radius * 2.8 + 120;
      if (weight < 0.02 || x + reach < 0 || x - reach > width || y + reach < 0 || y - reach > height) return;
      const diagonal = Math.hypot(width, height);
      const live = landmark.kind === "galaxy" ? smoothstep(420, 760, radius) : 0;
      const insideFade = (landmark.kind === "galaxy"
        ? 1 - smoothstep(diagonal * 6, diagonal * 16, radius)
        : 1 - smoothstep(diagonal * 1.2, diagonal * 4.5, radius)) * weight;
      if (insideFade <= 0.01) return;
      if (radius < 1.2) {
        context.fillStyle = rgba(landmark.kind === "supernova" ? colors.warmStar : colors.star, 0.8 * insideFade);
        context.fillRect(x - 1, y - 1, 2, 2);
      } else {
        const sprite = spriteFor(landmark.kind);
        const glowWeight = landmarkGlowWeight(landmark.kind, colors.night) * insideFade;
        if (sprite && glowWeight * (1 - live) > 0.02) {
          const size = radius * sprite.pad * 2;
          context.globalAlpha = glowWeight * (1 - live);
          context.drawImage(sprite.canvas, x - size / 2, y - size / 2, size, size);
          context.globalAlpha = 1;
        }
        if (live > 0) drawGalaxyField(x, y, radius, live * Math.max(glowWeight, 0.5 * insideFade), colors);
        const lineAlpha = (1 - 0.62 * colors.night) * insideFade * smoothstep(2, 7, radius) * (landmark.kind === "survey" ? 0.55 : 0.85);
        if (lineAlpha > 0.02 && radius < Math.hypot(width, height) * 2.5) {
          context.strokeStyle = rgba(colors.line, lineAlpha);
          context.fillStyle = rgba(colors.line, lineAlpha);
          drawLineArt(context, landmark.kind, x, y, radius, 1);
        }
      }
      if (!landmark.tag || labelAlpha <= 0) return;
      const tagAlpha = labelAlpha * smoothstep(3, 12, radius * 2) * (1 - smoothstep(110, 240, radius * 2)) * insideFade;
      if (tagAlpha < 0.03) return;
      context.font = "600 9.5px \"Space Grotesk\", ui-sans-serif, system-ui, sans-serif";
      if ("letterSpacing" in context) context.letterSpacing = "1.3px";
      context.textBaseline = "middle";
      context.fillStyle = rgba(colors.label, tagAlpha * 0.9);
      context.fillText(landmark.tag, x + Math.max(radius * 1.08, 4) + 7, y);
      if ("letterSpacing" in context) context.letterSpacing = "0px";
    }

    // weights.from / weights.to are the pages' closeness: while a page is open
    // its own landmark stays under it, and takes over as the page closes.
    function drawWorld(camera, previous, colors, plan, progress, speed, weights = null) {
      fillSky(colors);
      drawHazes(camera, colors);
      drawStars(camera, previous, colors, "far", speed);
      drawChart(camera, colors, plan, progress);
      const weightFor = (key) => {
        if (!plan || !weights) return 1;
        if (key === plan.to.key) return landmarkHandoff(weights.to, true);
        if (key === plan.from.key) return landmarkHandoff(weights.from);
        return 1;
      };
      LANDMARK_KEYS.forEach((key) => drawLandmark(camera, DESTINATIONS[key].landmark, colors, plan && key === plan.to.key ? 0 : 1, weightFor(key)));
      [plan?.from, plan?.to].forEach((target) => {
        if (target?.key === "article") drawLandmark(camera, target.landmark, colors, target === plan.to ? 0 : 1, weightFor(target.key));
      });
    }

    // Phase-A and the non-transition fallback paint the sky over a live page,
    // so the page shows through a soft hole with the same profile as the mask
    // the view transition later applies to the page snapshot.
    function cutLens(lens) {
      if (!lens) return;
      begin();
      context.globalCompositeOperation = "destination-out";
      const gradient = context.createRadialGradient(lens.x, lens.y, 0, lens.x, lens.y, lens.radius);
      gradient.addColorStop(0, `rgba(0,0,0,${lens.strength})`);
      gradient.addColorStop(LENS_CORE, `rgba(0,0,0,${lens.strength})`);
      gradient.addColorStop(LENS_SHOULDER, `rgba(0,0,0,${lens.strength * LENS_SHOULDER_ALPHA})`);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = "source-over";
    }

    function drawHud(camera, colors, plan, progress, lock, arrival = 0) {
      if (!plan) return;
      begin();
      const target = plan.to.landmark;
      const [tx, ty] = toScreen(camera, target.x, target.y);
      const radius = target.r * base / camera.w;
      const minimum = Math.min(width, height);
      const fade = (1 - smoothstep(0.8, 0.94, progress))
        * (1 - smoothstep(0.36, 0.62, arrival))
        * (1 - smoothstep(minimum * 0.3, minimum * 0.5, radius))
        * smoothstep(0, 0.35, lock);
      if (fade < 0.02) return;
      const insetTop = 76;
      const inset = 30;
      const clampedX = clamp(tx, inset, width - inset);
      const clampedY = clamp(ty, insetTop, height - inset);
      const offscreen = clampedX !== tx || clampedY !== ty;
      const settle = irisEase(clamp(lock, 0, 1));
      context.strokeStyle = rgba(colors.hud, 0.88 * fade);
      context.fillStyle = rgba(colors.hud, 0.92 * fade);
      context.lineWidth = 1.25;
      if (offscreen) {
        const angle = Math.atan2(ty - clampedY, tx - clampedX);
        context.save();
        context.translate(clampedX, clampedY);
        context.rotate(angle);
        context.beginPath();
        context.moveTo(-5, -7);
        context.lineTo(4, 0);
        context.lineTo(-5, 7);
        context.moveTo(-12, -7);
        context.lineTo(-3, 0);
        context.lineTo(-12, 7);
        context.stroke();
        context.restore();
      } else {
        const box = clamp(radius * 1.4, 14, minimum * 0.3) * lerp(2.4, 1, settle);
        const arm = Math.max(5, box * 0.3);
        context.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const cx = tx + sx * box;
          const cy = ty + sy * box;
          context.moveTo(cx - sx * arm, cy);
          context.lineTo(cx, cy);
          context.lineTo(cx, cy - sy * arm);
        }
        context.stroke();
      }
      const distance = Math.hypot(target.x - camera.x, target.y - camera.y) + Math.abs(Math.log2(camera.w / landingCamera(plan).w)) * 0.8;
      const bearing = (Math.atan2(target.y - plan.from.landmark.y, target.x - plan.from.landmark.x) * 180 / Math.PI + 90 + 360) % 360;
      const labelX = clamp(offscreen ? clampedX : tx, 70, width - 70);
      const labelY = offscreen ? clampedY + (clampedY > height / 2 ? -26 : 26) : clamp(ty - Math.max(radius * 1.4, 14) - 22, insetTop - 6, height - 40);
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "700 10.5px \"Space Grotesk\", ui-sans-serif, system-ui, sans-serif";
      if ("letterSpacing" in context) context.letterSpacing = "1.6px";
      context.fillText(plan.to.landmark.tag, labelX, labelY);
      context.font = "500 9px \"Space Grotesk\", ui-sans-serif, system-ui, sans-serif";
      context.fillStyle = rgba(colors.hud, 0.66 * fade);
      context.fillText(`AZ ${String(Math.round(bearing)).padStart(3, "0")}° · ${(distance * 3.26).toFixed(1)} LY`, labelX, labelY + 13);
      if ("letterSpacing" in context) context.letterSpacing = "0px";
      context.textAlign = "start";
    }

    // A page that has closed into a lens gets a field stop: a hairline ring and
    // cardinal ticks, the way a scope frames what it is pointed at.
    function drawFieldStop(page, colors) {
      const strength = page.opacity * smoothstep(0.12, 0.3, page.closeness) * (1 - smoothstep(0.62, 0.92, page.closeness));
      if (strength < 0.03) return;
      begin();
      const x = width / 2 + page.x + (page.focus.x - width / 2) * page.scale;
      const y = height / 2 + page.y + (page.focus.y - height / 2) * page.scale;
      const radius = page.radius * page.scale * 0.84;
      if (radius < 6 || x + radius < 0 || x - radius > width || y + radius < 0 || y - radius > height) return;
      context.strokeStyle = rgba(colors.hud, 0.55 * strength);
      context.lineWidth = 1;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      for (let index = 0; index < 4; index += 1) {
        const angle = index * Math.PI / 2;
        context.moveTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
        context.lineTo(x + Math.cos(angle) * (radius + 7), y + Math.sin(angle) * (radius + 7));
      }
      context.stroke();
      context.strokeStyle = rgba(colors.hud, 0.22 * strength);
      context.setLineDash([1, 5]);
      context.beginPath();
      context.arc(x, y, radius * 1.09, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }

    return { resize, clear, drawWorld, drawStars, cutLens, drawHud, drawFieldStop, begin, context };
  }

  // ---------------------------------------------------------------------------
  // Scene plumbing
  // ---------------------------------------------------------------------------

  function createLayer(name, zIndex) {
    const canvas = document.createElement("canvas");
    canvas.setAttribute?.("aria-hidden", "true");
    canvas.dataset.universeSky = name;
    const style = canvas.style;
    if (typeof style?.setProperty === "function") {
      style.setProperty("position", "fixed");
      style.setProperty("inset", "0");
      style.setProperty("width", "100vw");
      style.setProperty("height", "100vh");
      style.setProperty("pointer-events", "none");
      style.setProperty("z-index", String(zIndex));
      style.setProperty("view-transition-name", name);
      style.setProperty("contain", "strict");
    }
    const host = document.body || root;
    try {
      if (typeof host.append === "function") host.append(canvas);
      else if (typeof host.prepend === "function") host.prepend(canvas);
      else return null;
    } catch (_error) {
      return null;
    }
    return canvas;
  }

  function removeLayer(canvas) {
    try { canvas?.remove?.(); } catch (_error) { /* already detached */ }
  }

  function stopScene() {
    const scene = activeScene;
    activeScene = null;
    if (!scene) return;
    scene.stopped = true;
    scene.removeFastForward?.();
    if (scene.frame) window.cancelAnimationFrame?.(scene.frame);
    scene.layers.forEach(removeLayer);
    scene.animations?.forEach((animation) => {
      try { animation.cancel(); } catch (_error) { /* finished with the transition */ }
    });
  }

  function speedAt(plan, t) {
    const a = cameraAt(plan, Math.max(0, t - 0.012));
    const b = cameraAt(plan, Math.min(1, t + 0.012));
    const zoom = Math.abs(Math.log(b.w / a.w));
    const pan = Math.hypot(b.x - a.x, b.y - a.y) / ((a.w + b.w) / 2);
    return clamp((zoom + pan) * 4, 0, 1);
  }

  function shutterCamera(plan, t) {
    return cameraAt(plan, Math.max(0, t - 0.03));
  }

  // Phase A: the click is answered on the same frame. The current page becomes
  // a lens — sky closes in at its edges and the scope locks onto the
  // destination — while the next document is fetched.
  function startIris(travel) {
    stopScene();
    if (!document.body || typeof document.createElement !== "function") return;
    const canvas = createLayer("universe-iris", 47);
    const sky = createSky(canvas, { dpr: window.devicePixelRatio || 1 });
    if (!sky) {
      removeLayer(canvas);
      return;
    }
    const viewport = travel.viewport;
    const plan = planFlight(travel, null, viewport);
    prepareSprites([plan.from.landmark.kind, plan.to.landmark.kind]);
    const full = fullLens(plan.sourceFocus, viewport);
    const scene = { kind: "iris", layers: [canvas], started: now(), stopped: false, frame: 0, travel, plan, iris: 1, lock: 0 };
    activeScene = scene;
    sky.resize(viewport);
    const colors = palette(plan.fromDark);
    const draw = () => {
      if (scene.stopped) return;
      const elapsed = now() - scene.started;
      const amount = irisEase(clamp(elapsed / IRIS_MS, 0, 1));
      scene.iris = lerp(1, IRIS_CLOSE, amount);
      scene.lock = clamp(elapsed / 520, 0, 1);
      sky.drawWorld(plan.start, plan.start, colors, plan, 0, 0, pageWeights(plan, plan.start));
      sky.cutLens({ x: plan.sourceFocus.x, y: plan.sourceFocus.y, radius: full * scene.iris, strength: 1 });
      sky.drawHud(plan.start, colors, plan, 0, scene.lock);
    };
    scene.draw = draw;
    const tick = () => {
      draw();
      if (!scene.stopped && now() - scene.started < 1400) scene.frame = window.requestAnimationFrame(tick);
    };
    tick();
  }

  // Fallback for documents without cross-document view transitions: the old
  // page plays the first part of the flight over itself and hands off once it
  // has dissolved into its landmark.
  function startDepartureFlight(travel, onHandoff) {
    stopScene();
    const canvas = createLayer("universe-iris", 2147483000);
    const sky = createSky(canvas, { dpr: window.devicePixelRatio || 1 });
    if (!sky) {
      // Without a sky the departure keeps its normal timing; the scheduled
      // handoff still navigates.
      removeLayer(canvas);
      return;
    }
    const viewport = travel.viewport;
    const plan = planFlight(travel, null, viewport);
    prepareSprites([plan.from.landmark.kind, plan.to.landmark.kind]);
    sky.resize(viewport);
    const span = Math.min(FALLBACK_DEPARTURE_MS, plan.duration * FALLBACK_HANDOFF);
    const handoff = span / plan.duration;
    travel.handoff = handoff;
    travel.duration = plan.duration;
    const scene = { kind: "departure", layers: [canvas], started: now(), stopped: false, frame: 0 };
    activeScene = scene;
    let handedOff = false;
    const tick = () => {
      if (scene.stopped) return;
      const t = clamp((now() - scene.started) / plan.duration, 0, handoff);
      renderOverlayFrame(sky, plan, t, plan.start, plan.sourceFocus, t * plan.duration / 520);
      if (t >= handoff) {
        if (!handedOff) {
          handedOff = true;
          onHandoff();
        }
        return;
      }
      scene.frame = window.requestAnimationFrame(tick);
    };
    tick();
  }

  function renderOverlayFrame(sky, plan, t, pageCam, focus, lock) {
    const camera = cameraAt(plan, t);
    const colors = palette(darknessAt(plan, t));
    const speed = speedAt(plan, t);
    const weights = pageWeights(plan, camera);
    sky.drawWorld(camera, shutterCamera(plan, t), colors, plan, t, speed, weights);
    const page = pageState(pageCam, camera, focus, plan.viewport, {
      enclosing: pageCam === plan.start ? plan.sourceEncloses : plan.targetEncloses,
    });
    const lensX = plan.viewport.w / 2 + page.x + (focus.x - plan.viewport.w / 2) * page.scale;
    const lensY = plan.viewport.h / 2 + page.y + (focus.y - plan.viewport.h / 2) * page.scale;
    sky.cutLens({ x: lensX, y: lensY, radius: page.radius * page.scale, strength: page.opacity });
    sky.drawStars(camera, shutterCamera(plan, t), colors, "near", speed);
    sky.drawHud(camera, colors, plan, t, lock, weights.to);
  }

  function startFallbackArrival(record) {
    stopScene();
    const canvas = createLayer("universe-arrival", 2147483000);
    const sky = createSky(canvas, { dpr: window.devicePixelRatio || 1 });
    if (!sky) {
      removeLayer(canvas);
      return false;
    }
    const viewport = viewportSize();
    const plan = planFlight(record, null, viewport);
    prepareSprites([plan.from.landmark.kind, plan.to.landmark.kind]);
    sky.resize(viewport);
    const handoff = clamp(record.handoff || FALLBACK_HANDOFF, 0, 0.9);
    const scene = { kind: "fallback-arrival", layers: [canvas], started: 0, stopped: false, frame: 0, plan };
    activeScene = scene;
    let focusMeasured = false;
    const render = (t) => {
      if (!focusMeasured && document.readyState !== "loading") {
        focusMeasured = true;
        correctLanding(plan, measureFocus(plan.to, viewport), Math.max(t, handoff));
      }
      renderOverlayFrame(sky, plan, t, landingCamera(plan), plan.targetFocus, 2);
    };
    render(handoff);
    const begin = () => {
      if (scene.stopped) return;
      scene.started = now();
      const tick = () => {
        if (scene.stopped) return;
        const t = handoff + (now() - scene.started) / plan.duration;
        if (t >= 1) {
          clearTravelState({ generation: arrivalGeneration });
          return;
        }
        render(t);
        scene.frame = window.requestAnimationFrame(tick);
      };
      scene.frame = window.requestAnimationFrame(tick);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", begin, { once: true });
    else begin();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Cross-document arrival
  // ---------------------------------------------------------------------------

  function pageKeyframe(state, offset) {
    return {
      offset,
      transform: `translate(${state.x.toFixed(2)}px, ${state.y.toFixed(2)}px) scale(${state.scale.toFixed(5)})`,
      opacity: Number(state.opacity.toFixed(4)),
      "--universe-lens-x": `${state.focus.x.toFixed(1)}px`,
      "--universe-lens-y": `${state.focus.y.toFixed(1)}px`,
      "--universe-lens-r": `${state.radius.toFixed(1)}px`,
      "--universe-feather": `${state.feather.toFixed(1)}px`,
    };
  }

  function arrivalKeyframes(plan, irisLimit) {
    const samples = Math.max(24, Math.ceil(plan.duration / 16));
    const old = [];
    const next = [];
    const landing = landingCamera(plan);
    for (let index = 0; index <= samples; index += 1) {
      const t = index / samples;
      const camera = cameraAt(plan, t);
      old.push(pageKeyframe(pageState(plan.start, camera, plan.sourceFocus, plan.viewport, { irisLimit, enclosing: plan.sourceEncloses }), t));
      const state = pageState(landing, camera, plan.targetFocus, plan.viewport, { enclosing: plan.targetEncloses });
      if (index === samples) {
        state.x = 0;
        state.y = 0;
        state.scale = 1;
        state.opacity = 1;
        state.feather = 0;
      }
      next.push(pageKeyframe(state, t));
    }
    return { old, next };
  }

  function animatePseudo(pseudoElement, keyframes, duration) {
    try {
      return root.animate(keyframes, { duration, easing: "linear", fill: "both", pseudoElement });
    } catch (_error) {
      return null;
    }
  }

  function setInitialArrivalStyles(plan, irisLimit) {
    const camera = plan.start;
    const old = pageState(plan.start, camera, plan.sourceFocus, plan.viewport, { irisLimit });
    root.style.setProperty("--universe-old-lens-x", `${plan.sourceFocus.x.toFixed(1)}px`);
    root.style.setProperty("--universe-old-lens-y", `${plan.sourceFocus.y.toFixed(1)}px`);
    root.style.setProperty("--universe-old-lens-r", `${old.radius.toFixed(1)}px`);
    root.style.setProperty("--universe-flight-sky", rgbHex(palette(plan.fromDark).sky));
    root.style.setProperty("--universe-perspective-duration", `${plan.duration}ms`);
  }

  function clearArrivalStyles() {
    ["--universe-old-lens-x", "--universe-old-lens-y", "--universe-old-lens-r", "--universe-flight-sky"].forEach((property) => {
      root.style.removeProperty?.(property);
    });
    delete root.dataset.universeFlight;
  }

  function startViewTransitionArrival(transition, record) {
    stopScene();
    const viewport = viewportSize();
    const plan = planFlight(record, measureFocus(destinationForRecord(record.to, record.toPath), viewport), viewport);
    const irisLimit = fullLens(plan.sourceFocus, viewport) * clamp(record.iris || 1, IRIS_CLOSE, 1);
    const back = createLayer("universe-cosmos", 46);
    const front = createLayer("universe-cosmos-near", 49);
    const dpr = window.devicePixelRatio || 1;
    const backSky = createSky(back, { dpr });
    const frontSky = createSky(front, { dpr });
    if (!backSky || !frontSky) {
      removeLayer(back);
      removeLayer(front);
      return false;
    }
    root.dataset.universeFlight = "true";
    setInitialArrivalStyles(plan, irisLimit);
    prepareSprites([plan.from.landmark.kind, plan.to.landmark.kind]);
    backSky.resize(viewport);
    frontSky.resize(viewport);
    const scene = { kind: "arrival", layers: [back, front], stopped: false, frame: 0, plan, animations: [] };
    activeScene = scene;
    const lockOffset = clamp(record.lock || 0, 0, 1);
    const render = (t) => {
      const camera = cameraAt(plan, t);
      const previous = shutterCamera(plan, t);
      const colors = palette(darknessAt(plan, t));
      const speed = speedAt(plan, t);
      const pages = pageStates(plan, camera, irisLimit);
      const weights = { from: pages.source.closeness, to: pages.target.closeness };
      backSky.drawWorld(camera, previous, colors, plan, t, speed, weights);
      frontSky.clear();
      frontSky.drawStars(camera, previous, colors, "near", speed);
      frontSky.drawFieldStop(pages.source, colors);
      frontSky.drawFieldStop(pages.target, colors);
      frontSky.drawHud(camera, colors, plan, t, lockOffset + t * plan.duration / 520, weights.to);
    };
    render(0);
    lastTravel = Object.freeze({ ...lastTravel, duration: plan.duration });

    transition.ready.then(() => {
      if (scene.stopped) return;
      const settledFocus = measureFocus(plan.to, viewport);
      correctLanding(plan, settledFocus, 0);
      const frames = arrivalKeyframes(plan, irisLimit);
      const oldPage = animatePseudo("::view-transition-old(root)", frames.old, plan.duration);
      const newPage = animatePseudo("::view-transition-new(root)", frames.next, plan.duration);
      // The header leaves with the departing page and lands with the next one,
      // so open space is never framed by a page's chrome.
      const hudOut = animatePseudo("::view-transition-old(universe-site-header)", [
        { offset: 0, opacity: 1 }, { offset: 0.1, opacity: 1 }, { offset: 0.3, opacity: 0 }, { offset: 1, opacity: 0 },
      ], plan.duration);
      const hudIn = animatePseudo("::view-transition-new(universe-site-header)", [
        { offset: 0, opacity: 0 }, { offset: 0.66, opacity: 0 }, { offset: 0.88, opacity: 1 }, { offset: 1, opacity: 1 },
      ], plan.duration);
      scene.animations = [oldPage, newPage, hudOut, hudIn].filter(Boolean);
      const clock = newPage || oldPage;
      // Hold on the opening frame until the arriving document has run its
      // start-up scripts: a beat of stillness reads as the scope settling,
      // a stall mid-flight would read as a dropped frame. Paused animations
      // keep the transition alive while it waits.
      const holdStarted = now();
      const held = [];
      let released = false;
      const release = () => {
        if (released || scene.stopped) return;
        released = true;
        if (lastFlightStats) lastFlightStats.holdMs = Math.round(now() - holdStarted);
        // Resume only what the hold paused; anything else paused the flight
        // deliberately (developer tools, tests) and keeps control of it.
        held.forEach((animation) => {
          try { if (animation.playState === "paused") animation.play(); } catch (_error) { /* finished with the transition */ }
        });
      };
      if (document.readyState === "loading") {
        scene.animations.forEach((animation) => {
          try {
            if (animation.playState !== "running") return;
            animation.pause();
            held.push(animation);
          } catch (_error) { /* finished with the transition */ }
        });
        document.addEventListener("DOMContentLoaded", () => {
          window.requestAnimationFrame(() => window.requestAnimationFrame(release));
        }, { once: true });
        schedule(release, ARRIVAL_HOLD_LIMIT_MS);
      } else {
        released = true;
      }
      const started = now();
      // Frame accounting for tests and tuning: what the sky costs, and the
      // longest gap the page's own start-up work forced between frames.
      const stats = { frames: 0, renderMs: 0, maxRenderMs: 0, maxGapMs: 0, holdMs: 0, duration: plan.duration };
      lastFlightStats = stats;
      let previousFrame = 0;
      const tick = () => {
        if (scene.stopped) return;
        const frameStart = now();
        if (previousFrame && released) stats.maxGapMs = Math.max(stats.maxGapMs, frameStart - previousFrame);
        previousFrame = frameStart;
        const time = clock && Number.isFinite(Number(clock.currentTime)) ? Number(clock.currentTime) : now() - started;
        const t = clamp(time / plan.duration, 0, 1);
        render(t);
        const cost = now() - frameStart;
        stats.frames += 1;
        stats.renderMs += cost;
        stats.maxRenderMs = Math.max(stats.maxRenderMs, cost);
        // Runs until the transition ends, so a paused flight can be scrubbed.
        scene.frame = window.requestAnimationFrame(tick);
      };
      tick();
      installFastForward(scene);
    }, () => {
      stopScene();
      clearArrivalStyles();
    });
    return true;
  }

  // Any deliberate input during the landing fast-forwards it instead of
  // trapping the visitor inside the flight.
  function installFastForward(scene) {
    const accelerate = (event) => {
      if (scene.stopped) return;
      if (event.type === "keydown" && ["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      scene.animations.forEach((animation) => {
        try { animation.playbackRate = 3.2; } catch (_error) { /* animation already finished */ }
      });
    };
    const options = { capture: true, passive: true };
    window.addEventListener("pointerdown", accelerate, options);
    window.addEventListener("keydown", accelerate, options);
    window.addEventListener("wheel", accelerate, options);
    scene.removeFastForward = () => {
      window.removeEventListener("pointerdown", accelerate, options);
      window.removeEventListener("keydown", accelerate, options);
      window.removeEventListener("wheel", accelerate, options);
    };
  }

  // ---------------------------------------------------------------------------
  // Navigation lifecycle
  // ---------------------------------------------------------------------------

  function createTravel(source, target, targetUrl) {
    const viewport = viewportSize();
    const deltaX = target.landmark.x - source.landmark.x;
    const deltaY = target.landmark.y - source.landmark.y;
    const deltaDepth = target.depth - source.depth;
    const fromFocus = measureFocus(source, viewport);
    const toFocus = defaultFocus(viewport);
    const record = {
      version: RECORD_VERSION,
      motionModel: MOTION_MODEL,
      pathModel: PATH_MODEL,
      createdAt: Date.now(),
      destinationUrl: `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`,
      from: source.key,
      fromPath: normalizedPath(window.location.pathname),
      fromLabel: source.label,
      fromDepth: source.depth,
      fromMagnification: source.magnification,
      fromSurface: surfaceForDestination(source),
      fromFocus,
      to: target.key,
      toPath: normalizedPath(targetUrl.pathname),
      toLabel: target.label,
      toMapId: target.mapId,
      toDepth: target.depth,
      toMagnification: target.magnification,
      toSurface: surfaceForDestination(target),
      toFocus,
      direction: directionFor(deltaX, deltaY),
      depthDirection: Math.abs(deltaDepth) < 0.25 ? "level" : deltaDepth > 0 ? "farther" : "nearer",
      viewport,
      iris: 1,
      lock: 0,
    };
    const plan = planFlight(record, null, viewport);
    record.duration = plan.duration;
    record.zoomPathLength = Number(Math.abs(plan.path.S).toFixed(4));
    record.peakWidth = Number(plan.peak.toFixed(4));
    return record;
  }

  function applyTravel(travel) {
    lastTravel = travel;
    root.dataset.universeTravel = travel.direction;
    root.dataset.universeDepthTravel = travel.depthDirection;
    root.dataset.universePerspectiveFrom = travel.from;
    root.dataset.universePerspectiveTo = travel.to;
    root.style.setProperty("--universe-perspective-duration", `${travel.duration}ms`);
  }

  function clearTravelState({ keepLast = true, generation = null } = {}) {
    if (generation !== null && generation !== travelGeneration) return;
    clearTimers();
    stopScene();
    clearArrivalStyles();
    transitionInFlight = false;
    pendingDeparture = null;
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

  function validArrival(travel) {
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return Boolean(travel)
      && travel.version === RECORD_VERSION
      && travel.motionModel === MOTION_MODEL
      && Date.now() - travel.createdAt <= MAX_ARRIVAL_AGE
      && travel.createdAt - Date.now() <= 1000
      && travel.destinationUrl === currentUrl;
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
      return validArrival(travel) ? travel : null;
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

  function syncIrisIntoRecord() {
    const travel = lastTravel;
    const scene = activeScene;
    if (!travel || !scene || scene.kind !== "iris") return;
    scene.draw?.();
    const updated = { ...travel, iris: Number(scene.iris.toFixed(4)), lock: Number(scene.lock.toFixed(4)) };
    lastTravel = updated;
    storeArrival(updated);
  }

  function beginDeparture(event, anchor, targetUrl, target) {
    const retargeted = transitionInFlight;
    const generation = ++travelGeneration;
    if (retargeted) {
      skipActiveTransition();
      clearTimers();
      stopScene();
      transitionInFlight = false;
    }

    const travel = createTravel(currentDestination(), target, targetUrl);
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

    event.preventDefault();
    pendingDeparture = { generation, href: targetUrl.href };
    if (root.dataset.universeCrossDocument === "true") {
      try { startIris(travel); } catch (_error) { stopScene(); }
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        completeDeparture(generation);
      }));
      schedule(() => clearTravelState({ generation }), ABANDONED_DEPARTURE_MS);
      return;
    }

    let handedOff = false;
    const handoff = () => {
      if (handedOff) return;
      handedOff = true;
      storeArrival(travel);
      completeDeparture(generation);
    };
    try { startDepartureFlight(travel, handoff); } catch (_error) { stopScene(); }
    schedule(handoff, FALLBACK_DEPARTURE_MS + 40);
    schedule(() => clearTravelState({ generation }), FALLBACK_DEPARTURE_MS + 1200);
  }

  function ensureStylesheet() {
    if (document.querySelector("link[data-universe-perspective-styles]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = STYLE_HREF;
    link.dataset.universePerspectiveStyles = "";
    document.head.append(link);
  }

  // Same-origin pages are fetched on hover so the flight, not the network,
  // sets the pace of a navigation.
  function installSpeculation() {
    try {
      if (!window.HTMLScriptElement?.supports?.("speculationrules")) return;
      if (document.querySelector("script[data-universe-speculation]")) return;
      const script = document.createElement("script");
      script.type = "speculationrules";
      script.dataset.universeSpeculation = "";
      script.textContent = JSON.stringify({
        prefetch: [{
          where: { and: [
            { href_matches: "/*" },
            { not: { href_matches: ["/*.pdf", "/*.xml", "/*.json", "/*\\?*"] } },
            { not: { selector_matches: "[download], [rel~=nofollow]" } },
          ] },
          eagerness: "moderate",
        }],
      });
      document.head.append(script);
    } catch (_error) {
      // Prefetch is an optimisation only.
    }
  }

  function crossDocumentTransitionsSupported() {
    return "onpageswap" in window
      && "onpagereveal" in window
      && typeof window.CSS?.supports === "function"
      && window.CSS.supports("view-transition-name: universe-page");
  }

  ensureStylesheet();
  installSpeculation();
  const crossDocument = crossDocumentTransitionsSupported();
  root.dataset.universeCrossDocument = crossDocument ? "true" : "false";
  root.dataset.universePerspective = "ready";

  let arrival = takeArrival();
  if (arrival && !motionIsReduced()) {
    arrivalGeneration = ++travelGeneration;
    transitionInFlight = true;
    applyTravel(arrival);
    root.dataset.universePerspective = "arriving";
    root.dataset.universeMotion = "arrive";
    if (!crossDocument) {
      let started = false;
      try { started = Boolean(arrival.handoff) && startFallbackArrival(arrival); } catch (_error) { stopScene(); }
      const remaining = started ? arrival.duration * (1 - arrival.handoff) : 0;
      schedule(() => clearTravelState({ generation: arrivalGeneration }), remaining + 600);
    }
  } else {
    arrival = null;
  }

  // Back, forward and other navigations that never passed through the click
  // handler still fly: the leaving page writes the flight plan at swap time.
  window.addEventListener("pageswap", (event) => {
    if (event.viewTransition) activeViewTransition = event.viewTransition;
    if (motionIsReduced() || !event.viewTransition) return;
    if (root.dataset.universeMotion === "depart") {
      syncIrisIntoRecord();
      return;
    }
    const entryUrl = event.activation?.entry?.url;
    if (!entryUrl) return;
    let targetUrl;
    try { targetUrl = new URL(entryUrl); } catch (_error) { return; }
    if (targetUrl.origin !== window.location.origin) return;
    const target = destinationForLocation(targetUrl.pathname, targetUrl.hash);
    if (!target || normalizedPath(targetUrl.pathname) === normalizedPath(window.location.pathname)) return;
    const travel = createTravel(currentDestination(), target, targetUrl);
    lastTravel = travel;
    storeArrival(travel);
  });

  window.addEventListener("pagereveal", (event) => {
    if (motionIsReduced()) return;
    if (!arrival) {
      const restored = event.viewTransition ? takeArrival() : null;
      if (!restored) return;
      arrival = restored;
      arrivalGeneration = ++travelGeneration;
      transitionInFlight = true;
      applyTravel(arrival);
      root.dataset.universePerspective = "arriving";
      root.dataset.universeMotion = "arrive";
    }
    const record = arrival;
    arrival = null;
    if (!event.viewTransition) {
      // Capability support does not guarantee a transition for this navigation.
      root.dataset.universeCrossDocument = "false";
      let started = false;
      try { started = Boolean(record.handoff) && startFallbackArrival(record); } catch (_error) { stopScene(); }
      schedule(() => clearTravelState({ generation: arrivalGeneration }), started ? record.duration + 600 : 120);
      return;
    }
    const transition = event.viewTransition;
    activeViewTransition = transition;
    let started = false;
    try { started = startViewTransitionArrival(transition, record); } catch (_error) { stopScene(); clearArrivalStyles(); }
    if (!started) {
      try { transition.skipTransition(); } catch (_error) { /* nothing to skip */ }
    }
    const generation = arrivalGeneration;
    transition.finished.finally(() => {
      if (activeViewTransition === transition) activeViewTransition = null;
      clearTravelState({ generation });
    });
  });

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    const node = event.target instanceof Element ? event.target : null;
    const directAnchor = node?.closest("a[href]");
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

    const target = destinationForLocation(targetUrl.pathname, targetUrl.hash);
    if (!target) return;
    if (normalizedPath(targetUrl.pathname) === normalizedPath(window.location.pathname)) return;
    beginDeparture(event, anchor, targetUrl, target);
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

  // Warm the sprites for this page's neighbourhood while the visitor reads, so
  // the first click never pays for them.
  function warmSprites() {
    if (motionIsReduced()) return;
    const kinds = new Set([currentDestination().landmark.kind, "orbital", "supernova", "nebula", "galaxy"]);
    try { prepareSprites([...kinds]); } catch (_error) { /* rendered lazily instead */ }
  }
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(warmSprites, { timeout: 2500 });

  window.UniversePerspective = Object.freeze({
    snapshot() {
      const current = currentDestination();
      return Object.freeze({
        current: current.key,
        currentMapId: current.mapId,
        depth: current.depth,
        magnification: current.magnification,
        landmark: Object.freeze({ ...current.landmark }),
        // Where this page dissolves into, and unfolds out of, its landmark.
        focus: Object.freeze(measureFocus(current)),
        model: MOTION_MODEL,
        pathModel: PATH_MODEL,
        crossDocument,
        lastTravel: lastTravel ? Object.freeze({ ...lastTravel }) : null,
        flightStats: lastFlightStats ? Object.freeze({
          frames: lastFlightStats.frames,
          averageRenderMs: Number((lastFlightStats.renderMs / Math.max(1, lastFlightStats.frames)).toFixed(2)),
          maxRenderMs: Number(lastFlightStats.maxRenderMs.toFixed(2)),
          maxGapMs: Number(lastFlightStats.maxGapMs.toFixed(1)),
          holdMs: lastFlightStats.holdMs,
          duration: lastFlightStats.duration,
        }) : null,
        motion: root.dataset.universeMotion || null,
        scene: activeScene?.kind || null,
        activeTransition: Boolean(activeViewTransition),
        pendingCleanup: timers.size,
        ready: root.dataset.universePerspective || "pending",
        retargetable: true,
        stylesheet: Boolean(document.querySelector("link[data-universe-perspective-styles]")),
      });
    },
    // Exposed for tests and tooling: the pure flight model, no DOM involved.
    model: Object.freeze({
      destinationForLocation,
      pageCamera,
      zoomPath,
      flightDuration,
      planFlight,
      cameraAt,
      pageState,
      lensRadius,
      pageOpacity,
    }),
  });
})();
