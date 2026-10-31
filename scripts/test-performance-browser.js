const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const { chromium } = require("playwright");

async function main() {
  const app = express();
  app.use(express.static(path.join(__dirname, "..", "dist")));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const request = window.requestAnimationFrame.bind(window);
      const cancel = window.cancelAnimationFrame.bind(window);
      const pending = new Set();
      window.idleProbe = { calls: 0, pending };
      window.requestAnimationFrame = (callback) => {
        const isIdle = callback.name === "runIdleRotation";
        const id = request((time) => {
          pending.delete(id);
          if (isIdle) window.idleProbe.calls++;
          callback(time);
        });
        if (isIdle) pending.add(id);
        return id;
      };
      window.cancelAnimationFrame = (id) => { pending.delete(id); cancel(id); };
    });
    await page.goto(`${baseUrl}/about.html`);
    const motion = (state) => page.waitForFunction((expected) =>
      document.querySelector("[data-stellar-spectrum]")?.dataset.treeMotion === expected, state);
    const idle = () => motion("idle-rotation");
    async function stopped(label) {
      await page.waitForTimeout(100);
      const before = await page.evaluate(() => window.idleProbe.calls);
      await page.waitForTimeout(350);
      const result = await page.evaluate(() => ({ calls: window.idleProbe.calls, pending: window.idleProbe.pending.size }));
      assert.equal(result.calls - before, 0, `${label}: inactive About animation still executes callbacks`);
      assert.equal(result.pending, 0, `${label}: an idle callback remains queued`);
    }
    await idle();
    const toggle = page.locator("[data-tree-motion-toggle]");
    await toggle.click();
    await stopped("manual pause");
    await toggle.click();
    await idle();
    assert.equal(await page.evaluate(() => window.idleProbe.pending.size), 1);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await motion("paused");
    await stopped("offscreen");
    await page.evaluate(() => window.scrollTo(0, 0));
    await idle();

    // Keyboard activation avoids depending on the animated node's screen position.
    const node = page.locator("button[data-node-id]:visible").first();
    await node.focus();
    await stopped("focused node");
    await node.press("Enter");
    await page.locator("[data-stellar-readout]").waitFor({ state: "visible" });
    await stopped("open evidence popup");
    await page.keyboard.press("Escape");
    await toggle.focus();
    await page.mouse.move(0, 0);
    await idle();

    await page.locator(".stellar-tree__root").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-stellar-spectrum]").dataset.sourceIndex === "open");
    await stopped("sources panel");
    await page.keyboard.press("Escape");
    await idle();

    await page.emulateMedia({ reducedMotion: "reduce" });
    await motion("reduced");
    await stopped("reduced motion");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await idle();
    await toggle.click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await stopped("manual pause after motion preference changes");
    await toggle.click();
    await idle();
    assert.deepEqual(errors, []);
    await page.close();

    for (const profile of [
      { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 },
      { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
      { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 }
    ]) {
      const archive = await browser.newPage({ ...profile, javaScriptEnabled: false, reducedMotion: "reduce" });
      await archive.goto(`${baseUrl}/blog/`);
      for (const base of ["new-zealand-aurora", "photography-misty-mountains"]) {
        const image = archive.locator(`.galaxy-entry img[src*="${base}"]`).first();
        await image.scrollIntoViewIfNeeded();
        await image.evaluate((element) => element.decode());
        const expectedWidth = profile.deviceScaleFactor === 3 ? 1600 : 800;
        const current = await image.evaluate((element) => element.currentSrc);
        assert(current.endsWith(`${base}-${expectedWidth}.jpg`), `${base}: unexpected candidate ${current}`);
      }
      assert(await archive.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Logs overflowed the viewport");
      await archive.close();
    }
    console.log("Performance browser checks passed: About inactive callbacks and resume controls, Logs responsive image selection at desktop/mobile DPR 1/2/3, and no-JavaScript fallback.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
