const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const { chromium } = require("playwright");

// Browser contract for the cosmic camera navigation: a route change is one
// camera flight through the shared world, sampled here with the arrival's
// animations paused so every assertion reads a deterministic frame.

const VIEWPORT = { width: 1280, height: 800 };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function assertIdentity(state, message) {
  assert.equal(state.matrix.length, 16, `${message}: inspect the complete projective transform.`);
  state.matrix.forEach((value, index) => {
    const tolerance = index === 12 || index === 13 ? 0.5 : 0.001;
    assert(Math.abs(value - IDENTITY[index]) < tolerance, `${message}: matrix[${index}]=${value}, ${JSON.stringify(state)}`);
  });
}

async function pauseArrivalAnimations(context) {
  await context.addInitScript(() => {
    const animate = Element.prototype.animate;
    window.__universeFlightAnimations = [];
    window.__universeFlightLog = [];
    window.addEventListener("pagereveal", (event) => {
      window.__universeFlightLog.push(`reveal:${Boolean(event.viewTransition)}`);
      event.viewTransition?.ready.then(
        () => window.__universeFlightLog.push("ready"),
        (error) => window.__universeFlightLog.push(`ready-rejected:${error?.name}`),
      );
    });
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (String(args[1]?.pseudoElement || "").startsWith("::view-transition")) {
        animation.pause();
        window.__universeFlightAnimations.push(animation);
      }
      return animation;
    };
  });
}

async function seek(page, progress) {
  const state = await page.evaluate((amount) => {
    const root = document.documentElement;
    window.__universeFlightAnimations.forEach((animation) => {
      animation.currentTime = animation.effect.getComputedTiming().duration * amount;
    });
    const read = (pseudo) => {
      const style = getComputedStyle(root, pseudo);
      const matrix = style.transform === "none" ? new DOMMatrix() : new DOMMatrix(style.transform);
      const corners = [-innerWidth / 2, innerWidth / 2].flatMap((x) => [-innerHeight / 2, innerHeight / 2].map((y) => {
        const projected = matrix.transformPoint(new DOMPoint(x, y));
        return { x: projected.x / projected.w, y: projected.y / projected.w, depth: projected.w };
      }));
      return {
        opacity: Number(style.opacity),
        scale: Math.hypot(matrix.a, matrix.b),
        x: matrix.e,
        y: matrix.f,
        lens: Number.parseFloat(style.getPropertyValue("--universe-lens-r")),
        feather: Number.parseFloat(style.getPropertyValue("--universe-feather")),
        matrix: Array.from(matrix.toFloat64Array()),
        corners,
      };
    };
    return {
      old: read("::view-transition-old(root)"),
      next: read("::view-transition-new(root)"),
      header: Number(getComputedStyle(root, "::view-transition-new(universe-site-header)").opacity),
    };
  }, progress);
  for (const [name, projected] of [["source", state.old], ["destination", state.next]]) {
    assert(projected.matrix.every(Number.isFinite), `${name} matrix must remain finite at progress ${progress}.`);
    if (projected.opacity > 0) {
      assert(projected.corners.every((corner) => corner.depth > 0 && Number.isFinite(corner.x) && Number.isFinite(corner.y)),
        `Visible ${name} corners must stay in front of the projection horizon at progress ${progress}: ${JSON.stringify(projected)}`);
    }
    if (projected.opacity > 0.02) {
      assertIdentity(projected, `Visible ${name} text stays at rest, never on a tilted page at progress ${progress}`);
    }
  }
  return state;
}

async function waitForArrival(page) {
  try {
    // Interval polling: headless browsers produce few animation frames while a
    // cross-document transition is up, so frame-based polling can starve.
    await page.waitForFunction(() => (window.__universeFlightAnimations || []).length >= 2, null, { polling: 100, timeout: 30000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      log: window.__universeFlightLog,
      url: location.pathname,
      flight: document.documentElement.dataset.universeFlight || null,
      snapshot: window.UniversePerspective?.snapshot(),
    })).catch((evaluateError) => evaluateError.message);
    throw new Error(`Arrival flight never started: ${JSON.stringify(state)}`);
  }
}

