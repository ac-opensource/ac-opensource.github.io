const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const controllerPath = process.argv[2] || path.join(__dirname, "../assets/js/universe-theme-transition.js");
const source = fs.readFileSync(controllerPath, "utf8");
const ARRIVAL_KEY = "ac.universe-perspective.v1";

function createPage({ crossDocument = false, reduced = false, rejectNavigation = false } = {}) {
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
  window.location = new URL("https://example.test/work.html");
  window.location.assign = (href) => {
    navigations.push(href);
    if (rejectNavigation) throw new Error("Navigation rejected");
  };
  window.matchMedia = () => media;
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

// The flight model is pure: every route is a camera over one shared world.
const model = createPage().window.UniversePerspective.model;
const viewport = { w: 1280, h: 800 };
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
for (const [from, to] of [
  [{ x: 0, y: 0, w: 4 }, { x: 18, y: 8, w: 24 }],
  [{ x: 18, y: 8, w: 24 }, { x: 15, y: 9, w: 0.7 }],
  [{ x: 1, y: 1, w: 2 }, { x: 1, y: 1, w: 8 }],
]) {
  const path = model.zoomPath(from, to);
  const start = path.at(0);
  const end = path.at(1);
  assert(near(start.x, from.x) && near(start.y, from.y) && near(start.w, from.w), "A zoom path starts at its origin view.");
  assert(near(end.x, to.x, 1e-5) && near(end.y, to.y, 1e-5) && near(end.w, to.w, 1e-5), "A zoom path ends at its destination view.");
}

const record = (from, to, extra = {}) => ({
  from, to, fromPath: extra.fromPath || "/", toPath: extra.toPath || "/",
  fromSurface: "light", toSurface: "light", viewport,
  fromFocus: { x: 900, y: 420, r: 230 }, toFocus: { x: 640, y: 432, r: 192 },
});
const farHop = model.planFlight(record("home", "logs"), { x: 820, y: 430, r: 340 }, viewport);
assert(farHop.duration >= 950 && farHop.duration <= 1600, `Flight duration must stay navigable: ${farHop.duration}`);
assert(farHop.peak > Math.max(farHop.start.w, farHop.end.w), "A hop between distant objects rises above both.");
assert(!farHop.sourceEncloses && !farHop.targetEncloses);
const startCamera = model.cameraAt(farHop, 0);
const endCamera = model.cameraAt(farHop, 1);
assert(near(startCamera.w, farHop.start.w) && near(endCamera.w, farHop.end.w, 1e-5), "The camera starts and ends on the two pages.");
const landed = model.pageState(farHop.end, endCamera, farHop.targetFocus, viewport, { enclosing: farHop.targetEncloses });
assert(near(landed.scale, 1, 1e-5) && Math.abs(landed.x) < 0.01 && Math.abs(landed.y) < 0.01, "The destination lands in place.");
assert.equal(landed.opacity, 1);
assert.equal(landed.feather, 0);
const departing = model.pageState(farHop.start, model.cameraAt(farHop, 0.5), farHop.sourceFocus, viewport, { enclosing: false });
assert(departing.opacity < 0.05, "By mid-flight the departing page has collapsed into its landmark.");

const article = model.destinationForLocation("/blog/2026-04-30-agents-that-leave-receipts.html");
const galaxy = model.destinationForLocation("/blog/").landmark;
assert.equal(article.key, "article");
assert(Math.hypot(article.landmark.x - galaxy.x, article.landmark.y - galaxy.y) < galaxy.r, "Log entries are stars inside the archive galaxy.");
const dive = model.planFlight(record("logs", "article", { toPath: "/blog/2026-04-30-agents-that-leave-receipts.html" }), { x: 990, y: 480, r: 228 }, viewport);
assert(dive.sourceEncloses, "Opening an entry dives into the galaxy instead of flying over it.");
assert(model.pageOpacity(2, false) === 0 && model.pageOpacity(2, true) > 0, "Only nested pages are visible larger than the view.");

console.log("Universe transition lifecycle passed: motion changes, retargeting, one-time departures, native reduced motion, and restored-page cleanup, and the camera flight model.");
