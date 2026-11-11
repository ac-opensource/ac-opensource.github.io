const assert = require("node:assert/strict");
const express = require("express");
const path = require("node:path");
const { chromium } = require("playwright");

async function waitForController(page) {
  await page.waitForFunction(
    () => window.UniversePerspective?.snapshot().ready === "ready",
    null,
    { timeout: 5000 }
  );
}

async function main() {
  const app = express();
  app.use(express.static(path.resolve(__dirname, "..", process.env.SITE_ROOT || "dist")));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "chromium" });
    const origin = `http://127.0.0.1:${server.address().port}`;

    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(`${origin}/contact.html`, { waitUntil: "load" });
    await waitForController(page);
    const contact = await page.evaluate(() => ({
      snapshot: window.UniversePerspective.snapshot(),
      depthFieldCount: document.querySelectorAll("[data-universe-depth-field]").length,
      depthPlaneCount: document.querySelectorAll("[data-universe-depth-plane]").length,
      oldSkyCount: document.querySelectorAll("[data-universe-sky], [data-universe-transit]").length,
    }));

    assert.equal(contact.snapshot.model, "observer-camera-3d");
    assert.equal(contact.snapshot.searchModel, "directional-guiding-scope");
    assert.equal(contact.snapshot.transitionModel, "fade-through");
    assert.equal(contact.snapshot.current, "contact");
    assert.equal(contact.depthFieldCount, 1);
    assert.equal(contact.depthPlaneCount, 3);
    assert.equal(contact.oldSkyCount, 0);

    if (!contact.snapshot.crossDocument) {
      console.log("SKIP fade-through navigation: this browser has no cross-document view transitions");
      return;
    }

    await Promise.all([
      page.waitForURL("**/resume.html", { waitUntil: "commit" }),
      page.locator('#site-nav a[href="/resume.html"]').click(),
    ]);
    await waitForController(page);
    await page.waitForFunction(
      () => !window.UniversePerspective.snapshot().motion,
      null,
      { timeout: 5000 }
    );

    const arrival = await page.evaluate(() => ({
      snapshot: window.UniversePerspective.snapshot(),
      rootMotion: document.documentElement.dataset.universeMotion || null,
      rootPhase: document.documentElement.dataset.universePhase || null,
      markedVisuals: document.querySelectorAll("[data-universe-target-visual], [data-universe-copy]").length,
      veilOpacity: getComputedStyle(document.querySelector("[data-universe-veil]")).opacity,
    }));
    const travel = arrival.snapshot.lastTravel;
    assert.equal(travel.version, 9);
    assert.equal(travel.from, "contact");
    assert.equal(travel.to, "resume");
    assert.equal(travel.motionModel, "observer-camera-3d");
    assert.equal(travel.searchModel, "directional-guiding-scope");
    assert.equal(arrival.snapshot.current, "resume");
    assert.equal(arrival.rootMotion, null);
    assert.equal(arrival.rootPhase, null);
    assert.equal(arrival.markedVisuals, 0);
    assert.equal(Number(arrival.veilOpacity), 0);
    assert.deepEqual(errors, []);

    const reducedContext = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      reducedMotion: "reduce",
    });
    const reducedPage = await reducedContext.newPage();
    await reducedPage.goto(`${origin}/contact.html`, { waitUntil: "load" });
    await waitForController(reducedPage);
    await Promise.all([
      reducedPage.waitForURL("**/about.html", { waitUntil: "commit" }),
      reducedPage.locator('#site-nav a[href="/about.html"]').click(),
    ]);
    await waitForController(reducedPage);
    const reduced = await reducedPage.evaluate(() => window.UniversePerspective.snapshot());
    assert.equal(reduced.current, "about");
    assert.equal(reduced.motion, null);
    assert.equal(reduced.lastTravel, null);
    await reducedContext.close();

    console.log("PASS fade-through navigation lifecycle, settlement cleanup and native reduced motion");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