async function finishFlight(page) {
  await page.evaluate(() => window.__universeFlightAnimations.forEach((animation) => animation.finish()));
  await page.waitForFunction(() => window.UniversePerspective?.snapshot().ready === "ready", null, { polling: 100, timeout: 30000 });
}

async function assertCelestialApproach(page, label) {
  const samples = [0.12, 0.2, 0.35, 0.5, 0.65, 0.8];
  const approach = await page.evaluate((progress) => {
    const model = window.UniversePerspective.model;
    const snapshot = window.UniversePerspective.snapshot();
    const view = { w: innerWidth, h: innerHeight };
    const plan = model.planFlight(snapshot.lastTravel, snapshot.focus, view);
    return progress.map((amount) => {
      const camera = model.cameraAt(plan, amount);
      return model.pageState(plan.end, camera, plan.targetFocus, view).facing;
    });
  }, samples);
  assert(approach.some((facing) => facing < Math.cos(20 * Math.PI / 180)), `${label}: this route must exercise a substantial 3D turn.`);
  for (const progress of samples) {
    const frame = await seek(page, progress);
    assert.equal(frame.old.opacity, 0, `${label}: the source is a celestial object, with no page text during travel at ${progress}.`);
    assert.equal(frame.next.opacity, 0, `${label}: the destination shows no paper rectangle during approach at ${progress}.`);
  }
}

async function assertLiveGalaxyAlignment(page) {
  await page.waitForFunction(() => {
    const galaxy = window.UniverseGalaxy?.snapshot();
    return galaxy?.focus.r > 0 && document.querySelectorAll("#galaxy-nodes .galaxy-node").length > 0;
  }, null, { polling: 100, timeout: 30000 });
  const alignment = await page.evaluate(() => {
    const galaxy = window.UniverseGalaxy.snapshot();
    const snapshot = window.UniversePerspective.snapshot();
    const model = window.UniversePerspective.model;
    const landmark = model.destinationForLocation("/blog/").landmark;
    const view = { w: innerWidth, h: innerHeight };
    const camera = model.pageCamera(landmark, snapshot.focus, view);
    const core = document.querySelector(".galaxy-core__horizon").getBoundingClientRect();
    const field = document.getElementById("galaxy-field").getBoundingClientRect();
    const aspect = galaxy.focus.radiusY / galaxy.focus.radiusX;
    return {
      galaxy, focus: snapshot.focus,
      core: { x: core.left + core.width / 2, y: core.top + core.height / 2 },
      expectedRadii: { x: field.width * 0.49, y: field.height * 0.43 },
      projected: [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].map((angle) => model.projectPoint(camera, model.galaxyWorldPoint(landmark, 1, angle, aspect), view)),
      center: model.projectPoint(camera, landmark, view),
    };
  });
  const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 0.5, `${label}: ${actual} must align with ${expected}.`);
  assert(Number.isFinite(alignment.galaxy.elapsed) && alignment.galaxy.elapsed >= 0, "Logs exposes its live orbital clock.");
  assert.equal(alignment.galaxy.formation, 1, "Navigation arrives at the settled galaxy without replaying formation.");
  assert.equal(alignment.galaxy.mode, "spiral");
  assert.equal(typeof alignment.galaxy.paused, "boolean");
  near(alignment.focus.x, alignment.core.x, "The page camera uses the actual live core X");
  near(alignment.focus.y, alignment.core.y, "The page camera uses the actual live core Y");
  near(alignment.focus.r, alignment.expectedRadii.x, "The camera radius uses the live horizontal field radius");
  near(alignment.galaxy.focus.radiusX, alignment.expectedRadii.x, "The shared horizontal radius");
  near(alignment.galaxy.focus.radiusY, alignment.expectedRadii.y, "The shared vertical radius");
  assert(alignment.center.visible && alignment.projected.every((point) => point.visible), "The landed galaxy projects in front of the observer.");
  near(alignment.center.x, alignment.core.x, "The projected galaxy core X");
  near(alignment.center.y, alignment.core.y, "The projected galaxy core Y");
  alignment.projected.forEach((point, index) => {
    const angle = index * Math.PI / 2;
    near(point.x, alignment.core.x + Math.cos(angle) * alignment.expectedRadii.x, `Galaxy axis ${index} X`);
    near(point.y, alignment.core.y + Math.sin(angle) * alignment.expectedRadii.y, `Galaxy axis ${index} Y`);
  });
  return alignment.galaxy;
}

