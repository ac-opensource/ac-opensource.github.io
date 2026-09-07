#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../assets/experiments/universe-options/logs/spiral-galaxy-archive.js"), "utf8");
const rendererSource = source.slice(source.indexOf("  function createGpuRenderer()"), source.indexOf("  function buildNucleusSprite()"));
assert(rendererSource.includes("function createGpuRenderer"), "Renderer source must exist");

function fixture(failure) {
  const calls = [], enabled = new Set(), pointers = new Map(), uniforms = new Map();
  let bound, nextBuffer = 0, redraws = 0;
  const gl = new Proxy({
    createBuffer: () => ({ id: ++nextBuffer }),
    bindBuffer: (_target, buffer) => { bound = buffer; },
    bufferData: (_target, data, usage) => calls.push({ type: "upload", buffer: bound, usage, data: typeof data === "number" ? data : Array.from(data) }),
    bufferSubData: (_target, _offset, data) => calls.push({ type: "dynamic", buffer: bound, data: Array.from(data) }),
    getAttribLocation: (_program, name) => name,
    getUniformLocation: (_program, name) => name,
    enableVertexAttribArray: (name) => enabled.add(name),
    disableVertexAttribArray: (name) => enabled.delete(name),
    vertexAttribPointer: (name, size, _type, _normalized, stride, offset) => pointers.set(name, { size, stride, offset, buffer: bound }),
    uniform1f: (name, value) => uniforms.set(name, value),
    uniform2f: (name, ...value) => uniforms.set(name, value),
    uniform4f: (name, ...value) => uniforms.set(name, value),
    drawArrays: (_mode, _first, count) => calls.push({ type: "draw", count, buffer: bound, enabled: new Set(enabled), pointers: new Map(pointers), uniforms: new Map(uniforms) }),
    getShaderParameter: () => failure !== "compile",
    getProgramParameter: () => failure !== "link",
    createShader: () => ({}), createProgram: () => ({}), createTexture: () => ({}),
  }, { get: (target, name) => name in target ? target[name] : /^[A-Z_0-9]+$/.test(name) ? name : () => {} });
  const canvases = [];
  const document = { createElement: () => {
    const canvas = { width: 300, height: 150, listeners: {}, removed: false,
      getContext: (kind) => {
        if (kind !== "webgl") return new Proxy({}, { get: () => () => {} });
        if (failure === "create") throw new Error("Context unavailable");
        return failure === "unavailable" ? null : gl;
      },
      setAttribute() {}, addEventListener(name, callback) { this.listeners[name] = callback; },
      remove() { this.removed = true; }
    };
    canvases.push(canvas); return canvas;
  } };
  const particle = { spriteIndex: 0, spriteSize: 15, alpha: 0.8, fade: 0.9,
    arm: 1, radius: 0.5, radialJitter: 0.01, angleJitter: 0.03, frequency: 2, phase: 0.2 };
  const canvasState = { width: 1440, height: 900, elapsed: 1, budget: { tier: "wide" },
    starSprites: [[{}, {}, {}], [{}, {}, {}], [{}, {}, {}]], nucleusSprite: {},
    stars: [{ radius: 1, alpha: 0.5, phase: 0.2, x: 0.3, y: 0.4 }],
    particles: [{ ...particle }], remnantParticles: [{ ...particle, arm: 0 }] };
  const elements = { canvas: { width: 1800, height: 1125, after() {} }, hero: { dataset: {} } };
  const context = { document, canvasState, elements, geometry: { arms: 4, twist: 6, phase: 0.5 },
    reducedMotion: { matches: false }, drawGalaxyIfVisible: () => { redraws++; } };
  vm.createContext(context);
  const renderer = vm.runInContext(`${rendererSource}\ncreateGpuRenderer()`, context);
  return { renderer, calls, canvasState, elements, canvases, redraws: () => redraws };
}
const f = fixture();
assert(f.renderer);
const uploads = () => f.calls.filter(call => call.type === "upload" && call.usage === "STATIC_DRAW");
const orbitFrame = (companion = false) => { f.renderer.begin(); f.renderer.orbit(companion, 700, 450, 500, 300); f.renderer.flush(); };
orbitFrame();
assert.equal(uploads().length, 1);
assert.equal(f.calls.filter(call => call.type === "draw").length, 1, "Orbit must submit one draw including background and nucleus");
assert.equal(uploads()[0].data.length, 4 * 6 * 12);
f.canvasState.elapsed = 2;
orbitFrame();
assert.equal(uploads().length, 1, "Advancing time must reuse the static buffer");
assert.equal(f.calls.at(-1).uniforms.get("elapsed"), 2);
f.canvasState.width++;
f.elements.canvas.width++;
orbitFrame();
assert.equal(uploads().length, 2, "Resize invalidates geometry");
orbitFrame(true);
assert.equal(uploads().length, 3, "Switching remnant invalidates geometry");
assert.equal(f.calls.at(-1).uniforms.get("field")[3], 234);

f.renderer.begin();
f.renderer.sprite(0, 100, 100, 20, 0.8);
f.renderer.sprite(1, 200, 200, 20, 0.5);
f.renderer.sprite(0, -100, -100, 20, 1);
f.renderer.flush();
let draw = f.calls.at(-1);
assert.equal(draw.count, 12, "Encounter sprites batch into one draw and offscreen sprites are culled");
assert.equal(draw.uniforms.get("orbital"), 0);
assert(!draw.enabled.has("orbit") && !draw.enabled.has("anchor"), "Dynamic mode disables stale static attributes");
for (const name of ["position", "uv", "opacity"]) {
  assert.equal(draw.pointers.get(name).stride, 20);
  assert.equal(draw.pointers.get(name).buffer, draw.buffer);
}
f.renderer.begin(); f.renderer.sprite(0, 100, 100, 20, 1); f.renderer.flush();
assert.equal(f.calls.at(-1).count, 6, "Dynamic frame resets sprite count");
orbitFrame();
assert(f.calls.at(-1).enabled.has("orbit"), "Return to orbit re-enables orbital attributes");

let prevented = false;
f.canvasState.gpu = f.renderer;
f.canvases[0].listeners.webglcontextlost({ preventDefault() { prevented = true; } });
assert(prevented && f.canvases[0].removed);
assert.equal(f.canvasState.gpu, null);
assert.equal(f.elements.hero.dataset.galaxyRenderer, "canvas");
assert.equal(f.redraws(), 1, "Context loss redraws even without an animation callback");
for (const failure of ["create", "unavailable", "compile", "link"]) assert.equal(fixture(failure).renderer, null, `${failure} must fall back`);

const budgetSource = source.slice(source.indexOf("  function performanceBudgetFor("), source.indexOf("  function buildCanvasScene("));
const budgetFor = vm.runInNewContext(`${budgetSource}\nperformanceBudgetFor`);
for (const width of [320, 480, 600, 1000, 1440, 2560]) {
  const budget = budgetFor(width);
  assert(budget.stars + budget.particles + budget.companion + 4 <= 1600, `Encounter buffer capacity at ${width}`);
}
console.log("Galaxy GPU regression passed: static reuse/invalidation, dynamic batching, mode transitions, context loss, initialization fallback, and budget capacity.");
