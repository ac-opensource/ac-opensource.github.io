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
    const searchInstrument = await page.evaluate(() => {
      const bounds = (selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box && { bottom: box.bottom, height: box.height, left: box.left, right: box.right, top: box.top, width: box.width };
      };
      const field = document.querySelector("[data-search-field]");
      const controls = [...document.querySelectorAll(
        "[data-evidence-search-input], [data-evidence-search-form] button, [data-search-suggestion]"
      )].map((control) => {
        const box = control.getBoundingClientRect();
        return { height: box.height, width: box.width };
      });
      return {
        controls,
        fieldAriaHidden: field?.getAttribute("aria-hidden"),
        fieldPointerEvents: field && getComputedStyle(field).pointerEvents,
        inputLabels: document.querySelector("[data-evidence-search-input]")?.labels.length,
        input: bounds("[data-evidence-search-input]"),
        overflow: document.documentElement.scrollWidth - innerWidth,
        phase: document.querySelector("[data-search-navigation]")?.dataset.searchPhase,
        shell: bounds("[data-search-navigation]"),
        viewportHeight: innerHeight,
      };
    });
    assert(searchInstrument.overflow <= 1, `Desktop Search overflows horizontally: ${JSON.stringify(searchInstrument)}`);
    assert(searchInstrument.shell?.left >= 0 && searchInstrument.shell?.right <= 1281,
      `Desktop Search instrument escapes the viewport: ${JSON.stringify(searchInstrument.shell)}`);
    assert(searchInstrument.controls.every(({ height, width }) => height >= 44 && width >= 44),
      `Search exposes a target below 44px: ${JSON.stringify(searchInstrument.controls)}`);
    assert.equal(searchInstrument.fieldAriaHidden, "true");
    assert.equal(searchInstrument.fieldPointerEvents, "none");
    assert.equal(searchInstrument.inputLabels, 1, "Search destination input lost its accessible label.");
    assert(searchInstrument.input?.bottom <= searchInstrument.viewportHeight + 1,
      `Desktop Search input falls below the first viewport: ${JSON.stringify(searchInstrument.input)}`);
    assert.equal(searchInstrument.phase, "results");
    const publicIndex = await page.evaluate(async () => (await fetch("/assets/data/search-index.json")).json());
    assert.equal(publicIndex.version, 1);
    assert(publicIndex.documents.every((record) => /^\/(?!\/)/.test(record.url)));
    assert(!JSON.stringify(publicIndex).includes("blog.sqlite"));

    const repeatedHistoryLength = await page.evaluate(() => history.length);
    await page.locator("[data-evidence-search-form]").evaluate((form) => form.requestSubmit());
    assert.equal(await page.evaluate(() => history.length), repeatedHistoryLength,
      "Repeating the same canonical search created a duplicate history entry.");

    await page.locator("[data-evidence-search-input]").fill("privacy");
    await page.locator("[data-evidence-search-form]").evaluate((form) => form.requestSubmit());
    await page.locator("[data-evidence-search-status]").filter({ hasText: /published match/ }).waitFor();
    await page.goBack();
    await page.waitForURL((url) => url.searchParams.get("q") === "release reliability");
    assert.equal(await page.locator("[data-evidence-search-input]").inputValue(), "release reliability");
    assert.equal(await page.locator("[data-search-navigation]").getAttribute("data-search-phase"), "results");
    assert(await page.locator(".evidence-result").count() > 0,
      "Back navigation did not restore the previous Search results.");
    await page.goForward();
    await page.waitForURL((url) => url.searchParams.get("q") === "privacy");
    assert.equal(await page.locator("[data-evidence-search-input]").inputValue(), "privacy");
    assert.equal(await page.locator("[data-search-navigation]").getAttribute("data-search-phase"), "results");
    assert(await page.locator(".evidence-result").count() > 0,
      "Forward navigation did not restore the next Search results.");

    await page.locator("[data-evidence-search-input]").fill("route-that-does-not-exist-zzzz");
    await page.locator("[data-evidence-search-form]").evaluate((form) => form.requestSubmit());
    await page.locator("[data-evidence-search-status]").filter({ hasText: /^0 published matches/ }).waitFor();
    assert.equal(await page.locator("[data-search-navigation]").getAttribute("data-search-phase"), "empty");
    assert.equal(await page.locator(".evidence-result").count(), 0, "Empty route retained stale results.");

    await page.locator("[data-evidence-search-input]").fill("");
    await page.locator("[data-evidence-search-form]").evaluate((form) => form.requestSubmit());
    assert.equal(new URL(page.url()).searchParams.has("q"), false, "Empty search did not clear stale URL state.");
    assert.equal(await page.locator("[data-search-navigation]").getAttribute("data-search-phase"), "idle");

    const delayedPage = await context.newPage();
    await delayedPage.route("**/assets/data/search-index.json", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    await delayedPage.goto(`${baseUrl}/search.html`, { waitUntil: "domcontentloaded" });
    await delayedPage.locator("[data-evidence-search-input]").fill("Rust UniFFI");
    await delayedPage.locator("[data-evidence-search-form]").evaluate((form) => form.requestSubmit());
    assert.equal(await delayedPage.locator("[data-search-navigation]").getAttribute("data-search-phase"), "loading");
    assert.equal(new URL(delayedPage.url()).searchParams.get("q"), "Rust UniFFI",
      "A search submitted while the index loads was not preserved in the URL.");
    await delayedPage.locator("[data-evidence-search-status]").filter({ hasText: /published match/ }).waitFor();
    assert.equal(await delayedPage.locator("[data-evidence-search-input]").inputValue(), "Rust UniFFI");
    assert(await delayedPage.locator(".evidence-result").count() > 0,
      "A search submitted while the index loads was discarded after readiness.");
    await delayedPage.close();

    const unavailablePage = await context.newPage();
    await unavailablePage.route("**/assets/data/search-index.json", (route) => route.abort());
    await unavailablePage.goto(`${baseUrl}/search.html`, { waitUntil: "domcontentloaded" });
    await unavailablePage.locator("[data-evidence-search-status]").filter({ hasText: "Search index unavailable" }).waitFor();
    assert.equal(await unavailablePage.locator("[data-search-navigation]").getAttribute("data-search-phase"), "error");
    assert.equal(await unavailablePage.locator(".evidence-result").count(), 0,
      "Unavailable route index retained stale results.");
    await unavailablePage.close();

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
    await reducedPage.goto(`${baseUrl}/search.html?q=privacy`, { waitUntil: "domcontentloaded" });
    await reducedPage.locator("[data-evidence-search-status]").filter({ hasText: /published match/ }).waitFor();
    await reducedPage.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const reducedSearch = await reducedPage.evaluate(() => ({
      animations: document.querySelector("[data-search-navigation]").getAnimations({ subtree: true })
        .filter((animation) => ["pending", "running"].includes(animation.playState)).length,
      media: matchMedia("(prefers-reduced-motion: reduce)").matches,
      motion: document.querySelector("[data-search-navigation]").dataset.searchMotion || null,
      overflow: document.documentElement.scrollWidth - innerWidth,
      phase: document.querySelector("[data-search-navigation]").dataset.searchPhase,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    }));
    assert.equal(reducedSearch.animations, 0,
      `Reduced-motion Search still animates: ${JSON.stringify(reducedSearch)}`);
    assert.equal(reducedSearch.media, true);
    assert.equal(reducedSearch.motion, null);
    assert(reducedSearch.overflow <= 1, `Reduced-motion Search overflows: ${JSON.stringify(reducedSearch)}`);
    assert.equal(reducedSearch.phase, "results");
    assert.equal(reducedSearch.scrollBehavior, "auto");
    await reducedContext.close();

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await assertHeaderSearch(mobilePage, "Mobile Dashboard", "#site-topbar");

    await mobilePage.goto(`${baseUrl}/blog/`, { waitUntil: "domcontentloaded" });
    await mobilePage.waitForSelector('#galaxy-field[data-ready="true"]');
    await assertHeaderSearch(mobilePage, "Mobile Logs", "#site-topbar");
    await mobilePage.goto(`${baseUrl}/search.html?q=Android`, { waitUntil: "domcontentloaded" });
    await mobilePage.locator("[data-evidence-search-status]").filter({ hasText: /published match/ }).waitFor();
    await assertHeaderSearch(mobilePage, "Mobile Evidence Search", ".search-topbar");
    const mobileSearch = await mobilePage.evaluate(() => {
      const rectangles = (selector) => [...document.querySelectorAll(selector)].map((element) => {
        const box = element.getBoundingClientRect();
        return { bottom: box.bottom, height: box.height, left: box.left, right: box.right, top: box.top, width: box.width };
      });
      const input = document.querySelector("[data-evidence-search-input]").getBoundingClientRect();
      const submit = document.querySelector('[data-evidence-search-form] button[type="submit"]').getBoundingClientRect();
      const suggestionRows = new Set(rectangles("[data-search-suggestion]").map(({ top }) => Math.round(top)));
      return {
        controls: rectangles("[data-evidence-search-input], [data-evidence-search-form] button, [data-search-suggestion], .evidence-result h3 a"),
        fieldPointerEvents: getComputedStyle(document.querySelector("[data-search-field]")).pointerEvents,
        inputSubmitOverlap: !(input.right <= submit.left || submit.right <= input.left || input.bottom <= submit.top || submit.bottom <= input.top),
        overflow: document.documentElement.scrollWidth - innerWidth,
        phase: document.querySelector("[data-search-navigation]").dataset.searchPhase,
        suggestionRows: suggestionRows.size,
      };
    });
    assert(mobileSearch.overflow <= 1, `Mobile Search overflows horizontally: ${JSON.stringify(mobileSearch)}`);
    assert(mobileSearch.controls.every(({ height, left, right, width }) => (
      height >= 44 && width >= 44 && left >= -1 && right <= 391
    )), `Mobile Search exposes a clipped or small target: ${JSON.stringify(mobileSearch.controls)}`);
    assert.equal(mobileSearch.inputSubmitOverlap, false, "Mobile Search input overlaps its route button.");
    assert.equal(mobileSearch.fieldPointerEvents, "none");
    assert.equal(mobileSearch.phase, "results");
    assert(mobileSearch.suggestionRows > 1, "Mobile known routes did not wrap.");
    await mobilePage.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await mobilePage.waitForFunction(() => scrollY > 0);
    await mobilePage.goto(`${baseUrl}/404.html`, { waitUntil: "domcontentloaded" });
    assert.equal(await mobilePage.locator("[data-site-search-link], .site-tools").count(), 0);
    assert.equal(await mobilePage.locator('.lost-signal__search[action="/search.html"]').count(), 1);
    await mobileContext.close();

    const compactContext = await browser.newContext({ viewport: { width: 320, height: 760 } });
    const compactPage = await compactContext.newPage();
    for (const route of ["/", "/work.html", "/about.html", "/blog/", "/resume.html", "/contact.html", "/search.html"]) {
      await compactPage.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
      const compactNav = await compactPage.evaluate(() => {
        const nav = document.querySelector("#site-nav-mobile");
        const links = [...(nav?.querySelectorAll(":scope > a") || [])]
          .filter((link) => getComputedStyle(link).display !== "none" && link.getClientRects().length > 0)
          .map((link) => {
            const box = link.getBoundingClientRect();
            return {
              bottom: box.bottom,
              height: box.height,
              label: link.textContent.trim(),
              left: box.left,
              right: box.right,
              top: box.top,
              width: box.width
            };
          });
        const navBox = nav?.getBoundingClientRect();
        return {
          labels: links.map(({ label }) => label),
          links,
          mapVisible: Boolean(document.querySelector(".universe-route-map")?.getClientRects().length),
          nav: navBox && { left: navBox.left, right: navBox.right },
          overflow: document.documentElement.scrollWidth - innerWidth
        };
      });
      assert.deepEqual(
        compactNav.labels,
        ["[portfolio]", "[logs]", "[about]", "[résumé]", "[contact]"],
        `${route} compact navigation lost its five deliberate destinations.`
      );
      assert(compactNav.links.every(({ height, left, right, width }) => (
        height >= 44 && width >= 44 && left >= -1 && right <= 321
      )), `${route} compact navigation clips or shrinks a destination: ${JSON.stringify(compactNav)}`);
      assert(compactNav.nav?.left >= -1 && compactNav.nav?.right <= 321,
        `${route} compact navigation rail escapes the viewport: ${JSON.stringify(compactNav.nav)}`);
      assert.equal(compactNav.mapVisible, false,
        `${route} keeps the redundant fixed field map over 320px content.`);
      assert(compactNav.overflow <= 1, `${route} compact header creates horizontal overflow: ${JSON.stringify(compactNav)}`);
    }
    await compactContext.close();

    const phoneMapContext = await browser.newContext({ viewport: { width: 480, height: 900 } });
    const phoneMapPage = await phoneMapContext.newPage();
    for (const route of ["/work.html", "/about.html", "/blog/", "/resume.html", "/contact.html"]) {
      await phoneMapPage.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
      assert.equal(await phoneMapPage.locator(".universe-route-map").isVisible().catch(() => false), false,
        `${route} keeps the redundant field map over phone content.`);
    }
    await phoneMapContext.close();

    const noScriptContext = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 320, height: 760 }
    });
    const noScriptPage = await noScriptContext.newPage();
    await noScriptPage.goto(`${baseUrl}/search.html`);
    assert(await noScriptPage.locator(".evidence-search__noscript").isVisible());
    assert.equal(await noScriptPage.locator(".evidence-search__console").isVisible(), false);
    assert.equal(await noScriptPage.locator(".evidence-search__results").isVisible(), false);
    assert.equal(await noScriptPage.locator('.evidence-search__noscript a[href="/work.html"]').count(), 1);
    assert.equal(await noScriptPage.locator('[data-site-search-link][href="#search-noscript-title"]').count(), 1);
    const noScriptFallback = await noScriptPage.evaluate(() => {
      const link = document.querySelector("[data-site-search-link]");
      const target = link?.hash && document.querySelector(link.hash);
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        targetVisible: Boolean(target && target.getClientRects().length),
      };
    });
    assert(noScriptFallback.overflow <= 1, `No-JavaScript Search overflows: ${JSON.stringify(noScriptFallback)}`);
    assert.equal(noScriptFallback.targetVisible, true, "No-JavaScript header Search points to a hidden target.");
    assert.equal(await noScriptPage.locator("[data-calm-sky-toggle], [data-calm-sky-status]").count(), 0);
    await assertHeaderSearch(noScriptPage, "No-JavaScript Evidence Search", ".search-topbar");

    for (const [route, label] of [["/work.html", "Work"], ["/blog/", "Logs"]]) {
      await noScriptPage.goto(`${baseUrl}${route}`);
      assert.equal(await noScriptPage.locator('[data-site-search-link][href="/search.html"]').isVisible(), true);
      await assertHeaderSearch(noScriptPage, `No-JavaScript ${label}`, "#site-topbar");
      const shell = await noScriptPage.evaluate(() => {
        const header = document.querySelector("#site-topbar");
        const brand = header.querySelector(":scope > div > a:first-child");
        const nav = header.querySelector("#site-nav-mobile");
        const links = [...nav.querySelectorAll(":scope > a")]
          .filter((link) => getComputedStyle(link).display !== "none");
        return {
          brandDecoration: getComputedStyle(brand).textDecorationLine,
          brandFamily: getComputedStyle(brand).fontFamily,
          headerPosition: getComputedStyle(header).position,
          labels: links.map((link) => link.textContent.trim()),
          navClientWidth: nav.clientWidth,
          navScrollWidth: nav.scrollWidth,
          targets: links.map((link) => {
            const box = link.getBoundingClientRect();
            return { height: box.height, left: box.left, right: box.right, width: box.width };
          })
        };
      });
      assert.equal(shell.headerPosition, "fixed", `${label} loses its fixed shell without JavaScript.`);
      assert.equal(shell.brandDecoration, "none", `${label} falls back to an underlined browser-default brand.`);
      assert(!/times|serif/i.test(shell.brandFamily), `${label} falls back to a serif browser-default brand.`);
      assert.deepEqual(shell.labels, ["[portfolio]", "[logs]", "[about]", "[résumé]", "[contact]"]);
      assert.equal(shell.navScrollWidth, shell.navClientWidth, `${label} no-JavaScript nav becomes a hidden rail.`);
      assert(shell.targets.every(({ height, left, right, width }) => (
        height >= 44 && width >= 44 && left >= -1 && right <= 321
      )), `${label} no-JavaScript nav clips or shrinks a target: ${JSON.stringify(shell.targets)}`);
    }
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
