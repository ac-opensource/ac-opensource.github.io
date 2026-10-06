const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const controllerPath = process.argv[2] || path.join(__dirname, "../assets/js/universe-theme-transition.js");
const source = fs.readFileSync(controllerPath, "utf8");
const ARRIVAL_KEY = "ac.universe-perspective.v1";

function createPage({ crossDocument = false, reduced = false, rejectNavigation = false, pathname = "/work.html", galaxySnapshot = null } = {}) {
  const scheduled = new Map();
  const frames = new Map();
  const storage = new Map();
  const navigations = [];
  let nextTask = 0;
  let now = 0;

  class EventTarget {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(callback);
    }
    dispatchEvent(event) {
      (this.listeners.get(event.type) || []).forEach((callback) => callback(event));
    }
  }
  class Element extends EventTarget {
    constructor() { super(); this.dataset = {}; this.style = { setProperty() {} }; }
    setAttribute() {}
  }
  class Anchor extends Element {
    constructor(href) { super(); this.href = href; this.target = ""; }
    hasAttribute() { return false; }
    closest(selector) { return selector === "a[href]" ? this : null; }
  }

  const media = new EventTarget();
  media.matches = reduced;
  const document = new EventTarget();
  document.documentElement = new Element();
  document.body = { prepend() {} };
  document.head = { append() {} };
  document.createElement = () => new Element();
  document.querySelector = () => null;
  document.querySelectorAll = () => [];
  const window = new EventTarget();
  window.location = new URL(pathname, "https://example.test");
  window.location.assign = (href) => {
    navigations.push(href);
    if (rejectNavigation) throw new Error("Navigation rejected");
  };
  window.matchMedia = () => media;
  if (galaxySnapshot) window.UniverseGalaxy = { snapshot: () => galaxySnapshot };
  window.localStorage = { getItem: () => null };
  window.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
  window.setTimeout = (callback, delay) => {
    const id = ++nextTask;
    scheduled.set(id, { callback, at: now + delay });
    return id;
  };
  window.clearTimeout = (id) => scheduled.delete(id);
  window.requestAnimationFrame = (callback) => {
    const id = ++nextTask;
    frames.set(id, callback);
    return id;
  };
  if (crossDocument) {
    window.onpageswap = null;
    window.onpagereveal = null;
    window.CSS = { supports: () => true };
  }
  vm.runInNewContext(source, {
    window, document, Element, HTMLAnchorElement: Anchor, URL,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  }, { filename: controllerPath });

  return {
    window, navigations, storage,
    click(href) {
      const event = {
        type: "click", target: new Anchor(new URL(href, window.location).href),
        button: 0, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }
      };
      document.dispatchEvent(event);
      return event;
    },
    reduceMotion() {
      media.matches = true;
      media.dispatchEvent({ type: "change", matches: true });
    },
    advance(milliseconds) {
      const until = now + milliseconds;
      while (true) {
        const due = [...scheduled.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!due || due[1].at > until) break;
        now = due[1].at;
        scheduled.delete(due[0]);
        due[1].callback();
      }
      now = until;
    },
    frame() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(now));
    },
    snapshot: () => window.UniversePerspective.snapshot()
  };
}

for (const crossDocument of [false, true]) {
  const page = createPage({ crossDocument });
  assert(page.click("/about.html?source=map#profile-map").defaultPrevented);
  assert.equal(page.navigations.length, 0, "Motion still defers navigation until its normal departure point.");
  page.reduceMotion();
  assert.deepEqual(page.navigations, ["https://example.test/about.html?source=map#profile-map"],
    "Changing to reduced motion during departure must finish the intercepted navigation immediately.");
  assert.equal(page.snapshot().ready, "ready");
  assert.equal(page.snapshot().motion, null);
  assert.equal(page.snapshot().pendingCleanup, 0);
  assert.equal(JSON.parse(page.storage.get(ARRIVAL_KEY)).destinationUrl, "/about.html?source=map#profile-map",
    "Completing departure must retain the destination's one-time arrival payload.");
  assert.equal(JSON.parse(page.storage.get(ARRIVAL_KEY)).version, 12, "Changed world geometry must use the current arrival record.");
  page.frame();
  page.frame();
  page.advance(3000);
  assert.equal(page.navigations.length, 1, "Previously queued timers and frames must not navigate twice.");

  const retargeted = createPage({ crossDocument });
  retargeted.click("/about.html");
  retargeted.click("/blog/");
  retargeted.reduceMotion();
  retargeted.frame();
  retargeted.frame();
  retargeted.advance(3000);
  assert.deepEqual(retargeted.navigations, ["https://example.test/blog/"], "Only the latest destination may complete.");
  assert.equal(JSON.parse(retargeted.storage.get(ARRIVAL_KEY)).destinationUrl, "/blog/");

  const normal = createPage({ crossDocument });
  normal.click("/about.html");
  if (crossDocument) { normal.frame(); normal.frame(); }
  else normal.advance(1000);
  assert.deepEqual(normal.navigations, ["https://example.test/about.html"], "Unchanged motion must preserve normal navigation.");
  normal.reduceMotion();
  assert.equal(normal.navigations.length, 1, "A completed departure must not replay on preference changes.");

  const restored = createPage({ crossDocument });
  restored.click("/about.html");
  restored.window.dispatchEvent({ type: "pageshow", persisted: true });
  restored.frame();
  restored.frame();
  restored.advance(3000);
  assert.equal(restored.navigations.length, 0, "Restored pages must discard pending navigation callbacks.");
}

