const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('assets/js/about-spectrograph.js', 'utf8');
const rotation = source.slice(source.indexOf('  function runIdleRotation('), source.indexOf('  function startIdleRotation('));
for (const refreshRate of [60, 120, 144]) {
  let frames = 0;
  const scope = {
    motionPaused: false, reducedMotion: { matches: false }, document: { hidden: false },
    stageIsVisible: true, state: { bandId: null, projection: 'fixed' }, sourcePanelOpen: false,
    cameraPointerActive: false, cameraInteractionUntil: 0, idleRotationTimestamp: 1000,
    idleRotationFrame: 0, fixedViewPhase: 0, IDLE_ROTATION_SPEED: 0.000026,
    zoomMotionScale: () => 1, root: { dataset: {} },
    window: { requestAnimationFrame: () => 1 }, drawTreeScene: () => frames++
  };
  vm.createContext(scope);
  vm.runInContext(rotation, scope);
  for (let frame = 1; frame <= refreshRate; frame++) scope.runIdleRotation(1000 + frame * 1000 / refreshRate);
  assert.equal(frames, refreshRate, `${refreshRate} Hz must draw every display frame`);
  assert(Math.abs(scope.fixedViewPhase - 1000 * scope.IDLE_ROTATION_SPEED * 1.8) < 1e-10, 'Rotation speed must remain independent of refresh rate');
  for (const guard of ['motionPaused', 'cameraPointerActive', 'sourcePanelOpen']) {
    scope[guard] = true;
    scope.runIdleRotation(2100);
    assert.equal(frames, refreshRate, `${guard} must suppress rendering`);
    scope[guard] = false;
  }
  scope.reducedMotion.matches = true;
  scope.runIdleRotation(2200);
  assert.equal(frames, refreshRate);
  assert.equal(scope.idleRotationFrame, 0);
}
console.log('About frame pacing passed: every frame at 60/120/144 Hz, constant rotation speed, and pause guards.');
