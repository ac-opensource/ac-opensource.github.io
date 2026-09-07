const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");
const publication = require("./site-publication.config");

const ROOT = path.join(__dirname, "..");
const DIST_ROOT = path.join(ROOT, "dist");
let BASE_URL = process.env.OPTIONS_BASE_URL || "";
const GALLERY_PATH = "/experiments/universe-options/index.html";
const MIME_TYPES = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8"
};
const REGIONS = [
  "dashboard",
  "work",
  "logs",
  "about",
  "contact",
  "resume",
  "articles",
  "signals",
  "transitions"
];
const REGION_DIRECTION_COUNTS = Object.fromEntries(REGIONS.map((region) => [
  region,
  region === "work" ? 5 : region === "logs" ? 4 : 3
]));
const EXPECTED_DIRECTION_TOTAL = Object.values(REGION_DIRECTION_COUNTS).reduce((total, count) => total + count, 0);
const ROUND_04_PORTFOLIO_ROUTES = [
  "/experiments/universe-options/work-round-04/flagship-deck.html",
  "/experiments/universe-options/work-round-04/flagship-gravity.html",
  "/experiments/universe-options/work-round-04/flagship-broadsheet.html"
];
const EXPECTED_PORTFOLIO_IDS = [
  "bitcoin-wallet",
  "itvx",
  "ocbc-business",
  "openpay",
  "mystc",
  "littlepay",
  "owto",
  "popslide",
  "websafety",
  "solo",
  "projectbass",
  "ntu-pass",
  "aqua-expeditions",
  "persons-finder",
  "orchestrum",
  "mempalace"
];
const EXPECTED_PORTFOLIO_HREFS = [
  "https://play.google.com/store/apps/details?id=com.bitcoin.mwallet&hl=en",
  "https://play.google.com/store/apps/details?id=air.ITVMobilePlayer&hl=en",
  "/blog/case-study-ocbc-banking-experience.html",
  "https://play.google.com/store/apps/details?id=com.ocbc.mobilebv&hl=en",
  "/blog/case-study-openpay-bnpl-experience.html",
  "/blog/case-study-mystc-scale-and-reliability.html",
  "https://littlepay.com/",
  "/blog/case-study-owto-ride-hailing-platform.html",
  "/blog/case-study-popslide-engagement-and-monetization.html",
  "/blog/case-study-websafety-parental-controls.html",
  "https://play.google.com/store/apps/developer?id=Solo+Technologies+Services&hl=en",
  "/blog/case-study-solo-whitelabel-delivery-platform.html",
  "/blog/case-study-projectbass-crowdsourced-network-mapping.html",
  "https://play.google.com/store/apps/details?id=sg.edu.ntu.apps.ntusmartpass&hl=en",
  "https://www.aquaexpeditions.com/",
  "https://github.com/ac-opensource/persons-finder",
  "https://github.com/ac-opensource/Orchestrum",
  "https://github.com/MemPalace/mempalace/pull/78"
];
const REQUIRED_PRODUCTION_COPY = {
  itvx: ["Candyspace", "Media player team", "player recommendations", "preview timeline scrubbing", "errors, security, and player data parsing"],
  "ocbc-business": ["Senior Mobile Engineer", "RedAirship", "business accounts", "digital account opening", "reliable third-party identity"],
  openpay: ["Senior Mobile Engineer", "RedAirship", "spending limits", "merchant discovery", "partner-integrated payment flows"],
  mystc: ["Lead Developer", "five senior Android engineers", "English and Arabic", "sync, performance, and releases"]
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createStaticServer() {
  return http.createServer((request, response) => {
    if (!request.url || !["GET", "HEAD"].includes(request.method || "")) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    let filePath;
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const withIndex = relativePath.endsWith("/") ? `${relativePath}index.html` : relativePath;
      filePath = path.resolve(DIST_ROOT, withIndex);
      const distRelative = path.relative(DIST_ROOT, filePath);
      if (distRelative.startsWith("..") || path.isAbsolute(distRelative)) filePath = null;
    } catch (_error) {
      response.writeHead(400);
      response.end("Bad request");
      return;
    }

    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const stat = fs.statSync(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": stat.size,
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(filePath).pipe(response);
  });
}

function localPath(href) {
  const url = new URL(href, BASE_URL);
  assert(url.origin === new URL(BASE_URL).origin, `Option escaped the local design lab: ${href}`);
  return `${url.pathname}${url.search}${url.hash}`;
}

async function discoverOptions(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const options = [];

  for (const region of REGIONS) {
    await page.goto(`${BASE_URL}${GALLERY_PATH}?region=${region}`, { waitUntil: "domcontentloaded" });
    const rows = await page.locator(".option-trajectories a").evaluateAll((anchors) => anchors.map((anchor) => ({
      href: anchor.getAttribute("href"),
      status: anchor.dataset.status,
      disabled: anchor.getAttribute("aria-disabled"),
      label: anchor.querySelector("small")?.textContent?.trim() || ""
    })));

    const expectedCount = REGION_DIRECTION_COUNTS[region];
    assert(rows.length === expectedCount, `${region} exposes ${rows.length} directions instead of ${expectedCount}.`);
    rows.forEach((row, index) => {
      assert(row.status === "live", `${region} option ${index + 1} is still ${row.status || "unlabelled"}.`);
      assert(row.href, `${region} option ${index + 1} is live without a direct URL.`);
      assert(row.disabled !== "true", `${region} option ${index + 1} is live but disabled.`);
      options.push({ region, index: index + 1, label: row.label, path: localPath(row.href) });
    });
  }

  await page.close();
  assert(options.length === EXPECTED_DIRECTION_TOTAL, `Expected ${EXPECTED_DIRECTION_TOTAL} directions; discovered ${options.length}.`);
  return options;
}

async function smokeRoutes(browser, options) {
  const routes = [...new Set(options.map((option) => option.path))];
  const viewports = [
    { label: "desktop", width: 1440, height: 1000, reducedMotion: "no-preference" },
    { label: "mobile-reduced", width: 390, height: 844, reducedMotion: "reduce" }
  ];

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: viewport.reducedMotion
    });

    for (const route of routes) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });

      const response = await page.goto(`${BASE_URL}${route}`, {
        waitUntil: "domcontentloaded",
        timeout: 15000
      });
      await page.waitForTimeout(150);
      const state = await page.evaluate(() => ({
        rootWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        hasMain: Boolean(document.querySelector("main")),
        hasHeading: Boolean(document.querySelector("h1")),
        title: document.title.trim(),
        textLength: (document.querySelector("main")?.innerText || "").replace(/\s+/g, " ").trim().length
      }));

      assert(response && response.status() < 400, `${route} returned ${response?.status() || "no response"}.`);
      assert(errors.length === 0, `${route} logged errors at ${viewport.label}: ${errors.join(" | ")}`);
      assert(state.rootWidth <= state.viewportWidth + 2, `${route} exposes horizontal overflow at ${viewport.label}: ${state.rootWidth}/${state.viewportWidth}.`);
      assert(state.hasMain && state.hasHeading && state.title, `${route} is missing its main page shell at ${viewport.label}.`);
      assert(state.textLength >= 120, `${route} has too little readable content at ${viewport.label}.`);
      await page.close();
    }

    await context.close();
  }

  return routes;
}