const reduced = createPage({ reduced: true });
assert.equal(reduced.click("/about.html").defaultPrevented, false, "Existing reduced-motion navigation stays native.");
assert.equal(reduced.navigations.length, 0);
reduced.reduceMotion();
assert.equal(reduced.navigations.length, 0, "Changing preference without a departure cannot create navigation.");

const rejected = createPage({ rejectNavigation: true });
rejected.click("/about.html");
rejected.reduceMotion();
assert.equal(rejected.snapshot().ready, "ready");
assert.equal(rejected.snapshot().pendingCleanup, 0);
rejected.reduceMotion();
rejected.advance(3000);
assert.equal(rejected.navigations.length, 1, "A failed assignment must settle without replaying.");

// The flight model is pure: every route is a camera inside one shared 3D world.
const model = createPage().window.UniversePerspective.model;
const viewport = { w: 1280, h: 800 };
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
const routePaths = ["/", "/about.html", "/work.html", "/contact.html", "/blog/", "/resume.html", "/signals.html", "/search.html"];
const routes = routePaths.map((routePath) => ({ path: routePath, destination: model.destinationForLocation(routePath) }));
assert(routes.every(({ destination }) => Number.isFinite(destination.landmark.z)), "Every destination has a real depth coordinate, not only a place on a flat chart.");
assert(new Set(routes.map(({ destination }) => destination.landmark.z)).size > 3, "Destinations occupy different depths around the observer.");

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const assertIdentity = (matrix, message) => {
  assert.equal(matrix.length, 16, `${message}: a complete projective matrix is required.`);
  matrix.forEach((value, index) => assert(near(value, identity[index], 1e-5), `${message}: matrix[${index}] is ${value}.`));
};
const assertCameraFrame = (camera, message) => {
  const frame = model.cameraFrame(camera);
  for (const [name, vector] of Object.entries(frame)) {
    assert([vector.x, vector.y, vector.z].every(Number.isFinite), `${message}: ${name} must be finite.`);
  }
  for (const axis of [frame.right, frame.down, frame.forward]) {
    assert(near(Math.hypot(axis.x, axis.y, axis.z), 1), `${message}: camera axes must have unit length.`);
  }
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  assert(near(dot(frame.right, frame.down), 0) && near(dot(frame.right, frame.forward), 0) && near(dot(frame.down, frame.forward), 0), `${message}: camera axes must remain perpendicular.`);
};
const assertSafePage = (state, view, message, pageCamera, observer) => {
  assert(state.matrix.length === 16 && state.matrix.every(Number.isFinite), `${message}: page transform must be finite even while hidden.`);
  assert([state.opacity, state.scale, state.x, state.y, state.lensX, state.lensY, state.near, state.minDepth, state.facing, state.closeness].every(Number.isFinite), `${message}: page projection metadata must remain finite.`);
  if (state.scale <= 0.72 || state.facing <= Math.cos(20 * Math.PI / 180)) {
    assert.equal(state.opacity, 0, `${message}: distant or substantially tilted page text must stay hidden.`);
  }
  if (state.opacity <= 0) return;
  assert(state.closeness > 0.72, `${message}: page text appears only when the observer is close to resting on it.`);
  assert(state.minDepth > state.near, `${message}: a visible page must stay in front of the near plane (${state.minDepth} <= ${state.near}).`);
  const frame = model.cameraFrame(pageCamera);
  const pixel = pageCamera.w / Math.max(view.w, view.h);
  const worldPoint = (x, y) => ({
    x: pageCamera.x + pixel * (frame.right.x * x + frame.down.x * y),
    y: pageCamera.y + pixel * (frame.right.y * x + frame.down.y * y),
    z: pageCamera.z + pixel * (frame.right.z * x + frame.down.z * y),
  });
  for (const x of [-view.w / 2, view.w / 2]) {
    for (const y of [-view.h / 2, view.h / 2]) {
      const divisor = state.matrix[3] * x + state.matrix[7] * y + state.matrix[15];
      assert(divisor > 0, `${message}: a visible corner cannot cross the perspective horizon.`);
      const projectedX = (state.matrix[0] * x + state.matrix[4] * y + state.matrix[12]) / divisor;
      const projectedY = (state.matrix[1] * x + state.matrix[5] * y + state.matrix[13]) / divisor;
      assert(Number.isFinite(projectedX) && Number.isFinite(projectedY), `${message}: visible projected corners must be finite.`);
      const skyPoint = model.projectPoint(observer, worldPoint(x, y), view);
      assert(skyPoint.visible && near(skyPoint.x, view.w / 2 + projectedX) && near(skyPoint.y, view.h / 2 + projectedY), `${message}: page corners and the sky must share the same observer projection.`);
    }
  }
  const hero = model.projectPoint(observer, worldPoint(state.focus.x - view.w / 2, state.focus.y - view.h / 2), view);
  assert(near(state.lensX, hero.x) && near(state.lensY, hero.y), `${message}: the lens remains attached to the hero during the turn.`);
};

