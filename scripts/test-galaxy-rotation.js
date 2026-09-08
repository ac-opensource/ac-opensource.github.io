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

for (const name of ["spiralPoint", "orbitalOffset", "nodePosition"]) {
  const implementation = source.match(new RegExp(`function ${name}\\([^]*?\\n  \\}`));
  if (implementation) vm.runInContext(implementation[0], context);
}
for (let index = 0; index < 28; index += 1) {
  for (const elapsed of [0, 10, 120]) {
    const result = vm.runInContext(`canvasState.elapsed = ${elapsed}; (() => {
      const node = nodePosition(${index}, 28);
      const angle = orbitalAngle({ arm: node.arm, radius: node.progress, angleJitter: 0 });
      return { node, angle, x: 50 + Math.cos(angle) * node.progress * 49,
        y: 52 + Math.sin(angle) * node.progress * 43 };
    })()`, context);
    assert(Math.abs(result.node.angle - result.angle) < 1e-10, "Nodes must share the stars' orbital angle and clock");
    assert(Math.abs(result.node.x - Math.max(6, Math.min(94, result.x))) < 1e-10);
    assert(Math.abs(result.node.y - Math.max(6, Math.min(94, result.y))) < 1e-10);
  }
}
console.log("All 28 article nodes follow their stellar orbit at initial, intermediate, and long-running times.");