async function smokeNoJavaScript(browser, routes) {
  const experiments = [GALLERY_PATH, ...routes.filter((route) => route.startsWith("/experiments/universe-options/"))];
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();

  for (const route of experiments) {
    const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "load", timeout: 15000 });
    const state = await page.evaluate(() => ({
      rootWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      hasMain: Boolean(document.querySelector("main")),
      textLength: document.body.innerText.replace(/\s+/g, " ").trim().length,
      exposedEnhancements: [...document.querySelectorAll("[hidden]")].filter((element) => getComputedStyle(element).display !== "none").length
    }));

    assert(response && response.status() < 400, `${route} failed without JavaScript.`);
    assert(state.hasMain && state.textLength >= 180, `${route} loses essential content without JavaScript.`);
    assert(state.rootWidth <= state.viewportWidth + 2, `${route} overflows mobile without JavaScript: ${state.rootWidth}/${state.viewportWidth}.`);
    assert(state.exposedEnhancements === 0, `${route} exposes ${state.exposedEnhancements} hidden enhancement controls without JavaScript.`);
    if (route === GALLERY_PATH) {
      const directOptions = await page.locator(".no-js-options a").count();
      assert(directOptions === EXPECTED_DIRECTION_TOTAL, `No-JavaScript gallery exposes ${directOptions} directions instead of ${EXPECTED_DIRECTION_TOTAL}.`);
    }
  }

  await context.close();
}