// Use the same local geometry as the renderer: camera motion must change its
// projection, not regenerate or flatten the destination into a screen icon.
for (const kind of ["orbital", "supernova", "probe", "chart", "beacon", "survey", "tree", "cluster", "star"]) {
  const shape = model.landmarkGeometry(kind);
  const before = JSON.stringify(shape);
  assert.equal(model.landmarkGeometry(kind), shape, `${kind}: reuse the cached landmark geometry.`);
  const points = [];
  const edges = [];
  const point = (value) => {
    assert(value && [value.x, value.y, value.z].every(Number.isFinite), `${kind}: every local vertex must have finite XYZ coordinates.`);
    assert(Math.hypot(value.x, value.y, value.z) <= 4, `${kind}: geometry must stay within four nominal landmark radii.`);
    points.push(value);
  };
  for (const name of ["segments", "bodies", "faces", "clouds"]) assert(Array.isArray(shape[name]), `${kind}: ${name} must be a geometry collection.`);
  shape.segments.forEach((segment) => {
    point(segment.a);
    point(segment.b);
    edges.push([segment.a, segment.b]);
  });
  shape.faces.forEach((face) => {
    assert(face.points.length >= 3, `${kind}: a solid face requires at least three vertices.`);
    face.points.forEach(point);
    face.points.forEach((value, index) => edges.push([value, face.points[(index + 1) % face.points.length]]));
  });
  for (const body of [...shape.bodies, ...shape.clouds]) {
    point(body.at);
    assert(Number.isFinite(body.r) && body.r > 0 && Math.hypot(body.at.x, body.at.y, body.at.z) + body.r <= 4,
      `${kind}: body and cloud volumes need positive, bounded radii.`);
    // Include occupied extent, so a sphere's depth is represented even when
    // the renderer stores only its center and radius.
    for (const axis of ["x", "y", "z"]) for (const sign of [-1, 1]) {
      point({ ...body.at, [axis]: body.at[axis] + sign * body.r });
    }
  }
  assert(points.length > 0, `${kind}: the landmark must contain visible geometry.`);
  const zValues = points.map((value) => value.z);
  assert(Math.max(...zValues) - Math.min(...zValues) > 0.05, `${kind}: the landmark needs actual depth, not a flat drawing.`);
  const landmark = { x: 4.3, y: -2.1, z: 6.5, r: 2.75, kind };
  const world = points.map((local) => {
    const transformed = model.landmarkWorldPoint(landmark, local);
    for (const axis of ["x", "y", "z"]) {
      assert(near(transformed[axis], landmark[axis] + local[axis] * landmark.r, 1e-10), `${kind}: ${axis} uses the canonical landmark translation and radius.`);
    }
    return transformed;
  });
  const camera = { ...landmark, w: landmark.r * 12, yaw: 0, pitch: 0 };
  const turned = { ...camera, yaw: 0.63, pitch: -0.37 };
  for (const view of [viewport, { w: 390, h: 844 }]) {
    const atRest = world.map((value) => model.projectPoint(camera, value, view));
    const onTurn = world.map((value) => model.projectPoint(turned, value, view));
    assert([...atRest, ...onTurn].every((value) => value.visible && [value.x, value.y, value.depth].every(Number.isFinite)),
      `${kind}: the bounded landmark remains finite in front of the observer at either aspect ratio.`);
    assert(atRest.some((value, index) => Math.abs((value.depth - atRest[0].depth) - (onTurn[index].depth - onTurn[0].depth)) > landmark.r * 0.01),
      `${kind}: a camera turn changes relative vertex depths, not only the object's screen position.`);
  }

  // Place a real edge (or a volume diameter) across the eye's near plane.
  // The clipped endpoint must lie at the midpoint we deliberately put there;
  // dividing the hidden endpoint first would mirror or explode the segment.
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const pair = edges.find(([a, b]) => distance(a, b) > 0.01)
    || [points[0], points.find((value) => distance(points[0], value) > 0.01)];
  assert(pair[1], `${kind}: representative geometry must have nonzero extent.`);
  const [a, b] = pair.map((value) => model.landmarkWorldPoint(landmark, value));
  const length = distance(a, b);
  const direction = { x: (b.x - a.x) / length, y: (b.y - a.y) / length, z: (b.z - a.z) / length };
  const perpendicular = Math.abs(direction.y) < 0.8
    ? { x: -direction.z, y: 0, z: direction.x }
    : { x: 0, y: direction.z, z: -direction.y };
  const perpendicularLength = Math.hypot(perpendicular.x, perpendicular.y, perpendicular.z);
  const forward = Object.fromEntries(["x", "y", "z"].map((axis) => [axis, (direction[axis] + 0.75 * perpendicular[axis] / perpendicularLength) / 1.25]));
  const width = Math.max(0.1, length);
  const clipCamera = { w: width, yaw: Math.atan2(forward.x, -forward.z), pitch: Math.asin(forward.y) };
  for (const axis of ["x", "y", "z"]) clipCamera[axis] = (a[axis] + b[axis]) / 2 + forward[axis] * width * 0.98;
  assert.equal(model.projectPoint(clipCamera, a, viewport).visible, false, `${kind}: the clipping fixture starts behind the near plane.`);
  const visibleEnd = model.projectPoint(clipCamera, b, viewport);
  assert(visibleEnd.visible, `${kind}: the clipping fixture ends in front of the near plane.`);
  const clipped = model.projectSegment(clipCamera, a, b, viewport);
  assert(clipped && clipped.every(Number.isFinite), `${kind}: a crossing edge must clip to finite screen coordinates.`);
  [viewport.w / 2, viewport.h / 2, visibleEnd.x, visibleEnd.y].forEach((expected, index) => {
    assert(near(clipped[index], expected, 1e-5), `${kind}: clipped edge endpoint ${index} must use the same observer projection.`);
  });
  const reversed = model.projectSegment(clipCamera, b, a, viewport);
  assert(reversed && [clipped[2], clipped[3], clipped[0], clipped[1]].every((expected, index) => near(reversed[index], expected, 1e-5)),
    `${kind}: near-plane clipping must preserve the segment when its endpoints are reversed.`);
  const behind = [a, b].map((value) => Object.fromEntries(["x", "y", "z"].map((axis) => [axis, value[axis] - forward[axis] * (length * 2 + width)])));
  assert.equal(model.projectSegment(clipCamera, behind[0], behind[1], viewport), null, `${kind}: an entirely rear-facing edge must not reappear mirrored in the sky.`);
  assert.equal(JSON.stringify(model.landmarkGeometry(kind)), before, `${kind}: transforming and projecting a landmark must not mutate its cached geometry.`);
}

