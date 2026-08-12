const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");
const { openDatabase, getPostWithTopics } = require("./lib/blog-db");

const ROOT = path.join(__dirname, "..");
const FLAGSHIPS = Object.freeze([
  "case-study-bitcoin-wallet-multichain-android-systems",
  "case-study-itvx-playback-at-candyspace"
]);
const BRIEFS = Object.freeze([
  "android-leadership",
  "cross-platform-systems",
  "fintech-reliability",
  "agent-first-delivery"
]);

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp"
  }[extension] || "application/octet-stream";
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const filePath = path.resolve(ROOT, relativePath);
      if (!filePath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, { "Content-Type": contentType(filePath) });
      fs.createReadStream(filePath).pipe(response);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function verifySources() {
  const work = read("work.html");
  const briefing = read("assets/js/work-briefing.js");
  const css = read("assets/css/work-portfolio.css");
  const neuralCss = read("assets/css/neural-background.css");
  const { db } = openDatabase(undefined, { readonly: true });

  try {
    const bitcoin = getPostWithTopics(db, FLAGSHIPS[0]);
    const itvx = getPostWithTopics(db, FLAGSHIPS[1]);
    assert(bitcoin && itvx, "Both flagship posts must exist in the canonical SQLite database.");
    assert.strictEqual(bitcoin.status, "published");
    assert.strictEqual(itvx.status, "published");
    assert.deepStrictEqual(bitcoin.topics, ["Bitcoin.com Wallet", "Android", "Fintech", "Multichain", "Rust"]);
    assert.deepStrictEqual(itvx.topics, ["Candyspace", "ITVX", "Android", "Streaming", "Media Playback"]);

    [
      "first end-to-end Android implementation",
      "reward-backed crypto market predictions",
      "Bitcoin replace-by-fee",
      "single-chain to multichain",
      "staking and liquidity-reward",
      "provider-aware swaps",
      "recurring-buy reminders",
      "Rust core",
      "UniFFI",
      "startup",
      "release hardening"
    ].forEach((claim) => assert(bitcoin.body_html.includes(claim), `Bitcoin dossier lost public claim: ${claim}`));
    [
      "Candyspace was the employer; ITVX was the project",
      "recommendations panel",
      "phone and tablet",
      "preview timeline scrubbing",
      "error tracking",
      "security fixes",
      "Simple XML to Jackson"
    ].forEach((claim) => assert(itvx.body_html.includes(claim), `ITVX dossier lost public claim: ${claim}`));

    for (const post of [bitcoin, itvx]) {
      assert(!/\b(?:PR|ticket)\s*#?\d+/i.test(post.body_html), `${post.slug} exposes a private work identifier.`);
      assert(!/wallet-android|wombat|\/earn\//i.test(post.body_html), `${post.slug} exposes a private repository or service detail.`);
      assert(post.body_html.includes("public-safe"), `${post.slug} is missing its public evidence boundary.`);
    }

    FLAGSHIPS.forEach((slug) => {
      assert(work.includes(`data-work-deep-dive href="/blog/${slug}.html"`), `${slug} is not linked from Work.`);
    });
    assert(
      work.indexOf("Candyspace · Android · Media player team") < work.indexOf(">ITVX</h3>"),
      "Work must present Candyspace as the employer before the ITVX project name."
    );
    BRIEFS.forEach((brief) => {
      assert(work.includes(`data-brief-preset="${brief}"`), `${brief} preset is missing.`);
      assert(work.includes(`data-brief-panel="${brief}"`), `${brief} panel is missing.`);
      assert(briefing.includes(`"${brief}"`), `${brief} URL state is missing from the briefing controller.`);
    });
    assert(work.includes("Choose the lens that matches the role you&rsquo;re hiring for."),
      "Briefing heading must speak directly to the visitor making the hiring decision.");
    assert(!work.includes("Start with the signal for your role."), "Portfolio-owner-directed briefing copy remains.");
    assert(work.includes('href="#briefing" data-briefing-arrival>90-second briefing</a>'),
      "The briefing CTA should use a same-document destination instead of a route transition.");
    assert(work.includes('<h2 id="briefing-title" tabindex="-1">'),
      "The briefing destination heading must support deliberate programmatic focus.");
    assert(work.includes('aria-labelledby="briefing-title" tabindex="-1">'),
      "The briefing section must support focus for its own fragment destination.");
    assert(css.includes(".work-briefing__presets") && css.includes(".work-briefing__panel[hidden]"), "Briefing layout or state styles are missing.");
    assert(css.includes(".work-briefing__share[hidden]"), "Briefing share controls lack a no-JavaScript hidden state.");
    assert(neuralCss.includes("transition-duration: 0s !important;"),
      "Reduced motion must disable global transitions instead of shortening them into active animations.");
    assert(!neuralCss.includes("transition-duration: 0.01ms !important;"),
      "The global reduced-motion stylesheet still creates micro-transitions.");
    assert(css.includes("@keyframes workBriefingRouteSweep") && css.includes("@keyframes workBriefingPanelDock"),
      "Briefing arrival lacks its route sweep and spatial panel motion.");
    assert(briefing.includes('briefing.dataset.briefMotion = "reduced"'),
      "Briefing controller lacks its reduced-motion final state.");
    assert(briefing.includes('"universe-perspective:settled"'),
      "Briefing motion must wait for the Universe route arrival to settle.");
    assert(!briefing.includes("requestAnimationFrame(() => target.scrollIntoView"),
      "Briefing controller retained a delayed frame-based scroll correction.");
    assert(work.includes('work-portfolio.css?v=20260812-brief3'), "Work briefing styles lack a current cache key.");
    assert(work.includes('work-briefing.js?v=20260812-brief3'), "Work briefing controller lacks a current cache key.");
  } finally {
    db.close();
  }
}

async function verifyBrowser() {
  const server = await startServer();
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) route.continue();
      else route.abort();
    });
    const page = await context.newPage();

    await page.goto(`${origin}/work.html`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      window.__briefScrollSamples = [];
      window.__briefScrollStartedAt = performance.now();
      const sample = () => {
        window.__briefScrollSamples.push({ at: performance.now(), y: scrollY });
        if (performance.now() - window.__briefScrollStartedAt < 1500) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.locator('a[href="#briefing"]').focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => {
      const section = document.querySelector("[data-work-briefing]");
      const bounds = document.getElementById("briefing-title")?.getBoundingClientRect();
      return location.hash === "#briefing"
        && section?.dataset.briefMotion === "complete"
        && bounds?.bottom > 0
        && bounds?.top < innerHeight;
    });
    assert.strictEqual(new URL(page.url()).search, "", "Same-page briefing arrival unexpectedly changed the query string.");
    assert.strictEqual(await page.evaluate(() => document.activeElement?.id), "briefing",
      "Keyboard briefing activation did not move focus to the labeled destination section.");
    const settledScroll = await page.evaluate(() => scrollY);
    await page.waitForTimeout(1400);
    const scrollArrival = await page.evaluate(() => {
      const samples = window.__briefScrollSamples || [];
      const firstAtDestination = samples.findIndex((sample) => Math.abs(sample.y - scrollY) <= 1);
      const latePositions = firstAtDestination < 0 ? [] : samples.slice(firstAtDestination).map((sample) => sample.y);
      return {
        current: scrollY,
        firstAtDestinationMs: firstAtDestination < 0 ? null : samples[firstAtDestination].at - window.__briefScrollStartedAt,
        lateSpread: latePositions.length ? Math.max(...latePositions) - Math.min(...latePositions) : null
      };
    });
    assert(Math.abs(scrollArrival.current - settledScroll) <= 1, "Briefing arrival applied a late scroll correction.");
    assert(scrollArrival.firstAtDestinationMs !== null && scrollArrival.firstAtDestinationMs < 300,
      `Briefing destination took too long to arrive: ${JSON.stringify(scrollArrival)}`);
    assert(scrollArrival.lateSpread !== null && scrollArrival.lateSpread <= 1,
      `Briefing scroll drifted after arrival: ${JSON.stringify(scrollArrival)}`);

    await page.evaluate(() => {
      const root = document.documentElement;
      root.dataset.universePerspective = "arriving";
      root.dataset.universeMotion = "arrive";
      window.__briefOverlap = [];
      const briefing = document.querySelector("[data-work-briefing]");
      new MutationObserver(() => window.__briefOverlap.push({
        briefing: briefing.dataset.briefMotion,
        universe: root.dataset.universeMotion || null
      })).observe(briefing, { attributes: true, attributeFilter: ["data-brief-motion"] });
      document.querySelector("[data-briefing-arrival]").click();
      delete root.dataset.universeMotion;
      root.dataset.universePerspective = "ready";
      document.dispatchEvent(new CustomEvent("universe-perspective:settled"));
    });
    await page.waitForFunction(() => document.querySelector("[data-work-briefing]")?.dataset.briefMotion === "complete");
    const overlap = await page.evaluate(() => window.__briefOverlap);
    assert(!overlap.some((state) => state.briefing === "running" && state.universe === "arrive"),
      `Briefing motion overlapped Universe arrival: ${JSON.stringify(overlap)}`);

    await page.goto(`${origin}/work.html?brief=fintech-reliability#briefing`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll("[data-brief-panel]:not([hidden])").length === 1);
    await page.waitForFunction(() => document.querySelector("[data-work-briefing]")?.dataset.briefMotion === "complete");

    const selected = async () => page.locator('[data-brief-preset][aria-selected="true"]').getAttribute("data-brief-preset");
    assert.strictEqual(await selected(), "fintech-reliability");
    assert.strictEqual(await page.locator("[data-brief-panel]:not([hidden])").getAttribute("data-brief-panel"), "fintech-reliability");
    assert.strictEqual(await page.locator('[data-brief-preset][role="tab"]').count(), 4);
    assert.strictEqual(await page.locator('[data-brief-panel][role="tabpanel"]').count(), 4);
    assert.strictEqual(await page.locator("[data-brief-share]:visible").count(), 1);
    const arrivalState = await page.evaluate(() => {
      const destination = document.getElementById("briefing-title");
      const panel = document.querySelector("[data-brief-panel]:not([hidden])");
      const bounds = destination.getBoundingClientRect();
      return {
        destinationVisible: bounds.bottom > 0 && bounds.top < innerHeight,
        panelTransform: getComputedStyle(panel).transform,
        activeAnimations: document.querySelector("[data-work-briefing]")
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === "running").length
      };
    });
    assert.strictEqual(arrivalState.destinationVisible, true, "Briefing arrival did not leave its destination visible.");
    assert.strictEqual(arrivalState.panelTransform, "none", "Briefing panel did not settle into its final position.");
    assert.strictEqual(arrivalState.activeAnimations, 0, "Briefing arrival did not reach a stable final state.");

    const initialHistory = await page.evaluate(() => ({ length: history.length, url: location.href }));
    await page.locator('[data-brief-preset="fintech-reliability"]').click();
    const repeatedHistory = await page.evaluate(() => ({ length: history.length, url: location.href }));
    assert.deepStrictEqual(repeatedHistory, initialHistory, "Repeated selection added a duplicate briefing history entry.");

    await page.goto(`${origin}/work.html#brief-cross-platform-systems-title`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const target = document.getElementById("brief-cross-platform-systems-title");
      const panel = target?.closest("[data-brief-panel]");
      const bounds = target?.getBoundingClientRect();
      return panel?.hidden === false
        && document.querySelector("[data-work-briefing]")?.dataset.activeBrief === "cross-platform-systems"
        && bounds.bottom > 0
        && bounds.top < window.innerHeight;
    });
    assert.strictEqual(await selected(), "cross-platform-systems");
    assert.strictEqual(new URL(page.url()).hash, "#brief-cross-platform-systems-title");
    assert.strictEqual(new URL(page.url()).searchParams.has("brief"), false,
      "A heading deep link should not require a redundant briefing query parameter.");

    await page.locator('[data-brief-preset="agent-first-delivery"]').click();
    assert.strictEqual(new URL(page.url()).searchParams.get("brief"), "agent-first-delivery");
    assert.strictEqual(await selected(), "agent-first-delivery");

    const firstPreset = page.locator('[data-brief-preset="android-leadership"]');
    await firstPreset.focus();
    await firstPreset.press("ArrowRight");
    assert.strictEqual(await selected(), "cross-platform-systems");
    assert.strictEqual(new URL(page.url()).hash, "#briefing");
    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector('[data-brief-preset="agent-first-delivery"]')?.getAttribute("aria-selected") === "true");

    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto(`${origin}/work.html?brief=android-leadership#briefing`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll("[data-brief-panel]:not([hidden])").length === 1);
    const widths = await page.evaluate(() => ({ root: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert(widths.root <= widths.viewport + 2, `Briefing overflows on mobile: ${JSON.stringify(widths)}`);
    await context.close();

    const noScriptContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 430, height: 932 } });
    const noScriptPage = await noScriptContext.newPage();
    await noScriptPage.goto(`${origin}/work.html#briefing`, { waitUntil: "domcontentloaded" });
    assert.strictEqual(await noScriptPage.locator("[data-brief-panel]:visible").count(), 4);
    assert.strictEqual(await noScriptPage.locator("[data-brief-share]:visible").count(), 0);
    assert.strictEqual(await noScriptPage.locator("[data-brief-copy]:visible").count(), 0);
    assert.strictEqual(await noScriptPage.locator("[data-brief-status]:visible").count(), 0);
    await noScriptContext.close();

    const reducedContext = await browser.newContext({
      reducedMotion: "reduce",
      viewport: { width: 1280, height: 900 }
    });
    const reducedPage = await reducedContext.newPage();
    await reducedPage.goto(`${origin}/work.html`, { waitUntil: "domcontentloaded" });
    await reducedPage.locator('a[href="#briefing"]').focus();
    await reducedPage.keyboard.press("Enter");
    await reducedPage.waitForFunction(() => document.querySelector("[data-work-briefing]")?.dataset.briefMotion === "reduced");
    assert.strictEqual(await reducedPage.evaluate(() => document.activeElement?.id), "briefing",
      "Reduced-motion CTA did not move focus to the labeled briefing section.");
    const reducedArrival = await reducedPage.evaluate(() => {
      const section = document.querySelector("[data-work-briefing]");
      const targets = [
        section,
        document.getElementById("briefing-title"),
        section.querySelector("[data-brief-panel]:not([hidden]) h3")
      ];
      return {
        animations: section.getAnimations({ subtree: true }).map((animation) => ({
          animationName: animation.animationName || "",
          duration: animation.effect?.getComputedTiming?.().duration,
          playState: animation.playState,
          target: animation.effect?.target?.id || animation.effect?.target?.className || "",
          transitionProperty: animation.transitionProperty || ""
        })),
        transitionDurations: targets.map((target) => getComputedStyle(target).transitionDuration)
      };
    });
    assert.deepStrictEqual(reducedArrival.animations, [],
      `Reduced-motion CTA started an animation: ${JSON.stringify(reducedArrival.animations)}`);
    assert(reducedArrival.transitionDurations.every((duration) => duration === "0s"),
      `Reduced-motion briefing transitions are not disabled: ${JSON.stringify(reducedArrival.transitionDurations)}`);

    await reducedPage.goto(`${origin}/work.html?brief=agent-first-delivery#briefing`, { waitUntil: "domcontentloaded" });
    await reducedPage.waitForFunction(() => document.querySelector("[data-work-briefing]")?.dataset.briefMotion === "reduced");
    const reducedState = await reducedPage.evaluate(() => {
      const section = document.querySelector("[data-work-briefing]");
      const heading = document.getElementById("briefing-title");
      const panel = document.querySelector("[data-brief-panel]:not([hidden])");
      const bounds = heading.getBoundingClientRect();
      return {
        activeBrief: section.dataset.activeBrief,
        destinationVisible: bounds.bottom > 0 && bounds.top < innerHeight,
        headingTransform: getComputedStyle(heading.closest(".work-briefing__head > div")).transform,
        panelTransform: getComputedStyle(panel).transform,
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        activeAnimations: section.getAnimations({ subtree: true }).length
      };
    });
    assert.strictEqual(reducedState.activeBrief, "agent-first-delivery");
    assert.strictEqual(reducedState.destinationVisible, true, "Reduced-motion deep link did not reveal its destination.");
    assert.strictEqual(reducedState.headingTransform, "none", "Reduced-motion heading retained an arrival transform.");
    assert.strictEqual(reducedState.panelTransform, "none", "Reduced-motion panel retained an arrival transform.");
    assert.strictEqual(reducedState.scrollBehavior, "auto", "Reduced motion did not disable smooth document scrolling.");
    assert.strictEqual(reducedState.activeAnimations, 0, "Reduced-motion briefing still runs an animation.");
    await reducedContext.close();
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

(async () => {
  verifySources();
  await verifyBrowser();
  console.log(`Verified ${FLAGSHIPS.length} flagship dossiers and ${BRIEFS.length} shareable role briefings.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
