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
  const RECORD_VERSION = 12;
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
    projects: destination("projects", "Production apps", "projects", 8.8, 5.6, null,
      { x: -0.9, y: -21.4, z: -15, r: 0.42, kind: "cluster", tag: "04 PRODUCTION" }),
    logs: destination("logs", "Logs", "threads", 6.5, 2.8, "#galaxy-field",
      { x: 52.5, y: 24.6, z: -36, r: 6.4, kind: "galaxy", tag: "05 LOGS" }),
    contact: destination("contact", "Contact", "contact", 4, 1.8, "[data-payload-visual]",
      { x: 2.4, y: 8.7, z: 5.4, r: 0.32, kind: "probe", tag: "06 CONTACT" }),
    resume: destination("resume", "Resume", "work", 6.2, 4.4, "[data-resume-signature-visual]",
      { x: 5.7, y: -12.6, z: 15, r: 0.55, kind: "chart", tag: "07 RÉSUMÉ" }),
    signals: destination("signals", "Signals", "contact", 6.9, 3.6, ".signals-hero__telemetry",
      { x: 7.2, y: 11.7, z: 14.4, r: 0.26, kind: "beacon", tag: "08 SIGNALS" }),
    search: destination("search", "Evidence search", "threads", 5.4, 3.8, ".evidence-search__console",
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
      focus: ".article-region__hero",
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

  function measureFocus(target, viewport = viewportSize()) {
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

  function landmarkGeometry(kind) {
    if (landmarkGeometryCache.has(kind)) return landmarkGeometryCache.get(kind);
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
      // Six eccentric tracks follow the live Home rig's radii, centers and tilts.
      const profiles = [[.19, .125, .03, -.005, -8, -62], [.255, .17, .065, -.025, 13, 12],
        [.315, .215, .02, .025, -17, 82], [.37, .255, .08, -.035, 7, 137],
        [.42, .29, .11, -.01, 19, 211], [.47, .325, .065, .035, -11, 292]];
      profiles.forEach(([rx, ry, cx, cy, tilt, phase], index) => {
        const track = ring(point(cx * 1.8, cy * 1.8, (index - 2.5) * .018), rx * 1.8, ry * 1.8,
          .52 + index * .09, (index % 2 ? 1 : -1) * .24, tilt * Math.PI / 180 - .2,
          index % 3 === 1 ? teal : blue, .43 + index * .035);
        const node = track(phase * Math.PI / 180);
        body(node, .033 + index * .007, [silver, teal, copper, blue, silver, teal][index], .04, index > 2 ? "gas" : "rock");
        cloud(node, .09, blue, .18);
      });
      body(origin, .064, white, 1);
      cloud(origin, .32, blue, .15);
      ring(origin, .11, .11, .6, .2, 0, silver, .38);
    } else if (kind === "supernova") {
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
    } else if (kind === "probe") {
      const pose = (p) => rotateLandmark(p, -.26, .38, -.3);
      const metal = [155, 177, 195], dark = [31, 44, 59], gold = [199, 146, 67];
      // An octagonal, insulated bus with a separate frame and service deck.
      // The bevels, foil and hardware remain physical surfaces from the rear.
      const outline = [[-.125, -.225], [.125, -.225], [.175, -.175], [.175, .175],
        [.125, .225], [-.125, .225], [-.175, .175], [-.175, -.175]];
      const busEnd = (z) => outline.map(([x, y]) => pose(point(x, y, z)));
      const uv = outline.map(([x, y]) => ({ x: x / .35 + .5, y: y / .45 + .5 }));
      face(busEnd(.15), gold, false, { material: "foil", uv });
      face(busEnd(-.15).reverse(), gold, false, { material: "foil", uv: [...uv].reverse() });
      outline.forEach(([x, y], i) => {
        const [nx, ny] = outline[(i + 1) % outline.length];
        face([point(x, y, -.15), point(nx, ny, -.15), point(nx, ny, .15), point(x, y, .15)].map(pose), gold, false,
          { material: "foil", uv: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] });
        for (const z of [-.155, .155]) tube(point(x, y, z), point(nx, ny, z), .007, .007, metal, pose, "metal", 6);
        if (i % 2 === 0) tube(point(x, y, -.155), point(x, y, .155), .009, .009, metal, pose, "metal", 6);
      });
      box(point(-.026, .06, .163), point(.205, .235, .026), dark, pose, false, "dark");
      // A louvred radiator, recessed optical port and mounting fasteners.
      for (let i = 0; i < 9; i += 1) box(point(-.055, -.028 + i * .02, .183), point(.125, .007, .015), metal, pose);
      tube(point(.094, .046, .155), point(.094, .046, .215), .043, .04, metal, pose, "metal", 24);
      tube(point(.094, .046, .215), point(.094, .046, .219), .031, .031, [20, 43, 68], pose, "dark", 24);
      for (const x of [-.119, .119]) for (const y of [-.176, .177]) body(pose(point(x, y, .164)), .006, silver, 0, "metal");
      for (const side of [-1, 1]) {
        // Thick array edges, mechanical hinges and an aft triangulated support.
        tube(point(side * .174, 0, 0), point(side * .355, 0, 0), .021, .016, metal, pose);
        tube(point(side * .31, -.074, 0), point(side * .31, .074, 0), .031, .031, gold, pose);
        box(point(side * .75, 0, -.006), point(.84, .46, .029), metal, pose, true);
        const corners = [point(side * .341, -.216, .011), point(side * 1.159, -.216, .011),
          point(side * 1.159, .216, .011), point(side * .341, .216, .011)];
        const panelUV = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
        face((side < 0 ? corners.reverse() : corners).map(pose), [30, 65, 111], false,
          { material: "solar", uv: side < 0 ? panelUV.reverse() : panelUV });
        for (const y of [-.226, .226]) box(point(side * .75, y, .016), point(.84, .009, .019), metal, pose);
        for (const x of [.335, .612, .889, 1.165]) box(point(side * x, 0, .016), point(.009, .45, .019), metal, pose);
        for (const y of [-.19, .19]) {
          tube(point(side * .245, 0, -.035), point(side * .67, y, -.035), .005, .004, metal, pose, "metal", 6);
          tube(point(side * .67, y, -.035), point(side * 1.12, -y, -.035), .004, .004, metal, pose, "metal", 6);
        }
        line(pose(point(side * .18, .025, .065)), pose(point(side * .35, .025, .025)), copper, .85, 1.1);
        tube(point(side * .137, .16, -.04), point(side * .137, .266, -.04), .034, .034, metal, pose);
        tube(point(side * .137, .266, -.04), point(side * .137, .307, -.04), .015, .027, dark, pose, "dark");
      }
      // Radially tessellated reflector with smooth paraboloid normals, a rolled
      // rim and feed support. There is no fan of flat wedge-shaped highlights.
      const dishRadius = .27, dishY = -.367;
      const dishPoint = (angle, r, back = false) => pose(point(Math.cos(angle) * r, dishY + Math.sin(angle) * r, .178 + r * r * 1.85 - (back ? .011 : 0)));
      const dishNormal = (angle, r) => pose(point(-3.7 * Math.cos(angle) * r, -3.7 * Math.sin(angle) * r, 1));
      for (let band = 0; band < 7; band += 1) {
        const inner = band / 7 * dishRadius, outer = (band + 1) / 7 * dishRadius;
        for (let i = 0; i < 48; i += 1) {
          const a = i / 48 * tau, b = (i + 1) / 48 * tau;
          const angles = band ? [a, a, b, b] : [a, a, b];
          const radii = band ? [inner, outer, outer, inner] : [0, outer, outer];
          face(angles.map((angle, j) => dishPoint(angle, radii[j])), [202, 211, 215], true,
            { material: "ceramic", normals: angles.map((angle, j) => dishNormal(angle, radii[j])),
              uv: angles.map((angle, j) => ({ x: .5 + Math.cos(angle) * radii[j] / dishRadius / 2, y: .5 + Math.sin(angle) * radii[j] / dishRadius / 2 })) });
        }
      }
      // The rear ribs sit behind the reflecting surface; feed stays above it.
      for (let i = 0; i < 48; i += 1) {
        const a = i / 48 * tau, b = (i + 1) / 48 * tau;
        const unposed = (angle) => point(Math.cos(angle) * dishRadius, dishY + Math.sin(angle) * dishRadius, .178 + dishRadius ** 2 * 1.85);
        tube(unposed(a), unposed(b), .006, .006, metal, pose, "metal", 6);
      }
      for (let i = 0; i < 8; i += 1) {
        let prior = dishPoint(i / 8 * tau, .04, true);
        for (let j = 1; j <= 6; j += 1) {
          const p = dishPoint(i / 8 * tau, .04 + j / 6 * .224, true);
          line(prior, p, metal, .8, 1.2); prior = p;
        }
      }
      tube(point(0, -.2, .02), point(0, dishY, .154), .036, .021, metal, pose);
      for (let i = 0; i < 3; i += 1) {
        const a = i * tau / 3 - Math.PI / 2;
        tube(point(Math.cos(a) * .257, dishY + Math.sin(a) * .257, .306), point(0, dishY, .475), .005, .004, dark, pose, "metal", 6);
      }
      tube(point(0, dishY, .448), point(0, dishY, .494), .021, .031, copper, pose);
      tube(point(.135, -.186, -.1), point(.135, -.79, -.1), .006, .0025, metal, pose, "metal", 8);
      for (let i = 0; i < 3; i += 1) tube(point(.105 - i * .012, -.68 + i * .058, -.1), point(.165 + i * .012, -.68 + i * .058, -.1), .002, .002, metal, pose, "metal", 6);
      body(pose(point(.135, -.79, -.1)), .009, teal, 1.2);
      body(pose(point(-.142, .16, .16)), .007, teal, 1.2);
    } else if (kind === "chart") {
      // An ordered chain of milestones, related to the numbered mission dossier.
      const nodes = [point(-.86, .32, -.26), point(-.55, -.02, .05), point(-.27, .16, .32),
        point(.04, -.22, -.05), point(.4, -.08, .26), point(.76, -.47, .02)];
      nodes.forEach((node, i) => {
        if (i) line(nodes[i - 1], node, i === 5 ? copper : blue, .82, 1.4);
        body(node, i === 5 ? .076 : .039, i === 5 ? [233, 199, 152] : white, .65);
        ring(node, i === 5 ? .15 : .076, i === 5 ? .15 : .076, .3, -.32, 0, i === 5 ? copper : blue, .4);
        const foot = point(node.x, .56, -.3 + i * .1);
        line(node, foot, blue, .15, .7);
        line(point(foot.x - .03, foot.y, foot.z), point(foot.x + .03, foot.y, foot.z), blue, .45);
        if (i > 1) line(nodes[i - 2], node, blue, .15, .6);
      });
      line(point(-.95, .56, -.3), point(.9, .56, .3), blue, .28);
    } else if (kind === "beacon") {
      // Empty registry rings are instruments, not invented public records.
      ring(origin, .42, .42, .7, .2, -.24, teal, .7);
      ring(origin, .72, .72, -.55, .45, .24, blue, .55);
      ring(origin, .98, .98, .3, -.55, -.2, blue, .35);
      body(origin, .12, [133, 181, 206], .12, "metal");
      box(point(0, .22, 0), point(.08, .2, .08), silver);
      line(point(0, -.12), point(0, -.54, .08), silver, .8, 1.4);
      body(point(0, -.54, .08), .027, teal, 1);
      for (let i = 0; i < 3; i += 1) ring(point(0, -.54, .08 + i * .11), .12 + i * .13, .12 + i * .13, .75, .2, 0, teal, .45 - i * .11, Math.PI * 1.08, Math.PI * 1.92);
    } else if (kind === "survey") {
      // Three range gates and six converging rays echo Search's route field.
      const pose = (p) => rotateLandmark(p, .6, -.3, -.22);
      const gates = [[1, -.44], [.68, 0], [.37, .44]];
      gates.forEach(([radius, z], gate) => {
        let prior = null;
        for (let i = 0; i <= 120; i += 1) {
          const a = i / 120 * tau;
          const p = pose(point(Math.cos(a) * radius, Math.sin(a) * radius, z));
          if (prior) line(prior, p, gate === 2 ? teal : blue, .26 + gate * .12, gate === 2 ? 1.3 : .9);
          prior = p;
          if (i < 120 && i % 5 === 0) line(p, pose(point(Math.cos(a) * (radius + (i % 15 === 0 ? .038 : .018)), Math.sin(a) * (radius + (i % 15 === 0 ? .038 : .018)), z)), blue, .42, .8);
        }
      });
      for (let i = 0; i < 6; i += 1) {
        const a = i / 6 * tau;
        line(pose(point(Math.cos(a), Math.sin(a), -.44)), pose(point(Math.cos(a) * .37, Math.sin(a) * .37, .44)), blue, .18, .8);
      }
      const target = pose(point(.06, -.07, .7));
      body(target, .036, white, 1);
      ring(target, .1, .1, .6, -.3, -.22, teal, .8);
      line(pose(point(-.86, .22, -.44)), target, copper, .5, 1.1);
    } else if (kind === "tree") {
      const trunks = [point(-.27, .18, .1), point(.25, .08, -.15)];
      body(point(0, .6, .1), .066, white, .7);
      trunks.forEach((trunk, side) => {
        line(point(0, .6, .1), trunk, blue, .65, 1.6);
        body(trunk, .055, side ? teal : silver, .5);
        for (let branch = 0; branch < 4; branch += 1) {
          const a = (side ? -.1 : Math.PI) + (branch - 1.5) * .5;
          const joint = point(trunk.x + Math.cos(a) * .38, trunk.y + Math.sin(a) * .38 - .25, (branch - 1.5) * .22);
          line(trunk, joint, side ? teal : blue, .65);
          body(joint, .032, white, .6);
          for (let leaf = 0; leaf < 3; leaf += 1) {
            const tip = point(joint.x + Math.cos(a + (leaf - 1) * .7) * .19,
              joint.y + Math.sin(a + (leaf - 1) * .7) * .19 - .08, joint.z + (leaf - 1) * .16);
            line(joint, tip, side ? teal : blue, .36, .7);
            body(tip, .014, side ? teal : silver, .3);
          }
        }
      });
    } else if (kind === "cluster") {
      body(origin, .11, white, 1);
      [.46, .82].forEach((radius, group) => {
        const orbit = ring(origin, radius, radius, group ? -.65 : .6, group ? .45 : -.3, -.18, blue, .35);
        for (let i = 0; i < 5; i += 1) {
          const at = orbit(i / 5 * tau + group * .6);
          body(at, .052 + (i % 3) * .012, [teal, silver, copper, blue, silver][i], .04, i % 2 ? "gas" : "rock");
          cloud(at, .13, blue, .18);
        }
      });
    } else if (kind === "star") {
      body(origin, .23, [252, 229, 186], 1.5);
      for (let i = 0; i < 110; i += 1) {
        const a = random() * tau, z = random() * 2 - 1, radial = Math.sqrt(1 - z * z);
        cloud(point(Math.cos(a) * radial * .27, Math.sin(a) * radial * .27, z * .27), .07 + random() * .09,
          i % 3 ? [236, 182, 110] : white, .12);
      }
      for (let i = 0; i < 9; i += 1) ring(origin, .31 + i * .011, .31 + i * .011,
        i * .57, i * .9, i, copper, .14, i, i + .65);
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
    landmarkGeometryCache.set(kind, geometry);
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

    function drawNebula(camera, landmark, x, y, radius, alpha, colors) {
      const volume = prepareNebulaVolume();
      if (!volume) return landmark.kind === "supernova"
        ? drawLandmarkGeometry(camera, landmark, radius, alpha, colors) : drawNebulaCloud(camera, landmark, alpha);
      // Crop the raymarch to this object's projected sphere. The eye and all
      // rays are the observer's actual world-space frame, in nebula units.
      const frame = cameraFrame(camera);
      const distance = Math.hypot(frame.eye.x - landmark.x, frame.eye.y - landmark.y, frame.eye.z - landmark.z);
      const bound = distance < landmark.r * 1.8 ? Math.hypot(width, height) * 2 : radius * 1.85;
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
        centerY: height / 2 - top, baseScale: base, lightTheme: colors.night < 0.5, navigation, remnant: landmark.kind === "supernova" });
      if (!drawn) return landmark.kind === "supernova"
        ? drawLandmarkGeometry(camera, landmark, radius, alpha, colors) : drawNebulaCloud(camera, landmark, alpha);
      context.globalAlpha = alpha;
      context.drawImage(volume.canvas, left, top, w, h);
      context.globalAlpha = 1;
      return true;
    }

    function drawLandmarkGeometry(camera, landmark, radius, alpha, colors) {
      const geometry = landmarkGeometry(landmark.kind);
      const frame = cameraFrame(camera);
      const near = Math.max(1e-5, camera.w * .02);
      const viewport = { w: width, h: height };
      const world = (p) => landmarkWorldPoint(landmark, p);
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
      const localSize = (r, depth) => clamp(r * landmark.r * base / depth, .4, Math.hypot(width, height));
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
          drawNebula(camera, landmark, x, y, radius, landmark.kind === "supernova" ? insideFade : glowWeight, colors);
        } else if (landmark.kind === "galaxy") {
          drawGalaxyField(camera, landmark, radius, Math.max(glowWeight, 0.65 * insideFade), colors, plan);
        } else {
          drawLandmarkGeometry(camera, landmark, radius, insideFade, colors);
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