for (const [from, to] of [
  [{ x: 0, y: 0, w: 4 }, { x: 18, y: 8, w: 24 }],
  [{ x: 18, y: 8, w: 24 }, { x: 15, y: 9, w: 0.7 }],
  [{ x: 1, y: 1, w: 2 }, { x: 1, y: 1, w: 8 }],
  [{ x: 0, y: 0, z: 0, w: 4 }, { x: 18, y: 8, z: -12, w: 24 }],
  [{ x: 1, y: 1, z: -8, w: 2 }, { x: 1, y: 1, z: 15, w: 8 }],
]) {
  const path = model.zoomPath(from, to);
  const start = path.at(0);
  const end = path.at(1);
  assert(near(start.x, from.x) && near(start.y, from.y) && near(start.w, from.w), "A zoom path starts at its origin view.");
  assert(near(end.x, to.x, 1e-5) && near(end.y, to.y, 1e-5) && near(end.w, to.w, 1e-5), "A zoom path ends at its destination view.");
  assert(near(start.z, from.z || 0) && near(end.z, to.z || 0, 1e-5), "A spatial path preserves both depth endpoints, including depth-only journeys.");
}

const record = (from, to, extra = {}) => ({
  from, to, fromPath: extra.fromPath || "/", toPath: extra.toPath || "/",
  fromSurface: "light", toSurface: "light", viewport: extra.viewport || viewport,
  fromFocus: { x: 900, y: 420, r: 230 }, toFocus: { x: 640, y: 432, r: 192 },
  ...extra,
});