async function verifySpiralGalaxyArchive(browser) {
  const route = "/experiments/universe-options/logs/05-spiral-galaxy-archive.html";
  const expectedPosts = JSON.parse(fs.readFileSync(path.join(DIST_ROOT, "blog", "posts.json"), "utf8")).length;
  const viewports = [
    { label: "desktop", width: 1440, height: 1000, reducedMotion: "no-preference" },
    { label: "narrow-tablet", width: 732, height: 922, reducedMotion: "no-preference" },
    { label: "mobile-reduced", width: 390, height: 844, reducedMotion: "reduce" }
  ];

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: viewport.reducedMotion
    });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForSelector('#galaxy-field[data-ready="true"]', { timeout: 15000 });
    await page.waitForTimeout(220);

    const state = await page.evaluate(() => {
      const labels = [...document.querySelectorAll(".galaxy-node__label")].map((label) => {
        const rect = label.getBoundingClientRect();
        return { bottom: rect.bottom, left: rect.left, right: rect.right, text: label.textContent.trim(), top: rect.top };
      });
      let largestLabelOverlap = 0;
      for (let left = 0; left < labels.length; left += 1) {
        for (let right = left + 1; right < labels.length; right += 1) {
          const overlapX = Math.min(labels[left].right, labels[right].right) - Math.max(labels[left].left, labels[right].left);
          const overlapY = Math.min(labels[left].bottom, labels[right].bottom) - Math.max(labels[left].top, labels[right].top);
          if (overlapX > 2 && overlapY > 2) largestLabelOverlap = Math.max(largestLabelOverlap, overlapX * overlapY);
        }
      }
      const nodeTruth = [...document.querySelectorAll(".galaxy-node")].map((node) => ({
        label: node.querySelector(".galaxy-node__label")?.textContent.trim() || "",
        minutes: Number(node.dataset.readingMinutes || 0),
        size: Number.parseFloat(getComputedStyle(node).getPropertyValue("--node-size"))
      }));
      const canvas = document.querySelector("#galaxy-sky");
      const core = document.querySelector(".galaxy-core__horizon").getBoundingClientRect();
      const field = document.querySelector("#galaxy-field").getBoundingClientRect();
      const intro = document.querySelector(".galaxy-intro").getBoundingClientRect();
      const tuner = document.querySelector("#galaxy-tuner").getBoundingClientRect();
      return {
        canvasHeight: canvas.height,
        canvasWidth: canvas.width,
        coreInsideField: core.left >= field.left && core.right <= field.right && core.top >= field.top && core.bottom <= field.bottom,
        entries: document.querySelectorAll(".galaxy-entry").length,
        fieldLabel: document.querySelector("#galaxy-field").getAttribute("aria-label"),
        introTunerGap: tuner.top - intro.bottom,
        largestLabelOverlap,
        nodeTruth,
        rootWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
      };
    });

    assert(state.entries === expectedPosts && state.nodeTruth.length === expectedPosts,
      `Spiral Galaxy rendered ${state.nodeTruth.length} nodes and ${state.entries} entries instead of ${expectedPosts} at ${viewport.label}.`);
    assert(state.canvasWidth > 0 && state.canvasHeight > 0 && state.coreInsideField,
      `Spiral Galaxy is missing its rendered galaxy or centered galactic core at ${viewport.label}.`);
    assert(/spiral arms.+luminous galactic core/i.test(state.fieldLabel || ""),
      "Spiral Galaxy does not expose its visual model accessibly.");
    assert(state.nodeTruth.every((node) => node.label && node.minutes > 0 && node.size > 0),
      `Spiral Galaxy has an unlabeled or unsized article node at ${viewport.label}.`);
    const minuteOrdered = [...state.nodeTruth].sort((left, right) => left.minutes - right.minutes);
    assert(minuteOrdered.every((node, index) => index === 0 || node.size >= minuteOrdered[index - 1].size),
      "Spiral Galaxy node size does not grow monotonically with published reading time.");
    assert(state.largestLabelOverlap < 300,
      `Spiral Galaxy labels materially collide at ${viewport.label} (${state.largestLabelOverlap.toFixed(0)}px² overlap).`);
    assert(state.rootWidth <= state.viewportWidth + 2,
      `Spiral Galaxy overflows horizontally at ${viewport.label}: ${state.rootWidth}/${state.viewportWidth}.`);
    assert(state.introTunerGap >= 16,
      `Spiral Galaxy search overlaps the hero copy at ${viewport.label}: ${state.introTunerGap.toFixed(1)}px gap.`);

    const firstNode = page.locator(".galaxy-node").first();
    const selectedSlug = await firstNode.getAttribute("data-slug");
    await firstNode.click();
    await page.waitForFunction((slug) => new URL(location.href).searchParams.get("target") === slug, selectedSlug);
    const focus = await page.evaluate((slug) => {
      const popup = document.querySelector("#galaxy-focus");
      const field = document.querySelector("#galaxy-field").getBoundingClientRect();
      const rect = popup.getBoundingClientRect();
      return {
        direct: popup.querySelector("#galaxy-focus-link")?.getAttribute("href"),
        hidden: popup.hidden,
        inside: rect.left >= field.left - 1 && rect.right <= field.right + 1 && rect.top >= field.top - 1 && rect.bottom <= field.bottom + 1
      };
    }, selectedSlug);
    assert(!focus.hidden && focus.inside && focus.direct === `/blog/${encodeURIComponent(selectedSlug)}.html`,
      `Spiral Galaxy selected-entry bubble is not usable at ${viewport.label}: ${JSON.stringify(focus)}.`);

    await page.fill("#galaxy-search", "photography");
    if (viewport.reducedMotion !== "reduce") {
      await page.waitForTimeout(viewport.width <= 920 ? 80 : 180);
      const duringTyping = await page.evaluate(() => ({
        choreography: document.querySelector(".galaxy-hero").classList.contains("is-encounter-choreography"),
        state: document.querySelector(".galaxy-hero").dataset.merger
      }));
      assert(duringTyping.state === "archive" && !duringTyping.choreography,
        `Spiral Galaxy commits a search before the typing pause at ${viewport.label}: ${JSON.stringify(duringTyping)}.`);
    }
    await page.waitForTimeout(viewport.reducedMotion === "reduce" ? 80 : 380);
    const filteredEntries = await page.locator(".galaxy-entry:not([hidden])").count();
    assert(filteredEntries > 0 && filteredEntries < expectedPosts,
      `Spiral Galaxy search did not narrow the real archive at ${viewport.label}.`);
    const merger = await page.evaluate(() => ({
      ejected: document.querySelectorAll(".galaxy-node.is-ejected").length,
      matches: document.querySelectorAll(".galaxy-node.is-match").length,
      nodeChoreography: document.querySelector(".galaxy-hero").classList.contains("is-encounter-choreography"),
      remnantArms: [...document.querySelectorAll(".galaxy-node.is-match")].every((node) => Number(node.dataset.arm) < 2),
      state: document.querySelector(".galaxy-hero").dataset.merger
    }));
    assert(merger.state === "remnant" && merger.matches === filteredEntries && merger.ejected === expectedPosts - filteredEntries && merger.remnantArms,
      `Spiral Galaxy did not form a filtered merger remnant at ${viewport.label}: ${JSON.stringify(merger)}.`);
    assert(merger.nodeChoreography === (viewport.reducedMotion !== "reduce"),
      `Spiral Galaxy node choreography did not respect motion preference at ${viewport.label}: ${JSON.stringify(merger)}.`);
    await page.fill("#galaxy-search", "");
    await page.waitForTimeout(viewport.reducedMotion === "reduce" ? 80 : 540);
    const restored = await page.evaluate(() => ({
      ejected: document.querySelectorAll(".galaxy-node.is-ejected").length,
      state: document.querySelector(".galaxy-hero").dataset.merger
    }));
    assert(restored.state === "archive" && restored.ejected === 0,
      `Spiral Galaxy did not restore the complete archive after clearing search at ${viewport.label}.`);
    await context.close();
  }
}

