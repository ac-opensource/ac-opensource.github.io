const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const controllerPath = process.argv[2] || path.join(__dirname, "../assets/js/universe-theme-transition.js");
const source = fs.readFileSync(controllerPath, "utf8");
const ARRIVAL_KEY = "ac.universe-perspective.v1";

function createPage({ crossDocument = false, reduced = false, rejectNavigation = false, arrival = null, loading = false } = {}) {
  const scheduled = new Map();
  const frames = new Map();
  const storage = new Map();
  if (arrival) storage.set(ARRIVAL_KEY, JSON.stringify(arrival));
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
  document.readyState = loading ? "loading" : "complete";
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
    window, document, navigations, storage,
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

  // The source page is covered first, so the document never changes while
  // the cover is still fading in: frames alone must not release navigation.
  const normal = createPage({ crossDocument });
  normal.click("/about.html");
  assert.equal(normal.snapshot().motion, "depart");
  assert.equal(normal.snapshot().transitionModel, "fade-through");
  const departure = JSON.parse(normal.storage.get(ARRIVAL_KEY)).departure;
  assert(departure >= 160 && departure <= 240, "The cover must stay a brief, single beat.");
  normal.frame();
  normal.frame();
  normal.advance(departure - 1);
  assert.equal(normal.navigations.length, 0, "Navigation must wait until the source page is fully covered.");
  normal.advance(1);
  assert.deepEqual(normal.navigations, ["https://example.test/about.html"], "Unchanged motion must preserve normal navigation.");
  normal.reduceMotion();
  assert.equal(normal.navigations.length, 1, "A completed departure must not replay on preference changes.");

  // A navigation that never commits must not leave the page under its cover.
  const stalled = createPage({ crossDocument });
  stalled.click("/about.html");
  stalled.advance(1000);
  assert.equal(stalled.snapshot().motion, "depart", "The cover holds while the destination loads.");
  stalled.advance(6000);
  assert.equal(stalled.snapshot().ready, "ready", "A stalled departure must hand the page back.");
  assert.equal(stalled.snapshot().motion, null);
  assert.equal(stalled.snapshot().pendingCleanup, 0);
  assert.equal(stalled.navigations.length, 1);

  const restored = createPage({ crossDocument });
  restored.click("/about.html");
  restored.window.dispatchEvent({ type: "pageshow", persisted: true });
  restored.frame();
  restored.frame();
  restored.advance(3000);
  assert.equal(restored.navigations.length, 0, "Restored pages must discard pending navigation callbacks.");
}

// Arrival: the destination stays covered until it is ready, reveals once, and
// settles only after both the reveal and any document transition finish.
function arrivalRecord() {
  const source = createPage();
  source.window.location = new URL("https://example.test/about.html");
  source.window.location.assign = () => {};
  source.click("/work.html");
  return JSON.parse(source.storage.get(ARRIVAL_KEY));
}

(async () => {
  for (const crossDocument of [false, true]) {
    const record = arrivalRecord();
    assert.equal(record.version, 9);
    assert.equal(record.transitionModel, "fade-through");
    assert.equal(record.destinationUrl, "/work.html");
    assert(Math.abs(record.nearX) > Math.abs(record.middleX) && Math.abs(record.middleX) > Math.abs(record.farX),
      "Nearer star planes must travel further than distant ones.");
    assert(Math.abs(record.nearX) <= 12 && Math.abs(record.nearY) <= 12,
      "Parallax must stay inside the planes' overscan.");

    const arriving = createPage({ crossDocument, arrival: record });
    const root = arriving.document.documentElement;
    assert.equal(arriving.snapshot().motion, "arrive");
    assert.equal(arriving.snapshot().phase, "cover", "The destination's first frame must be covered.");
    assert.equal(arriving.storage.has(ARRIVAL_KEY), false, "The arrival payload is consumed once.");

    let finishTransition = () => {};
    if (crossDocument) {
      const finished = new Promise((resolve) => { finishTransition = resolve; });
      arriving.window.dispatchEvent({ type: "pagereveal", viewTransition: { finished, skipTransition() {} } });
    }
    arriving.frame();
    arriving.frame();
    assert.equal(arriving.snapshot().phase, "cover", "The reveal waits for two frames that arrive on time.");
    arriving.frame();
    assert.equal(arriving.snapshot().phase, "reveal");
    let settled = 0;
    arriving.document.addEventListener("universe-perspective:settled", () => { settled += 1; });
    arriving.advance(record.duration + 79);
    assert.equal(arriving.snapshot().motion, "arrive", "The reveal must run its full length.");
    arriving.advance(1);
    if (crossDocument) {
      assert.equal(arriving.snapshot().motion, "arrive", "An unfinished document transition keeps the travel state alive.");
      finishTransition();
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(arriving.snapshot().ready, "ready");
    assert.equal(arriving.snapshot().motion, null);
    assert.equal(arriving.snapshot().phase, null);
    assert.equal(arriving.snapshot().pendingCleanup, 0);
    assert.equal(root.dataset.universeSky, undefined);
    assert.equal(settled, 1, "Arrival settles exactly once.");

    // A slow parse cannot hold the cover forever.
    const slow = createPage({ crossDocument, arrival: record, loading: true });
    assert.equal(slow.snapshot().phase, "cover");
    slow.frame();
    slow.frame();
    slow.frame();
    slow.advance(1199);
    assert.equal(slow.snapshot().phase, "cover", "An unparsed destination stays covered.");
    slow.advance(1);
    slow.frame();
    slow.frame();
    slow.frame();
    assert.equal(slow.snapshot().phase, "reveal");

    // Neither can a renderer that is too starved to deliver frames.
    const starved = createPage({ crossDocument, arrival: record });
    starved.advance(459);
    assert.equal(starved.snapshot().phase, "cover");
    starved.advance(1);
    assert.equal(starved.snapshot().phase, "reveal", "The reveal must not depend on frames arriving.");

    // Retargeting mid-arrival covers the page again and leaves for the new target.
    const retargetArrival = createPage({ crossDocument, arrival: record });
    retargetArrival.frame();
    retargetArrival.frame();
    retargetArrival.frame();
    assert.equal(retargetArrival.snapshot().phase, "reveal");
    assert(retargetArrival.click("/blog/").defaultPrevented);
    assert.equal(retargetArrival.snapshot().motion, "depart");
    assert.equal(retargetArrival.snapshot().phase, null);
    retargetArrival.advance(3000);
    assert.deepEqual(retargetArrival.navigations, ["https://example.test/blog/"]);

    // An outdated payload is ignored: the page loads plainly.
    const outdated = createPage({ crossDocument, arrival: { ...record, version: 8 } });
    assert.equal(outdated.snapshot().motion, null);
    assert.equal(outdated.snapshot().ready, "ready");
  }

  const reducedArrival = createPage({ reduced: true, arrival: arrivalRecord() });
  assert.equal(reducedArrival.snapshot().motion, null, "Reduced motion never covers the destination.");

  console.log("Universe arrival lifecycle passed: covered first frame, single reveal, joint settlement, capped wait, retargeting and stale payloads.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

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

console.log("Universe transition lifecycle passed: motion changes, retargeting, one-time departures, native reduced motion, and restored-page cleanup.");