// A live archive may have been orbiting for minutes or be paused. Its source
// phase survives navigation, while an arriving archive owns its current phase.
const sourceGalaxy = { elapsed: 123.5, formation: 1, mode: "spiral", paused: true,
  focus: { x: 880, y: 430, r: 340, radiusX: 340, radiusY: 290 } };
const logsPage = createPage({ pathname: "/blog/", galaxySnapshot: sourceGalaxy });
logsPage.click("/about.html");
logsPage.reduceMotion();
const sourceTravel = JSON.parse(logsPage.storage.get(ARRIVAL_KEY));
assert.deepEqual(sourceTravel.galaxy, sourceGalaxy, "Leaving Logs captures its phase, paused state, and actual responsive field.");
assert.deepEqual(sourceTravel.fromFocus, sourceGalaxy.focus, "The source page camera uses the live galaxy core and both field radii.");
const arrivalGalaxy = { ...sourceGalaxy, elapsed: 0.25, paused: false };
const logsArrival = createPage({ galaxySnapshot: arrivalGalaxy });
const arrivalModel = logsArrival.window.UniversePerspective.model;
const galaxyArrivalPlan = arrivalModel.planFlight(record("about", "logs", { galaxy: sourceGalaxy }), arrivalGalaxy.focus, viewport);
assert.equal(galaxyArrivalPlan.galaxy, arrivalGalaxy, "A destination galaxy adopts the arriving document's clock, not a stale source phase.");
const measuredGalaxy = { ...arrivalGalaxy, elapsed: 0.5, focus: { ...arrivalGalaxy.focus, y: 450, radiusY: 305 } };
logsArrival.window.UniverseGalaxy = { snapshot: () => measuredGalaxy };
arrivalModel.correctLanding(galaxyArrivalPlan, measuredGalaxy.focus, 0.55);
assert.equal(galaxyArrivalPlan.galaxy, measuredGalaxy, "Late layout correction refreshes the galaxy's live phase and responsive field together.");

// On portrait screens the archive core can sit below the introduction. Keep
// the travel destination in the visible reading region, while retaining the
// exact live clock/field in the record for the archive itself.
const phoneView = { w: 390, h: 844 };
const offscreenGalaxy = { ...sourceGalaxy, focus: { x: 195, y: 1250, r: 160, radiusX: 160, radiusY: 260 } };
assert.equal(model.visibleGalaxyFocus(offscreenGalaxy.focus, phoneView), false, "A below-fold core must not pull the approach off the phone screen.");
assert.equal(model.visibleGalaxyFocus({ ...offscreenGalaxy.focus, y: 430 }, phoneView), true, "A visible phone core still uses the live galaxy focus.");
const phoneLogs = createPage({ pathname: "/blog/", galaxySnapshot: offscreenGalaxy });
phoneLogs.window.innerWidth = phoneView.w;
phoneLogs.window.innerHeight = phoneView.h;
const phoneFocus = JSON.parse(JSON.stringify(phoneLogs.snapshot().focus));
assert(near(phoneFocus.x, phoneView.w / 2) && near(phoneFocus.y, phoneView.h * 0.54), "An offscreen archive lands in the visible page region.");
phoneLogs.click("/about.html");
phoneLogs.reduceMotion();
const phoneTravel = JSON.parse(phoneLogs.storage.get(ARRIVAL_KEY));
assert.deepEqual(phoneTravel.fromFocus, phoneFocus, "Departure keeps the visible phone camera instead of chasing the below-fold core.");
assert.deepEqual(phoneTravel.galaxy, offscreenGalaxy, "The mobile focus fallback must not overwrite the archive's actual phase or field.");

