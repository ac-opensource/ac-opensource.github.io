const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(process.env.ABOUT_SOURCE || "assets/js/about-spectrograph.js", "utf8");
const rotation = source.slice(source.indexOf("  function noteCameraInteraction("), source.indexOf("  function syncTreeInteractionControl("));

function harness() {
  let now = 1000;
  let nextId = 1;
  let draws = 0;
  const frames = new Map();
  const timers = new Map();
  const scope = {
    motionPaused: false, reducedMotion: { matches: false }, document: { hidden: false },
    stageIsVisible: true, state: { bandId: null, projection: "fixed" }, sourcePanelOpen: false,
    cameraPointerActive: false, cameraInteractionUntil: 0, idleRotationTimestamp: 1000,
    idleRotationFrame: 0, idleRotationTimer: 0, idleRotationStarted: true,
    fixedViewPhase: 0, IDLE_ROTATION_SPEED: 0.000026, IDLE_ROTATION_DELAY: 250,
    zoomMotionScale: () => 1, root: { dataset: {} },
    window: {
      performance: { now: () => now },
      requestAnimationFrame(callback) { const id = nextId++; frames.set(id, callback); return id; },
      cancelAnimationFrame: (id) => frames.delete(id),
      setTimeout(callback, delay) { const id = nextId++; timers.set(id, { callback, at: now + delay }); return id; },
      clearTimeout: (id) => timers.delete(id)
    },
    drawTreeScene: () => draws++
  };
  vm.createContext(scope);
  vm.runInContext(rotation, scope);
  function advance(time) {
    now = time;
    for (const [id, timer] of [...timers]) {
      if (timer.at > now) continue;
      timers.delete(id);
      timer.callback();
    }
  }
  function frame(time) {
    advance(time);
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(time));
  }
  return { scope, frames, timers, advance, frame, get draws() { return draws; } };
}

for (const refreshRate of [60, 120, 144]) {
  const test = harness();
  const { scope, frames } = test;
  for (let frame = 1; frame <= refreshRate; frame++) {
    const time = 1000 + frame * 1000 / refreshRate;
    test.advance(time);
    frames.clear();
    scope.runIdleRotation(time);
  }
  assert.equal(test.draws, refreshRate, `${refreshRate} Hz must draw every display frame`);
  assert(Math.abs(scope.fixedViewPhase - 1000 * scope.IDLE_ROTATION_SPEED * 1.8) < 1e-10,
    "Rotation speed must remain independent of refresh rate");
  for (const [object, key, value] of [
    [scope, "motionPaused", true], [scope, "cameraPointerActive", true],
    [scope, "sourcePanelOpen", true], [scope, "stageIsVisible", false],
    [scope.document, "hidden", true], [scope.state, "bandId", "selected"],
    [scope.reducedMotion, "matches", true]
  ]) {
    const original = object[key];
    object[key] = value;
    test.frame(2100);
    assert.equal(test.draws, refreshRate, `${key} must suppress rendering`);
    assert.equal(frames.size, 0, `${key} must stop requesting idle frames`);
    assert.equal(test.timers.size, 0, `${key} must not poll with timers`);
    object[key] = original;
    scope.syncIdleRotation();
    assert.equal(frames.size, 1, `${key} release must restart exactly one frame loop`);
  }
}

const test = harness();
const { scope, frames, timers } = test;
scope.idleRotationStarted = false;
scope.syncIdleRotation();
assert.equal(frames.size + timers.size, 0, "Arrival must explicitly start idle rotation");
scope.startIdleRotation();
assert.equal(frames.size, 0, "Initial cooldown must not poll animation frames");
assert.equal(timers.size, 1);
test.frame(1349);
assert.equal(test.draws, 0);
test.frame(1350);
test.frame(1367);
assert.equal(test.draws, 1);

scope.noteCameraInteraction(60000);
assert.equal(frames.size, 0, "Hover hold must stop idle frames");
assert.equal(timers.size, 1);
test.advance(1400);
scope.noteCameraInteraction(250);
assert.equal(timers.size, 1, "Pointer leave replaces the long hold with one cooldown");
test.frame(1649);
assert.equal(test.draws, 1);
test.frame(1650);
test.frame(1667);
assert.equal(test.draws, 2, "Motion resumes after the existing 250 ms cooldown");
scope.syncIdleRotation();
scope.syncIdleRotation();
assert.equal(frames.size, 1, "Repeated lifecycle events cannot duplicate the frame loop");

scope.motionPaused = true;
scope.syncIdleRotation();
test.advance(100000);
assert.equal(frames.size + timers.size, 0);
const phase = scope.fixedViewPhase;
scope.motionPaused = false;
scope.syncIdleRotation();
test.frame(100016);
assert(Math.abs(scope.fixedViewPhase - phase - 16 * scope.IDLE_ROTATION_SPEED * 1.8) < 1e-10,
  "Resume must exclude time spent paused");

scope.noteCameraInteraction(250);
scope.document.hidden = true;
scope.syncIdleRotation();
assert.equal(frames.size + timers.size, 0, "Hidden pages cancel cooldowns as well as frames");
test.advance(100100);
scope.document.hidden = false;
scope.syncIdleRotation();
assert.equal(timers.size, 1, "Restoring visibility retains any remaining cooldown");
test.frame(100266);
test.frame(100283);
assert.equal(frames.size, 1);
scope.stopIdleRotation();
assert.equal(frames.size + timers.size, 0, "Page exit clears pending work");
scope.syncIdleRotation();
assert.equal(frames.size, 1, "Restoring the page resumes without another startup delay");

console.log("About frame pacing passed: 60/120/144 Hz, constant speed, inactive-loop cancellation, cooldowns and resume lifecycle.");
