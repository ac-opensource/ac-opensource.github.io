const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/experiments/universe-options/logs/spiral-galaxy-archive.js', 'utf8');
const animation = source.slice(source.indexOf('  function animateGalaxy('), source.indexOf('  function stopGalaxy('));
const easing = source.match(/const easing = ([^;]+);/)[1];
for (const hz of [60, 120, 144]) {
  let frames = 0, scheduled = 0;
  const scope = { canvasState: { intersectsViewport: true, paused: false, merger: {}, animationFrame: 0 },
    document: { hidden: false }, reducedMotion: { matches: false },
    drawGalaxy: () => frames++, window: { requestAnimationFrame: () => ++scheduled }, delta: 1 / hz };
  vm.createContext(scope);
  vm.runInContext(animation, scope);
  let remaining = 1;
  for (let frame = 1; frame <= hz; frame++) {
    scope.animateGalaxy(frame * 1000 / hz);
    remaining *= 1 - vm.runInContext(easing, scope);
  }
  assert.equal(frames, hz);
  assert.equal(scheduled, hz);
  assert(Math.abs(remaining - Math.pow(0.925, 30)) < 1e-10, 'Parallax easing must preserve its one-second response at every refresh rate');
  for (const [object, key, value] of [[scope.document, 'hidden', true], [scope.reducedMotion, 'matches', true],
    [scope.canvasState, 'paused', true], [scope.canvasState, 'intersectsViewport', false]]) {
    const original = object[key]; object[key] = value;
    scope.animateGalaxy(2000); assert.equal(frames, hz); assert.equal(scheduled, hz);
    object[key] = original;
  }
  scope.canvasState.merger = { encounter: {}, progress: 1 };
  scope.animateGalaxy(2000); assert.equal(frames, hz); assert.equal(scheduled, hz);
}
console.log('Blog frame pacing passed: 60/120/144 Hz, time-based parallax, pause/hidden/offscreen/reduced-motion/settled-encounter guards.');