const farHop = model.planFlight(record("home", "logs"), { x: 820, y: 430, r: 340 }, viewport);
assert(farHop.duration >= 950 && farHop.duration <= 1900, `Flight duration must stay navigable: ${farHop.duration}`);
assert(farHop.peak > Math.max(farHop.start.w, farHop.end.w), "A hop between distant objects rises above both.");
assert(!farHop.sourceEncloses && !farHop.targetEncloses);
const startCamera = model.cameraAt(farHop, 0);
const endCamera = model.cameraAt(farHop, 1);
assert(near(startCamera.w, farHop.start.w) && near(endCamera.w, farHop.end.w, 1e-5), "The camera starts and ends on the two pages.");
const landed = model.pageState(farHop.end, endCamera, farHop.targetFocus, viewport, { enclosing: farHop.targetEncloses });
assert(near(landed.scale, 1, 1e-5) && Math.abs(landed.x) < 0.01 && Math.abs(landed.y) < 0.01, "The destination lands in place.");
assert.equal(landed.opacity, 1);
assert.equal(landed.feather, 0);
assertIdentity(landed.matrix, "The landed page has no residual rotation or perspective");
const departing = model.pageState(farHop.start, model.cameraAt(farHop, 0.5), farHop.sourceFocus, viewport, { enclosing: false });
assert(departing.opacity < 0.05, "By mid-flight the departing page has collapsed into its landmark.");

const article = model.destinationForLocation("/blog/2026-04-30-agents-that-leave-receipts.html");
const galaxy = model.destinationForLocation("/blog/").landmark;
assert.equal(article.key, "article");
assert(Math.hypot(article.landmark.x - galaxy.x, article.landmark.y - galaxy.y, article.landmark.z - galaxy.z) < galaxy.r, "Log entries are stars inside the archive galaxy in three dimensions.");
const dive = model.planFlight(record("logs", "article", { toPath: "/blog/2026-04-30-agents-that-leave-receipts.html" }), { x: 990, y: 480, r: 228 }, viewport);
assert(dive.sourceEncloses, "Opening an entry dives into the galaxy instead of flying over it.");
assert(near(dive.turn.angle, 0), "A nested archive dive keeps the galaxy's orientation.");
const rise = model.planFlight(record("article", "logs", { fromPath: "/blog/2026-04-30-agents-that-leave-receipts.html" }), { x: 820, y: 430, r: 340 }, viewport);
assert(rise.targetEncloses, "Returning from an entry rises into its enclosing archive.");
assert(near(rise.turn.angle, 0), "Returning to the archive keeps the nested orientation too.");
assert(model.pageOpacity(2, false) === 0 && model.pageOpacity(2, true) > 0, "Only nested pages are visible larger than the view.");
assert.equal(model.pageOpacity(0.72, false), 0, "A distant page must remain its celestial object until the close approach.");

