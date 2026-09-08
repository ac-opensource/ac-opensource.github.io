const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('assets/js/about-spectrograph.js', 'utf8');
const start = source.indexOf('  function sizeTreeCanvasSurface(');
const end = source.indexOf('\n  // Keep stars', start);
// Model a stage during arrival: its visual bounds differ from its resting
// layout, then change without a ResizeObserver notification.
for (const width of [390, 1512, 1920]) {
  const opening = { offsetLeft: 0, offsetTop: 84, offsetHeight: 824, offsetParent: null };
  const stage = { offsetLeft: width > 720 ? 580 : 0, offsetTop: 40, offsetParent: opening };
  const viewport = { offsetLeft: 0, offsetTop: 0, clientHeight: 784, offsetParent: stage };
  const canvas = { style: {} };
  const scope = { root: { querySelector: () => opening }, document: { documentElement: { clientWidth: width } }, window: { innerHeight: 900 }, canvas, viewport };
  // A transformed DOMRect must never participate in persisted layout offsets.
  for (const node of [opening, viewport]) node.getBoundingClientRect = () => { throw new Error('Arrival transform leaked into canvas layout'); };
  vm.runInNewContext(source.slice(start, end) + '\nsizeTreeCanvasSurface(canvas, viewport);', scope);
  assert.equal(parseFloat(canvas.style.left) + stage.offsetLeft, 0);
  assert.equal(canvas.style.width, `${width}px`);
  assert.equal(parseFloat(canvas.style.top) + stage.offsetTop, -900);
  assert.equal(canvas.style.height, '2624px');
}
console.log('About canvas uses stable layout offsets across arrival transforms at mobile and desktop widths.');
