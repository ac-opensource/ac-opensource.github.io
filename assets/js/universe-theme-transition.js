(function () {
  "use strict";

  // Every route is a place in one universe. A navigation is a camera flight:
  // the current page collapses into its object, the camera turns toward the
  // destination through a shared 3D sky, then its object opens into the page.
  //
  // Chromium and Safari fly the whole path inside one cross-document view
  // transition: the old page is a snapshot placed in the world, the new page is
  // live, and a canvas renders the sky between them. Other browsers split the
  // same flight across the two documents and hand off in open space.

  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ARRIVAL_KEY = "ac.universe-perspective.v1";
  const RECORD_VERSION = 13;
  const MOTION_MODEL = "cosmic-camera";
  const PATH_MODEL = "spatial-zoom-orbit";
  const MAX_ARRIVAL_AGE = 8000;
  const STYLE_HREF = "/assets/css/universe-perspective-navigation.css?v=20261005-spatial5";
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

  // One volume, not a page plane: x grows east, y grows down, z grows toward
  // the observer at rest. The sky map is its X/Y chart. Pages rest facing -Z;
  // flights yaw/pitch toward their actual target, including objects behind us.
  // Region centers leave open space between their fixed-size landmarks.
  // Skills and Production retain their local offsets inside their parent region.
  const DESTINATIONS = Object.freeze({
    home: destination("home", "Dashboard", "home", 1, 1, "[data-camera-window]",
      { x: 0, y: 0, z: 0, r: 1, kind: "orbital", tag: "00 HOME" }),
    about: destination("about", "About", "about", 4.5, 1.6, "#profile-map",
      { x: -28.8, y: 13.2, z: 45, r: 2.6, kind: "nebula", tag: "01 ABOUT" }),
    profile: destination("profile", "Skills", "profile", 7.4, 3.2, null,
      { x: -27.3, y: 11.4, z: 45, r: 0.62, kind: "tree", tag: "02 SKILLS" }),
    work: destination("work", "Portfolio", "work", 3.1, 2.4, ".work-hero__art",
      { x: -3.6, y: -22.2, z: -15, r: 1.5, kind: "supernova", tag: "03 PORTFOLIO" }),
    projects: destination("projects", "Production apps", "projects", 8.8, 5.6, ".work-bitcoin-gallery",
      { x: -0.9, y: -21.4, z: -15, r: 0.42, kind: "cluster", tag: "04 PRODUCTION" }),
    logs: destination("logs", "Logs", "threads", 6.5, 2.8, "#galaxy-field",
      { x: 52.5, y: 24.6, z: -36, r: 6.4, kind: "galaxy", tag: "05 LOGS" }),
    contact: destination("contact", "Contact", "contact", 4, 1.8, "[data-payload-visual]",
      { x: 2.4, y: 8.7, z: 5.4, r: 0.32, kind: "probe", tag: "06 CONTACT" }),
    resume: destination("resume", "Resume", "work", 6.2, 4.4, ".resume-timeline__track",
      { x: 5.7, y: -12.6, z: 15, r: 0.55, kind: "chart", tag: "07 RÉSUMÉ" }),
    signals: destination("signals", "Signals", "contact", 6.9, 3.6, ".signals-orbit__field",
      { x: 7.2, y: 11.7, z: 14.4, r: 0.26, kind: "beacon", tag: "08 SIGNALS" }),
    search: destination("search", "Evidence search", "threads", 5.4, 3.8, ".evidence-search__field",
      { x: 9.6, y: 1.2, z: -12, r: 9, kind: "survey", tag: "09 SEARCH" }),
  });
  const LANDMARK_KEYS = ["search", "logs", "about", "work", "home", "resume", "projects", "profile", "contact", "signals"];
  const CHART_LINES = [
    ["home", "contact"], ["contact", "signals"], ["home", "about"], ["about", "profile"],
    ["home", "resume"], ["resume", "work"], ["work", "projects"], ["home", "logs"],
  ];
  const HAZES = [
    { ...DESTINATIONS.about.landmark, r: 7.5, rgb: [96, 120, 230] },
    { ...DESTINATIONS.work.landmark, r: 5.5, rgb: [54, 132, 185] },
    { ...DESTINATIONS.logs.landmark, r: 15, rgb: [92, 96, 214] },
    { ...DESTINATIONS.home.landmark, r: 4.5, rgb: [40, 150, 170] },
  ];
  // The archive and flight share trailing arms and an orbital clock. The
  // observer determines their apparent angle, never a screen-facing sprite.
  const galaxyGeometry = Object.freeze({
    arms: 4, centerX: 0.5, centerY: 0.52, radiusX: 0.49, radiusY: 0.43,
    phase: -0.78, twist: 5.65,
    frequency: (radius) => 1 / Math.pow(radius * radius + 0.25 * 0.25, 0.75),
    angle(radius, arm, jitter = 0, elapsed = 0) {
      return arm * Math.PI / 2 + radius * this.twist + this.phase + jitter - elapsed * 0.012 * this.frequency(radius);
    },
  });

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

  function galaxyWorldPoint(landmark, radius, angle, aspect = 0.8, height = 0) {
    return { x: landmark.x + Math.cos(angle) * radius * landmark.r,
      y: landmark.y + Math.sin(angle) * radius * landmark.r * aspect,
      z: landmark.z + height * landmark.r };
  }

  function galaxyArmPoint(arm, along, spread = 0) {
    const radius = 0.1 + 0.86 * along;
    const theta = galaxyGeometry.angle(radius, arm, spread);
    return { x: radius * Math.cos(theta), y: radius * Math.sin(theta) * 0.8 };
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
      focus: ".article-region__hero, .work-post-hero",
      landmark: Object.freeze({
        x: galaxy.x + point.x * galaxy.r,
        y: galaxy.y + point.y * galaxy.r,
        z: galaxy.z,
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

  function visibleGalaxyFocus(focus, viewport) {
    return Boolean(focus && [focus.x, focus.y, focus.r].every(Number.isFinite) && focus.r > 0
      && focus.x > 0 && focus.x < viewport.w && focus.y > 56 && focus.y < viewport.h * 0.9);
  }

  // Only page-owned cosmetic geometry crosses documents. Each provider exposes
  // finite dimensions/pose, never labels, form values or application records.
  function capturePageVisuals() {
    const provider = window.UniversePageLandmark;
    if (!provider || !["orbital", "probe", "supernova"].includes(provider.kind)) return {};
    try {
      const visual = provider.snapshot();
      return visual && typeof visual === "object" ? { [provider.kind]: visual } : {};
    } catch (_error) { return {}; }
  }

  function measureFocus(target, viewport = viewportSize()) {
    if (target?.key === "work" || target?.key === "home") {
      const kind = target.key === "home" ? "orbital" : "supernova";
      const focus = window.UniversePageLandmark?.kind === kind
        ? window.UniversePageLandmark.measureFocus?.() || capturePageVisuals()[kind]?.focus : null;
      if (visibleGalaxyFocus(focus, viewport)) return { x: focus.x, y: focus.y, r: focus.r };
    }
    if (target?.key === "logs") {
      const focus = window.UniverseGalaxy?.snapshot().focus;
      // The portrait archive sits below its introduction. Land on the region
      // the reader can actually see, rather than chasing an offscreen core.
      return visibleGalaxyFocus(focus, viewport) ? focus : defaultFocus(viewport);
    }
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
      z: landmark.z || 0,
      w,
      yaw: 0,
      pitch: 0,
    };
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function cameraFrame(camera) {
    const yaw = camera.yaw || 0;
    const pitch = camera.pitch || 0;
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const sp = Math.sin(pitch), cp = Math.cos(pitch);
    const right = { x: cy, y: 0, z: sy };
    const down = { x: -sy * sp, y: cp, z: cy * sp };
    const forward = { x: sy * cp, y: sp, z: -cy * cp };
    return {
      right, down, forward,
      eye: { x: camera.x - forward.x * camera.w, y: camera.y - forward.y * camera.w, z: (camera.z || 0) - forward.z * camera.w },
    };
  }

  function cameraPoint(frame, point) {
    const relative = { x: point.x - frame.eye.x, y: point.y - frame.eye.y, z: (point.z || 0) - frame.eye.z };
    return { x: dot(relative, frame.right), y: dot(relative, frame.down), z: dot(relative, frame.forward) };
  }

  function projectPoint(camera, point, viewport) {
    const local = cameraPoint(cameraFrame(camera), point);
    const visible = local.z > Math.max(1e-5, camera.w * 0.02);
    const scale = visible ? projectionBase(viewport) / local.z : 0;
    return { x: viewport.w / 2 + local.x * scale, y: viewport.h / 2 + local.y * scale,
      depth: local.z, visible, cameraX: local.x, cameraY: local.y };
  }

  // Clip world lines before perspective division, so a route crossing behind
  // the eye never flips across the screen or stretches through infinity.
  function projectSegment(camera, from, to, viewport) {
    const frame = cameraFrame(camera);
    let a = cameraPoint(frame, from), b = cameraPoint(frame, to);
    const near = Math.max(1e-5, camera.w * 0.02);
    if (a.z <= near && b.z <= near) return null;
    const clip = (p, q) => {
      const t = (near - p.z) / (q.z - p.z);
      return { x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t), z: near };
    };
    if (a.z < near) a = clip(a, b);
    if (b.z < near) b = clip(b, a);
    const base = projectionBase(viewport);
    return [viewport.w / 2 + a.x * base / a.z, viewport.h / 2 + a.y * base / a.z,
      viewport.w / 2 + b.x * base / b.z, viewport.h / 2 + b.y * base / b.z];
  }

  // van Wijk & Nuij, "Smooth and efficient zooming and panning" (2003): the
  // perceptually shortest path between two views rises, crosses, and descends.
  function zoomPath(from, to, rho = RHO) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = (to.z || 0) - (from.z || 0);
    const d2 = dx * dx + dy * dy + dz * dz;
    const rho2 = rho * rho;
    const rho4 = rho2 * rho2;
    if (d2 < 1e-12) {
      const S = Math.log(to.w / from.w) / rho;
      return {
        S: Math.abs(S),
        at(s) {
          return { x: from.x + s * dx, y: from.y + s * dy, z: (from.z || 0) + s * dz, w: from.w * Math.exp(rho * s * S) };
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
        return { x: from.x + u * dx, y: from.y + u * dy, z: (from.z || 0) + u * dz, w: from.w * coshR0 / Math.cosh(rho * distance + r0) };
      },
    };
  }

  function flightDuration(S, angle = 0) {
    return Math.round(clamp(700 + 280 * Math.abs(S) + 180 * angle, 950, 1900));
  }

  function flightTurn(start, from, to) {
    // A log entry belongs to the galaxy already in view: dive along its arm.
    if ([from.key, to.key].every((key) => key === "logs" || key === "article")) {
      return { yaw: 0, pitch: 0, angle: 0 };
    }
    const target = cameraPoint(cameraFrame(start), to.landmark);
    const yaw = Math.atan2(target.x, target.z);
    const pitch = Math.atan2(target.y, Math.hypot(target.x, target.z));
    const angle = Math.atan2(Math.hypot(target.x, target.y), target.z);
    return { yaw, pitch, angle };
  }

  function planFlight(record, arrivalFocus, viewport) {
    const from = destinationForRecord(record.from, record.fromPath);
    const to = destinationForRecord(record.to, record.toPath);
    const source = scaleFocus(record.fromFocus, record.viewport, viewport) || defaultFocus(viewport);
    const plannedTarget = scaleFocus(record.toFocus, record.viewport, viewport) || defaultFocus(viewport);
    const start = pageCamera(from.landmark, source, viewport);
    const planned = pageCamera(to.landmark, plannedTarget, viewport);
    const path = zoomPath(start, planned);
    const turn = flightTurn(start, from, to);
    const plan = {
      from,
      to,
      viewport,
      sourceFocus: source,
      targetFocus: plannedTarget,
      start,
      end: planned,
      path,
      turn,
      duration: record.duration || flightDuration(path.S, turn.angle),
      fromDark: record.fromSurface === "dark" ? 1 : 0,
      toDark: record.toSurface === "dark" ? 1 : 0,
      travelDusk: 0.74 * smoothstep(0.7, 1.9, Math.abs(path.S)),
      correction: null,
      galaxy: to.key === "logs" ? window.UniverseGalaxy?.snapshot() || null : record.galaxy || null,
      visuals: { ...record.visuals, ...capturePageVisuals() },
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
    if (plan.to.key === "logs") plan.galaxy = window.UniverseGalaxy?.snapshot() || plan.galaxy;
    Object.assign(plan.visuals, capturePageVisuals());
    const measured = pageCamera(plan.to.landmark, focus, plan.viewport);
    plan.targetFocus = focus;
    const dx = measured.x - plan.end.x;
    const dy = measured.y - plan.end.y;
    const dz = measured.z - plan.end.z;
    const dw = Math.log(measured.w / plan.end.w);
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-6 && Math.abs(dw) < 1e-6) return;
    if (from <= 0) {
      plan.end = measured;
      plan.path = zoomPath(plan.start, measured);
      plan.correction = null;
    } else {
      plan.correction = { from: clamp(from, 0, 0.9), dx, dy, dz, dw, end: measured };
    }
    if (plan.peak !== undefined) measureEnclosure(plan);
  }

  function cameraAt(plan, t) {
    // Dissolve while at rest, fly through the actual objects, then let the
    // destination's reading surface emerge after the observer has settled.
    // A document is never exposed as a tilted rectangle in open space.
    const time = clamp(t, 0, 1);
    const progress = clamp((time - 0.1) / 0.72, 0, 1);
    const camera = plan.path.at(flightEase(progress));
    if (plan.correction) {
      const blend = smoothstep(plan.correction.from, Math.max(0.82, plan.correction.from + 0.1), time);
      camera.x += plan.correction.dx * blend;
      camera.y += plan.correction.dy * blend;
      camera.z += plan.correction.dz * blend;
      camera.w *= Math.exp(plan.correction.dw * blend);
    }
    // Turn into the bearing while pulling away, travel through it, then line
    // up with the destination's resting view. Angles stay on one shortest arc;
    // a rear target is a deliberate half turn, never an arbitrary spin.
    const turn = smoothstep(0.04, 0.34, progress) * (1 - smoothstep(0.58, 0.94, progress));
    camera.yaw = plan.turn.yaw * turn;
    camera.pitch = plan.turn.pitch * turn;
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
    const open = Math.pow(smoothstep(0.82, 1, scale), 2);
    return hero + (full - hero) * open;
  }

  // Larger than the view (scale > 1) a page is only visible when the flight is
  // nested inside it — diving into the archive, or rising out of an entry back
  // to it. A page the camera will later look down on stays hidden until then.
  function pageOpacity(scale, enclosing = true) {
    if (scale <= 1) return smoothstep(0.72, 0.985, scale);
    if (!enclosing) return 1 - smoothstep(1, 1.02, scale);
    return 1 - smoothstep(1.35, 2.5, scale);
  }

  // The page rectangle also feathers as soon as it leaves rest, so no straight
  // edge ever crosses the sky.
  function pageFeather(scale, viewport) {
    if (scale >= 1) return 0;
    return Math.min(viewport.w, viewport.h) * 0.5 * (1 - smoothstep(0.86, 1, scale));
  }

  // How close the camera is to resting on a page: its scale, discounted by how
  // far off-centre the page sits. A page passing at full size on the far side
  // of the sky is still only its object, not an open page.
  function pageCloseness(scale, x, y, viewport) {
    if (scale > 1) return scale;
    return scale * Math.exp(-1.8 * Math.hypot(x, y) / Math.max(viewport.w, viewport.h));
  }

  function pageState(pageCameraState, camera, focus, viewport, { irisLimit = Infinity, enclosing = true } = {}) {
    const base = projectionBase(viewport);
    const frame = cameraFrame(camera);
    const pageFrame = cameraFrame(pageCameraState);
    const center = cameraPoint(frame, pageCameraState);
    const near = Math.max(1e-5, camera.w * 0.02);
    const pixel = pageCameraState.w / base;
    const rx = dot(pageFrame.right, frame.right), ry = dot(pageFrame.right, frame.down), rz = dot(pageFrame.right, frame.forward);
    const dx = dot(pageFrame.down, frame.right), dy = dot(pageFrame.down, frame.down), dz = dot(pageFrame.down, frame.forward);
    const minDepth = center.z - pixel * (Math.abs(rz) * viewport.w / 2 + Math.abs(dz) * viewport.h / 2);
    const facing = dot(pageFrame.forward, frame.forward);
    const visible = minDepth > near && facing > 0;
    const scale = visible ? pageCameraState.w / center.z : 0;
    const x = visible ? center.x * base / center.z : 0;
    const y = visible ? center.y * base / center.z : 0;
    // Keep the page geometry in the same observer frame even while masked.
    // The exposure envelope below reveals it only after this reaches rest.
    const matrix = [scale * rx, scale * ry, 0, visible ? pixel * rz / center.z : 0,
      scale * dx, scale * dy, 0, visible ? pixel * dz / center.z : 0,
      0, 0, 1, 0, x, y, 0, 1];
    const closeness = pageCloseness(scale, x, y, viewport) * smoothstep(0.94, 0.9995, facing);
    const fx = focus.x - viewport.w / 2, fy = focus.y - viewport.h / 2;
    const denominator = matrix[3] * fx + matrix[7] * fy + 1;
    return {
      scale, matrix, near, minDepth, facing,
      closeness,
      x,
      y,
      lensX: viewport.w / 2 + (matrix[0] * fx + matrix[4] * fy + x) / denominator,
      lensY: viewport.h / 2 + (matrix[1] * fx + matrix[5] * fy + y) / denominator,
      lensScale: scale / denominator,
      opacity: visible ? pageOpacity(closeness, enclosing) * smoothstep(near, near * 4, minDepth) : 0,
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

  let galaxyParticleCache = null;

  // A finite thickness and a warm bulge keep the archive a volume during
  // oblique flight. Arm geometry is identical to the live archive renderer.
  function galaxyParticles() {
    if (galaxyParticleCache) return galaxyParticleCache;
    const random = seededRandom(stableHash("galaxy-arms"));
    galaxyParticleCache = Array.from({ length: 900 }, (_, index) => {
      const radius = Math.pow(random(), 0.82);
      return { radius, arm: index % 4,
        jitter: (random() - 0.5) * (0.12 + radius * 0.22),
        height: (random() + random() + random() - 1.5) * (0.008 + 0.07 * (1 - radius) ** 3),
        alpha: 0.3 + random() * 0.55, size: 0.6 + Math.pow(random(), 4) * 4.2,
        warm: random() < 0.14 };
    });
    return galaxyParticleCache;
  }

  let nebulaVolume = null;
  let nebulaPrepared = false;
  let solidField = null;
  let solidPrepared = false;
  const solidRendering = { materialFrames: 0, fallbackFrames: 0 };
  let nebulaCloud = null;
  let dustSprite = null;
  let galaxyStarSprite = null;
  function galaxyLight() {
    if (!galaxyStarSprite) {
      galaxyStarSprite = makeCanvas(64);
      glow(galaxyStarSprite.getContext("2d"), 32, 32, [[0, "rgba(240,247,255,1)"],
        [0.07, "rgba(195,219,255,.85)"], [0.2, "rgba(140,181,240,.22)"], [0.55, "rgba(93,130,200,.035)"], [1, "rgba(0,0,0,0)"]]);
    }
    return galaxyStarSprite;
  }
  function galaxyDust() {
    if (!dustSprite) {
      dustSprite = makeCanvas(64);
      const dust = dustSprite.getContext("2d");
      glow(dust, 32, 32, [[0, "rgba(151,183,239,.35)"], [0.4, "rgba(106,139,204,.15)"], [1, "rgba(0,0,0,0)"]]);
    }
    return dustSprite;
  }

  function prepareNebulaVolume() {
    if (nebulaPrepared || !window.createAboutButterflyField) return nebulaVolume;
    nebulaPrepared = true;
    const canvas = makeCanvas(256);
    const renderer = window.createAboutButterflyField(canvas);
    if (renderer) nebulaVolume = { canvas, renderer };
    return nebulaVolume;
  }

  function prepareSolidField() {
    if (solidPrepared || !window.createUniverseSolidField) return solidField;
    solidPrepared = true;
    const canvas = makeCanvas(256);
    const renderer = window.createUniverseSolidField(canvas);
    if (renderer) solidField = { canvas, renderer };
    return solidField;
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

  // Navigation objects are authored in local XYZ radii. Their points, faces
  // and luminous matter share the observer used by the galaxy and page lens.
  // Cache geometry, not a picture: a rear or oblique approach reveals its shape.
  const landmarkGeometryCache = new Map();
  const matterSprites = new Map();

  function landmarkWorldPoint(landmark, point) {
    return { x: landmark.x + point.x * landmark.r, y: landmark.y + point.y * landmark.r,
      z: landmark.z + point.z * landmark.r };
  }

  function rotateLandmark(point, pitch = 0, yaw = 0, roll = 0) {
    const y = point.y * Math.cos(pitch) - point.z * Math.sin(pitch);
    const z = point.y * Math.sin(pitch) + point.z * Math.cos(pitch);
    const x = point.x * Math.cos(yaw) + z * Math.sin(yaw);
    return { x: x * Math.cos(roll) - y * Math.sin(roll),
      y: x * Math.sin(roll) + y * Math.cos(roll), z: -point.x * Math.sin(yaw) + z * Math.cos(yaw) };
  }

  function landmarkGeometry(kind, visual = null) {
    const artwork = kind === "supernova" ? window.prepareUniverseRemnantArtwork?.() : null;
    const cacheKey = `${kind}:${visual ? JSON.stringify(visual) : "default"}:${artwork?.ready ? "artwork" : "fallback"}`;
    if (landmarkGeometryCache.has(cacheKey)) return landmarkGeometryCache.get(cacheKey);
    const geometry = { segments: [], bodies: [], faces: [], clouds: [] };
    const random = seededRandom(stableHash(`volume:${kind}`));
    const tau = Math.PI * 2;
    const origin = { x: 0, y: 0, z: 0 };
    const blue = [88, 145, 220], teal = [76, 176, 175], copper = [196, 126, 77];
    const silver = [190, 208, 225], white = [233, 243, 255];
    const point = (x, y, z = 0) => ({ x, y, z });
    const line = (a, b, color = blue, alpha = 0.45, width = 1) => geometry.segments.push({ a, b, color, alpha, width });
    const body = (at, r, color = silver, emission = 0, material = emission >= .3 ? "star" : "rock") => geometry.bodies.push({ at, r, color, emission, material });
    const cloud = (at, r, color = blue, alpha = 0.18) => geometry.clouds.push({ at, r, color, alpha });
    const face = (points, color, doubleSided = false, surface = {}) => geometry.faces.push({ points, color, doubleSided, ...surface });
    const ring = (at, rx, ry, pitch, yaw, roll, color = blue, alpha = 0.4, start = 0, end = tau) => {
      const sample = (angle) => {
        const p = rotateLandmark(point(Math.cos(angle) * rx, Math.sin(angle) * ry), pitch, yaw, roll);
        return point(p.x + at.x, p.y + at.y, p.z + at.z);
      };
      const count = Math.ceil((end - start) / tau * 96);
      for (let i = 0; i < count; i += 1) line(sample(lerp(start, end, i / count)), sample(lerp(start, end, (i + 1) / count)), color, alpha);
      return sample;
    };
    const box = (at, size, color, transform = (p) => p, openFront = false, material = "metal") => {
      const vertices = [-1, 1].flatMap((z) => [-1, 1].flatMap((y) => [-1, 1].map((x) =>
        transform(point(at.x + x * size.x / 2, at.y + y * size.y / 2, at.z + z * size.z / 2)))));
      [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]].forEach((indices, i) => {
        if (!openFront || i !== 1) face(indices.map((j) => vertices[j]), color, false,
          { material, uv: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] });
      });
    };
    const tube = (a, b, r0, r1, color, pose, material = "metal", sides = 12) => {
      const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const axis = point((b.x - a.x) / length, (b.y - a.y) / length, (b.z - a.z) / length);
      const ref = Math.abs(axis.y) < .9 ? point(0, 1, 0) : point(1, 0, 0);
      const u = point(axis.y * ref.z - axis.z * ref.y, axis.z * ref.x - axis.x * ref.z, axis.x * ref.y - axis.y * ref.x);
      const ul = Math.hypot(u.x, u.y, u.z);
      u.x /= ul; u.y /= ul; u.z /= ul;
      const v = point(axis.y * u.z - axis.z * u.y, axis.z * u.x - axis.x * u.z, axis.x * u.y - axis.y * u.x);
      const radial = (i) => point(u.x * Math.cos(i / sides * tau) + v.x * Math.sin(i / sides * tau),
        u.y * Math.cos(i / sides * tau) + v.y * Math.sin(i / sides * tau), u.z * Math.cos(i / sides * tau) + v.z * Math.sin(i / sides * tau));
      const at = (p, r, i) => { const n = radial(i); return pose(point(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r)); };
      const normal = (i) => { const n = radial(i); return pose(point(n.x + axis.x * (r0 - r1) / length,
        n.y + axis.y * (r0 - r1) / length, n.z + axis.z * (r0 - r1) / length)); };
      for (let i = 0; i < sides; i += 1) face([at(a, r0, i), at(a, r0, i + 1), at(b, r1, i + 1), at(b, r1, i)], color, false,
        { material, normals: [normal(i), normal(i + 1), normal(i + 1), normal(i)],
          uv: [{ x: i / sides, y: 0 }, { x: (i + 1) / sides, y: 0 }, { x: (i + 1) / sides, y: 1 }, { x: i / sides, y: 1 }] });
      face(Array.from({ length: sides }, (_, i) => at(a, r0, sides - i)), color, false, { material });
      face(Array.from({ length: sides }, (_, i) => at(b, r1, i)), color, false, { material });
    };

    if (kind === "orbital") {
      // One tilted rig carries Home's six wire sculptures. A page snapshot
      // supplies the actual responsive/custom tracks and current body anchors.
      const pitch = 56 * Math.PI / 180, roll = -7 * Math.PI / 180;
      const cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
      const defaultPose = [cr, cp * sr, sp * sr, -sr, cp * cr, sp * cr, 0, -sp, cp];
      const inversePose = [cr, -sr, 0, cp * sr, cp * cr, -sp, sp * sr, sp * cr, cp];
      const motifs = ["sphere", "frames", "gyroscope", "compass", "loom", "cubes"];
      const keys = ["about", "profile", "work", "projects", "threads", "contact"];
      const profiles = [[.19, .125, .03, -.005, -8, -62], [.255, .17, .065, -.025, 13, 12],
        [.315, .215, .02, .025, -17, 82], [.37, .255, .08, -.035, 7, 137],
        [.42, .29, .11, -.01, 19, 211], [.47, .325, .065, .035, -11, 292]];
      const defaults = profiles.map(([rx, ry, cx, cy, tilt, phase], index) => {
        const angle = phase * Math.PI / 180, rotation = tilt * Math.PI / 180;
        const x = Math.cos(angle) * rx * 1.18, y = Math.sin(angle) * ry;
        return { key: keys[index], motif: motifs[index], rx: rx * 1.18, ry, tilt: rotation,
          center: point(cx * 1.18, cy), size: .11,
          sculpturePose: index === 1 ? [Math.SQRT1_2, Math.SQRT1_2, 0, -Math.SQRT1_2, Math.SQRT1_2, 0, 0, 0, 1] : inversePose,
          position: point(cx * 1.18 + x * Math.cos(rotation) - y * Math.sin(rotation),
            cy + x * Math.sin(rotation) + y * Math.cos(rotation)) };
      });
      const snapshot = visual?.kind === "orbital" && visual.orbits?.length === 6 ? visual : null;
      const pose = snapshot?.pose || defaultPose, orbits = snapshot?.orbits || defaults;
      const core = snapshot?.origin || { x: .0472, y: .02, z: .008, r: .056 };
      const apply = (p, matrix) => point(matrix[0] * p.x + matrix[3] * p.y + matrix[6] * p.z,
        matrix[1] * p.x + matrix[4] * p.y + matrix[7] * p.z,
        matrix[2] * p.x + matrix[5] * p.y + matrix[8] * p.z);
      const corePosition = apply(core, pose);
      const rig = (p) => {
        const q = apply(p, pose);
        return point((q.x - corePosition.x) * 1.8, (q.y - corePosition.y) * 1.8, (q.z - corePosition.z) * 1.8);
      };
      const ink = [153, 168, 180], accent = [40, 100, 199], porcelain = [243, 245, 240];
      const stroke = (a, b, color = ink, alpha = .9) => line(rig(a), rig(b), color, alpha, .9);
      const path = (sample, count = 48, color = ink, alpha = .9, dashed = false) => {
        for (let i = 0; i < count; i += 1) {
          if (!dashed || i % 4 < 2) stroke(sample(i / count * tau), sample((i + 1) / count * tau), color, alpha);
        }
      };
      orbits.forEach((orbit, index) => {
        const ct = Math.cos(orbit.tilt), st = Math.sin(orbit.tilt);
        path((angle) => point(orbit.center.x + Math.cos(angle) * orbit.rx * ct - Math.sin(angle) * orbit.ry * st,
          orbit.center.y + Math.cos(angle) * orbit.rx * st + Math.sin(angle) * orbit.ry * ct), 96,
        orbit.custom ? accent : ink, orbit.custom ? .6 : .46, orbit.custom || index === 1 || index === 3);
        const at = (p) => {
          const q = apply(p, orbit.sculpturePose || inversePose), size = orbit.size;
          return point(orbit.position.x + q.x * size, orbit.position.y + q.y * size, orbit.position.z + q.z * size);
        };
        const wireColor = orbit.comet ? accent : ink;
        const edge = (a, b, color = wireColor) => stroke(at(a), at(b), color);
        const hoop = (rx, ry, rotation = (p) => p, color = wireColor, dashed = false) =>
          path((angle) => at(rotation(point(Math.cos(angle) * rx, Math.sin(angle) * ry))), 40, color, .92, dashed);
        const bead = (p, r = .043) => {
          body(rig(at(p)), orbit.size * r * 1.8, porcelain, 0, "ceramic");
          path((angle) => at(point(p.x + Math.cos(angle) * r, p.y + Math.sin(angle) * r, p.z + r * .3)), 16, accent);
        };
        const frame = (center, width, height, depth, color = wireColor) => {
          const vertices = [-1, 1].flatMap((z) => [-1, 1].flatMap((y) => [-1, 1].map((x) =>
            point(center.x + x * width / 2, center.y + y * height / 2, center.z + z * depth / 2))));
          [[0, 1], [0, 2], [1, 3], [2, 3], [4, 5], [4, 6], [5, 7], [6, 7],
            [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => edge(vertices[a], vertices[b], color));
        };
        const stud = (p, diamond = false) => box(p, point(.09, .09, .075), porcelain,
          (q) => rig(at(diamond ? point(p.x + (q.x - p.x - q.y + p.y) / Math.SQRT2,
            p.y + (q.x - p.x + q.y - p.y) / Math.SQRT2, q.z) : q)), false, "ceramic");
        const motif = orbit.motif || motifs[index];
        if (motif === "sphere") {
          hoop(.5, .5);
          hoop(.22, .42, (p) => point(p.x, p.y, p.x * 1.65));
          hoop(.42, .22, (p) => point(p.x, p.y, p.y * 1.65));
          [0, Math.PI / 4, -Math.PI / 4].forEach((angle) => edge(
            point(-.47 * Math.cos(angle), -.47 * Math.sin(angle), .02), point(.47 * Math.cos(angle), .47 * Math.sin(angle), .02)));
          [point(0, -.38, .09), point(.38, .22, .09), point(-.38, .22, .09)].forEach((p) => bead(p));
        } else if (motif === "frames") {
          [1, .8, .54, .28].forEach((size, i) => frame(point(0, 0, [0, .12, -.12, .18][i]), size, size, .045));
          edge(point(-.62, 0), point(.62, 0));
          [-.5, .5].forEach((x) => [-.5, .5].forEach((y) => stud(point(x, y, .04))));
        } else if (motif === "gyroscope") {
          hoop(.5, .5);
          hoop(.4, .4, (p) => rotateLandmark(p, 64 * Math.PI / 180));
          hoop(.4, .4, (p) => rotateLandmark(p, 0, 64 * Math.PI / 180));
          [0, 1, 2].forEach((i) => {
            const angle = -Math.PI / 2 + i * tau / 3, tip = point(Math.cos(angle) * .4, Math.sin(angle) * .4, .035);
            edge(point(0, 0, .035), tip); bead(tip);
          });
          bead(point(0, 0, .035), .025);
        } else if (motif === "compass") {
          hoop(.5, .5);
          hoop(.34, .34, (p) => point(p.x, p.y, -.085), accent, true);
          [0, 1, 2, 3].forEach((i) => {
            const angle = (18 + i * 90) * Math.PI / 180;
            edge(point(0, 0, .035), point(Math.cos(angle) * .49, Math.sin(angle) * .49, .035));
            const corner = (-45 + i * 90) * Math.PI / 180;
            stud(point(Math.cos(corner) * .43, Math.sin(corner) * .43, .035), true);
          });
        } else if (motif === "loom") {
          [-.5, .5].forEach((y) => edge(point(-.5, y), point(.5, y)));
          [-.4, .4].forEach((x) => {
            edge(point(x, -.58, -.07), point(x, .58, -.07));
            edge(point(x, -.58, .07), point(x, .58, .07));
          });
          [[-.3, 9], [-.08, -7], [.14, 5], [.32, -3]].forEach(([y, angle], i) => {
            const slope = Math.tan(angle * Math.PI / 180), z = i % 2 ? -.045 : .045;
            edge(point(-.4, y, z), point(.4, y + .8 * slope, z));
            if (i < 3) { const x = [-.28, .02, .27][i]; bead(point(x, y + (x + .4) * slope, z + .04), .05); }
          });
        } else if (motif === "cubes") {
          frame(point(-.11, -.11, .12), .54, .54, .28);
          frame(point(.13, .13, -.12), .54, .54, .28, accent);
          [[-.38, -.38], [.16, -.38], [-.38, .16]].forEach(([x, y]) => edge(point(x, y, .12), point(x + .24, y + .24, -.12)));
          bead(point(.42, -.38, .04), .05); bead(point(-.39, .4, .04), .05);
        }
        if (orbit.comet) {
          const dx = orbit.position.x - core.x, dy = orbit.position.y - core.y;
          const distance = Math.max(.001, Math.hypot(dx, dy)), length = orbit.size * 1.5;
          [accent, teal, copper].forEach((color, lane) => {
            const sample = (t) => {
              const spread = Math.sin(t * Math.PI * .75) * (lane - 1) * orbit.size * .12;
              return point(orbit.position.x + dx / distance * length * t - dy / distance * spread,
                orbit.position.y + dy / distance * length * t + dx / distance * spread, orbit.position.z + spread * .3);
            };
            for (let i = 0; i < 12; i += 1) stroke(sample(i / 12), sample((i + 1) / 12), color, .55 * (1 - i / 12));
          });
        }
      });
      // The AC origin is a raised ceramic medallion, including physical lettering.
      const coreAt = (x, y, z) => point(core.x + x * core.r, core.y + y * core.r, core.z + z * core.r);
      const rim = (angle, z, radius = 1) => coreAt(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
      face(Array.from({ length: 48 }, (_, i) => rig(rim(i / 48 * tau, .12))), porcelain, false, { material: "ceramic" });
      face(Array.from({ length: 48 }, (_, i) => rig(rim(-i / 48 * tau, -.12))), silver, false, { material: "metal" });
      for (let i = 0; i < 48; i += 1) {
        const a = i / 48 * tau, b = (i + 1) / 48 * tau;
        face([rim(a, .12), rim(a, -.12), rim(b, -.12), rim(b, .12)].map(rig), silver, false, { material: "metal" });
      }
      path((angle) => rim(angle, .13), 64, ink);
      path((angle) => rim(angle, .14, .76), 64, ink, .62, true);
      const letterStroke = (a, b) => {
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const dx = (b[1] - a[1]) / length * .034, dy = (a[0] - b[0]) / length * .034;
        const corners = [[a[0] - dx, a[1] - dy], [b[0] - dx, b[1] - dy], [b[0] + dx, b[1] + dy], [a[0] + dx, a[1] + dy]];
        face(corners.map(([x, y]) => rig(coreAt(x, y, .23))), accent, true, { material: "ceramic" });
        corners.forEach(([x, y], i) => {
          const [nx, ny] = corners[(i + 1) % 4];
          face([coreAt(x, y, .13), coreAt(nx, ny, .13), coreAt(nx, ny, .23), coreAt(x, y, .23)].map(rig), accent, true, { material: "ceramic" });
        });
      };
      letterStroke([-.54, .2], [-.33, -.34]); letterStroke([-.33, -.34], [-.12, .2]);
      letterStroke([-.46, 0], [-.20, 0]);
      for (let i = 0; i < 18; i += 1) {
        const a = .65 + (tau - 1.3) * i / 18, b = .65 + (tau - 1.3) * (i + 1) / 18;
        letterStroke([.27 + Math.cos(a) * .24, -.06 + Math.sin(a) * .27], [.27 + Math.cos(b) * .24, -.06 + Math.sin(b) * .27]);
      }
      // Extreme user flings remain one bounded landmark; the atlas radius and
      // distances between destinations never change with a page interaction.
      const vertices = new Set(geometry.faces.flatMap((surface) => surface.points));
      geometry.segments.forEach(({ a, b }) => { vertices.add(a); vertices.add(b); });
      geometry.bodies.forEach(({ at }) => vertices.add(at));
      const extent = Math.max(...[...vertices].map((p) => Math.hypot(p.x, p.y, p.z)),
        ...geometry.bodies.map(({ at, r }) => Math.hypot(at.x, at.y, at.z) + r));
      if (extent > 3.8) {
        const scale = 3.8 / extent;
        vertices.forEach((p) => { p.x *= scale; p.y *= scale; p.z *= scale; });
        geometry.bodies.forEach((item) => { item.r *= scale; });
      }
    } else if (kind === "supernova") {
      if (artwork?.ready) {
        const { pixels, size } = artwork;
        for (let i = 0; i < 4800; i += 1) {
          const u = random(), v = random();
          const offset = (Math.floor(v * size) * size + Math.floor(u * size)) * 4;
          const color = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
          const pigment = Math.max(0, .975 - (color[0] * .299 + color[1] * .587 + color[2] * .114) / 255);
          if (pigment < .055 || random() > Math.min(1, pigment * 2.4)) continue;
          const depth = .03 + pigment * .12;
          const tone = artwork.palette?.length ? artwork.palette.reduce((nearest, candidate) => {
            const distance = rgb => rgb.reduce((sum, value, channel) => sum + (value - color[channel]) ** 2, 0);
            return distance(candidate) < distance(nearest) ? candidate : nearest;
          }) : color;
          cloud(point((u - .501) * 2, (v - .496) * 2, (random() * 2 - 1) * depth),
            .008 + random() * .019, tone, .15 + pigment * .55);
        }
        body(origin, .009, [255, 228, 180], 1.4);
        cloud(origin, .045, [255, 223, 171], .3);
      } else {
        // The live Work artwork is an elongated cobalt/teal remnant with ragged
        // copper filaments. A thick, irregular shell preserves that silhouette.
        const shell = (angle, latitude, layer = 1) => {
          const radial = Math.sqrt(1 - latitude * latitude);
          const ripple = 1 + .09 * Math.sin(angle * 7 + latitude * 11) + .045 * Math.cos(angle * 17 - latitude * 8);
          return rotateLandmark(point(Math.cos(angle) * radial * 1.08 * ripple * layer,
            Math.sin(angle) * radial * .58 * ripple * layer, latitude * .44 * layer), .24, -.2, -.66);
        };
        const matter = [[42, 100, 198], [69, 148, 185], [43, 154, 153], [115, 148, 205], copper];
        for (let i = 0; i < 1050; i += 1) {
          const angle = random() * tau, latitude = random() * 2 - 1;
          cloud(shell(angle, latitude, .72 + random() * .29), .035 + random() * .085,
            matter[i % matter.length], .14 + random() * .19);
        }
        for (let i = 0; i < 64; i += 1) {
          const latitude = (random() * 2 - 1) * .93;
          const start = random() * tau, length = .13 + random() * .6;
          const color = i % 3 === 0 ? [233, 186, 125] : i % 3 === 1 ? copper : [111, 188, 216];
          let previous = null;
          for (let step = 0; step <= 16; step += 1) {
            const angle = start + length * step / 16;
            const p = shell(angle, clamp(latitude + Math.sin(step * .7 + i) * .025, -.98, .98), .92 + .06 * Math.sin(step * 1.3 + i));
            if (previous) line(previous, p, color, .24 + random() * .3, .65);
            previous = p;
          }
        }
        body(origin, .016, white, 1.5);
        cloud(origin, .11, white, .2);
      }
    } else if (kind === "probe") {
      const art = typeof visual === "object" && visual ? visual : {};
      const deployed = art.topology === "public";
      const aspect = clamp(Number.isFinite(art.bayAspect) ? art.bayAspect : .8, .32, 3);
      const bayWidth = 2 * Math.max(1, aspect), bayHeight = 2 * Math.max(1, 1 / aspect);
      const size = 2 * clamp(Number.isFinite(art.satelliteScale) ? art.satelliteScale : .42, .18, 1.3);
      const pose = (p) => p, part = (x, y, z = 0) => point(x * size, y * size, z * size);
      const ceramic = [225, 233, 227], metal = [130, 151, 140], ink = [77, 104, 90], cobalt = [31, 92, 186];
      // These proportions follow Contact's .satellite CSS: a .30-wide bus,
      // .36-wide three-panel wings, a .156 core and a .20 upward-open dish.
      const bx = .15, by = .15 / .78, bevelX = deployed ? .06 : .008, bevelY = deployed ? by * .44 : .008;
      const outline = [[-bx + bevelX, -by], [bx - bevelX, -by], [bx, -by + bevelY], [bx, by - bevelY],
        [bx - bevelX, by], [-bx + bevelX, by], [-bx, by - bevelY], [-bx, -by + bevelY]];
      const uv = outline.map(([x, y]) => ({ x: x / .3 + .5, y: y / (by * 2) + .5 }));
      face(outline.map(([x, y]) => part(x, y, .075)), ceramic, false, { material: "ceramic", uv });
      face(outline.map(([x, y]) => part(x, y, -.075)).reverse(), metal, false, { material: "metal", uv: [...uv].reverse() });
      outline.forEach(([x, y], i) => {
        const [nx, ny] = outline[(i + 1) % outline.length];
        face([part(x, y, -.075), part(nx, ny, -.075), part(nx, ny, .075), part(x, y, .075)], ceramic, false, { material: "ceramic" });
        tube(part(x, y, .078), part(nx, ny, .078), .0028 * size, .0028 * size, metal, pose, "metal", 6);
        line(part(x, y, -.078), part(nx, ny, -.078), ink, .6);
      });
      // A machined circular payload core sits inside the pale capsule face.
      const coreY = -.011538;
      const circle = (angle, radius, z) => part(Math.cos(angle) * radius, coreY + Math.sin(angle) * radius, z);
      for (let i = 0; i < 40; i += 1) {
        const a = i / 40 * tau, b = (i + 1) / 40 * tau;
        face([circle(a, .078, .079), circle(b, .078, .079), circle(b, .065, .095), circle(a, .065, .095)], metal, false, { material: "metal" });
        face([part(0, coreY, .087), circle(a, .065, .087), circle(b, .065, .087)], [196, 214, 206], false, { material: "ceramic" });
        line(circle(a, .078, .097), circle(b, .078, .097), cobalt, .7);
        if (i % 2 === 0) line(circle(a, .04056, .098), circle(b, .04056, .098), cobalt, .55);
      }
      box(part(0, -.143, .079), part(.15, .013, .006), metal, pose);
      box(part(0, .153, .08), part(.075, .011, .007), cobalt, pose);
      for (const x of [-.115, .115]) for (const y of [-.149, .149]) body(part(x, y, .082), .0045 * size, silver, 0, "metal");
      for (let i = 0; i < 6; i += 1) box(part(-.075 + i * .03, 0, -.08), part(.004, .24, .01), metal, pose);
      for (const side of [-1, 1]) {
        // The private capsule folds its wings backward, retaining the page's
        // 18% front-view span while exposing real hinges and rear structure.
        const angle = side * (deployed ? 0 : Math.acos(.18));
        const wing = (p) => point(side * .15 * size + Math.cos(angle) * p.x + Math.sin(angle) * p.z,
          p.y, -.025 * size - Math.sin(angle) * p.x + Math.cos(angle) * p.z);
        tube(part(side * .15, -.058, -.025), part(side * .15, .058, -.025), .01 * size, .01 * size, metal, pose);
        for (let panel = 0; panel < 3; panel += 1) {
          const start = panel * .12 + .0035, end = (panel + 1) * .12 - .0035;
          box(part(side * (start + end) / 2, 0, 0), part(end - start, .171428, .009), [199, 219, 217], wing, false, "ceramic");
          const corners = [[start, -.085714], [end, -.085714], [end, .085714], [start, .085714]]
            .map(([x, y]) => wing(part(side * x, y, .006)));
          corners.forEach((p, i) => tube(p, corners[(i + 1) % 4], .0022 * size, .0022 * size, cobalt, pose, "metal", 6));
          for (let cell = 1; cell < 5; cell += 1) {
            const x = side * lerp(start, end, cell / 5);
            line(wing(part(x, -.078, .007)), wing(part(x, .078, .007)), cobalt, .42);
          }
          line(wing(part(side * start, -.078, -.007)), wing(part(side * end, .078, -.007)), ink, .35);
          line(wing(part(side * start, .078, -.007)), wing(part(side * end, -.078, -.007)), ink, .35);
        }
      }
      // The page's small U-shaped cup opens upward. Smooth paraboloid normals
      // retain that side silhouette without turning it into a camera-facing disc.
      const dishRadius = .1, dishHeight = .2 / 1.45, dishBottom = -.27 / 2.1 - .5 / 2.1 + dishHeight;
      const dishPoint = (angle, r) => part(Math.cos(angle) * r, dishBottom - dishHeight * (r / dishRadius) ** 2, Math.sin(angle) * r);
      const dishNormal = (angle, r) => point(-2 * dishHeight * r / dishRadius ** 2 * Math.cos(angle), -1,
        -2 * dishHeight * r / dishRadius ** 2 * Math.sin(angle));
      for (let band = 0; band < 6; band += 1) {
        const inner = band / 6 * dishRadius, outer = (band + 1) / 6 * dishRadius;
        for (let i = 0; i < 40; i += 1) {
          const a = i / 40 * tau, b = (i + 1) / 40 * tau;
          const angles = band ? [a, a, b, b] : [a, a, b], radii = band ? [inner, outer, outer, inner] : [0, outer, outer];
          face(angles.map((angle, j) => dishPoint(angle, radii[j])), ceramic, true,
            { material: "ceramic", normals: angles.map((angle, j) => dishNormal(angle, radii[j])),
              uv: angles.map((angle, j) => ({ x: .5 + Math.cos(angle) * radii[j] / .2, y: .5 + Math.sin(angle) * radii[j] / .2 })) });
        }
      }
      for (let i = 0; i < 40; i += 1) tube(dishPoint(i / 40 * tau, dishRadius), dishPoint((i + 1) / 40 * tau, dishRadius), .0025 * size, .0025 * size, metal, pose, "metal", 6);
      tube(part(0, dishBottom, 0), part(0, -.1763, 0), .0045 * size, .0045 * size, metal, pose);

      // Contact's open fairings frame the whole [data-payload-visual] region.
      // Curved ribs and narrow shell strips keep their airy diagram silhouette
      // while the camera can move around the hollow bay in three dimensions.
      for (const side of [-1, 1]) {
        const centerX = side * .268 * bayWidth, centerY = -.01 * bayHeight;
        const turn = side * 2.5 * Math.PI / 180;
        const fairing = (latitude, angle) => {
          const p = rotateLandmark(point(side * (.093 + .35 * Math.sin(latitude) * Math.cos(angle)) * bayWidth - centerX,
            -.4 * Math.cos(latitude) * bayHeight, .11 * bayWidth * Math.sin(latitude) * Math.sin(angle)), 0, 0, turn);
          return point(p.x + centerX, p.y + centerY, p.z);
        };
        const normal = (latitude, angle) => rotateLandmark(point(side * Math.sin(latitude) * Math.cos(angle) / (.35 * bayWidth),
          -Math.cos(latitude) / (.4 * bayHeight), Math.sin(latitude) * Math.sin(angle) / (.11 * bayWidth)), 0, 0, turn);
        for (const angle of [-Math.PI / 2, -.8, 0, .8, Math.PI / 2]) {
          for (let i = 0; i < 32; i += 1) line(fairing(i / 32 * Math.PI, angle), fairing((i + 1) / 32 * Math.PI, angle), ink, angle === 0 ? .66 : .32);
        }
        for (const angle of [-1.48, 0, 1.48]) {
          for (let band = 0; band < 24; band += 1) {
            const a = band / 24 * Math.PI, b = (band + 1) / 24 * Math.PI;
            let samples = band === 0 ? [[a, angle - .014], [b, angle - .014], [b, angle + .014]]
              : band === 23 ? [[a, angle - .014], [b, angle - .014], [a, angle + .014]]
              : [[a, angle - .014], [b, angle - .014], [b, angle + .014], [a, angle + .014]];
            if (side < 0) samples = samples.reverse();
            face(samples.map(([latitude, theta]) => fairing(latitude, theta)), [181, 199, 187], true,
              { material: "ceramic", normals: samples.map(([latitude, theta]) => normal(latitude, theta)) });
          }
        }
        for (const height of [.304, .2, .088]) ring(point(side * .1665 * bayWidth, centerY, .115 * bayWidth),
          .0455 * bayWidth, height * bayHeight, 0, side * .12, turn, ink, .3);
      }
      ring(point(0, 0, -.15), .315 * bayWidth, .315 * bayWidth / 1.65, 0, 0, -7 * Math.PI / 180, ink, .22);
      ring(point(0, 0, -.12), .22 * bayWidth, .22 * bayWidth / 1.75, 0, 0, (deployed ? -13 : -8) * Math.PI / 180, cobalt, deployed ? .36 : .1);
      ring(point(0, 0, -.09), .145 * bayWidth, .145 * bayWidth / 1.4, 0, 0, 14 * Math.PI / 180, cobalt, .28);
      if (deployed) ring(part(0, 0, .115), .185 * size, .185 * size, 0, 0, 0, cobalt, .3);
    } else if (kind === "chart") {
      // Seven solid timeline blocks preserve resume.html's authored role widths
      // and resume-dossier.css's blue current-role cap, rather than a star chain.
      const months = [25, 24, 23, 13, 24, 12, 28];
      const total = months.reduce((sum, value) => sum + value, 0);
      const pose = (p) => rotateLandmark(p, -.1, -.12, 0);
      const paper = [224, 229, 224], ink = [77, 100, 108], current = [49, 109, 190];
      let left = -.96;
      months.forEach((duration, i) => {
        const width = 1.8 * duration / total;
        const x = left + width / 2, z = (i - 3) * .011;
        box(point(x, 0, z), point(width, .67, .17), i === 6 ? [198, 217, 235] : paper, pose, false, "ceramic");
        box(point(x, -.318, z + .006), point(width, .035, .19), i === 6 ? current : ink, pose);
        body(pose(point(x - width * .25, -.19, z + .1)), .024, i === 6 ? current : ink, .04, "metal");
        for (let row = 0; row < 3; row += 1) {
          box(point(x - width * .07, .015 + row * .065, z + .09),
            point(width * (row === 2 ? .47 : .7), .009, .008), row === 2 ? [139, 155, 158] : ink, pose);
        }
        box(point(x - width * .18, .252, z + .09), point(width * .38, .012, .009), ink, pose);
        tube(point(x, .315, z), point(x, .397, z), .012, .012, silver, pose, "metal", 8);
        left += width + .02;
      });
      box(point(0, .408, 0), point(1.94, .035, .085), ink, pose);
    } else if (kind === "beacon") {
      // Signals' empty public-slot field: aligned ellipses, a dashed middle
      // orbit and the centered registry origin. No invented occupied slots.
      const pose = (p) => rotateLandmark(p, 0, 0, -8 * Math.PI / 180);
      const registry = [65, 115, 185];
      [[.98, .62, -.04], [.98 * 63 / 82, .62 * 53 / 72, 0], [.98 * 36 / 82, .62 * 29 / 72, .04]].forEach(([rx, ry, z], index) => {
        for (let i = 0; i < 96; i += 1) {
          if (index === 1 && i % 6 >= 3) continue;
          const a = i / 96 * tau, b = (i + 1) / 96 * tau;
          tube(point(Math.cos(a) * rx, Math.sin(a) * ry, z), point(Math.cos(b) * rx, Math.sin(b) * ry, z),
            .0055, .0055, registry, pose, "metal", 6);
        }
      });
      line(pose(point(-1.08, 0, -.07)), pose(point(1.08, 0, -.07)), registry, .22, .7);
      line(pose(point(0, -.73, -.07)), pose(point(0, .73, -.07)), registry, .22, .7);
      tube(point(0, 0, -.065), point(0, 0, .065), .132, .132, [217, 231, 233], pose, "ceramic", 40);
      ring(point(0, 0, .068), .13, .13, 0, 0, -8 * Math.PI / 180, registry, .9);
      // Raised AC monogram follows the public origin marker, not telemetry data.
      const glyph = (points) => points.slice(1).forEach((p, i) => line(pose(point(...points[i])), pose(point(...p)), registry, .95, 1.25));
      glyph([[-.075, .035, .072], [-.044, -.04, .072], [-.014, .035, .072]]);
      glyph([[-.063, .006, .072], [-.025, .006, .072]]);
      glyph([[.066, -.027, .072], [.047, -.04, .072], [.019, -.019, .072], [.019, .023, .072], [.047, .04, .072], [.066, .027, .072]]);
    } else if (kind === "survey") {
      // evidence-search.css authors 27x14, 19x9.8 and 10x5 gates at -9 degrees.
      // They share a target; all six route rays approach it from the same side.
      const pose = (p) => rotateLandmark(p, 0, 0, -9 * Math.PI / 180);
      const searchBlue = [56, 110, 180];
      [[27, 14, -.055], [19, 9.8, 0], [10, 5, .055]].forEach(([w, h, z], gate) => {
        const rx = w / 27, ry = h / 27;
        for (let i = 0; i < 96; i += 1) {
          const a = i / 96 * tau, b = (i + 1) / 96 * tau;
          tube(point(Math.cos(a) * rx, Math.sin(a) * ry, z), point(Math.cos(b) * rx, Math.sin(b) * ry, z),
            .0035 + gate * .0007, .0035 + gate * .0007, searchBlue, pose, "metal", 6);
        }
        line(pose(point(-rx - .018, 0, z)), pose(point(-rx + .018, 0, z)), searchBlue, .7, 1);
        line(pose(point(0, -ry - .018, z)), pose(point(0, -ry + .018, z)), searchBlue, .7, 1);
      });
      [-18, -10, -3, 5, 13, 21].forEach((degrees, index) => {
        const a = degrees * Math.PI / 180;
        const start = point(-1.65 * Math.cos(a), -1.65 * Math.sin(a), -.2 - index * .022);
        line(start, point(0, 0, .08), searchBlue, .37, .8);
        const pin = point(start.x * .31, start.y * .31, lerp(.08, start.z, .31));
        box(pin, point(.026, .026, .021), [211, 227, 230]);
      });
      ring(point(0, 0, .084), .087, .087, 0, 0, 0, searchBlue, .95);
      line(point(-.119, 0, .086), point(.119, 0, .086), searchBlue, .8, .9);
      line(point(0, -.119, .086), point(0, .119, .086), searchBlue, .8, .9);
      body(point(0, 0, .09), .014, teal, .9);
      line(point(.1, 0, .04), point(.5, 0, -.025), searchBlue, .5, 1.1);
    } else if (kind === "tree") {
      // Match buildTreeGeometry in about-spectrograph.js: two diagonal lobes,
      // eight named branch anchors and 31 equal evidence stars with their tones.
      const bands = [
        [-2.3, -4.6, .5, 4, [101, 168, 255]], [-4.3, -2.6, -.8, 6, [127, 145, 255]],
        [-2.5, -1.7, 1.2, 7, [170, 134, 255]], [-.9, -3.4, -1, 4, [85, 200, 223]],
        [2.2, 1.8, .6, 3, [91, 213, 188]], [4.1, 3.6, -.7, 2, [131, 203, 255]],
        [2.1, 5.1, 1, 3, [192, 165, 255]], [.6, 3.4, -1, 2, [217, 185, 121]],
      ];
      const local = (p) => point(p.x / 8, -p.y / 8, p.z / 8);
      const curve = (first, last, bend, depth, color, alpha, width) => {
        const a = point(lerp(first.x, last.x, .34) + bend, lerp(first.y, last.y, .34), lerp(first.z, last.z, .34) + depth);
        const b = point(lerp(first.x, last.x, .72) - bend * .28, lerp(first.y, last.y, .72), lerp(first.z, last.z, .72) - depth * .35);
        let previous = local(first);
        for (let i = 1; i <= 22; i += 1) {
          const t = i / 22, v = 1 - t;
          const p = local(point(...["x", "y", "z"].map((axis) => v ** 3 * first[axis] + 3 * v * v * t * a[axis] + 3 * v * t * t * b[axis] + t ** 3 * last[axis])));
          line(previous, p, color, alpha, width); previous = p;
        }
      };
      const junctions = [point(-1.5, -1.2, .5), point(1.5, 1.2, -.5)];
      curve(origin, junctions[0], -.28, .82, bands[0][4], .8, 1.5);
      curve(origin, junctions[1], .28, -.66, bands[4][4], .8, 1.5);
      body(origin, .045, white, 1);
      bands.forEach(([x, y, z, count, tone], index) => {
        const anchor = point(x * 1.32, y * 1.18, z * 1.3);
        curve(junctions[index < 4 ? 0 : 1], anchor, (index % 2 ? 1 : -1) * .34, (index - 3.5) * .19, tone, .72, 1.1);
        body(local(anchor), .027, tone, .65);
        cloud(local(anchor), .13, tone, .12);
        for (let i = 0; i < count; i += 1) {
          const a = i / count * tau + .4;
          const leaf = point(anchor.x + Math.cos(a) * (count > 4 ? 1.7 : 1.35), anchor.y + Math.sin(a) * 1.4, anchor.z + Math.sin(a * 2) * .85);
          curve(anchor, leaf, (i - (count - 1) / 2) * .06, (i % 2 ? 1 : -1) * .24, tone, .55, .75);
          body(local(leaf), .018, tone, .7);
        }
      });
    } else if (kind === "cluster") {
      // The first production case's three staggered phone screens, rendered as
      // rounded solid handsets with their actual page artwork and rear hardware.
      const orange = [237, 143, 46], glass = [19, 29, 40], chassis = [93, 109, 125];
      const screens = ["img_bitcoin_wallet_2.webp", "img_bitcoin_wallet_1.webp", "img_bitcoin_wallet_3.webp"];
      const phone = (x, y, z, scale, roll, yaw, variant) => {
        const pose = (p) => {
          const q = rotateLandmark(point(p.x * scale, p.y * scale, p.z * scale), -.035, yaw, roll);
          return point(q.x + x, q.y + y, q.z + z);
        };
        const outline = (w, h, r, depth, transform = pose) => {
          const corners = [[w / 2 - r, -h / 2 + r], [w / 2 - r, h / 2 - r], [-w / 2 + r, h / 2 - r], [-w / 2 + r, -h / 2 + r]];
          return corners.flatMap(([cx, cy], corner) => Array.from({ length: 8 }, (_, i) => {
            const a = -Math.PI / 2 + corner * Math.PI / 2 + i / 7 * Math.PI / 2;
            return transform(point(cx + Math.cos(a) * r, cy + Math.sin(a) * r, depth));
          }));
        };
        const front = outline(.55, .98, .052, .049), back = outline(.55, .98, .052, -.049);
        face(front, chassis, false, { material: "metal" });
        face([...back].reverse(), [40, 52, 64], false, { material: "dark" });
        front.forEach((p, i) => { const next = (i + 1) % front.length; face([back[i], back[next], front[next], p], chassis, false, { material: "metal" }); });
        const screenHeight = .94, screenWidth = screenHeight * 443 / 788, halfWidth = screenWidth / 2;
        const screen = outline(screenWidth, screenHeight, .044, 0, (p) => p);
        const screenPoint = (p) => pose(point(p.x, p.y, .061 - .008 * (p.x / halfWidth) ** 2));
        const screenNormal = (p) => {
          const nx = .016 * p.x / (halfWidth * halfWidth), length = Math.hypot(nx, 1);
          return rotateLandmark(point(nx / length, 0, 1 / length), -.035, yaw, roll);
        };
        const screenUV = (p) => ({ x: (p.x + halfWidth) / screenWidth, y: (p.y + screenHeight / 2) / screenHeight });
        screen.forEach((p, i) => {
          const triangle = [origin, p, screen[(i + 1) % screen.length]];
          face(triangle.map(screenPoint), glass, false, { material: "screen", texture: `/assets/images/work/${screens[variant]}`,
            uv: triangle.map(screenUV), normals: triangle.map(screenNormal) });
        });
        box(point(0, -.481, .056), point(.09, .007, .004), [109, 128, 144], pose);
        body(pose(point(.068, -.481, .058)), .005 * scale, [81, 126, 144], .02, "metal");
        box(point(0, .48, .056), point(.1, .005, .004), [139, 157, 173], pose);
        for (const side of [-1, 1]) box(point(side * .278, -.16, 0), point(.013, side < 0 ? .16 : .085, .035), silver, pose);
        box(point(-.149, -.336, -.056), point(.157, .212, .025), chassis, pose, false, "dark");
        for (const dy of [-.38, -.294]) {
          body(pose(point(-.162, dy, -.074)), .032 * scale, silver, 0, "metal");
          body(pose(point(-.162, dy, -.093)), .022 * scale, [21, 44, 63], .02, "dark");
        }
      };
      phone(-.38, .05, -.1, .88, -8 * Math.PI / 180, -.11, 0);
      phone(.38, .05, -.06, .88, 8 * Math.PI / 180, .11, 2);
      phone(0, 0, .16, 1, -Math.PI / 180, -.02, 1);
      ring(point(0, 0, -.18), .78, .78, 0, 0, 0, orange, .24);
      cloud(point(0, 0, -.18), .82, orange, .095);
    } else if (kind === "star") {
      // An article remains a star within Logs. Up close, article-aurora.js's
      // green hem and pink/violet folded curtains resolve around that star.
      body(origin, .022, [221, 240, 224], 1.4);
      cloud(origin, .075, [139, 212, 177], .22);
      const hues = [[110, 227, 153], [159, 226, 141], [226, 124, 155], [233, 78, 148], [206, 75, 161], [154, 74, 173], [117, 75, 165]];
      for (let layer = 0; layer < 2; layer += 1) {
        for (let i = 0; i <= 80; i += 1) {
          const u = i / 80, phase = layer * 2.7;
          const fold = u * (12 + layer * 2.7) + phase + Math.sin(u * 19 + phase) * .37;
          const x = (u - .5) * 1.9 + Math.sin(fold) * .054;
          const hem = .29 + layer * .14 + Math.sin(u * 6 + phase) * .17 + Math.cos(fold) * .056;
          const depth = Math.cos(fold) * .25 + (layer - .5) * .29;
          const height = .47 + .29 * (.5 + .5 * Math.sin(u * 15 + phase)) + random() * .11;
          const envelope = Math.pow(Math.sin(Math.PI * u), .55);
          let prior = point(x, hem, depth);
          for (let ray = 1; ray <= hues.length; ray += 1) {
            const t = ray / hues.length;
            const p = point(x + Math.sin(u * 5 + phase) * .055 * t, hem - height * t, depth + Math.sin(t * Math.PI) * .075);
            line(prior, p, hues[ray - 1], envelope * (.76 - t * .6), .9);
            prior = p;
          }
          if (i % 2 === 0) {
            cloud(point(x, hem - .02, depth), .07, hues[0], envelope * .2);
            cloud(point(x, hem - height * .47, depth + .065), .115, hues[3], envelope * .10);
          }
        }
      }
    }
    const bounds = { min: point(Infinity, Infinity, Infinity), max: point(-Infinity, -Infinity, -Infinity) };
    const include = (p, radius = 0) => {
      for (const axis of ["x", "y", "z"]) {
        bounds.min[axis] = Math.min(bounds.min[axis], p[axis] - radius);
        bounds.max[axis] = Math.max(bounds.max[axis], p[axis] + radius);
      }
    };
    geometry.faces.forEach((face) => face.points.forEach((p) => include(p)));
    geometry.segments.forEach(({ a, b }) => { include(a); include(b); });
    geometry.bodies.forEach(({ at, r }) => include(at, r));
    geometry.bounds = bounds;
    if (landmarkGeometryCache.size >= 24) landmarkGeometryCache.delete(landmarkGeometryCache.keys().next().value);
    landmarkGeometryCache.set(cacheKey, geometry);
    return geometry;
  }

  function prepareLandmarks(kinds) {
    kinds.forEach((kind) => landmarkGeometry(kind));
  }

  function matterSprite(color) {
    const key = color.join(",");
    if (!matterSprites.has(key)) {
      const canvas = makeCanvas(64);
      glow(canvas.getContext("2d"), 32, 32, [[0, rgba(color, .8)], [.25, rgba(color, .36)], [.6, rgba(color, .08)], [1, rgba(color, 0)]]);
      matterSprites.set(key, canvas);
    }
    return matterSprites.get(key);
  }

  function pageStates(plan, camera, irisLimit = Infinity, t = 0) {
    const pages = {
      source: pageState(plan.start, camera, plan.sourceFocus, plan.viewport, { irisLimit, enclosing: plan.sourceEncloses }),
      target: pageState(landingCamera(plan), camera, plan.targetFocus, plan.viewport, { enclosing: plan.targetEncloses }),
    };
    pages.source.opacity *= 1 - smoothstep(0, 0.1, t);
    pages.target.opacity *= smoothstep(0.82, 1, t);
    return pages;
  }

  function pageWeights(plan, camera, t = 0) {
    const pages = pageStates(plan, camera, Infinity, t);
    return { from: pages.source.opacity, to: pages.target.opacity };
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

    function toScreen(camera, point) {
      return projectPoint(camera, point, { w: width, h: height });
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
        const projected = toScreen(camera, haze);
        if (!projected.visible) return;
        const { x, y } = projected;
        const radius = haze.r * base / projected.depth;
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

    // Stable cells fill a volume around the eye, including behind it. Sample
    // the same world star through both camera poses to get turn and translation
    // parallax. Fading octave/range boundaries avoids repopulating the sky when
    // the camera crosses a cell, changes heading, or changes magnification.
    function collectStars(camera, previous, colors, layer, speed) {
      buckets.clear();
      const h = camera.w;
      const frame = cameraFrame(camera);
      const prior = cameraFrame(previous);
      const kTop = Math.floor(Math.log2(h));
      const shutter = speed > 0.001;
      for (let k = kTop - 3; k <= kTop + 3; k += 1) {
        const span = 2 ** k;
        const ratio = span / h;
        const octave = smoothstep(0.0625, 0.125, ratio) * (1 - smoothstep(4, 8, ratio));
        if (octave < 0.02) continue;
        const ci = Math.floor(frame.eye.x / span), cj = Math.floor(frame.eye.y / span), ck = Math.floor(frame.eye.z / span);
        for (let i = ci - 5; i <= ci + 5; i += 1) {
          for (let j = cj - 5; j <= cj + 5; j += 1) {
            for (let l = ck - 5; l <= ck + 5; l += 1) {
              const salt = k * 31;
              const point = { x: (i + hashCell(i, j, l, salt + 1)) * span,
                y: (j + hashCell(i, j, l, salt + 2)) * span, z: (l + hashCell(i, j, l, salt + 3)) * span };
              const range = Math.hypot(point.x - frame.eye.x, point.y - frame.eye.y, point.z - frame.eye.z) / span;
              if (range > 4.8) continue;
              const local = cameraPoint(frame, point);
              const depth = local.z;
              if (depth <= h * 0.02) continue;
              const nearness = clamp(1 - depth / h, 0, 1);
              const isNear = depth < h * 0.34;
              if (layer === "near" && !isNear) continue;
              const sx = width / 2 + local.x * base / depth;
              const sy = height / 2 + local.y * base / depth;
              if (sx < -40 || sx > width + 40 || sy < -40 || sy > height + 40) continue;
              const brightness = 0.3 + 0.7 * hashCell(i, j, l, salt + 4) ** 2;
              const size = clamp(base * span * 0.002 / depth, 0.5, 2.6);
              let alpha = brightness * octave * smoothstep(0.02, 0.16, depth / h)
                * (1 - smoothstep(3.2, 4.8, range)) * (0.7 + 0.3 * nearness);
              if (layer === "near") alpha *= smoothstep(0.08, 0.4, speed);
              else if (isNear) alpha *= 1 - smoothstep(0.08, 0.4, speed);
              if (alpha < 0.03) continue;
              let tx = sx;
              let ty = sy;
              const old = cameraPoint(prior, point);
              if (shutter && old.z > previous.w * 0.02) {
                tx = width / 2 + old.x * base / old.z;
                ty = height / 2 + old.y * base / old.z;
                const dx = sx - tx;
                const dy = sy - ty;
                const length = Math.hypot(dx, dy);
                const limit = width * 0.065;
                if (length > limit) {
                  tx = sx - dx / length * limit;
                  ty = sy - dy / length * limit;
                }
                if (length > size * 2) alpha *= Math.sqrt(clamp(size * 2.4 / length, 0.18, 1));
              }
              const warm = hashCell(i, j, l, salt + 5) < 0.22;
              const level = Math.min(5, Math.floor(alpha * 6));
              const weight = size < 0.9 ? 0 : size < 1.6 ? 1 : 2;
              const key = `${warm ? 1 : 0}|${level}|${weight}`;
              if (!buckets.has(key)) buckets.set(key, { warm, alpha: (level + 0.5) / 6, width: [0.9, 1.4, 2.2][weight], segments: [] });
              buckets.get(key).segments.push(sx, sy, tx, ty);
            }
          }
        }
      }
      return buckets;
    }

    function drawStars(camera, previous, colors, layer, speed) {
      collectStars(camera, previous, colors, layer, speed);
      context.lineCap = "round";
      buckets.forEach((bucket) => {
        context.strokeStyle = rgba(bucket.warm ? colors.warmStar : colors.star, bucket.alpha * 0.62);
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
      const base = lerp(0.1, 0.055, colors.night);
      CHART_LINES.forEach(([from, to]) => {
        const a = DESTINATIONS[from].landmark;
        const b = DESTINATIONS[to].landmark;
        const line = projectSegment(camera, a, b, { w: width, h: height });
        if (!line) return;
        const [ax, ay, bx, by] = line;
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
      const line = projectSegment(camera, a, b, { w: width, h: height });
      if (!line) return;
      const [ax, ay, bx, by] = line;
      const routeAlpha = 0.24 * Math.sin(Math.PI * clamp(progress, 0, 1)) ** 0.7;
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

    function drawGalaxyField(camera, landmark, radius, alpha, colors, plan) {
      if (alpha < 0.02) return;
      const snapshot = plan?.galaxy;
      // A filtered archive may be in its encounter/remnant state. Do not
      // replace that live state with an unrelated four-arm picture.
      if (snapshot?.mode && snapshot.mode !== "spiral") return;
      const aspect = visibleGalaxyFocus(snapshot?.focus, { w: width, h: height }) && snapshot.focus.radiusX > 0
        ? clamp(snapshot.focus.radiusY / snapshot.focus.radiusX, 0.25, 3) : 0.8;
      const elapsed = Number.isFinite(snapshot?.elapsed) ? snapshot.elapsed : 0;
      const center = toScreen(camera, landmark);
      context.save();
      context.globalCompositeOperation = colors.night > 0.5 ? "lighter" : "source-over";
      // Dust lanes are the space between stars; there is no ellipse or outline
      // painted in screen coordinates to contradict the camera's perspective.
      galaxyParticles().forEach((particle) => {
        const angle = galaxyGeometry.angle(particle.radius, particle.arm, particle.jitter, elapsed);
        const world = galaxyWorldPoint(landmark, particle.radius, angle, aspect, particle.height);
        const point = toScreen(camera, world);
        if (!point.visible || point.x < -20 || point.x > width + 20 || point.y < -20 || point.y > height + 20) return;
        const size = clamp(particle.size * landmark.r * base / point.depth / 220, 0.45, 4.5);
        const dustSize = clamp(landmark.r * base / point.depth * 0.09, 2, 90);
        context.globalAlpha = particle.alpha * alpha * 0.3;
        context.drawImage(galaxyDust(), point.x - dustSize / 2, point.y - dustSize / 2, dustSize, dustSize);
        context.globalAlpha = particle.alpha * alpha * 0.58;
        context.fillStyle = colors.night > 0.5 ? (particle.warm ? "#ffcfab" : "#c6dcff") : "#496d9a";
        context.fillRect(point.x - size / 2, point.y - size / 2, size, size);
        if (size > 0.9) {
          context.globalAlpha *= 0.7;
          context.drawImage(galaxyLight(), point.x - size * 6, point.y - size * 6, size * 12, size * 12);
        }
      });
      context.globalAlpha = alpha;
      glow(context, [center.x, center.y], Math.max(2, radius * 0.2), [[0, "rgba(255,250,236,.95)"], [0.12, "rgba(230,238,255,.62)"], [0.4, "rgba(130,171,229,.12)"], [1, "rgba(0,0,0,0)"]]);
      context.restore();
    }

    // Canvas fallback samples the same bipolar shell in world coordinates.
    // It keeps the silhouette and parallax when WebGL is unavailable/lost.
    function drawNebulaCloud(camera, landmark, alpha) {
      if (!nebulaCloud) {
        const random = seededRandom(19471);
        nebulaCloud = Array.from({ length: 950 }, () => {
          const axial = (random() * 2 - 1) * 9.8;
          const angle = random() * Math.PI * 2;
          const shell = random() > 0.32;
          const profile = 0.55 + 7.8 * (Math.abs(axial) / 10.2) ** 0.78;
          const radius = profile * (shell ? 0.9 + random() * 0.12 : Math.sqrt(random()) * 0.84);
          const radial = Math.cos(angle) * radius;
          return { x: (axial * 0.681 - radial * 0.732) / 12,
            y: -(axial * 0.732 + radial * 0.681) / 12,
            z: Math.sin(angle) * radius / 12,
            size: shell ? 0.023 : 0.075, shell };
        });
      }
      context.save();
      context.globalCompositeOperation = "lighter";
      nebulaCloud.forEach((particle) => {
        const point = toScreen(camera, { x: landmark.x + particle.x * landmark.r,
          y: landmark.y + particle.y * landmark.r, z: landmark.z + particle.z * landmark.r });
        if (!point.visible) return;
        const size = clamp(particle.size * landmark.r * base / point.depth, 0.6, 42);
        if (point.x < -size || point.x > width + size || point.y < -size || point.y > height + size) return;
        context.globalAlpha = alpha * (particle.shell ? 0.26 : 0.16);
        if (particle.shell) {
          context.fillStyle = "#dfb67c";
          context.fillRect(point.x, point.y, size * 0.38, size);
        } else {
          context.drawImage(galaxyDust(), point.x - size, point.y - size, size * 2, size * 2);
        }
      });
      context.restore();
      return true;
    }

    function drawNebula(camera, landmark, x, y, radius, alpha, colors, visual = null) {
      const volume = prepareNebulaVolume();
      if (!volume) return landmark.kind === "supernova"
        ? drawLandmarkGeometry(camera, landmark, radius, alpha, colors, visual) : drawNebulaCloud(camera, landmark, alpha);
      // Crop the raymarch to this object's projected sphere. The eye and all
      // rays are the observer's actual world-space frame, in nebula units.
      const frame = cameraFrame(camera);
      const distance = Math.hypot(frame.eye.x - landmark.x, frame.eye.y - landmark.y, frame.eye.z - landmark.z);
      const matterScale = landmark.kind === "supernova" && Number.isFinite(visual?.size) ? clamp(visual.size, .045, 1.3) : 1;
      const bound = distance < landmark.r * matterScale * 1.8 ? Math.hypot(width, height) * 2 : radius * matterScale * 1.85;
      const left = Math.max(0, Math.floor(x - bound)), top = Math.max(0, Math.floor(y - bound));
      const w = Math.min(width, Math.ceil(x + bound)) - left;
      const h = Math.min(height, Math.ceil(y + bound)) - top;
      if (w <= 0 || h <= 0) return true;
      const local = (vector) => ({ x: vector.x, y: -vector.y, z: vector.z });
      const units = 12 / landmark.r;
      const navigation = {
        navigationEye: local({ x: (frame.eye.x - landmark.x) * units,
          y: (frame.eye.y - landmark.y) * units, z: (frame.eye.z - landmark.z) * units }),
        navigationRight: local(frame.right), navigationDown: local(frame.down), navigationForward: local(frame.forward),
      };
      const drawn = volume.renderer.draw({ width: w, height: h, centerX: width / 2 - left,
        centerY: height / 2 - top, baseScale: base, lightTheme: colors.night < 0.5, navigation,
        remnant: landmark.kind === "supernova", remnantState: visual });
      if (!drawn) return landmark.kind === "supernova"
        ? drawLandmarkGeometry(camera, landmark, radius, alpha, colors, visual) : drawNebulaCloud(camera, landmark, alpha);
      context.globalAlpha = alpha;
      context.drawImage(volume.canvas, left, top, w, h);
      context.globalAlpha = 1;
      return true;
    }

    function drawLandmarkGeometry(camera, landmark, radius, alpha, colors, visual = null) {
      const geometry = landmarkGeometry(landmark.kind, landmark.kind === "supernova" ? null : visual);
      const frame = cameraFrame(camera);
      const near = Math.max(1e-5, camera.w * .02);
      const viewport = { w: width, h: height };
      const matterScale = landmark.kind === "supernova" && Number.isFinite(visual?.size) ? clamp(visual.size, .045, 1.3) : 1;
      const world = (p) => landmarkWorldPoint(landmark, matterScale === 1 ? p : { x: p.x * matterScale, y: p.y * matterScale, z: p.z * matterScale });
      const project = (p) => {
        const local = cameraPoint(frame, world(p));
        return { x: width / 2 + local.x * base / Math.max(near, local.z),
          y: height / 2 + local.y * base / Math.max(near, local.z), depth: local.z, local };
      };
      const ink = (color) => mixRgb(color.map((channel) => Math.round(channel * .55)), color, colors.night);
      const visible = (p, reach = 0) => p.depth > near && p.x + reach >= 0 && p.x - reach <= width && p.y + reach >= 0 && p.y - reach <= height;
      const queue = [];
      const light = { x: -.45, y: -.62, z: .64 };
      const lightX = dot(light, frame.right), lightY = dot(light, frame.down);
      const localSize = (r, depth) => clamp(r * matterScale * landmark.r * base / depth, .4, Math.hypot(width, height));
      const stride = radius < 10 ? 8 : radius < 32 ? 3 : 1;

      // Opaque material surfaces use a real depth buffer. Transparent halos
      // stay underneath; their positions still use the same world camera.
      const field = landmark.kind === "supernova" ? null : prepareSolidField();
      if (field) {
        const { min, max } = geometry.bounds;
        const corners = [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => project({ x, y, z }))));
        const crossesNear = corners.some((p) => p.depth <= near);
        const left = crossesNear ? 0 : Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))) - 4);
        const top = crossesNear ? 0 : Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))) - 4);
        const right = crossesNear ? width : Math.min(width, Math.ceil(Math.max(...corners.map((p) => p.x))) + 4);
        const bottom = crossesNear ? height : Math.min(height, Math.ceil(Math.max(...corners.map((p) => p.y))) + 4);
        const crop = { left, top, width: right - left, height: bottom - top };
        const hasSurface = crop.width > 0 && crop.height > 0;
        // An offscreen solid can still cast a visible halo into the viewport.
        if (!hasSurface || field.renderer.draw({ geometry, kind: landmark.kind, frame, landmark, viewport, crop, night: colors.night, near })) {
          if (hasSurface) solidRendering.materialFrames += 1;
          context.save();
          context.globalCompositeOperation = colors.night > .5 ? "screen" : "multiply";
          geometry.clouds.forEach((cloud, i) => {
            if (i % stride) return;
            const p = project(cloud.at), size = localSize(cloud.r, p.depth);
            if (!visible(p, size)) return;
            context.globalAlpha = alpha * cloud.alpha * smoothstep(near, near * 3, p.depth);
            context.drawImage(matterSprite(cloud.color), p.x - size, p.y - size, size * 2, size * 2);
          });
          geometry.bodies.forEach((body) => {
            if (!body.emission) return;
            const p = project(body.at), size = localSize(body.r, p.depth) * 5;
            if (!visible(p, size)) return;
            context.globalAlpha = alpha * body.emission * lerp(.25, .65, colors.night) * smoothstep(near, near * 3, p.depth);
            context.drawImage(matterSprite(body.color), p.x - size, p.y - size, size * 2, size * 2);
          });
          context.globalCompositeOperation = "source-over";
          context.globalAlpha = alpha;
          if (hasSurface) context.drawImage(field.canvas, left, top, crop.width, crop.height);
          context.restore();
          return;
        }
      }
      solidRendering.fallbackFrames += 1;

      geometry.clouds.forEach((cloud, i) => {
        if (i % stride) return;
        const p = project(cloud.at), size = localSize(cloud.r, p.depth);
        if (visible(p, size)) queue.push({ type: "cloud", item: cloud, p, size, depth: p.depth });
      });
      geometry.bodies.forEach((body) => {
        const p = project(body.at), size = localSize(body.r, p.depth);
        if (visible(p, size * 5)) queue.push({ type: "body", item: body, p, size, depth: p.depth });
      });
      if (radius > 4) geometry.segments.forEach((segment) => {
        const a = project(segment.a), b = project(segment.b);
        if (a.depth <= near && b.depth <= near) return;
        const points = a.depth <= near || b.depth <= near
          ? projectSegment(camera, world(segment.a), world(segment.b), viewport) : [a.x, a.y, b.x, b.y];
        if (!points || Math.max(points[0], points[2]) < 0 || Math.min(points[0], points[2]) > width
          || Math.max(points[1], points[3]) < 0 || Math.min(points[1], points[3]) > height) return;
        queue.push({ type: "line", item: segment, points, depth: (Math.max(near, a.depth) + Math.max(near, b.depth)) / 2 });
      });
      geometry.faces.forEach((face) => {
        let polygon = face.points.map((p) => cameraPoint(frame, world(p)));
        const clipped = [];
        // Clip a solid face before perspective division, including an approach
        // through its near side. Never mirror a polygon behind the observer.
        polygon.forEach((p, i) => {
          const q = polygon[(i + 1) % polygon.length];
          if (p.z >= near) clipped.push(p);
          if ((p.z >= near) !== (q.z >= near)) {
            const t = (near - p.z) / (q.z - p.z);
            clipped.push({ x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t), z: near });
          }
        });
        polygon = clipped;
        if (polygon.length < 3) return;
        const points = polygon.map((p) => ({ x: width / 2 + p.x * base / p.z, y: height / 2 + p.y * base / p.z }));
        if (points.every((p) => p.x < 0) || points.every((p) => p.x > width)
          || points.every((p) => p.y < 0) || points.every((p) => p.y > height)) return;
        const [a, b, c] = face.points;
        const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
        const normal = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
        const anchor = world(a);
        const facing = dot(normal, { x: frame.eye.x - anchor.x, y: frame.eye.y - anchor.y, z: frame.eye.z - anchor.z });
        if (!face.doubleSided && facing <= 0) return;
        const incidence = dot(normal, light) * (facing < 0 ? -1 : 1);
        const illumination = .38 + .62 * Math.max(0, incidence) / Math.max(1e-6, Math.hypot(normal.x, normal.y, normal.z));
        queue.push({ type: "face", item: face, points, illumination, depth: polygon.reduce((sum, p) => sum + p.z, 0) / polygon.length });
      });
      // Drawing far-to-near lets satellites occult their rear tracks and the
      // satellite bus obscure array roots. Glow is local to each physical part.
      queue.sort((a, b) => b.depth - a.depth);
      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const draw of queue) {
        const { item } = draw;
        const depthFade = smoothstep(near, near * 3, draw.depth);
        context.globalCompositeOperation = "source-over";
        context.globalAlpha = alpha * depthFade;
        if (draw.type === "cloud") {
          context.globalCompositeOperation = colors.night > .5 ? "screen" : "multiply";
          context.globalAlpha *= item.alpha * (stride > 1 ? 1.4 : 1);
          context.drawImage(matterSprite(item.color), draw.p.x - draw.size, draw.p.y - draw.size, draw.size * 2, draw.size * 2);
        } else if (draw.type === "line") {
          context.strokeStyle = rgba(ink(item.color), item.alpha * smoothstep(4, 14, radius));
          context.lineWidth = item.width * clamp(radius / 160, .7, 1.35);
          context.beginPath();
          context.moveTo(draw.points[0], draw.points[1]);
          context.lineTo(draw.points[2], draw.points[3]);
          context.stroke();
        } else if (draw.type === "face") {
          context.fillStyle = rgba(item.color.map((channel) => Math.round(channel * draw.illumination)), 1);
          context.beginPath();
          draw.points.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y));
          context.closePath();
          context.fill();
          context.strokeStyle = rgba(mixRgb(item.color, [225, 239, 250], .35), .25);
          context.lineWidth = .55;
          context.stroke();
        } else {
          const { x, y } = draw.p, r = draw.size;
          if (item.emission && r > .7) {
            context.globalAlpha *= item.emission * lerp(.38, .8, colors.night);
            context.drawImage(matterSprite(item.color), x - r * 5, y - r * 5, r * 10, r * 10);
            context.globalAlpha = alpha * depthFade;
          }
          const surface = context.createRadialGradient(x + lightX * r * .45, y + lightY * r * .45, r * .04, x, y, r);
          surface.addColorStop(0, rgba(mixRgb(item.color, [255, 255, 255], .82), 1));
          surface.addColorStop(.42, rgba(item.color, 1));
          surface.addColorStop(.8, rgba(item.color.map((channel) => Math.round(channel * (item.emission > .9 ? .84 : .48))), 1));
          surface.addColorStop(1, rgba(item.color.map((channel) => Math.round(channel * (item.emission > .9 ? .5 : .16))), 1));
          context.fillStyle = surface;
          context.beginPath();
          context.arc(x, y, r, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.restore();
    }

    function drawLandmark(camera, landmark, colors, labelAlpha = 1, weight = 1, plan = null) {
      const projected = toScreen(camera, landmark);
      if (!projected.visible) return;
      const { x, y } = projected;
      const radius = landmark.r * base / projected.depth;
      const reach = radius * 2.8 + 120;
      if (weight < 0.02 || x + reach < 0 || x - reach > width || y + reach < 0 || y - reach > height) return;
      const diagonal = Math.hypot(width, height);
      const visual = landmark.kind === "supernova" && window.UniversePageLandmark?.kind === "supernova"
        ? window.UniversePageLandmark.snapshot() : plan?.visuals?.[landmark.kind] || null;
      const insideFade = (landmark.kind === "galaxy"
        ? 1 - smoothstep(diagonal * 6, diagonal * 16, radius)
        : 1 - smoothstep(diagonal * 1.2, diagonal * 4.5, radius)) * weight;
      if (insideFade <= 0.01) return;
      if (radius < 1.2) {
        context.fillStyle = rgba(landmark.kind === "supernova" ? colors.warmStar : colors.star, 0.8 * insideFade);
        context.fillRect(x - 1, y - 1, 2, 2);
      } else {
        const glowWeight = landmarkGlowWeight(landmark.kind, colors.night) * insideFade;
        if (landmark.kind === "nebula" || landmark.kind === "supernova") {
          drawNebula(camera, landmark, x, y, radius, landmark.kind === "supernova" ? insideFade : glowWeight, colors, visual);
        } else if (landmark.kind === "galaxy") {
          drawGalaxyField(camera, landmark, radius, Math.max(glowWeight, 0.65 * insideFade), colors, plan);
        } else {
          drawLandmarkGeometry(camera, landmark, radius, insideFade, colors, visual);
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

    // weights.from / weights.to are the pages' exposure: while a page is open
    // its own landmark stays under it, and takes over as the page closes.
    function drawWorld(camera, previous, colors, plan, progress, speed, weights = null) {
      fillSky(colors);
      drawHazes(camera, colors);
      drawStars(camera, previous, colors, "far", speed);
      drawChart(camera, colors, plan, progress);
      const weightFor = (target) => {
        if (!plan || !weights) return 1;
        if (target === plan.to) return 1 - weights.to;
        if (target === plan.from) return (1 - weights.from) * (target.key === "search" ? 1 - 0.94 * smoothstep(0.24, 0.58, progress) : 1);
        // Search surveys the whole map. Keep its large gates subordinate when
        // flying to another object instead of filling that approach with rails.
        return target.key === "search" ? 0.06 : 1;
      };
      const objects = LANDMARK_KEYS.map((key) => DESTINATIONS[key]);
      [plan?.from, plan?.to].forEach((target) => { if (target?.key === "article") objects.push(target); });
      objects.sort((a, b) => toScreen(camera, b.landmark).depth - toScreen(camera, a.landmark).depth);
      objects.forEach((target) => drawLandmark(camera, target.landmark, colors,
        plan && target === plan.to ? 0 : 1, weightFor(target), plan));
    }

    // Phase-A and the non-transition fallback paint the sky over a live page,
    // so the page shows through a soft hole with the same profile as the mask
    // the view transition later applies to the page snapshot.
    function cutLens(lens) {
      if (!lens || lens.radius <= 0 || lens.strength <= 0) return;
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
      const projected = toScreen(camera, target);
      let { x: tx, y: ty } = projected;
      const behind = !projected.visible;
      // Rear bearings cannot be perspective-divided: that would mirror their
      // direction. Put the cue on the edge until the camera has turned to it.
      if (behind) {
        const angle = Math.atan2(projected.cameraY, projected.cameraX || Math.sign(plan.turn.yaw || 1) * 1e-4);
        tx = width / 2 + Math.cos(angle) * Math.hypot(width, height);
        ty = height / 2 + Math.sin(angle) * Math.hypot(width, height);
      }
      const radius = projected.visible ? target.r * base / projected.depth : 0;
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
      const offscreen = behind || clampedX !== tx || clampedY !== ty;
      const settle = irisEase(clamp(lock, 0, 1));
      context.strokeStyle = rgba(colors.hud, 0.42 * fade);
      context.fillStyle = rgba(colors.hud, 0.92 * fade);
      context.lineWidth = 0.8;
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
        const arm = Math.max(5, box * 0.11);
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
      const distance = Math.hypot(projected.cameraX, projected.cameraY, projected.depth);
      const bearing = Math.atan2(projected.cameraX, projected.depth) * 180 / Math.PI;
      const elevation = Math.atan2(-projected.cameraY, Math.hypot(projected.cameraX, projected.depth)) * 180 / Math.PI;
      const labelX = clamp(offscreen ? clampedX : tx, 70, width - 70);
      const labelY = offscreen ? clampedY + (clampedY > height / 2 ? -26 : 26) : clamp(ty - Math.max(radius * 1.4, 14) - 22, insetTop - 6, height - 40);
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "700 10.5px \"Space Grotesk\", ui-sans-serif, system-ui, sans-serif";
      if ("letterSpacing" in context) context.letterSpacing = "1.6px";
      context.fillText(plan.to.landmark.tag, labelX, labelY);
      context.font = "500 9px \"Space Grotesk\", ui-sans-serif, system-ui, sans-serif";
      context.fillStyle = rgba(colors.hud, 0.66 * fade);
      context.fillText(`${behind ? "BEHIND · " : ""}AZ ${Math.round(bearing)}° · EL ${Math.round(elevation)}°`, labelX, labelY + 13);
      context.fillText(`${(distance * 3.26).toFixed(1)} LY`, labelX, labelY + 25);
      if ("letterSpacing" in context) context.letterSpacing = "0px";
      context.textAlign = "start";
    }

    return { resize, clear, drawWorld, drawStars, cutLens, drawHud, begin, context };
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
    const pan = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / ((a.w + b.w) / 2);
    const turn = Math.hypot(b.yaw - a.yaw, b.pitch - a.pitch);
    return clamp((zoom + pan + turn) * 4, 0, 1);
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
    prepareLandmarks([plan.from.landmark.kind, plan.to.landmark.kind]);
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
    prepareLandmarks([plan.from.landmark.kind, plan.to.landmark.kind]);
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
    const weights = pageWeights(plan, camera, t);
    sky.drawWorld(camera, shutterCamera(plan, t), colors, plan, t, speed, weights);
    const page = pageState(pageCam, camera, focus, plan.viewport, {
      enclosing: pageCam === plan.start ? plan.sourceEncloses : plan.targetEncloses,
    });
    page.opacity *= pageCam === plan.start ? 1 - smoothstep(0, 0.1, t) : smoothstep(0.82, 1, t);
    sky.cutLens({ x: page.lensX, y: page.lensY, radius: page.radius * page.lensScale, strength: page.opacity });
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
    prepareLandmarks([plan.from.landmark.kind, plan.to.landmark.kind]);
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
      transform: `matrix3d(${state.matrix.map((value) => Number(value.toFixed(10))).join(",")})`,
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
    for (let index = 0; index <= samples; index += 1) {
      const t = index / samples;
      const camera = cameraAt(plan, t);
      const pages = pageStates(plan, camera, irisLimit, t);
      old.push(pageKeyframe(pages.source, t));
      const state = pages.target;
      if (index === samples) {
        state.x = 0;
        state.y = 0;
        state.scale = 1;
        state.opacity = 1;
        state.feather = 0;
        state.matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
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
    prepareLandmarks([plan.from.landmark.kind, plan.to.landmark.kind]);
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
      const pages = pageStates(plan, camera, irisLimit, t);
      const weights = { from: pages.source.opacity, to: pages.target.opacity };
      backSky.drawWorld(camera, previous, colors, plan, t, speed, weights);
      frontSky.clear();
      frontSky.drawStars(camera, previous, colors, "near", speed);
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
        { offset: 0, opacity: 1 }, { offset: 0.02, opacity: 1 }, { offset: 0.13, opacity: 0 }, { offset: 1, opacity: 0 },
      ], plan.duration);
      const hudIn = animatePseudo("::view-transition-new(universe-site-header)", [
        { offset: 0, opacity: 0 }, { offset: 0.9, opacity: 0 }, { offset: 0.995, opacity: 1 }, { offset: 1, opacity: 1 },
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
      visuals: capturePageVisuals(),
      galaxy: source.key === "logs" ? window.UniverseGalaxy?.snapshot() || null : null,
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
    record.turnYaw = Number((plan.turn.yaw * 180 / Math.PI).toFixed(2));
    record.turnPitch = Number((plan.turn.pitch * 180 / Math.PI).toFixed(2));
    record.targetBehind = !projectPoint(plan.start, target.landmark, viewport).visible;
    record.fromPosition = { x: source.landmark.x, y: source.landmark.y, z: source.landmark.z };
    record.toPosition = { x: target.landmark.x, y: target.landmark.y, z: target.landmark.z };
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
    try { prepareLandmarks([...kinds]); prepareNebulaVolume(); prepareSolidField(); } catch (_error) { /* rendered lazily instead */ }
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
        solidRendering: Object.freeze({ ...solidRendering }),
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
      cameraFrame,
      projectPoint,
      projectSegment,
      zoomPath,
      flightDuration,
      planFlight,
      cameraAt,
      correctLanding,
      pageState,
      lensRadius,
      pageOpacity,
      galaxyGeometry,
      galaxyWorldPoint,
      landmarkGeometry,
      landmarkWorldPoint,
      visibleGalaxyFocus,
    }),
  });
})();