// Compare the shared orbit to the live renderer's independent fallback math.
// This catches a reversed orbit, a phase/arm mismatch, or responsive axes that
// look correct in isolation but jump when the navigation hands over to Logs.
const archiveSource = fs.readFileSync(path.join(__dirname, "../assets/experiments/universe-options/logs/spiral-galaxy-archive.js"), "utf8");
const archiveGeometryMatch = archiveSource.match(/const geometry = (?:[^\n]+\|\| )?Object\.freeze\((\{[\s\S]*?\})\);/);
assert(archiveGeometryMatch, "The live archive's standalone geometry must be available for parity checks.");
const archive = vm.createContext({});
vm.runInContext(`const geometry = ${archiveGeometryMatch[1]}; const canvasState = { elapsed: 0 };`, archive);
for (const name of ["spiralPoint", "orbitalAngle"]) {
  const implementation = archiveSource.match(new RegExp(`function ${name}\\([^]*?\\n  \\}`));
  assert(implementation, `The live archive must expose its ${name} calculation in source.`);
  vm.runInContext(implementation[0], archive);
}
const geometry = model.galaxyGeometry;
for (const [key, value] of Object.entries({ arms: 4, centerX: 0.5, centerY: 0.52, phase: -0.78, radiusX: 0.49, radiusY: 0.43, twist: 5.65 })) {
  assert.equal(geometry[key], value, `Navigation retains the actual Logs ${key}.`);
  assert.equal(geometry[key], vm.runInContext(`geometry.${key}`, archive), `Navigation and standalone Logs share ${key}.`);
}
for (const radius of [0, 0.1, 0.5, 0.95]) {
  assert(Number.isFinite(geometry.frequency(radius)) && geometry.frequency(radius) > 0, "The orbital frequency stays finite, including at the core.");
  const winding = geometry.angle(radius + 0.01, 0) - geometry.angle(radius, 0);
  const motion = geometry.angle(radius, 0, 0, 1) - geometry.angle(radius, 0);
  assert(winding * motion < 0, "The shared orbit opposes outward arm winding so the same arms trail during flight and at rest.");
  for (let arm = 0; arm < geometry.arms; arm += 1) {
    for (const jitter of [-0.13, 0, 0.09]) {
      for (const elapsed of [0, 10, 120]) {
        const liveAngle = vm.runInContext(`canvasState.elapsed = ${elapsed}; orbitalAngle({ radius: ${radius}, arm: ${arm}, angleJitter: ${jitter} })`, archive);
        assert(near(geometry.angle(radius, arm, jitter, elapsed), liveAngle, 1e-10), "The flight and archive retain identical arm phase and differential rotation at every sampled radius.");
      }
    }
  }
}
assert(geometry.frequency(0.1) > geometry.frequency(0.95), "Inner stars orbit faster than outer stars.");
for (const view of [viewport, { w: 390, h: 844 }]) {
  const focus = { x: view.w * 0.7, y: view.h * 0.52, r: view.w * 0.31, radiusX: view.w * 0.31, radiusY: view.h * 0.34 };
  const aspect = focus.radiusY / focus.radiusX;
  const camera = model.pageCamera(galaxy, focus, view);
  for (const radius of [0, 0.1, 0.5, 0.95]) {
    for (let arm = 0; arm < geometry.arms; arm += 1) {
      const angle = geometry.angle(radius, arm, 0.07);
      const point = model.galaxyWorldPoint(galaxy, radius, angle, aspect);
      const projected = model.projectPoint(camera, point, view);
      const live = vm.runInContext(`spiralPoint(${radius}, ${arm}, ${focus.x}, ${focus.y}, ${focus.radiusX}, ${focus.radiusY}, 0.07)`, archive);
      assert(projected.visible && near(projected.x, live.x) && near(projected.y, live.y), "The 3D disc lands at the live archive's arm positions for desktop and portrait field shapes.");
      assert.equal(point.z, galaxy.z, "The disc rests in the galaxy's world plane.");
    }
  }
  const turned = { ...camera, yaw: 0.6, pitch: 0.3 };
  const cardinals = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].map((angle) => model.projectPoint(turned, model.galaxyWorldPoint(galaxy, 0.8, angle, aspect), view));
  assert(cardinals.every((point) => point.visible && [point.x, point.y, point.depth].every(Number.isFinite)), "A tilted galaxy disc projects finite points through the observer.");
  assert(cardinals[0].depth > cardinals[2].depth && cardinals[1].depth > cardinals[3].depth, "Yaw and pitch give opposite sides of the galaxy different depths instead of rotating a flat sprite on screen.");
  const mid = model.projectPoint(camera, model.galaxyWorldPoint(galaxy, 0, 0, aspect), view);
  const raised = model.projectPoint(camera, model.galaxyWorldPoint(galaxy, 0, 0, aspect, 0.05), view);
  assert(raised.depth < mid.depth, "Galactic thickness extends toward the observer in positive world Z.");
}

const centeredFocus = { x: viewport.w / 2, y: viewport.h / 2, r: 230 };
const homeCamera = model.pageCamera(model.destinationForLocation("/").landmark, centeredFocus, viewport);
const projectedFromHome = (routePath) => model.projectPoint(homeCamera, model.destinationForLocation(routePath).landmark, viewport);
assert(projectedFromHome("/work.html").cameraY < 0, "Portfolio starts above the observer.");
assert(projectedFromHome("/contact.html").cameraY > 0, "Contact starts below the observer.");
assert(projectedFromHome("/blog/").cameraX > 0, "Logs start to the observer's side.");
const behind = projectedFromHome("/about.html");
assert(behind.depth < 0 && !behind.visible, "About is behind the observer and cannot be mirrored into the forward view.");
assert([behind.x, behind.y, behind.cameraX, behind.cameraY, behind.depth].every(Number.isFinite), "A hidden rear target still has a finite direction for the HUD.");
const rearFlight = model.planFlight(record("home", "about", { fromFocus: centeredFocus }), centeredFocus, viewport);
assert(rearFlight.turn.angle > Math.PI / 2, "A rear destination requires a real turn of more than 90 degrees.");
assert(Array.from({ length: 19 }, (_, index) => model.cameraAt(rearFlight, (index + 1) / 20)).some((camera) => Math.abs(camera.yaw) > 0.5), "The observer visibly turns during a journey to a rear destination.");