async function verifySpiralGalaxyOffscreenPause(browser) {
  const route = "/experiments/universe-options/logs/05-spiral-galaxy-archive.html";
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "no-preference"
  });
  await context.addInitScript(() => {
    window.__galaxyCanvasFrames = 0;
    const clearRect = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas?.id === "galaxy-sky") window.__galaxyCanvasFrames += 1;
      return clearRect.apply(this, args);
    };
  });

  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForSelector('#galaxy-field[data-ready="true"]', { timeout: 15000 });
    await page.waitForFunction(() => (
      document.querySelector(".galaxy-hero")?.dataset.galaxyActivity === "running"
        && window.__galaxyCanvasFrames >= 3
    ));

    const runningStart = await page.evaluate(() => window.__galaxyCanvasFrames);
    await page.waitForTimeout(180);
    const runningEnd = await page.evaluate(() => window.__galaxyCanvasFrames);
    assert(runningEnd > runningStart,
      `Spiral Galaxy canvas did not advance while onscreen (${runningStart} → ${runningEnd}).`);

    await page.evaluate(() => {
      const index = document.querySelector("#galaxy-index");
      window.scrollTo(0, Math.min(
        document.documentElement.scrollHeight - window.innerHeight,
        index.offsetTop + 160
      ));
    });
    await page.waitForFunction(() => {
      const hero = document.querySelector(".galaxy-hero");
      return hero.getBoundingClientRect().bottom <= 0 && hero.dataset.galaxyActivity === "paused";
    });
    const pausedStart = await page.evaluate(() => window.__galaxyCanvasFrames);
    await page.waitForTimeout(260);
    const pausedEnd = await page.evaluate(() => window.__galaxyCanvasFrames);
    assert(pausedEnd === pausedStart,
      `Spiral Galaxy canvas kept drawing while offscreen (${pausedStart} → ${pausedEnd}).`);

    await page.evaluate(() => document.querySelector(".galaxy-hero").scrollIntoView({ block: "start" }));
    await page.waitForFunction(() => {
      const hero = document.querySelector(".galaxy-hero");
      const bounds = hero.getBoundingClientRect();
      return bounds.bottom > 0 && bounds.top < innerHeight && hero.dataset.galaxyActivity === "running";
    });
    const resumedStart = await page.evaluate(() => window.__galaxyCanvasFrames);
    await page.waitForTimeout(180);
    const resumedEnd = await page.evaluate(() => window.__galaxyCanvasFrames);
    assert(resumedEnd > resumedStart,
      `Spiral Galaxy canvas did not resume after re-entry (${resumedStart} → ${resumedEnd}).`);
  } finally {
    await context.close();
  }
}

