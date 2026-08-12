const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const { chromium } = require("playwright");
const { buildSite } = require("./build-site");
const { DEFAULT_DB_PATH } = require("./lib/blog-db");

const REDUCED_MOTION_EXPERIMENT_CONTROLLERS = Object.freeze([
  "assets/experiments/universe-options/logs/spiral-galaxy-archive.js",
  "assets/experiments/universe-options/work-round-05/supernova-portfolio.js"
]);

function walkHtmlFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolutePath);
      else if (entry.isFile() && entry.name.endsWith(".html")) files.push(absolutePath);
    }
  }
  return files.sort();
}

async function assertHeaderSearch(page, label, headerSelector) {
  const searchLinks = page.locator("[data-site-search-link]");
  assert.equal(await searchLinks.count(), 1, `${label} does not expose exactly one header Search link.`);
  const metrics = await page.evaluate((selector) => {
    const link = document.querySelector("[data-site-search-link]")?.getBoundingClientRect();
    const header = document.querySelector(selector)?.getBoundingClientRect();
    const slot = document.querySelector("[data-site-search-slot]")?.getBoundingClientRect();
    return {
      header: header && { bottom: header.bottom },
      link: link && { width: link.width, height: link.height },
      overlayCount: document.querySelectorAll(".site-tools, [data-site-tools-capabilities]").length,
      slot: slot && { left: slot.left, top: slot.top, right: slot.right, bottom: slot.bottom },
      viewport: { width: innerWidth }
    };
  }, headerSelector);
  assert(metrics.link && metrics.link.width >= 44 && metrics.link.height >= 44,
    `${label} Search target is smaller than 44px.`);
  assert(metrics.slot && metrics.slot.left > metrics.viewport.width / 2,
    `${label} Search does not occupy the right-hand header slot.`);
  assert(metrics.header && metrics.slot.top >= 0 && metrics.slot.bottom <= metrics.header.bottom + 1,
    `${label} Search sits outside its header.`);
  assert.equal(metrics.overlayCount, 0, `${label} still contains a floating shared-tools overlay.`);
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac-site-discovery-browser-"));
  const outputRoot = path.join(tempRoot, "site");
  const databasePath = path.join(tempRoot, "blog.sqlite");
  fs.copyFileSync(DEFAULT_DB_PATH, databasePath);
  buildSite({ outputRoot, dbPath: databasePath });

  const headerSearchRoutes = new Set([
    "index.html", "about.html", "work.html", "contact.html", "resume.html", "search.html", "blog/index.html",
    "experiments/universe-options/work-round-05/supernova-portfolio.html"
  ]);
  for (const htmlPath of walkHtmlFiles(outputRoot)) {
    const relativePath = path.relative(outputRoot, htmlPath).split(path.sep).join("/");
    const html = fs.readFileSync(htmlPath, "utf8");
    const expectsSearch = headerSearchRoutes.has(relativePath) || /^blog\/(?!index\.html$)[^/]+\.html$/.test(relativePath);
    assert.equal((html.match(/data-site-search-link/g) || []).length, expectsSearch ? 1 : 0,
      `${relativePath} has the wrong number of header Search links.`);
    assert.equal((html.match(/data-site-search-slot/g) || []).length, expectsSearch ? 1 : 0,
      `${relativePath} has the wrong number of explicit Search slots.`);
    assert(!html.includes("site-tools") && !html.includes("data-site-tools-capabilities"),
      `${relativePath} still contains a floating shared-tools overlay.`);
    assert(html.includes('/assets/css/site-search.css') && html.includes('/assets/js/site-search.js'),
      `${relativePath} lost the shared Search assets.`);
    assert(!/calm-sky\.js|data-calm-sky|ac\.motion-preference\.v1/i.test(html),
      `${relativePath} still exposes Calm Sky UI or persistence.`);
  }
  const signalsHtml = fs.readFileSync(path.join(outputRoot, "signals.html"), "utf8");
  const notFoundHtml = fs.readFileSync(path.join(outputRoot, "404.html"), "utf8");
  assert(signalsHtml.includes("[registry: moderated]") && !signalsHtml.includes("data-site-search-slot"));
  assert(notFoundHtml.includes("[signal: interrupted]") && !notFoundHtml.includes("data-site-search-slot"));
  assert(notFoundHtml.includes('action="/search.html"'), "Lost Signal lost its existing Search form.");
  assert(!fs.existsSync(path.join(outputRoot, "assets", "js", "calm-sky.js")));
  assert(!fs.existsSync(path.join(outputRoot, "assets", "css", "calm-sky.css")));
  for (const controllerPath of REDUCED_MOTION_EXPERIMENT_CONTROLLERS) {
    const controller = fs.readFileSync(path.join(outputRoot, controllerPath), "utf8");
    assert(controller.includes('matchMedia("(prefers-reduced-motion: reduce)")'),
      `${controllerPath} lost its native reduced-motion behavior.`);
  }

  const app = express();
  app.use(express.static(outputRoot, { extensions: ["html"] }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/search.html?q=release%20reliability`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-evidence-search-status]").filter({ hasText: /published match/ }).waitFor();
    assert(await page.locator(".evidence-result").count() > 0, "Evidence search returned no public matches.");
    assert(await page.locator(".evidence-result mark").count() > 0, "Evidence search did not identify the matching terms.");
    assert.equal(await page.locator("[data-evidence-search-input]").getAttribute("maxlength"), "160");
    const publicIndex = await page.evaluate(async () => (await fetch("/assets/data/search-index.json")).json());
    assert.equal(publicIndex.version, 1);
    assert(publicIndex.documents.every((record) => /^\/(?!\/)/.test(record.url)));
    assert(!JSON.stringify(publicIndex).includes("blog.sqlite"));

    const repeatedHistoryLength = await page.evaluate(() => history.length);
    await page.locator("[data-evidence-search-form]").evaluate((form) => form.requestSubmit());
    assert.equal(await page.evaluate(() => history.length), repeatedHistoryLength,
      "Repeating the same canonical search created a duplicate history entry.");

    await page.locator("[data-evidence-search-input]").fill("");
    await page.locator("[data-evidence-search-form]").evaluate((form) => form.requestSubmit());
    assert.equal(new URL(page.url()).searchParams.has("q"), false, "Empty search did not clear stale URL state.");

    const delayedPage = await context.newPage();
    await delayedPage.route("**/assets/data/search-index.json", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    await delayedPage.goto(`${baseUrl}/search.html`, { waitUntil: "domcontentloaded" });
    await delayedPage.locator("[data-evidence-search-input]").fill("Rust UniFFI");
    await delayedPage.locator("[data-evidence-search-form]").evaluate((form) => form.requestSubmit());
    assert.equal(new URL(delayedPage.url()).searchParams.get("q"), "Rust UniFFI",
      "A search submitted while the index loads was not preserved in the URL.");
    await delayedPage.locator("[data-evidence-search-status]").filter({ hasText: /published match/ }).waitFor();
    assert.equal(await delayedPage.locator("[data-evidence-search-input]").inputValue(), "Rust UniFFI");
    assert(await delayedPage.locator(".evidence-result").count() > 0,
      "A search submitted while the index loads was discarded after readiness.");
    await delayedPage.close();

    const deepLinkPage = await context.newPage();
    await deepLinkPage.goto(
      `${baseUrl}/search.html?q=${encodeURIComponent("Trace the product past the first client symptom")}`,
      { waitUntil: "domcontentloaded" }
    );
    await deepLinkPage.locator("[data-evidence-search-status]").filter({ hasText: /published match/ }).waitFor();
    const workResult = deepLinkPage.locator('a[href="/work.html#brief-cross-platform-systems-title"]');
    assert.equal(await workResult.count(), 1, "Search did not link to the matched Work briefing heading.");
    await Promise.all([
      deepLinkPage.waitForURL(/\/work\.html#brief-cross-platform-systems-title$/),
      workResult.click()
    ]);
    await deepLinkPage.waitForFunction(() => {
      const target = document.getElementById("brief-cross-platform-systems-title");
      return target?.closest("[data-brief-panel]")?.hidden === false
        && document.querySelector("[data-work-briefing]")?.dataset.activeBrief === "cross-platform-systems";
    });
    assert.equal(await deepLinkPage.locator("#brief-cross-platform-systems-title").isVisible(), true,
      "The Work search result opened a hidden briefing target.");

    await deepLinkPage.goto(
      `${baseUrl}/search.html?q=${encodeURIComponent("building documenting deterministic snapshot")}`,
      { waitUntil: "domcontentloaded" }
    );
    await deepLinkPage.locator("[data-evidence-search-status]").filter({ hasText: /published match/ }).waitFor();
    const radarResult = deepLinkPage.locator('a[href="/#facet-threads-title"]');
    assert.equal(await radarResult.count(), 1, "Search did not link to the matched Current work radar heading.");
    await Promise.all([
      deepLinkPage.waitForURL(/\/#facet-threads-title$/),
      radarResult.click()
    ]);
    await deepLinkPage.waitForFunction(() => (
      document.querySelector("[data-synthesis]")?.dataset.phase === "focused"
        && document.querySelector("[data-synthesis]")?.dataset.selected === "threads"
    ));
    assert.equal(await deepLinkPage.locator("#facet-threads-title").isVisible(), true,
      "The Current work search result opened a hidden homepage facet target.");
    assert.equal(await deepLinkPage.locator("[data-facet-position]").textContent(), "05 / 06 · CURRENT WORK RADAR");
    assert.equal(
      await deepLinkPage.locator("[data-facet-status]").textContent(),
      "Current work radar · Dated portfolio, agent-delivery, and memory-system work."
    );
    await deepLinkPage.close();

    await assertHeaderSearch(page, "Desktop Evidence Search", ".search-topbar");
    assert.equal(await page.locator("[data-calm-sky-toggle], [data-calm-sky-status]").count(), 0);
    await page.evaluate(() => localStorage.setItem("ac.motion-preference.v1", "calm"));
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await assertHeaderSearch(page, "Desktop Dashboard", "#site-topbar");
    const removedCalmState = await page.evaluate(() => ({
      api: typeof window.CalmSky,
      mode: document.documentElement.dataset.motionMode || null,
      preference: document.documentElement.dataset.motionPreference || null,
      stored: localStorage.getItem("ac.motion-preference.v1")
    }));
    assert.deepEqual(removedCalmState, { api: "undefined", mode: null, preference: null, stored: "calm" },
      "A legacy Calm Sky preference still changes the public runtime.");
    await page.evaluate(() => localStorage.removeItem("ac.motion-preference.v1"));
    await page.locator('[data-map-target="projects"]').click();
    await page.waitForFunction(() => document.querySelector("[data-synthesis]")?.dataset.phase === "focused");
    await page.keyboard.press("/");
    await page.waitForURL(/\/search\.html/);
    assert.equal(await page.locator("[data-evidence-search-input]").evaluate((input) => input === document.activeElement), true,
      "The Search shortcut did not focus the evidence query on the Search route.");

    await page.goto(`${baseUrl}/experiments/universe-options/work-round-05/supernova-portfolio.html`, { waitUntil: "domcontentloaded" });
    const experimentSearch = page.locator('[data-site-search-link][href="/search.html"]');
    assert.equal(await experimentSearch.isVisible(), true, "Adopted experiment lost its header Search control.");
    assert.equal(await page.locator('script[src^="/assets/js/site-search.js"]').count(), 1);
    assert.equal(await page.locator("[data-calm-sky-toggle], [data-calm-sky-status]").count(), 0,
      "Experiment route still exposes Calm Sky UI.");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.motionMode || null), null,
      "Experiment route still applies a manual motion preference.");
    await assertHeaderSearch(page, "Desktop adopted experiment", "#site-topbar");
    await Promise.all([
      page.waitForURL(/\/search\.html/),
      experimentSearch.click()
    ]);
    assert.equal(await page.locator("[data-calm-sky-toggle], [data-calm-sky-status]").count(), 0);
    await context.close();

    const reducedContext = await browser.newContext({ reducedMotion: "reduce" });
    const reducedPage = await reducedContext.newPage();
    await reducedPage.goto(`${baseUrl}/experiments/universe-options/logs/05-spiral-galaxy-archive.html`, { waitUntil: "domcontentloaded" });
    await reducedPage.waitForSelector('#galaxy-field[data-ready="true"]');
    assert.equal(await reducedPage.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
    assert.equal(await reducedPage.evaluate(() => document.documentElement.dataset.motionMode || null), null,
      "Native reduced motion should not recreate a manual motion mode.");
    assert.equal(await reducedPage.locator("[data-calm-sky-toggle], [data-calm-sky-status]").count(), 0);
    assert.equal(await reducedPage.locator("[data-site-search-link], .site-tools").count(), 0,
      "Archived Logs experiment received an invented Search overlay.");
    await reducedContext.close();

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await assertHeaderSearch(mobilePage, "Mobile Dashboard", "#site-topbar");

    await mobilePage.goto(`${baseUrl}/blog/`, { waitUntil: "domcontentloaded" });
    await mobilePage.waitForSelector('#galaxy-field[data-ready="true"]');
    await assertHeaderSearch(mobilePage, "Mobile Logs", "#site-topbar");
    await mobilePage.goto(`${baseUrl}/404.html`, { waitUntil: "domcontentloaded" });
    assert.equal(await mobilePage.locator("[data-site-search-link], .site-tools").count(), 0);
    assert.equal(await mobilePage.locator('.lost-signal__search[action="/search.html"]').count(), 1);
    await mobileContext.close();

    const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
    const noScriptPage = await noScriptContext.newPage();
    await noScriptPage.goto(`${baseUrl}/search.html`);
    assert(await noScriptPage.locator(".evidence-search__noscript").isVisible());
    assert.equal(await noScriptPage.locator(".evidence-search__console").isVisible(), false);
    assert.equal(await noScriptPage.locator(".evidence-search__results").isVisible(), false);
    assert.equal(await noScriptPage.locator('.evidence-search__noscript a[href="/work.html"]').count(), 1);
    assert.equal(await noScriptPage.locator('[data-site-search-link][href="#evidence-query"]').count(), 1);
    assert.equal(await noScriptPage.locator("[data-calm-sky-toggle], [data-calm-sky-status]").count(), 0);
    await assertHeaderSearch(noScriptPage, "No-JavaScript Evidence Search", ".search-topbar");

    await noScriptPage.goto(`${baseUrl}/blog/`);
    assert.equal(await noScriptPage.locator('[data-site-search-link][href="/search.html"]').isVisible(), true);
    await assertHeaderSearch(noScriptPage, "No-JavaScript Logs", "#site-topbar");
    await noScriptPage.goto(`${baseUrl}/404.html`);
    assert.equal(await noScriptPage.locator("[data-site-search-link], .site-tools").count(), 0);
    assert.equal(await noScriptPage.locator('.lost-signal__search[action="/search.html"]').count(), 1);
    await noScriptContext.close();

    console.log("Verified explicit in-header Search slots, 44px targets, keyboard/no-JS access, specialized-status preservation, no overlay, and native-only reduced motion.");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