async function flyViaLink(page, { from, to, kind, href, selector, nested = null, pageKey = to, renderer = "materialFrames" }) {
  const label = `${from} -> ${to}`;
  const destination = new URL(href, page.url());
  await page.evaluate(() => { window.__universeFlightAnimations = []; });
  await Promise.all([
    page.waitForURL((url) => url.pathname === destination.pathname && url.search === destination.search && url.hash === destination.hash,
      { waitUntil: "commit" }),
    page.locator(selector).click(),
  ]);
  await waitForArrival(page);
  if (pageKey !== to) await page.waitForFunction((key) => window.UniversePerspective.snapshot().current === key, pageKey, { polling: 100 });
  const arrival = await page.evaluate(() => {
    const snapshot = window.UniversePerspective.snapshot();
    const plan = window.UniversePerspective.model.planFlight(snapshot.lastTravel, snapshot.focus, { w: innerWidth, h: innerHeight });
    const archive = [plan.from, plan.to].find((destination) => destination.key === "logs")?.landmark;
    const entry = [plan.from, plan.to].find((destination) => destination.key === "article")?.landmark;
    return {
      snapshot,
      layers: document.querySelectorAll("[data-universe-sky]").length,
      turn: plan.turn.angle,
      entryInsideArchive: archive && entry ? Math.hypot(entry.x - archive.x, entry.y - archive.y, entry.z - archive.z) + entry.r < archive.r : false,
      targetKind: plan.to.landmark.kind,
    };
  });
  assert.equal(arrival.snapshot.lastTravel.version, 11, `${label}: use the current flight record.`);
  assert.equal(arrival.snapshot.lastTravel.from, from);
  assert.equal(arrival.snapshot.lastTravel.to, to);
  assert.equal(arrival.snapshot.current, pageKey);
  assert.equal(arrival.targetKind, kind, `${label}: the flight uses its authored celestial object.`);
  assert.equal(arrival.snapshot.scene, "arrival");
  assert.equal(arrival.snapshot.activeTransition, true);
  assert.equal(arrival.layers, 2, `${label}: both shared sky layers are available during flight.`);
  if (nested) {
    assert(Math.abs(arrival.turn) < 1e-8, `${label}: nested archive travel preserves the disc orientation.`);
    // Enclosure here is physical membership. The sourceEncloses/targetEncloses
    // camera flags also depend on hero framing and can change after layout.
    assert(arrival.entryInsideArchive, `${label}: the star remains physically inside its enclosing archive.`);
  }
  const start = await seek(page, 0);
  assertIdentity(start.old, `${label}: the source starts at rest`);
  assert(start.old.opacity > 0.99 && start.next.opacity === 0, `${label}: only the source is exposed at departure.`);
  for (const progress of [0.12, 0.35, 0.58, 0.8]) {
    const frame = await seek(page, progress);
    assert.equal(frame.old.opacity, 0, `${label}: source text is hidden in space at ${progress}.`);
    assert.equal(frame.next.opacity, 0, `${label}: destination text is hidden in space at ${progress}.`);
  }
  await page.waitForFunction((key) => window.UniversePerspective.snapshot().solidRendering[key] > 0, renderer, { polling: 100 });
  await seek(page, 0.9);
  const landing = await seek(page, 1);
  assertIdentity(landing.next, `${label}: the destination lands exactly at rest`);
  assert(landing.next.opacity > 0.99 && landing.next.feather < 0.5, `${label}: the landed document is fully open.`);
  await finishFlight(page);
  const settled = await page.evaluate(() => ({
    snapshot: window.UniversePerspective.snapshot(),
    layers: document.querySelectorAll("[data-universe-sky]").length,
    flight: document.documentElement.dataset.universeFlight || null,
  }));
  assert.equal(settled.layers, 0, `${label}: landing removes both sky layers.`);
  assert.equal(settled.flight, null);
  assert.equal(settled.snapshot.current, pageKey);
  assert.equal(settled.snapshot.motion, null);
  assert.equal(settled.snapshot.scene, null);
  assert.equal(settled.snapshot.activeTransition, false);
  assert.equal(settled.snapshot.pendingCleanup, 0);
  console.log(`PASS ${label} flies through ${kind}, hides page sheets, lands, and cleans up`);
}

