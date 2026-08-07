const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const handoff = require(path.join(ROOT, "assets", "js", "route-signal-handoff.js"));

const source = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

assert.deepStrictEqual(Object.keys(handoff.ROUTES), ["work", "contact"], "Only the two proof destinations may receive a signal");
assert.strictEqual(handoff.ROUTES.work.path, "/work.html");
assert.strictEqual(handoff.ROUTES.contact.path, "/contact.html");
assert.deepStrictEqual(handoff.SIGNAL_KEYS, ["createdAt", "destination", "source", "token", "version"]);
assert(handoff.isDashboardReferrer("https://example.test/", "https://example.test"));
assert(handoff.isDashboardReferrer("https://example.test/index.html#facet-work", "https://example.test"));
for (const referrer of [
  "",
  "https://example.test/about.html",
  "https://example.test/?preview=1",
  "https://elsewhere.test/"
]) {
  assert(!handoff.isDashboardReferrer(referrer, "https://example.test"), `Non-dashboard referrer was accepted: ${referrer}`);
}

for (const [mode, timing] of Object.entries(handoff.TIMINGS)) {
  assert(timing.departure >= 0, `${mode} departure timing must be finite`);
  assert(timing.settle >= 0 && timing.settle < timing.arrival, `${mode} receiver must resolve before it clears`);
  assert(timing.departure + timing.arrival < 1000, `${mode} signal handoff must remain below one second`);
}

assert(handoff.isPlainActivation(), "A plain primary click must remain enhanceable");
assert(handoff.isPlainActivation({ target: "_self" }), "An explicit same-context target must remain enhanceable");
for (const activation of [
  { altKey: true },
  { button: 1 },
  { ctrlKey: true },
  { defaultPrevented: true },
  { download: true },
  { metaKey: true },
  { shiftKey: true },
  { target: "_blank" }
]) {
  assert(!handoff.isPlainActivation(activation), `Native activation must not be intercepted: ${JSON.stringify(activation)}`);
}

assert.strictEqual(handoff.resolveMode(), "normal");
assert.strictEqual(handoff.resolveMode({ reduced: true, saveData: true }), "reduced");
for (const environment of [
  { hidden: true },
  { saveData: true },
  { effectiveType: "slow-2g" },
  { effectiveType: "2g" },
  { deviceMemory: 2 },
  { hardwareConcurrency: 2 }
]) {
  assert.strictEqual(handoff.resolveMode(environment), "constrained", `Expected a static constrained cue: ${JSON.stringify(environment)}`);
}

const now = 1786017600000;
const validWorkSignal = {
  version: 1,
  token: "0123456789abcdef",
  source: "dashboard",
  destination: "work",
  createdAt: now
};
assert(handoff.validSignal(validWorkSignal, "work", now));
for (const invalidSignal of [
  { ...validWorkSignal, extra: true },
  { ...validWorkSignal, version: 2 },
  { ...validWorkSignal, source: "contact" },
  { ...validWorkSignal, destination: "contact" },
  { ...validWorkSignal, token: "short" },
  { ...validWorkSignal, createdAt: now - 5001 },
  { ...validWorkSignal, createdAt: now + 1001 }
]) {
  assert(!handoff.validSignal(invalidSignal, "work", now), `Invalid signal was accepted: ${JSON.stringify(invalidSignal)}`);
}

const sharedIncludes = [
  '/assets/css/route-signal-handoff.css?v=20260806-t3',
  '/assets/js/route-signal-handoff.js?v=20260806-t3'
];
const index = source("index.html");
const work = source("work.html");
const contact = source("contact.html");
for (const html of [index, work, contact]) {
  for (const include of sharedIncludes) assert(html.includes(include), `Missing shared handoff asset: ${include}`);
}
assert.strictEqual((index.match(/data-route-signal-link/g) || []).length, 2, "Only the two dashboard major-region CTAs may emit");
assert(index.includes('href="/work.html" data-route-signal-link data-route-signal-destination="work"'));
assert(index.includes('href="/contact.html" data-route-signal-link data-route-signal-destination="contact"'));
assert(work.includes('data-route-signal-receiver="work"'));
assert(work.includes("[mission trajectory / inbound]") && handoff.ROUTES.work.resolved.includes("TRAJECTORY LOCK"), "Work receiver must use its page-specific trajectory cue");
assert(contact.includes('data-route-signal-receiver="contact"'));
assert(contact.includes("[mission telemetry / inbound]") && handoff.ROUTES.contact.resolved.includes("TELEMETRY LOCK"), "Contact receiver must use its page-specific telemetry cue");
for (const html of [work, contact]) {
  assert(!html.includes("data-route-signal-link"), "Destination pages must not generalize the dashboard emitter");
}
for (const relativePath of ["about.html", "resume.html", "blog/index.html"]) {
  assert(!source(relativePath).includes("route-signal-handoff"), `${relativePath} must stay outside the proof-route experiment`);
}

const css = source("assets/css/route-signal-handoff.css");
assert(css.includes("pointer-events: none"), "Signal surfaces must not take pointer ownership");
assert(css.includes("@media (prefers-reduced-motion: reduce)"), "A static reduced-motion cue is required");
assert(css.includes("overflow: hidden"), "Bounded receiver geometry is required");

console.log("Signal handoff contract passed: 2 exact routes, one-time validated payload, native activations, and sub-second modes.");
