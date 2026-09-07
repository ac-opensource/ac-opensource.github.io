const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { Encounter, acceleration, step } = require("../assets/js/galaxy-dynamics");

// Fixed sampling exercises both inner disk and loosely bound outer stars.
function seeds(count) {
  return Array.from({ length: count }, (_, index) => ({
    radius: 0.12 + 0.88 * Math.sqrt((index + 0.5) / count),
    angle: index * Math.PI * (3 - Math.sqrt(5))
  }));
}
function encounter(count = 120) {
  return new Encounter(seeds(count), seeds(count));
}
function advanceFor(model, seconds, fps) {
  for (let frame = 0; frame < seconds * fps; frame += 1) model.advance(1 / fps);
}
function quantileRadius(model, fraction) {
  const radii = model.particles.map((star) => Math.hypot(star.x, star.y, star.z)).sort((a, b) => a - b);
  return radii[Math.floor(fraction * radii.length)];
}
function near(actual, expected, tolerance, label) {
  assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
}

const stationary = encounter();
const initial = JSON.stringify(stationary);
for (const delta of [0, -1, NaN, Infinity, -Infinity]) stationary.advance(delta);
assert.equal(JSON.stringify(stationary), initial, "Invalid or non-positive frame time must leave the state unchanged");
stationary.advance(1000);
near(stationary.time, 0.1, 1e-12, "Suspended-tab catchup limit");
assert(stationary.accumulator < step, "Catchup must not leave a backlog of suspended time");

const core = { x: 0, y: 0, z: 0, mass: 1 };
assert.deepEqual(acceleration(0, 0, 0, [core]), [0, 0, 0], "Softening must regularize the center");
const radius = 0.5;
const force = acceleration(radius, 0, 0, [core]);
const circular = new Encounter([{ radius: radius / 0.9, angle: 0 }], []);
const star = circular.particles[0];
const velocitySquared = (star.vx - circular.cores[0].vx) ** 2
  + (star.vy - circular.cores[0].vy) ** 2 + star.vz ** 2;
near(velocitySquared / radius, -force[0], 1e-12, "Seed circular speed must balance the softened radial force");
assert(force[0] < 0 && force[1] === 0 && force[2] === 0, "An isolated core must attract radially");

const model = encounter();
const initialOuter = quantileRadius(model, 0.9);
let minimumSeparation = model.separation;
for (let frame = 0; frame < 12 * 60; frame += 1) {
  model.advance(1 / 60);
  minimumSeparation = Math.min(minimumSeparation, model.separation);
  for (const body of [...model.cores, ...model.particles]) {
    for (const key of ["x", "y", "z", "vx", "vy", "vz"]) {
      assert(Number.isFinite(body[key]), `Encounter produced non-finite ${key}`);
    }
  }
  for (const key of ["x", "y", "z", "vx", "vy", "vz"]) {
    near(model.cores[0][key] + model.cores[1][key], 0, 1e-10, `Core pair must preserve symmetric ${key}`);
  }
}
assert(minimumSeparation < 0.5, "Cores must make a close encounter");
assert(model.separation < 0.2, "Cores must coalesce by 12 seconds");
const finalOuter = quantileRadius(model, 0.9);
assert(finalOuter > initialOuter * 1.4, "Encounter must redistribute outer stars into extended tidal material");
assert(quantileRadius(model, 0.5) < 1.8, "Encounter must retain a compact stellar population");
// Cross a fixed-step boundary so decimal accumulation cannot obscure the terminal phase.
model.advance(step);
assert.equal(model.phase, "remnant");

const slowFrames = encounter();
const fastFrames = encounter();
advanceFor(slowFrames, 12, 24);
advanceFor(fastFrames, 12, 60);
assert.deepEqual(slowFrames.cores, fastFrames.cores, "Core physics must be independent of rendering frame rate");
assert.deepEqual(slowFrames.particles, fastFrames.particles, "Star physics must be independent of rendering frame rate");
near(slowFrames.time, fastFrames.time, 1e-12, "Equivalent simulation duration");

const benchmark = encounter(600);
const started = performance.now();
advanceFor(benchmark, 12, 60);
const elapsed = performance.now() - started;
console.log(`Galaxy dynamics passed: closest cores ${minimumSeparation.toFixed(3)}, final cores ${fastFrames.separation.toFixed(3)}, outer radius ${initialOuter.toFixed(2)} -> ${finalOuter.toFixed(2)}; 1200 stars / 12 simulated seconds in ${elapsed.toFixed(1)}ms (${(elapsed / 720).toFixed(2)}ms per 60Hz frame).`);