async function verifyGalaxyEncounterLifecycle(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference" });
  await context.addInitScript(() => {
    window.__encounterFrames = [];
    window.__galaxyCallbacks = 0;
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => request((timestamp) => {
      const start = performance.now();
      callback(timestamp);
      if (callback.name === "animateGalaxy") window.__galaxyCallbacks += 1;
      if (callback.name === "animateGalaxy" && document.querySelector(".galaxy-hero")?.classList.contains("has-stellar-encounter")) {
        window.__encounterFrames.push({ timestamp, cost: performance.now() - start });
      }
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const time = () => page.locator(".galaxy-hero").evaluate((hero) => Number(hero.dataset.encounterTime || 0));
  try {
    await page.goto(`${BASE_URL}/blog/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('#galaxy-field[data-ready="true"]');
    await page.locator("#galaxy-search").fill("photography");
    await page.waitForFunction(() => Number(document.querySelector(".galaxy-hero").dataset.encounterTime) > 0.5);
    const movingNode = page.locator(".galaxy-node.is-match").first();
    const firstTranslate = await movingNode.evaluate((node) => node.style.translate);
    await page.waitForTimeout(180);
    const secondTranslate = await movingNode.evaluate((node) => node.style.translate);
    assert(firstTranslate !== secondTranslate && secondTranslate !== "", "Article nodes must travel with the particle encounter");
    await page.locator("#galaxy-motion").click();
    const paused = await time();
    await page.waitForTimeout(250);
    assert(await time() === paused, "Pausing must freeze the gravitational encounter");
    assert(await page.locator("#galaxy-motion").getAttribute("aria-pressed") === "true", "Pause must expose its state");
    await page.locator(".galaxy-node.is-match").first().click();
    assert(await time() === paused, "Selecting an article must not restart or advance a paused encounter");
    await page.keyboard.press("Escape");
    await page.locator("#galaxy-motion").click();
    await page.waitForFunction((before) => Number(document.querySelector(".galaxy-hero").dataset.encounterTime) > before + 0.2, paused);
    const resumedAt = Date.now();
    await page.waitForFunction(() => document.querySelector(".galaxy-hero").dataset.galaxyActivity === "settled", null, { timeout: 5500 });
    assert(Date.now() - resumedAt < 5000, "The functional encounter must settle promptly");
    const settledTime = await time();
    await page.waitForTimeout(50);
    const settledCallbacks = await page.evaluate(() => window.__galaxyCallbacks);
    await page.waitForTimeout(250);
    assert(await page.evaluate(() => window.__galaxyCallbacks) === settledCallbacks, "A completed merge must stop RAF callbacks");
    assert(await time() === settledTime, "A completed merge must stop its simulation clock");
    const results = await page.locator(".galaxy-node").evaluateAll((nodes) => nodes.map((node) => ({
      match: node.classList.contains("is-match"), visibility: getComputedStyle(node).visibility,
      opacity: Number(getComputedStyle(node).opacity), translate: node.style.translate
    })));
    assert(results.filter((node) => !node.match).every((node) => node.visibility === "hidden"), "Nonmatching nodes must disappear after the merge");
    assert(results.filter((node) => node.match).every((node) => node.visibility !== "hidden" && node.opacity > 0.9), "Matching nodes must remain available after the merge");
    const separation = await page.locator(".galaxy-hero").evaluate((hero) => Number(hero.dataset.encounterSeparation));
    assert(separation < 0.2, `Encounter must reach a coalesced remnant, got separation ${separation}`);
    const visibleBeforeReplay = await page.locator(".galaxy-entry:not([hidden])").count();
    await page.locator("#galaxy-replay").click();
    await page.waitForFunction(() => Number(document.querySelector(".galaxy-hero").dataset.encounterTime) < 1);
    assert(await page.locator(".galaxy-entry:not([hidden])").count() === visibleBeforeReplay, "Replay must preserve filtering");
    await page.waitForFunction(() => document.querySelector(".galaxy-hero").dataset.galaxyActivity === "settled", null, { timeout: 5500 });
    await page.locator("#galaxy-search").fill("Android");
    await page.waitForFunction(() => new URL(location.href).searchParams.get("q") === "Android");
    await page.waitForTimeout(400);
    assert(await time() < 3, "Changing subjects after completion must restart the encounter");
    assert(await page.locator(".galaxy-hero").getAttribute("data-galaxy-activity") === "running", "A fresh search must wake the settled renderer");
    await page.waitForFunction(() => document.querySelector(".galaxy-hero").dataset.galaxyActivity === "settled", null, { timeout: 5500 });
    await page.locator("#galaxy-search").fill("");
    await page.waitForFunction(() => document.querySelector(".galaxy-hero").dataset.encounterPhase === "archive");
    const clearedCallbacks = await page.evaluate(() => window.__galaxyCallbacks);
    await page.waitForTimeout(150);
    assert(await page.evaluate(() => window.__galaxyCallbacks) > clearedCallbacks, "Clearing a settled encounter must restart RAF without toggling motion");
    await page.locator("#galaxy-search").fill("Android");
    await page.waitForFunction(() => document.querySelector(".galaxy-hero").dataset.encounterPhase === "approach");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => document.querySelector(".galaxy-hero").dataset.galaxyActivity === "paused");
    assert(await page.locator("#galaxy-motion").isDisabled() && await page.locator("#galaxy-replay").isDisabled(), "Reduced motion must disable animation controls");
    assert(await page.locator(".galaxy-hero").getAttribute("data-encounter-phase") === "remnant", "Reduced motion must present a static filtered galaxy");
    await page.locator("#galaxy-search").fill("");
    await page.waitForFunction(() => document.querySelector(".galaxy-hero").dataset.encounterPhase === "archive");
    assert(await page.locator("#galaxy-replay").isHidden(), "Clearing the filter must remove replay");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForFunction(() => document.querySelector(".galaxy-hero").dataset.galaxyActivity === "running");
    const archiveCallbacks = await page.evaluate(() => window.__galaxyCallbacks);
    await page.waitForTimeout(150);
    assert(await page.evaluate(() => window.__galaxyCallbacks) > archiveCallbacks, "The cleared archive must resume animation");
    assert(errors.length === 0, `Encounter raised page errors: ${errors.join("; ")}`);
    const profile = await page.evaluate(() => {
      const frames = window.__encounterFrames;
      const costs = frames.map((frame) => frame.cost).sort((a, b) => a - b);
      const intervals = frames.slice(1).map((frame, index) => frame.timestamp - frames[index].timestamp).filter((delta) => delta < 100).sort((a, b) => a - b);
      return { samples: costs.length, callbackP95Ms: costs[Math.floor(costs.length * 0.95)], rafIntervalP95Ms: intervals[Math.floor(intervals.length * 0.95)] };
    });
    console.log(`Galaxy callback profile (headless, includes throttled RAF callbacks): ${JSON.stringify(profile)}`);
    console.log(`Galaxy encounter lifecycle passed: pause/resume, selection, coalescence (${separation}), replay, new subject, reduced motion, clear.`);
  } finally {
    await context.close();
  }
}

async function verifyRound04PortfolioHierarchy(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  for (const route of ROUND_04_PORTFOLIO_ROUTES) {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    const state = await page.evaluate(({ supportIds }) => {
      const projects = [...document.querySelectorAll("[data-project][data-project-id]")];
      const rectFor = (element) => {
        const rect = element.getBoundingClientRect();
        return {
          area: Math.max(0, rect.width) * Math.max(0, rect.height),
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height
        };
      };
      const bitcoin = document.querySelector('[data-project-id="bitcoin-wallet"]');
      const support = supportIds.map((id) => document.querySelector(`[data-project-id="${id}"]`));
      const productionSection = bitcoin?.closest("section");
      const archiveSection = document.querySelector('[data-kind="archive"]')?.closest("section");

      return {
        ids: projects.map((project) => project.dataset.projectId),
        counts: {
          production: projects.filter((project) => project.dataset.kind === "production").length,
          archive: projects.filter((project) => project.dataset.kind === "archive").length,
          public: projects.filter((project) => project.dataset.kind === "public").length
        },
        evidenceHrefs: [...document.querySelectorAll("[data-evidence-link]")].map((link) => link.getAttribute("href")),
        supportText: Object.fromEntries(supportIds.map((id, index) => [id, support[index]?.textContent.replace(/\s+/g, " ").trim() || ""])),
        bitcoinRect: bitcoin ? rectFor(bitcoin) : null,
        supportRects: support.map((project) => project ? rectFor(project) : null),
        productionHeight: productionSection?.getBoundingClientRect().height || 0,
        archiveHeight: archiveSection?.getBoundingClientRect().height || 0
      };
    }, { supportIds: Object.keys(REQUIRED_PRODUCTION_COPY) });

    assert(JSON.stringify(state.ids) === JSON.stringify(EXPECTED_PORTFOLIO_IDS), `${route} changed the canonical 16-project order.`);
    assert(state.counts.production === 5 && state.counts.archive === 8 && state.counts.public === 3, `${route} changed the canonical 5/8/3 hierarchy.`);
    assert(JSON.stringify(state.evidenceHrefs) === JSON.stringify(EXPECTED_PORTFOLIO_HREFS), `${route} changed the 18 canonical evidence links.`);

    for (const [id, markers] of Object.entries(REQUIRED_PRODUCTION_COPY)) {
      for (const marker of markers) {
        assert(state.supportText[id].toLowerCase().includes(marker.toLowerCase()), `${route} abbreviates ${id}; missing “${marker}”.`);
      }
    }

    assert(state.bitcoinRect, `${route} is missing the Bitcoin.com Wallet flagship.`);
    assert(state.supportRects.every(Boolean), `${route} is missing one of the four production credentials.`);
    const supportArea = state.supportRects.reduce((sum, rect) => sum + rect.area, 0);
    assert(state.bitcoinRect.area > supportArea, `${route} no longer gives Bitcoin.com Wallet more visual mass than the other four production credentials combined.`);
    assert(state.bitcoinRect.top < 1000 && state.bitcoinRect.bottom > 0 && state.supportRects.every((rect) => rect.top < 1000 && rect.bottom > 0), `${route} does not keep all five production credentials in the desktop opening viewport.`);
    assert(state.productionHeight > 0 && state.archiveHeight > 0 && state.archiveHeight < state.productionHeight * 0.42, `${route} lets the archive become a co-equal chapter (${state.archiveHeight.toFixed(0)}px vs ${state.productionHeight.toFixed(0)}px production).`);
  }

  await context.close();

  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const responsiveContext = await browser.newContext({ viewport });
    const responsivePage = await responsiveContext.newPage();

    for (const route of ROUND_04_PORTFOLIO_ROUTES) {
      await responsivePage.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 15000 });
      const prominence = await responsivePage.evaluate(({ supportIds }) => {
        const metric = (element) => {
          const rect = element.getBoundingClientRect();
          const title = element.querySelector("h2, h3, .satellite-select strong, p > strong");
          return {
            area: rect.width * rect.height,
            titleSize: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0
          };
        };
        return {
          support: supportIds.map((id) => metric(document.querySelector(`[data-project-id="${id}"]`))),
          archive: [...document.querySelectorAll('[data-kind="archive"]')].map(metric)
        };
      }, { supportIds: Object.keys(REQUIRED_PRODUCTION_COPY) });
      const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
      const supportArea = average(prominence.support.map((item) => item.area));
      const archiveArea = average(prominence.archive.map((item) => item.area));
      const supportTitle = average(prominence.support.map((item) => item.titleSize));
      const archiveTitle = average(prominence.archive.map((item) => item.titleSize));

      assert(supportArea > archiveArea * 1.25, `${route} lets an archive credit rival a production credential at ${viewport.width}×${viewport.height} (${supportArea.toFixed(0)}px² vs ${archiveArea.toFixed(0)}px² average).`);
      assert(supportTitle > archiveTitle * 1.08, `${route} makes archive titles rival production titles at ${viewport.width}×${viewport.height} (${supportTitle.toFixed(1)}px vs ${archiveTitle.toFixed(1)}px average).`);
    }

    await responsiveContext.close();
  }
}

async function verifyPayloadFeedbackOptionalPrivate(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true
  });
  const page = await context.newPage();
  await page.goto(
    BASE_URL + "/experiments/universe-options/contact/option-03-payload-integration.html?localDemo=1",
    { waitUntil: "domcontentloaded", timeout: 15000 }
  );
  await page.locator("#payload-name").fill("Test Operator");
  await page.locator("#payload-email").fill("operator@example.test");
  await page.locator('input[name="intent"][value="public"]').check();
  await page.locator("#payload-quote").fill("K");
  await page.locator("#payload-public-consent").check();
  await page.locator("#payload-acknowledgement").check();
  assert(await page.locator("#payload-message").getAttribute("required") === null,
    "Option 03 still requires private notes for Feedback Satellite.");
  assert(await page.locator("#payload-quote").getAttribute("minlength") === null,
    "Option 03 still exposes a public-quote minimum length.");
  assert(await page.locator('[data-module-state="payload"]').textContent() === "BEACON PACKAGE LOADED",
    "Option 03 still labels a quote-only payload as a private mission core.");
  assert(await page.locator("[data-submit]").isEnabled(),
    "Option 03 does not accept an empty private note plus a one-character public quote.");
  await page.locator("[data-submit]").click();
  assert(await page.locator("#payload-form").getAttribute("data-visual-phase") === "preparing",
    "Option 03 public-only launch did not enter the preparing phase.");
  await page.waitForFunction(function () {
    return document.querySelector("#payload-form")?.dataset.visualPhase === "recording";
  });
  const visualInView = await page.locator("[data-payload-visual]").evaluate(function (visual) {
    const bounds = visual.getBoundingClientRect();
    return bounds.bottom > 0 && bounds.top < window.innerHeight;
  });
  assert(visualInView, "Option 03 public-only launch did not reframe its payload visual on mobile.");
  await context.close();
}

function verifyPublicationBoundary() {
  const dist = path.join(ROOT, "dist");
  assert(fs.existsSync(dist), "dist is missing; run npm run build before the option contract.");
  const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [path.relative(dist, absolutePath).split(path.sep).join("/")];
  });
  const actualFiles = walk(path.join(dist, "experiments", "universe-options")).sort();
  const actualAssets = walk(path.join(dist, "assets", "experiments", "universe-options")).sort();
  assert(
    JSON.stringify(actualFiles) === JSON.stringify([...publication.publicExperimentFiles].sort()),
    "Published universe option files do not exactly match the explicit archive allowlist."
  );
  assert(
    JSON.stringify(actualAssets) === JSON.stringify([...publication.publicExperimentAssets].sort()),
    "Published universe option assets do not exactly match the explicit archive allowlist."
  );
}

async function main() {
  let server = null;
  if (!BASE_URL) {
    assert(fs.existsSync(DIST_ROOT), "dist is missing; run npm run build before the option contract.");
    server = createStaticServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(typeof address === "object" && address?.port, "Option contract server did not allocate a port.");
    BASE_URL = `http://127.0.0.1:${address.port}`;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const options = await discoverOptions(browser);
    const routes = await smokeRoutes(browser, options);
    await smokeNoJavaScript(browser, routes);
    await verifySpiralGalaxyArchive(browser);
    await verifySpiralGalaxyOffscreenPause(browser);
    await verifyGalaxyEncounterLifecycle(browser);
    await verifyRound04PortfolioHierarchy(browser);
    await verifyPayloadFeedbackOptionalPrivate(browser);
    verifyPublicationBoundary();
    console.log(`Universe option contract passed: ${options.length} primary directions, ${routes.length} unique routes, desktop/mobile/reduced-motion/no-JS, exact archive publication boundary clean.`);
  } finally {
    await browser.close();
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