async function assertSolidRenderer(page) {
  const result = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    const diagnostics = [];
    const testGL = canvas.getContext("webgl");
    if (testGL) {
      const compile = testGL.compileShader.bind(testGL);
      testGL.compileShader = shader => { compile(shader); if (!testGL.getShaderParameter(shader, testGL.COMPILE_STATUS)) diagnostics.push(testGL.getShaderInfoLog(shader)); };
      const link = testGL.linkProgram.bind(testGL);
      testGL.linkProgram = program => { link(program); if (!testGL.getProgramParameter(program, testGL.LINK_STATUS)) diagnostics.push(testGL.getProgramInfoLog(program)); };
    }
    const renderer = window.createUniverseSolidField(canvas);
    if (!renderer) return { available: false, webgl: Boolean(testGL), diagnostics };
    const face = (z, color) => ({ points: [{ x: -.45, y: -.4, z }, { x: .45, y: -.4, z },
      { x: .45, y: .4, z }, { x: -.45, y: .4, z }], color, material: "ceramic" });
    // Submit the rear surface last. It must remain behind the red face even
    // when both triangles cover the same pixels in the cropped viewport.
    const geometry = { faces: [face(.5, [235, 28, 18]), face(-.5, [15, 28, 235])], bodies: [], segments: [] };
    const options = { geometry, frame: { eye: { x: 0, y: 0, z: 3 }, right: { x: 1, y: 0, z: 0 },
      down: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: -1 } }, landmark: { x: 0, y: 0, z: 0, r: 1 },
      viewport: { w: 256, h: 192 }, crop: { left: 64, top: 32, width: 128, height: 128 }, near: .02, night: 1 };
    const drawn = renderer.draw(options);
    const gl = canvas.getContext("webgl");
    const read = (x, y) => { const out = new Uint8Array(4); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out); return [...out]; };
    const center = read(canvas.width / 2, canvas.height / 2), outside = read(0, 0);
    // Clip both faces, then verify that clearing a reused field does not leave
    // stale material pixels for the next landmark rendered through it.
    const clipped = renderer.draw({ ...options, near: 4 });
    const cleared = read(canvas.width / 2, canvas.height / 2);
    renderer.draw({ ...options, crop: { left: 0, top: 0, width: 1600, height: 1000 } });
    const pixels = canvas.width * canvas.height;
    const extension = gl.getExtension("WEBGL_lose_context");
    let lossFallback = null;
    if (extension) {
      const lost = new Promise(resolve => canvas.addEventListener("webglcontextlost", resolve, { once: true }));
      extension.loseContext();
      await lost;
      lossFallback = renderer.draw(options) === false;
    }
    renderer.dispose();
    return { available: true, drawn, center, outside, clipped, cleared, pixels, lossFallback, disposed: renderer.draw(options) === false };
  });
  assert(result.available && result.drawn, `The actual material shaders compile and render in Chromium: ${JSON.stringify(result)}`);
  assert(result.center[0] > result.center[2] * 2 && result.center[3] === 255,
    `GPU depth and crop projection keep the nearer red surface in front: ${JSON.stringify(result)}`);
  assert.equal(result.outside[3], 0, "The cropped field retains a transparent background.");
  assert(result.clipped && result.cleared[3] === 0, "Near-plane clipping and reuse clear the previous landmark.");
  assert(result.pixels <= 300000, "Large landmarks respect the material pixel budget.");
  assert.equal(result.lossFallback, true, "A lost WebGL context explicitly returns to the Canvas fallback.");
  assert.equal(result.disposed, true);
  console.log("PASS material shader projection, depth, transparency, near clipping, pixel budget and context loss");
}

