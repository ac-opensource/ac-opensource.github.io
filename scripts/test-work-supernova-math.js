const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../assets/js/work-supernova-field.js'), 'utf8');
const entryBody = source.match(/const entryReady = \(\) => \{([\s\S]*?)\n  \};/);
assert(entryBody, 'Locate the actual navigation gate');
const entryReady = new Function('document', entryBody[1]);
for (const motion of [undefined, 'arrive']) {
  assert(entryReady({ documentElement: { dataset: { universeMotion: motion } } }),
    'The supernova must begin immediately on direct load and during navigation arrival');
}
assert(!entryReady({ documentElement: { dataset: { universeMotion: 'depart' } } }));
for (const bigBang of ['pending', 'running', 'revealing']) {
  assert(!entryReady({ documentElement: { dataset: { bigBang, universeMotion: 'arrive' } } }));
}
const renderBody = source.match(/const render = \(\) => \{([\s\S]*?)\n  \};\n  const tick/);
assert(renderBody, 'Locate the actual render function to exercise the uploaded pulse uniforms');
const render = new Function('gl', 'uniforms', 'elapsed', 'pulseStart', 'field', 'pointerX', 'pointerY', renderBody[1]);

// Independent reference: the original shader's collapse, expansion, settle,
// impact and tension equations before they moved from GLSL into JS.
const clamp = value => Math.min(1, Math.max(0, value));
const mix = (a, b, weight) => a * (1 - weight) + b * weight;
const smoothstep = value => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
const originalPulse = sequence => {
  const collapse = clamp(sequence / 3);
  const blast = clamp((sequence - 3) / .7);
  const settle = clamp((sequence - 3.7) / 2.3);
  const compression = 1 - Math.pow(collapse, 2.3) * .955;
  const expansion = mix(.045, 1.27, 1 - Math.pow(1 - blast, 4));
  return [
    sequence < 3 ? compression : mix(expansion, 1, smoothstep(settle)),
    sequence < 3 ? 0 : Math.exp(-(sequence - 3) * 2.1),
    sequence < 3 ? Math.pow(collapse, 3) : 0,
    blast
  ];
};

const uniforms = { time: 'time', sequence: 'sequence', pointer: 'pointer', pulse: 'pulse' };
const values = {};
let draws = 0;
const gl = {
  TRIANGLES: 4,
  uniform1f: (name, value) => { values[name] = value; },
  uniform2f: (name, ...value) => { values[name] = value; },
  uniform4f: (name, ...value) => { values[name] = value; },
  drawArrays: (...args) => { assert.deepEqual(args, [4, 0, 6]); draws++; }
};
const ages = Array.from({ length: 6001 }, (_, i) => i / 1000);
ages.push(3 - 1e-9, 3 + 1e-9, 3.7 - 1e-9, 3.7 + 1e-9, 6 - 1e-9, 60, 3600);
for (const pulseStart of [0, 321.5]) {
  for (const requestedAge of ages) {
    const elapsed = pulseStart + requestedAge;
    const age = Math.min(6, elapsed - pulseStart);
    const field = { dataset: {} };
    render(gl, uniforms, elapsed, pulseStart, field, .2, .8);
    const expected = originalPulse(age);
    values.pulse.forEach((value, index) => {
      assert(Number.isFinite(value));
      assert(Math.abs(value - expected[index]) < 1e-12,
        `Pulse channel ${index} differs at ${age}: ${value} vs ${expected[index]}`);
    });
    assert.equal(values.sequence, age);
    assert.equal(values.time, elapsed);
    assert.deepEqual(values.pointer, [.2, .8]);
    assert.equal(field.dataset.phase,
      age < 3 ? 'collapsing' : age < 3.7 ? 'exploding' : age < 6 ? 'settling' : 'remnant');
  }
}
assert.equal(draws, ages.length * 2);
console.log(`Work pulse math passed: ${draws} actual-render samples covering phase boundaries, replay offsets, settled clamping, pointer upload and one draw per frame. GPU lattice fidelity is verified separately in the browser; Node does not emulate shader precision or texture filtering.`);