// A view direction can become vertical or face directly backward. Neither
// orientation may collapse the camera basis or create an infinite projection.
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI]) {
  for (const pitch of [-Math.PI / 2, 0, Math.PI / 2]) {
    const camera = { ...homeCamera, yaw, pitch };
    assertCameraFrame(camera, `yaw=${yaw}, pitch=${pitch}`);
    const frame = model.cameraFrame(camera);
    for (const distance of [-10, 0, 10]) {
      const point = { x: frame.eye.x + frame.forward.x * distance, y: frame.eye.y + frame.forward.y * distance, z: frame.eye.z + frame.forward.z * distance };
      const projected = model.projectPoint(camera, point, viewport);
      assert([projected.x, projected.y, projected.depth].every(Number.isFinite), "Near-plane and rear projections remain finite.");
      if (distance <= 0) assert.equal(projected.visible, false, "A point on or behind the eye cannot be visible.");
      else assert(near(projected.x, viewport.w / 2) && near(projected.y, viewport.h / 2), "The forward axis projects to the viewport center.");
    }
  }
}

// Exercise all public route pairs at both aspect ratios so page planes cannot
// silently cross the eye during a turn that the primary browser hop misses.
for (const view of [viewport, { w: 390, h: 844 }]) {
  const sourceFocus = { x: view.w * 0.7, y: view.h * 0.53, r: Math.min(view.w, view.h) * 0.26 };
  const targetFocus = { x: view.w * 0.58, y: view.h * 0.58, r: Math.min(view.w, view.h) * 0.23 };
  for (const from of routes) {
    for (const to of routes) {
      if (from === to) continue;
      const label = `${from.destination.key}->${to.destination.key} ${view.w}x${view.h}`;
      const plan = model.planFlight(record(from.destination.key, to.destination.key, { fromPath: from.path, toPath: to.path, viewport: view, fromFocus: sourceFocus }), targetFocus, view);
      assert(plan.duration >= 950 && plan.duration <= 1900, `${label}: keep navigation duration bounded.`);
      for (const progress of [0, 0.05, 0.1]) {
        assertIdentity(model.pageState(plan.start, model.cameraAt(plan, progress), plan.sourceFocus, view).matrix, `${label}: source remains at rest while dissolving at ${progress}`);
      }
      for (const progress of [0.82, 0.9, 1]) {
        assertIdentity(model.pageState(plan.end, model.cameraAt(plan, progress), plan.targetFocus, view).matrix, `${label}: destination remains at rest while appearing at ${progress}`);
      }
      const targetProjection = model.projectPoint(model.cameraAt(plan, 1), to.destination.landmark, view);
      assert(targetProjection.visible && near(targetProjection.x, targetFocus.x) && near(targetProjection.y, targetFocus.y), `${label}: the landmark lands under the measured hero.`);
      for (let sample = 0; sample <= 64; sample += 1) {
        const camera = model.cameraAt(plan, sample / 64);
        assertCameraFrame(camera, label);
        assertSafePage(model.pageState(plan.start, camera, plan.sourceFocus, view, { enclosing: plan.sourceEncloses }), view, `${label} source t=${sample / 64}`, plan.start, camera);
        assertSafePage(model.pageState(plan.end, camera, plan.targetFocus, view, { enclosing: plan.targetEncloses }), view, `${label} target t=${sample / 64}`, plan.end, camera);
      }
    }
  }
}

const measuredFocus = { x: 1020, y: 350, r: 275 };
for (const correctionTime of [0.55, 0.86]) {
  const corrected = model.planFlight(record("contact", "about"), null, viewport);
  const beforeCorrection = model.cameraAt(corrected, correctionTime);
  model.correctLanding(corrected, measuredFocus, correctionTime);
  const afterCorrection = model.cameraAt(corrected, correctionTime);
  for (const component of ["x", "y", "z", "w", "yaw", "pitch"]) {
    assert(near(beforeCorrection[component], afterCorrection[component]), `Focus measured at ${correctionTime} cannot jump the camera's ${component}.`);
  }
  const correctedCamera = model.cameraAt(corrected, 1);
  const measuredCamera = model.pageCamera(corrected.to.landmark, measuredFocus, viewport);
  assertIdentity(model.pageState(measuredCamera, correctedCamera, measuredFocus, viewport).matrix, `Focus measured at ${correctionTime} lands exactly in place`);
  for (let sample = 0; sample <= 24; sample += 1) {
    const camera = model.cameraAt(corrected, correctionTime + (1 - correctionTime) * sample / 24);
    assertSafePage(model.pageState(measuredCamera, camera, measuredFocus, viewport, { enclosing: corrected.targetEncloses }), viewport, `Focus measured at ${correctionTime}, correction t=${sample}`, measuredCamera, camera);
  }
}

console.log("Universe transition lifecycle passed: motion changes, retargeting, one-time departures, native reduced motion, restored-page cleanup, 3D directions, dimensional landmarks and clipped edges, hidden tilted pages, shared galaxy phase/projection, nested travel, and exact landing.");