async function main() {
  const app = express();
  app.use(express.static(path.resolve(__dirname, "..", process.env.SITE_ROOT || "dist")));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  let browser;
  try {
    // Full Chromium's headless mode exercises WebGL material rendering too;
    // the lightweight headless shell can expose no WebGL context on macOS.
    browser = await chromium.launch({ headless: true, channel: "chromium" });
    const origin = `http://127.0.0.1:${server.address().port}`;

    const context = await browser.newContext({ viewport: VIEWPORT });
    await pauseArrivalAnimations(context);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));

    // Lightweight routes keep this about the flight, not page start-up cost.
    await page.goto(`${origin}/contact.html`, { waitUntil: "load" });
    await page.waitForFunction(() => window.UniversePerspective?.snapshot().ready === "ready", null, { polling: 100 });
    const settledContact = await page.evaluate(() => window.UniversePerspective.snapshot());
    assert.equal(settledContact.model, "cosmic-camera");
    assert.equal(settledContact.pathModel, "spatial-zoom-orbit");
    assert.equal(settledContact.current, "contact");
    assert.equal(settledContact.landmark.kind, "probe");
    assert.equal(await page.locator("[data-universe-sky]").count(), 0, "A settled page carries no sky layers.");
    await assertSolidRenderer(page);

    if (!settledContact.crossDocument) {
      console.log("SKIP universe flight: this browser has no cross-document view transitions");
      return;
    }

    await Promise.all([
      page.waitForURL("**/resume.html", { waitUntil: "commit" }),
      page.locator('#site-nav a[href="/resume.html"]').click(),
    ]);
    await waitForArrival(page);

    const arrival = await page.evaluate(() => ({
      flight: document.documentElement.dataset.universeFlight,
      motion: document.documentElement.dataset.universeMotion,
      layers: [...document.querySelectorAll("[data-universe-sky]")].map((canvas) => ({
        name: getComputedStyle(canvas).viewTransitionName,
        painted: (() => {
          const context = canvas.getContext("2d");
          const { data } = context.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1);
          return data[3];
        })(),
      })),
      snapshot: window.UniversePerspective.snapshot(),
    }));
    assert.equal(arrival.flight, "true");
    assert.equal(arrival.motion, "arrive", "Arriving pages keep the contract their own start-up scripts wait on.");
    assert.deepEqual(arrival.layers.map((layer) => layer.name), ["universe-cosmos", "universe-cosmos-near"]);
    assert.equal(arrival.layers[0].painted, 255, "The far sky is painted before the first transition frame.");
    const travel = arrival.snapshot.lastTravel;
    assert.equal(travel.version, 11);
    assert.equal(travel.from, "contact");
    assert.equal(travel.to, "resume");
    assert.equal(travel.motionModel, "cosmic-camera");
    assert.equal(travel.pathModel, "spatial-zoom-orbit");
    assert(travel.duration >= 950 && travel.duration <= 1900, `Flight duration out of range: ${travel.duration}`);
    assert(travel.zoomPathLength > 0.5, "The flight must cover real distance in zoom-pan space.");
    assert.equal(arrival.snapshot.scene, "arrival");

    const start = await seek(page, 0);
    assertIdentity(start.old, "The departing page starts exactly where the visitor left it");
    assert(Math.abs(start.old.scale - 1) < 0.001 && Math.abs(start.old.x) < 0.5 && Math.abs(start.old.y) < 0.5,
      `The departing page must start exactly where the visitor left it: ${JSON.stringify(start.old)}`);
    assert(start.next.opacity < 0.05, `The destination must not be visible before the camera reaches it: ${JSON.stringify(start.next)}`);

    const middle = await seek(page, 0.5);
    assert(middle.old.opacity < 0.2 || middle.old.scale < 0.35,
      `By mid-flight the departing page must have collapsed into its landmark: ${JSON.stringify(middle.old)}`);
    assert(middle.old.lens < start.old.lens * 0.5, "A receding page closes into a lens around its own object.");
    assert(middle.old.feather > 0, "A receding page loses its straight edges.");
    assert(middle.next.scale < 1, "Mid-flight the destination is still ahead of the camera.");
    assert(middle.header < 0.5, "Open space is not framed by either page's header.");

    const landing = await seek(page, 1);
    assertIdentity(landing.next, "The destination lands without residual rotation or perspective");
    assert(Math.abs(landing.next.scale - 1) < 0.001 && Math.abs(landing.next.x) < 0.5 && Math.abs(landing.next.y) < 0.5,
      `The destination must land exactly in place: ${JSON.stringify(landing.next)}`);
    assert(landing.next.opacity > 0.99 && landing.next.feather < 0.5, "The landed page is fully open.");
    assert(landing.header > 0.99);

    await finishFlight(page);
    const settledResume = await page.evaluate(() => ({
      flight: document.documentElement.dataset.universeFlight || null,
      layers: document.querySelectorAll("[data-universe-sky]").length,
      snapshot: window.UniversePerspective.snapshot(),
    }));
    assert.equal(settledResume.flight, null);
    assert.equal(settledResume.layers, 0, "Sky layers are removed once the camera lands.");
    assert.equal(settledResume.snapshot.motion, null);
    assert.equal(settledResume.snapshot.current, "resume");
    console.log(`PASS contact -> resume flies a ${travel.duration}ms camera path and lands in place`);

    // History traversal never passes the click handler; the leaving page plans
    // the flight at swap time.
    await page.evaluate(() => { window.__universeFlightAnimations = []; });
    await Promise.all([
      page.waitForURL("**/contact.html", { waitUntil: "commit" }),
      page.goBack(),
    ]);
    await waitForArrival(page);
    const back = await page.evaluate(() => window.UniversePerspective.snapshot().lastTravel);
    assert.equal(back.from, "resume");
    assert.equal(back.to, "contact");
    assertIdentity((await seek(page, 1)).next, "Browser back lands the restored page in place");
    await finishFlight(page);
    console.log("PASS browser back flies the reverse route");

    // About starts behind Contact's resting observer. The controller must turn
    // through the world before revealing that destination, then settle squarely.
    const rearTarget = await page.evaluate(() => {
      const snapshot = window.UniversePerspective.snapshot();
      const model = window.UniversePerspective.model;
      const view = { w: innerWidth, h: innerHeight };
      const camera = model.pageCamera(snapshot.landmark, snapshot.focus, view);
      return model.projectPoint(camera, model.destinationForLocation("/about.html").landmark, view);
    });
    assert(rearTarget.depth < 0 && !rearTarget.visible, "The browser rear-route fixture must actually begin behind the camera.");
    await page.evaluate(() => { window.__universeFlightAnimations = []; });
    await Promise.all([
      page.waitForURL("**/about.html", { waitUntil: "commit" }),
      page.locator('#site-nav a[href="/about.html"]').click(),
    ]);
    await waitForArrival(page);
    const rearTravel = await page.evaluate(() => window.UniversePerspective.snapshot().lastTravel);
    assert.equal(rearTravel.from, "contact");
    assert.equal(rearTravel.to, "about");
    const rearStart = await seek(page, 0);
    assertIdentity(rearStart.old, "A rear-bound flight starts with the source page in place");
    assert(rearStart.next.opacity === 0, "A destination behind the eye must be hidden at departure.");
    const rearFrames = [];
    for (const progress of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) rearFrames.push(await seek(page, progress));
    assert(rearFrames.some((frame) => [...frame.old.matrix, ...frame.next.matrix].some((value, index) => (index % 16 === 3 || index % 16 === 7) && Math.abs(value) > 1e-6)),
      "The rear flight must produce a projective turn, not only translate flat pages.");
    const rearLanding = await seek(page, 1);
    assertIdentity(rearLanding.next, "The rear destination lands exactly in place");
    assert(rearLanding.next.opacity > 0.99 && rearLanding.next.feather < 0.5, "The rear destination opens fully at landing.");
    await finishFlight(page);
    assert.equal(await page.locator("[data-universe-sky]").count(), 0, "Rear-route sky layers are removed after landing.");
    console.log("PASS contact -> about turns toward a rear destination and lands in place");

    // Match the actual Logs field at arrival, then depart with its live phase.
    // Both directions traverse open space with celestial objects; page text
    // appears only after the observer has settled at the destination.
    await page.evaluate(() => { window.__universeFlightAnimations = []; });
    await Promise.all([
      page.waitForURL("**/blog/", { waitUntil: "commit" }),
      page.locator('#site-nav a[href="/blog/"]').click(),
    ]);
    await waitForArrival(page);
    const logsTravel = await page.evaluate(() => window.UniversePerspective.snapshot().lastTravel);
    assert.equal(logsTravel.version, 11);
    assert.equal(logsTravel.from, "about");
    assert.equal(logsTravel.to, "logs");
    assertIdentity((await seek(page, 0)).old, "About starts at rest before entering the galaxy");
    await assertCelestialApproach(page, "About -> Logs");
    const logsLanding = await seek(page, 1);
    assertIdentity(logsLanding.next, "Logs lands without changing its disc angle");
    assert(logsLanding.next.opacity > 0.99 && logsLanding.next.feather < 0.5, "Logs opens fully after its observer settles.");
    await finishFlight(page);
    const liveGalaxy = await assertLiveGalaxyAlignment(page);
    assert.equal(await page.locator("[data-universe-sky]").count(), 0);
    console.log("PASS about -> logs hides page sheets and aligns the 3D galaxy with the live archive");

    await page.evaluate(() => { window.__universeFlightAnimations = []; });
    await Promise.all([
      page.waitForURL("**/about.html", { waitUntil: "commit" }),
      page.locator('#site-nav a[href="/about.html"]').click(),
    ]);
    await waitForArrival(page);
    const aboutTravel = await page.evaluate(() => window.UniversePerspective.snapshot().lastTravel);
    assert.equal(aboutTravel.from, "logs");
    assert.equal(aboutTravel.to, "about");
    assert(aboutTravel.galaxy?.elapsed >= liveGalaxy.elapsed, "Leaving Logs retains its current orbital phase instead of resetting the arms.");
    assert.equal(aboutTravel.galaxy.formation, liveGalaxy.formation);
    assert.equal(aboutTravel.galaxy.mode, liveGalaxy.mode);
    assert.equal(aboutTravel.galaxy.paused, liveGalaxy.paused);
    assert(Math.abs(aboutTravel.fromFocus.x - aboutTravel.galaxy.focus.x) < 0.5
      && Math.abs(aboutTravel.fromFocus.y - aboutTravel.galaxy.focus.y) < 0.5,
    "The stored galaxy phase and source page camera refer to the same core.");
    assertIdentity((await seek(page, 0)).old, "Logs starts at rest with its live spiral orientation");
    await assertCelestialApproach(page, "Logs -> About");
    const aboutLanding = await seek(page, 1);
    assertIdentity(aboutLanding.next, "About lands exactly at rest after leaving the galaxy");
    assert(aboutLanding.next.opacity > 0.99 && aboutLanding.next.feather < 0.5, "About opens fully after the turn.");
    await finishFlight(page);
    assert.equal(await page.locator("[data-universe-sky]").count(), 0);
    console.log("PASS logs -> about preserves source galaxy phase and hides paper during the turn");

    // Exercise every other authored landmark through the site's real links.
    // The shared samples also cover the visible document fade after each
    // destination camera settles, including pages with different header markup.
    const destinations = [
      { from: "about", to: "home", kind: "orbital", href: "/", selector: '#site-topbar a[href="/"]:not(.site-nav-link)' },
      { from: "home", to: "work", kind: "supernova", href: "/work.html", selector: '#site-nav a[href="/work.html"]' },
      { from: "work", to: "contact", kind: "probe", href: "/contact.html", selector: '#site-nav a[href="/contact.html"]' },
      { from: "contact", to: "signals", kind: "beacon", href: "/signals.html", selector: '.ground-link[href="/signals.html"]' },
      { from: "signals", to: "resume", kind: "chart", href: "/resume.html", selector: '.signals-nav a[href="/resume.html"]' },
      { from: "resume", to: "search", kind: "survey", href: "/search.html", selector: '[data-site-search-link][href="/search.html"]' },
      { from: "search", to: "home", kind: "orbital", href: "/", selector: '.search-brand[href="/"]' },
    ];
    for (const destination of destinations) await flyViaLink(page, destination);

    // Home exposes Skills and Production through its existing detail panels.
    // Open those controls normally so their hash targets remain real routes.
    for (const destination of [
      // About's existing controller clears the bare profile-map hash when no
      // instrument state is selected. The arrival record still targets Skills.
      { key: "profile", pageKey: "about", kind: "tree", href: "/about.html#profile-map" },
      { key: "projects", kind: "cluster", href: "/work.html#production-work" },
    ]) {
      await page.locator(`[data-map-target="${destination.key}"]`).click();
      await page.locator(`[data-synthesis][data-phase="focused"][data-selected="${destination.key}"]`).waitFor();
      await flyViaLink(page, {
        from: "home", to: destination.key, pageKey: destination.pageKey, kind: destination.kind, href: destination.href,
        selector: `[data-facet-detail="${destination.key}"] .landing-copy a[href="${destination.href}"]`,
      });
      await flyViaLink(page, { from: destination.pageKey || destination.key, to: "home", kind: "orbital", href: "/", selector: '#site-topbar a[href="/"]:not(.site-nav-link)' });
    }

    // A real published entry link exercises the smaller star inside Logs.
    await flyViaLink(page, { from: "home", to: "logs", kind: "galaxy", href: "/blog/", selector: '#site-nav a[href="/blog/"]' });
    const articleLink = '#galaxy-list .galaxy-entry__body h4 a';
    const articleHref = await page.locator(articleLink).first().getAttribute("href");
    assert(/^\/blog\/.+\.html$/.test(articleHref), "The nested fixture is an actual published article link.");
    await flyViaLink(page, { from: "logs", to: "article", kind: "star", href: articleHref,
      selector: `${articleLink}[href="${articleHref}"]`, nested: true });
    await flyViaLink(page, { from: "article", to: "logs", kind: "galaxy", href: "/blog/",
      selector: '#site-nav a[href="/blog/"]', nested: true });
    await context.close();

    // Reduced motion keeps native navigation: no interception, no sky.
    const calmContext = await browser.newContext({ viewport: VIEWPORT, reducedMotion: "reduce" });
    const calm = await calmContext.newPage();
    calm.on("pageerror", (error) => errors.push(error.message));
    await calm.goto(`${origin}/contact.html`, { waitUntil: "load" });
    const prevented = await calm.evaluate(() => new Promise((resolve) => {
      window.addEventListener("click", (event) => { resolve(event.defaultPrevented); event.preventDefault(); }, { once: true });
      document.querySelector('#site-nav a[href="/resume.html"]').click();
    }));
    assert.equal(prevented, false, "Reduced motion must not delay navigation.");
    assert.equal(await calm.locator("[data-universe-sky]").count(), 0);
    await calmContext.close();
    console.log("PASS reduced motion keeps native navigation");

    // Phones project the world against their long edge.
    const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await pauseArrivalAnimations(phoneContext);
    const phone = await phoneContext.newPage();
    phone.on("pageerror", (error) => errors.push(error.message));
    await phone.goto(`${origin}/resume.html`, { waitUntil: "load" });
    await Promise.all([
      phone.waitForURL("**/contact.html", { waitUntil: "commit" }),
      phone.locator('#site-nav-mobile a[href="/contact.html"]').click(),
    ]);
    await waitForArrival(phone);
    assertIdentity((await seek(phone, 0)).old, "The phone source starts in place");
    for (const progress of [0.2, 0.4, 0.6, 0.8]) await seek(phone, progress);
    const phoneLanding = await seek(phone, 1);
    assertIdentity(phoneLanding.next, "The phone destination lands without perspective distortion");
    assert(Math.abs(phoneLanding.next.scale - 1) < 0.001, "Phones land the destination in place too.");
    await finishFlight(phone);
    await phoneContext.close();
    console.log("PASS phone flight lands in place");

    const fallbackContext = await browser.newContext({ viewport: VIEWPORT });
    await fallbackContext.route("**/assets/js/universe-solid-field.js*", route => route.fulfill({
      contentType: "text/javascript", body: "window.createUniverseSolidField = () => null;",
    }));
    await pauseArrivalAnimations(fallbackContext);
    const fallback = await fallbackContext.newPage();
    fallback.on("pageerror", error => errors.push(error.message));
    await fallback.goto(`${origin}/resume.html`, { waitUntil: "load" });
    await flyViaLink(fallback, { from: "resume", to: "contact", kind: "probe", href: "/contact.html",
      selector: '#site-nav a[href="/contact.html"]', renderer: "fallbackFrames" });
    assert.equal((await fallback.evaluate(() => UniversePerspective.snapshot().solidRendering)).materialFrames, 0);
    await fallbackContext.close();
    console.log("PASS navigation and detailed geometry survive an unavailable material renderer");

    assert.deepEqual(errors, [], `Page errors during flights: ${errors.join(" | ")}`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
