const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "assets/js/article-aurora.js"), "utf8");
const baselineIndex = process.argv.indexOf("--baseline");
const baseline = baselineIndex >= 0
  ? fs.readFileSync(process.argv[baselineIndex + 1], "utf8") : null;

function createHarness(script, { width = 1440, height = 900, reduced = false, hidden = false } = {}) {
  let hash;
  let commands;
  let sinCalls;
  let gradients;
  let nextFrame = 1;
  let now = 0;
  const frames = new Map();
  const events = new Map();
  const preferenceEvents = new Map();
  const buttonEvents = new Map();
  const record = (...command) => {
    commands += 1;
    hash.update(JSON.stringify(command)).update("\n");
  };
  const reset = () => {
    hash = crypto.createHash("sha256");
    commands = sinCalls = gradients = 0;
  };
  const result = () => ({ digest: hash.digest("hex"), commands, sinCalls, gradients });
  const capture = (callback) => {
    reset();
    callback();
    return result();
  };
  const makeCanvas = (name) => {
    const context = new Proxy({}, {
      get(_target, property) {
        if (property === "createLinearGradient") return (...args) => {
          const gradient = { gradient: gradients++ };
          record(name, property, ...args, gradient);
          return {
            ...gradient,
            addColorStop: (...stop) => record(name, "addColorStop", gradient, ...stop)
          };
        };
        return (...args) => record(name, property, ...args);
      },
      set(_target, property, value) {
        record(name, "set", property, value);
        return true;
      }
    });
    return {
      toJSON: () => ({ canvas: name }),
      getContext: () => context,
      set width(value) { record(name, "width", value); },
      set height(value) { record(name, "height", value); }
    };
  };
  const canvas = makeCanvas("screen");
  const curtain = makeCanvas("curtain");
  const button = {
    addEventListener: (type, handler) => buttonEvents.set(type, handler),
    setAttribute(name, value) { this[name] = value; }
  };
  const preference = {
    matches: reduced,
    addEventListener: (type, handler) => preferenceEvents.set(type, handler)
  };
  const math = Object.create(Math);
  math.sin = (value) => { sinCalls += 1; return Math.sin(value); };
  const scope = {
    Math: math,
    innerWidth: width,
    innerHeight: height,
    document: {
      hidden,
      querySelector: (selector) => selector === ".article-aurora" ? canvas : button,
      createElement: () => curtain,
      addEventListener: (type, handler) => events.set(type, handler)
    },
    matchMedia: () => preference,
    addEventListener: (type, handler) => events.set(type, handler),
    performance: { now: () => now },
    requestAnimationFrame: (callback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id)
  };
  const initial = capture(() => vm.runInNewContext(script, scope));
  return {
    initial,
    button,
    get pendingFrames() { return frames.size; },
    frame(timestamp) {
      return capture(() => {
        now = timestamp;
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback(timestamp));
      });
    },
    pause: () => capture(() => buttonEvents.get("click")()),
    resize(nextWidth, nextHeight) {
      return capture(() => {
        scope.innerWidth = nextWidth;
        scope.innerHeight = nextHeight;
        events.get("resize")();
      });
    },
    reduce(value) {
      return capture(() => {
        preference.matches = value;
        preferenceEvents.get("change")();
      });
    },
    hide(value) {
      return capture(() => {
        scope.document.hidden = value;
        events.get("visibilitychange")();
      });
    }
  };
}

function exercise(script) {
  const renderer = createHarness(script);
  const captures = { initial: renderer.initial };
  assert.equal(renderer.pendingFrames, 1);
  for (const timestamp of [16, 49, 50, 100]) {
    captures[`frame${timestamp}`] = renderer.frame(timestamp);
    assert.equal(renderer.pendingFrames, 1);
  }
  assert.equal(captures.frame16.commands, 0, "The 50 ms drawing cadence must remain unchanged");
  assert.equal(captures.frame49.commands, 0);
  assert.equal(captures.frame50.gradients, 3842, "Keep both full-density aurora layers");
  captures.paused = renderer.pause();
  assert.equal(renderer.pendingFrames, 0);
  assert.equal(renderer.button["aria-pressed"], "true");
  assert.equal(renderer.button.textContent, "Resume aurora");
  assert.equal(captures.paused.digest, captures.frame100.digest, "Pausing must keep the current visual frame");
  captures.pausedHidden = renderer.hide(true);
  captures.pausedVisible = renderer.hide(false);
  assert.equal(renderer.pendingFrames, 0, "Visibility changes must preserve manual pause");
  captures.resumed = renderer.pause();
  assert.equal(renderer.pendingFrames, 1);
  assert.equal(renderer.button["aria-pressed"], "false");
  assert.equal(renderer.button.textContent, "Pause aurora");
  captures.frame150 = renderer.frame(150);
  captures.reduced = renderer.reduce(true);
  assert.equal(renderer.pendingFrames, 0);
  captures.hidden = renderer.hide(true);
  captures.mobile = renderer.resize(390, 844);
  captures.mobileAgain = renderer.resize(390, 844);
  assert.equal(captures.mobile.digest, captures.mobileAgain.digest);
  assert.equal(captures.mobile.gradients, 1042);
  captures.wide = renderer.resize(1920, 1080);
  assert.equal(captures.wide.gradients, 3842, "Retain the existing 1440 px rendering cap");
  captures.mobileRestored = renderer.resize(390, 844);
  assert.equal(captures.mobileRestored.digest, captures.mobile.digest, "Resizing away and back must rebuild the same rays");
  assert.equal(renderer.pendingFrames, 0);
  captures.hiddenMotionAllowed = renderer.reduce(false);
  assert.equal(renderer.pendingFrames, 0, "A hidden page must not restart animation");
  captures.visible = renderer.hide(false);
  assert.equal(renderer.pendingFrames, 1);
  captures.longFrame = renderer.frame(1000);
  for (const options of [{ reduced: true }, { hidden: true }]) {
    const inactive = createHarness(script, options);
    captures[options.reduced ? "initialReduced" : "initialHidden"] = inactive.initial;
    assert.equal(inactive.pendingFrames, 0);
  }
  return captures;
}

const captures = exercise(source);
assert.ok(captures.frame50.sinCalls < 105000, "A desktop frame must reuse static ray and star calculations");
assert.equal(captures.frame50.sinCalls, captures.frame100.sinCalls);
if (baseline) {
  const original = exercise(baseline);
  for (const [name, capture] of Object.entries(captures)) {
    assert.equal(capture.digest, original[name].digest, `${name}: every canvas command must match the original renderer exactly`);
    assert.equal(capture.commands, original[name].commands);
  }
  const before = original.frame50.sinCalls;
  const after = captures.frame50.sinCalls;
  console.log(`Compared ${Object.keys(captures).length} exact canvas command streams with baseline. Desktop frame sine calls: ${before} -> ${after} (${((before - after) / before * 100).toFixed(1)}% fewer).`);
}
console.log("Article aurora passed: rendering density, resize invalidation, 50 ms pacing, pause/resume, reduced motion, visibility and cached calculation budget.");
