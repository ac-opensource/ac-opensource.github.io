const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const { chromium } = require("playwright");

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
    const index = {
      version: 1,
      documents: [{
        url: "/work.html", title: "Android reliability", description: "Release evidence",
        type: "Portfolio", sections: [{ id: "android", title: "Android", text: "Android reliability evidence" }]
      }]
    };
    const draftPage = await browser.newPage({ reducedMotion: "reduce" });
    let initialRequest;
    await draftPage.route("**/assets/data/search-index.json", (route) => { initialRequest = route; });
    await draftPage.goto(`${origin}/search.html`);
    await draftPage.locator("[data-evidence-search-input]").fill("Android draft");
    await initialRequest.fulfill({ json: index });
    await draftPage.waitForFunction(() => document.querySelector("[data-search-navigation]").dataset.searchPhase === "idle");
    assert.equal(await draftPage.locator("[data-evidence-search-input]").inputValue(), "Android draft",
      "Loading the index must preserve text typed before submission");
    await draftPage.close();
    console.log("PASS search readiness preserves an unsubmitted draft");
    for (const failure of ["network", "http", "format"]) {
      const page = await browser.newPage({ reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let requests = 0;
      let pendingRequest;
      await page.route("**/assets/data/search-index.json", async (route) => {
        requests += 1;
        if (requests > 1) {
          pendingRequest = route;
          return;
        }
        if (failure === "network") await route.abort("failed");
        else await route.fulfill({ status: failure === "http" ? 503 : 200, json: { version: 0 } });
      });
      const phase = () => page.locator("[data-search-navigation]").getAttribute("data-search-phase");
      const submit = () => page.locator("[data-evidence-search-form]").evaluate((form) => form.requestSubmit());
      const waitForPhase = (value) => page.waitForFunction(
        (expected) => document.querySelector("[data-search-navigation]").dataset.searchPhase === expected,
        value, { timeout: 5000 }
      );
      await page.goto(`${origin}/search.html?q=unmatched`);
      await waitForPhase("error");
      await page.locator("[data-evidence-search-input]").fill("Android");
      const retry = page.waitForRequest("**/assets/data/search-index.json", { timeout: 5000 });
      await submit();
      await retry;
      for (let attempt = 0; attempt < 3; attempt += 1) await submit();
      assert.equal(requests, 2, `${failure}: submissions must share the pending request`);
      assert.equal(await phase(), "loading");
      // Retry failures remain recoverable, and the next query wins while loading.
      await pendingRequest.fulfill({ status: 503, body: "Unavailable" });
      await waitForPhase("error");
      const nextRetry = page.waitForRequest("**/assets/data/search-index.json", { timeout: 5000 });
      await page.locator("[data-search-suggestion]").first().click();
      await nextRetry;
      await page.evaluate(() => {
        history.pushState(null, "", "?q=reliability");
        dispatchEvent(new PopStateEvent("popstate"));
      });
      await pendingRequest.fulfill({ json: index });
      await waitForPhase("results");
      assert.equal(requests, 3);
      assert.equal(await page.locator("[data-evidence-search-input]").inputValue(), "reliability");
      assert.equal(await page.locator(".evidence-result").count(), 1);
      assert.equal(await page.locator(".evidence-result a").getAttribute("href"), "/work.html#android");
      await page.locator("[data-evidence-search-input]").fill("");
      await submit();
      assert.equal(await phase(), "idle");
      assert.equal(requests, 3, "A loaded index should be reused");
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS search recovery: ${failure}, retry failure, concurrent submissions, suggestion, history, index reuse`);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
