const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { Encounter } = require("../assets/js/galaxy-dynamics");

// Exercise the renderer's actual angle calculation without a browser clock.
const source = fs.readFileSync(process.argv[2] || require.resolve("../assets/experiments/universe-options/logs/spiral-galaxy-archive.js"), "utf8");
const geometry = source.match(/const geometry = Object.freeze\((\{[\s\S]*?\})\);/)[1];
const orbitalAngle = source.match(/function orbitalAngle\([^]*?\n  \}/)[0];
const context = vm.createContext({});
vm.runInContext(`const geometry = ${geometry}; const canvasState = { elapsed: 0 }; ${orbitalAngle}`, context);
for (const companion of [false, true]) {
  for (const radius of [0.1, 0.5, 0.95]) {
    const angle = (r, elapsed) => vm.runInContext(`canvasState.elapsed = ${elapsed}; orbitalAngle({arm: 0, radius: ${r}, angleJitter: 0}, ${companion})`, context);
    const winding = angle(radius + 0.01, 0) - angle(radius, 0);
    const motion = angle(radius, 1) - angle(radius, 0);
    assert(winding * motion < 0, "Orbital motion must oppose outward arm winding so arms trail");
    const model = new Encounter([{ radius, angle: angle(radius, 0), spin: -1 }], []);
    const star = model.particles[0];
    const core = model.cores[0];
    const angularMomentum = (star.x - core.x) * (star.vy - core.vy)
      - (star.y - core.y) * (star.vx - core.vx);
    assert(angularMomentum * motion > 0, "Encounter must retain the archive's orbital direction");
  }
}
console.log("Galaxy rotation passed: trailing arms and consistent encounter spin at inner, middle, and outer radii.");
