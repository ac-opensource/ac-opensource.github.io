const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const { chromium } = require("playwright");

// Browser contract for the cosmic camera navigation: a route change is one
// camera flight through the shared world, sampled here with the arrival's
// animations paused so every assertion reads a deterministic frame.

const VIEWPORT = { width: 1280, height: 800 };

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
  return page.evaluate((amount) => {
    const root = document.documentElement;
    window.__universeFlightAnimations.forEach((animation) => {
      animation.currentTime = animation.effect.getComputedTiming().duration * amount;
    });
    const read = (pseudo) => {
      const style = getComputedStyle(root, pseudo);
      const matrix = style.transform === "none" ? new DOMMatrix() : new DOMMatrix(style.transform);
      return {
        opacity: Number(style.opacity),
        scale: Math.hypot(matrix.a, matrix.b),
        x: matrix.e,
        y: matrix.f,
        lens: Number.parseFloat(style.getPropertyValue("--universe-lens-r")),
        feather: Number.parseFloat(style.getPropertyValue("--universe-feather")),
      };
    };
    return {
      old: read("::view-transition-old(root)"),
      next: read("::view-transition-new(root)"),
      header: Number(getComputedStyle(root, "::view-transition-new(universe-site-header)").opacity),
    };
  }, progress);
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

async function main() {
  const app = express();
  app.use(express.static(path.resolve(__dirname, "..", process.env.SITE_ROOT || "dist")));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
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
    assert.equal(settledContact.pathModel, "van-wijk-nuij");
    assert.equal(settledContact.current, "contact");
    assert.equal(settledContact.landmark.kind, "probe");
    assert.equal(await page.locator("[data-universe-sky]").count(), 0, "A settled page carries no sky layers.");

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
    assert.equal(travel.from, "contact");
    assert.equal(travel.to, "resume");
    assert.equal(travel.motionModel, "cosmic-camera");
    assert.equal(travel.pathModel, "van-wijk-nuij");
    assert(travel.duration >= 950 && travel.duration <= 1600, `Flight duration out of range: ${travel.duration}`);
    assert(travel.zoomPathLength > 0.5, "The flight must cover real distance in zoom-pan space.");
    assert.equal(arrival.snapshot.scene, "arrival");

    const start = await seek(page, 0);
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
    await finishFlight(page);
    console.log("PASS browser back flies the reverse route");
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
    const phoneLanding = await seek(phone, 1);
    assert(Math.abs(phoneLanding.next.scale - 1) < 0.001, "Phones land the destination in place too.");
    await finishFlight(phone);
    await phoneContext.close();
    console.log("PASS phone flight lands in place");

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
