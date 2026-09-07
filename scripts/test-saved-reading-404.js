const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");
const { buildBlogIndexFallback, buildStaticPostHtml } = require("./build-static-blog-pages");
const publication = require("./site-publication.config");

const ROOT = path.join(__dirname, "..");
const HOST = "127.0.0.1";
const CANONICAL_KEY = "ac.blog.bookmarks.v1";
const LEGACY_KEY = "ac_blog_bookmarks_v1";
const FOCUS_EVIDENCE_ROOT = "/tmp/ac-logs-focus-evidence";
const MIME_TYPES = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp"
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fixtureArticle(post) {
  return buildStaticPostHtml({
    post: {
      author: "Andrew Concepcion",
      body_html: "<h2>Focused bookmark fixture</h2><p>This page verifies saved-reading interoperability.</p>",
      category: post.category,
      hero_alt: post.heroAlt,
      hero_image: post.heroImage,
      published_date: post.date,
      reading_time: post.readingTime,
      slug: post.slug,
      summary: post.summary,
      title: post.title,
      topics: post.topics,
      updated_at: post.date
    },
    previous: null,
    next: null
  });
}

function resolveSourcePath(pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const withIndex = relative.endsWith("/") ? `${relative}index.html` : relative;
  const absolute = path.resolve(ROOT, withIndex);
  const boundary = path.relative(ROOT, absolute);
  return boundary.startsWith("..") || path.isAbsolute(boundary) ? null : absolute;
}

function focusedBlogFallback(posts) {
  const source = fs.readFileSync(path.join(ROOT, "blog", "index.html"), "utf8");
  const fallbackPosts = posts.map((post) => ({
    body_html: "",
    category: post.category,
    hero_alt: post.heroAlt,
    hero_image: post.heroImage,
    published_date: post.date,
    reading_time: post.readingTime,
    slug: post.slug,
    summary: post.summary,
    title: post.title,
    topics: post.topics
  }));
  const withFallback = source.replace(
    /<section id="blog-feed"[^>]*>[\s\S]*?<\/section>/,
    buildBlogIndexFallback(fallbackPosts)
  );
  return withFallback.replace(
    /(<script src="\/assets\/experiments\/universe-options\/logs\/spiral-galaxy-archive\.js[^"]*"><\/script>)/,
    '<script>window.__prerenderedGalaxyEntries = [...document.querySelectorAll("#galaxy-list > article")];<\/script>\n$1'
  );
}

function createServer(articleHtml, noJsBlogHtml) {
  return http.createServer((request, response) => {
    if (!request.url || !["GET", "HEAD"].includes(request.method || "")) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/fixture-article.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      if (request.method === "HEAD") response.end();
      else response.end(articleHtml);
      return;
    }
    if (pathname === "/focused-blog/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      if (request.method === "HEAD") response.end();
      else response.end(noJsBlogHtml);
      return;
    }

    const sourcePath = resolveSourcePath(pathname);
    if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      const notFound = fs.readFileSync(path.join(ROOT, "404.html"));
      response.writeHead(404, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": notFound.length,
        "Cache-Control": "no-store"
      });
      if (request.method === "HEAD") response.end();
      else response.end(notFound);
      return;
    }

    const contents = fs.readFileSync(sourcePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(sourcePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": contents.length,
      "Cache-Control": "no-store"
    });
    if (request.method === "HEAD") response.end();
    else response.end(contents);
  });
}

async function verifyMigrationAndUrlState(browser, baseUrl, posts) {
  const [first, second] = posts;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce"
  });
  await context.addInitScript(({ canonicalKey, legacyKey, firstSlug, secondSlug }) => {
    localStorage.setItem(canonicalKey, JSON.stringify([firstSlug]));
    localStorage.setItem(legacyKey, JSON.stringify([secondSlug, firstSlug]));
  }, {
    canonicalKey: CANONICAL_KEY,
    legacyKey: LEGACY_KEY,
    firstSlug: first.slug,
    secondSlug: second.slug
  });

  const page = await context.newPage();
  const query = encodeURIComponent(first.title);
  const category = encodeURIComponent(first.category);
  await page.goto(
    `${baseUrl}/blog/?saved=1&category=${category}&q=${query}&target=${encodeURIComponent(second.slug)}`,
    { waitUntil: "domcontentloaded" }
  );
  await page.waitForSelector('#galaxy-field[data-ready="true"]');
  await page.waitForFunction(() => !new URL(location.href).searchParams.has("target"));

  const migrated = await page.evaluate(({ canonicalKey, legacyKey }) => ({
    canonical: JSON.parse(localStorage.getItem(canonicalKey) || "[]"),
    legacy: localStorage.getItem(legacyKey),
    pressed: document.querySelector("button[data-saved-filter]")?.getAttribute("aria-pressed"),
    label: document.querySelector("button[data-saved-filter]")?.getAttribute("aria-label"),
    name: document.querySelector("button[data-saved-filter]")?.textContent.replace(/\s+/g, " ").trim(),
    count: document.querySelector(".galaxy-saved-filter__count")?.textContent,
    status: document.querySelector("#galaxy-saved-count")?.textContent,
    visibleSlugs: [...document.querySelectorAll(".galaxy-entry:not([hidden])")].map((entry) => entry.dataset.slug)
  }), { canonicalKey: CANONICAL_KEY, legacyKey: LEGACY_KEY });

  assert(
    JSON.stringify(migrated.canonical) === JSON.stringify([first.slug, second.slug].sort()),
    `Bookmark migration did not merge both keys without loss: ${JSON.stringify(migrated.canonical)}.`
  );
  assert(migrated.legacy === null, "Bookmark migration left the legacy key behind.");
  assert(
    migrated.pressed === "true"
      && migrated.label === null
      && /^saved reading\s*2$/i.test(migrated.name || "")
      && migrated.count === "2"
      && migrated.status === "2 saved entries",
    `Saved filter is not announced accessibly: ${JSON.stringify(migrated)}.`);
  assert(JSON.stringify(migrated.visibleSlugs) === JSON.stringify([first.slug]),
    `Saved, category, and query filters did not compose: ${JSON.stringify(migrated.visibleSlugs)}.`);
  assert(new URL(page.url()).searchParams.has("target") === false,
    "Saved filtering left a stale selected-post target in the shareable URL.");

  const savedButton = page.locator("button[data-saved-filter]");
  await savedButton.click();
  assert(new URL(page.url()).searchParams.get("saved") === null, "Saved toggle did not remove its URL state.");
  assert(new URL(page.url()).searchParams.get("category") === first.category, "Saved toggle discarded category URL state.");
  assert(new URL(page.url()).searchParams.get("q") === first.title, "Saved toggle discarded query URL state.");
  await page.goBack();
  await page.waitForFunction(() => new URL(location.href).searchParams.get("saved") === "1");
  assert(await savedButton.getAttribute("aria-pressed") === "true", "Back navigation did not restore Saved filter state.");

  await context.close();
}

async function verifyPrerenderHydrationIdentity(browser, baseUrl, posts) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce"
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/focused-blog/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('#galaxy-field[data-ready="true"]');

  const hydrated = await page.evaluate(() => {
    const original = window.__prerenderedGalaxyEntries || [];
    const current = [...document.querySelectorAll("#galaxy-list > article")];
    const currentBySlug = new Map(current.map((entry) => [entry.dataset.blogSlug, entry]));
    return {
      actionCounts: current.map((entry) => entry.querySelectorAll(":scope .galaxy-entry__actions").length),
      currentSlugs: current.map((entry) => entry.dataset.blogSlug),
      originalCount: original.length,
      originalSlugs: original.map((entry) => entry.dataset.blogSlug),
      preservedByIdentity: original.every((entry) => currentBySlug.get(entry.dataset.blogSlug) === entry)
    };
  });

  assert(hydrated.originalCount === posts.length,
    `Prerender fixture exposed ${hydrated.originalCount} entries instead of ${posts.length}.`);
  assert(hydrated.preservedByIdentity,
    "Logs hydration replaced one or more server-rendered article elements.");
  assert(JSON.stringify(hydrated.currentSlugs) === JSON.stringify(hydrated.originalSlugs),
    "Logs hydration changed the prerendered archive order.");
  assert(hydrated.actionCounts.every((count) => count === 1),
    `Logs hydration did not enhance each prerendered entry exactly once: ${JSON.stringify(hydrated.actionCounts)}.`);

  const firstBookmark = page.locator(".galaxy-entry:not([hidden]) button[data-bookmark-slug]").first();
  const firstSlug = await firstBookmark.getAttribute("data-bookmark-slug");
  await firstBookmark.click();
  const saved = await page.evaluate((canonicalKey) => JSON.parse(localStorage.getItem(canonicalKey) || "[]"), CANONICAL_KEY);
  assert(JSON.stringify(saved) === JSON.stringify([firstSlug]),
    `Hydrated entry actions are not bound to Saved Reading state: ${JSON.stringify(saved)}.`);
  await context.close();
}

async function verifyArticleInteroperability(browser, baseUrl, post) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const articlePage = await context.newPage();
  await articlePage.goto(`${baseUrl}/fixture-article.html`, { waitUntil: "domcontentloaded" });
  const articleBookmark = articlePage.locator("#bookmark-post-button");
  await articleBookmark.click();
  const articleStorage = await articlePage.evaluate(({ canonicalKey, legacyKey }) => ({
    canonical: JSON.parse(localStorage.getItem(canonicalKey) || "[]"),
    legacy: localStorage.getItem(legacyKey)
  }), { canonicalKey: CANONICAL_KEY, legacyKey: LEGACY_KEY });
  assert(JSON.stringify(articleStorage.canonical) === JSON.stringify([post.slug]),
    `Generated article did not save through the canonical key: ${JSON.stringify(articleStorage)}.`);
  assert(articleStorage.legacy === null, "Generated article recreated the legacy bookmark key.");
  assert(await articleBookmark.getAttribute("aria-pressed") === "true", "Generated article bookmark lacks pressed state.");

  const logsPage = await context.newPage();
  await logsPage.goto(`${baseUrl}/blog/?saved=1`, { waitUntil: "domcontentloaded" });
  await logsPage.waitForSelector('#galaxy-field[data-ready="true"]');
  const visibleSlugs = await logsPage.locator(".galaxy-entry:not([hidden])").evaluateAll((entries) =>
    entries.map((entry) => entry.dataset.slug)
  );
  assert(JSON.stringify(visibleSlugs) === JSON.stringify([post.slug]),
    `Logs did not read the article bookmark through the shared key: ${JSON.stringify(visibleSlugs)}.`);

  await logsPage.locator(`button[data-bookmark-slug="${post.slug}"]`).click();
  await articlePage.waitForFunction(() => document.querySelector("#bookmark-post-button")?.getAttribute("aria-pressed") === "false");
  assert(await articleBookmark.textContent() === "[BOOKMARK]", "Article did not react to a cross-tab bookmark removal.");
  await logsPage.waitForFunction(() => document.querySelectorAll(".galaxy-entry:not([hidden])").length === 0);
  const emptyText = await logsPage.locator("#galaxy-empty:not([hidden])").textContent();
  assert(/No saved reading yet/.test(emptyText || ""), `Saved filter did not explain its empty state: ${emptyText}.`);

  await context.close();
}

async function verifySavedFocusHandoff(browser, baseUrl, posts) {
  const seededSlugs = posts.slice(0, 2).map((post) => post.slug);
  const context = await browser.newContext({
    viewport: { width: 1100, height: 800 },
    reducedMotion: "reduce"
  });
  await context.addInitScript(({ canonicalKey, slugs }) => {
    localStorage.setItem(canonicalKey, JSON.stringify(slugs));
  }, { canonicalKey: CANONICAL_KEY, slugs: seededSlugs });

  const page = await context.newPage();
  await page.goto(`${baseUrl}/blog/?saved=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('#galaxy-field[data-ready="true"]');

  const visibleBookmarks = page.locator(".galaxy-entry:not([hidden]) button[data-bookmark-slug]");
  assert(await visibleBookmarks.count() === 2, "Saved focus fixture did not expose two bookmarked entries.");
  const firstSlug = await visibleBookmarks.nth(0).getAttribute("data-bookmark-slug");
  const secondSlug = await visibleBookmarks.nth(1).getAttribute("data-bookmark-slug");
  await visibleBookmarks.nth(0).click();
  await page.waitForFunction((slug) => document.activeElement?.dataset.bookmarkSlug === slug, secondSlug);
  assert(await page.evaluate(() => document.activeElement?.dataset.bookmarkSlug) === secondSlug,
    "Removing the first Saved entry did not move focus to the next Saved entry.");

  await page.evaluate(({ canonicalKey, slugs }) => {
    localStorage.setItem(canonicalKey, JSON.stringify(slugs));
  }, { canonicalKey: CANONICAL_KEY, slugs: seededSlugs });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('#galaxy-field[data-ready="true"]');
  const restoredBookmarks = page.locator(".galaxy-entry:not([hidden]) button[data-bookmark-slug]");
  assert(await restoredBookmarks.count() === 2, "Saved focus fixture did not restore both bookmarked entries.");
  await restoredBookmarks.nth(1).click();
  await page.waitForFunction((slug) => document.activeElement?.dataset.bookmarkSlug === slug, firstSlug);
  assert(await page.evaluate(() => document.activeElement?.dataset.bookmarkSlug) === firstSlug,
    "Removing the last Saved entry did not move focus to the previous Saved entry.");

  await page.locator(`button[data-bookmark-slug="${firstSlug}"]`).click();
  await page.waitForFunction(() => document.activeElement?.matches("button[data-saved-filter]"));
  assert(await page.locator("button[data-saved-filter]").evaluate((button) => button === document.activeElement),
    "Removing the final Saved entry did not return focus to the Saved filter.");
  await context.close();
}

async function verifyGalaxyPlacementRuntime(browser, baseUrl) {
  const evidence = [];
  const verifyFocusCards = async (page, width, height, motion) => {
    const visibleNodes = page.locator(".galaxy-node:not(.is-muted)");
    const focusFailures = [];
    let maxFrameAttempts = 0;
    for (let index = 0; index < await visibleNodes.count(); index += 1) {
      const node = visibleNodes.nth(index);
      const slug = await node.getAttribute("data-slug");
      await node.click();
      await page.waitForFunction((selectedSlug) => {
        const focus = document.querySelector("#galaxy-focus");
        return new URL(location.href).searchParams.get("target") === selectedSlug
          && !focus?.hidden
          && focus?.dataset.frameState === "settled";
      }, slug);
      const focusGeometry = await page.evaluate(() => {
        const header = document.querySelector("#site-topbar").getBoundingClientRect();
        const field = document.querySelector("#galaxy-field").getBoundingClientRect();
        const focus = document.querySelector("#galaxy-focus").getBoundingClientRect();
        return {
          bottom: focus.bottom,
          fieldBottom: field.bottom,
          fieldTop: field.top,
          frameAttempts: Number(document.querySelector("#galaxy-focus").dataset.frameAttempts),
          headerBottom: header.bottom,
          scrollY,
          selected: new URL(location.href).searchParams.get("target"),
          top: focus.top,
          viewportHeight: innerHeight
        };
      });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForTimeout(64);
      const settledGeometry = await page.evaluate(() => {
        const focus = document.querySelector("#galaxy-focus").getBoundingClientRect();
        return { bottom: focus.bottom, scrollY, top: focus.top };
      });
      focusGeometry.jitter = Math.max(
        Math.abs(settledGeometry.top - focusGeometry.top),
        Math.abs(settledGeometry.bottom - focusGeometry.bottom),
        Math.abs(settledGeometry.scrollY - focusGeometry.scrollY)
      );
      maxFrameAttempts = Math.max(maxFrameAttempts, focusGeometry.frameAttempts);
      if (motion === "normal motion" && index === 0) {
        fs.mkdirSync(FOCUS_EVIDENCE_ROOT, { recursive: true });
        await page.screenshot({
          path: path.join(FOCUS_EVIDENCE_ROOT, `logs-focus-${width}x${height}.png`)
        });
      }
      if (!(focusGeometry.selected
        && focusGeometry.top >= focusGeometry.headerBottom + 7
        && focusGeometry.bottom <= focusGeometry.viewportHeight - 7
        && focusGeometry.top >= focusGeometry.fieldTop
        && focusGeometry.bottom <= focusGeometry.fieldBottom
        && focusGeometry.jitter <= 1)) {
        focusFailures.push({ index, ...focusGeometry });
      }
      await page.keyboard.press("Escape");
      assert(await page.locator("#galaxy-focus").isHidden(), `Escape left Logs node ${index} open at ${width}px (${motion}).`);
      assert(await node.evaluate((element) => document.activeElement === element),
        `Escape did not restore focus to Logs node ${index} at ${width}px (${motion}).`);
    }
    assert(focusFailures.length === 0,
      `Selected Logs evidence is not stably framed below the sticky header at ${width}x${height} (${motion}): ${JSON.stringify(focusFailures)}.`);
    return maxFrameAttempts;
  };

  const verifySearchScroll = async (page, expectedBehavior, width) => {
    await page.evaluate(() => {
      const original = Element.prototype.scrollIntoView;
      window.__logsScrollIntoView = [];
      Element.prototype.scrollIntoView = function scrollIntoView(options) {
        window.__logsScrollIntoView.push(options || null);
        return original.call(this, options);
      };
    });
    await page.locator("#galaxy-search").fill("Android");
    await page.locator("#galaxy-tuner").press("Enter");
    await page.waitForFunction(() => window.__logsScrollIntoView?.length > 0);
    const behavior = await page.evaluate(() => window.__logsScrollIntoView.at(-1)?.behavior);
    assert(behavior === expectedBehavior,
      `Logs search lost its ${expectedBehavior} core journey at ${width}px: ${behavior}.`);
  };

  const verifyBrowseHandoff = async (page, width) => {
    const browse = page.locator('.galaxy-ledger__browse[href="#blog-feed"]');
    await browse.focus();
    assert(await browse.evaluate((element) => document.activeElement === element),
      `Browse link could not receive keyboard focus at ${width}px.`);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.hash === "#blog-feed" && document.activeElement?.id === "blog-feed");

    const landed = await page.evaluate(() => {
      const feed = document.querySelector("#blog-feed").getBoundingClientRect();
      const header = document.querySelector("#site-topbar").getBoundingClientRect();
      return { activeId: document.activeElement?.id, feedTop: feed.top, headerBottom: header.bottom, scrollY };
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(64);
    const settled = await page.evaluate(() => ({
      activeId: document.activeElement?.id,
      feedTop: document.querySelector("#blog-feed").getBoundingClientRect().top,
      scrollY
    }));
    const jitter = Math.max(
      Math.abs(settled.feedTop - landed.feedTop),
      Math.abs(settled.scrollY - landed.scrollY)
    );
    assert(
      landed.activeId === "blog-feed"
        && settled.activeId === "blog-feed"
        && landed.feedTop >= landed.headerBottom + 7
        && landed.feedTop <= landed.headerBottom + 32
        && jitter <= 1,
      `Browse did not hand off focus stably below the sticky header at ${width}px: ${JSON.stringify({ ...landed, jitter, settled })}.`
    );
    fs.mkdirSync(FOCUS_EVIDENCE_ROOT, { recursive: true });
    await page.screenshot({
      path: path.join(FOCUS_EVIDENCE_ROOT, `logs-browse-focus-${width}.png`)
    });

    await page.keyboard.press("Tab");
    const nextFocus = await page.evaluate(() => ({
      href: document.activeElement?.getAttribute?.("href") || "",
      inFirstEntry: Boolean(document.activeElement?.closest?.(".galaxy-entry:first-child")),
      tag: document.activeElement?.tagName || ""
    }));
    assert(nextFocus.tag === "A" && nextFocus.inFirstEntry && nextFocus.href.startsWith("/blog/"),
      `Browse did not continue into the first published entry at ${width}px: ${JSON.stringify(nextFocus)}.`);
    return {
      feedTop: Number(landed.feedTop.toFixed(1)),
      headerBottom: Number(landed.headerBottom.toFixed(1)),
      jitter: Number(jitter.toFixed(1))
    };
  };

  for (const width of [320, 390]) {
    const height = width === 320 ? 720 : 843;
    const context = await browser.newContext({ viewport: { width, height } });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === baseUrl) route.continue();
      else route.abort();
    });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/blog/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForFunction(() => document.querySelector("#galaxy-field")?.dataset.labelLayoutState === "settled");

    const measure = () => page.evaluate(() => {
      const field = document.querySelector("#galaxy-field");
      const fieldRect = field.getBoundingClientRect();
      const labels = [...document.querySelectorAll(".galaxy-node:not(.is-muted) .galaxy-node__label")];
      const rects = labels.map((label) => label.getBoundingClientRect());
      let actualOverlaps = 0;
      for (let index = 0; index < rects.length; index += 1) {
        for (let candidate = index + 1; candidate < rects.length; candidate += 1) {
          const left = rects[index];
          const right = rects[candidate];
          const overlapX = Math.min(left.right + 2, right.right + 2) - Math.max(left.left - 2, right.left - 2);
          const overlapY = Math.min(left.bottom + 2, right.bottom + 2) - Math.max(left.top - 2, right.top - 2);
          if (overlapX > 0 && overlapY > 0) actualOverlaps += 1;
        }
      }
      const actualClipped = rects.filter((rect) => (
        rect.left < fieldRect.left + 2 || rect.right > fieldRect.right - 2
          || rect.top < fieldRect.top + 2 || rect.bottom > fieldRect.bottom - 2
      )).length;
      return {
        actualClipped,
        actualOverlaps,
        clipped: Number(field.dataset.labelClippedCount),
        layoutMs: Number(field.dataset.labelLayoutMs),
        labels: labels.length,
        minLabelPx: Math.min(...labels.map((label) => Number.parseFloat(getComputedStyle(label).fontSize))),
        overlaps: Number(field.dataset.labelOverlapCount),
        placements: Number(field.dataset.labelPlacementCount),
        runs: Number(field.dataset.labelLayoutRuns),
        state: field.dataset.labelLayoutState
      };
    });

    const assertPlacement = (state, label) => {
      assert(
        state.state === "settled"
          && state.clipped === 0
          && state.overlaps === 0
          && state.actualClipped === 0
          && state.actualOverlaps === 0
          && state.placements === state.labels
          && state.minLabelPx >= 10
          && state.layoutMs < 50,
        `${label} placement exceeded its geometry/performance budget at ${width}px: ${JSON.stringify(state)}.`
      );
    };

    const initial = await measure();
    assertPlacement(initial, "Default Logs");
    assert(initial.runs <= 2, `Logs repeated its startup label pass at ${width}px: ${JSON.stringify(initial)}.`);
    let maxLayoutMs = initial.layoutMs;

    const normalFrameAttempts = await verifyFocusCards(page, width, height, "normal motion");
    const browseHandoff = await verifyBrowseHandoff(page, width);

    const categories = await page.locator("button[data-category]").evaluateAll((buttons) =>
      buttons.map((button) => button.dataset.category)
    );
    let previousRuns = initial.runs;
    for (const category of categories.filter((value) => value !== "all")) {
      await page.locator(`button[data-category="${category}"]`).click();
      await page.waitForFunction(({ category, previousRuns }) => {
        const field = document.querySelector("#galaxy-field");
        const active = document.querySelector(`button[data-category="${category}"]`);
        return active?.getAttribute("aria-pressed") === "true"
          && field?.dataset.labelLayoutState === "settled"
          && Number(field.dataset.labelLayoutRuns) > previousRuns;
      }, { category, previousRuns });
      const filtered = await measure();
      assertPlacement(filtered, `${category} Logs`);
      maxLayoutMs = Math.max(maxLayoutMs, filtered.layoutMs);
      assert(filtered.runs === previousRuns + 1,
        `${category} scheduled duplicate label passes at ${width}px: ${previousRuns} -> ${filtered.runs}.`);
      previousRuns = filtered.runs;
    }
    await verifySearchScroll(page, "smooth", width);
    evidence.push({ browseHandoff, initialRuns: initial.runs, maxLayoutMs, normalFrameAttempts, width });
    await context.close();

    const reducedContext = await browser.newContext({
      reducedMotion: "reduce",
      viewport: { width, height }
    });
    await reducedContext.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === baseUrl) route.continue();
      else route.abort();
    });
    const reducedPage = await reducedContext.newPage();
    await reducedPage.goto(`${baseUrl}/blog/`, { waitUntil: "domcontentloaded" });
    await reducedPage.waitForFunction(() => document.querySelector("#galaxy-field")?.dataset.labelLayoutState === "settled");
    evidence[evidence.length - 1].reducedFrameAttempts = await verifyFocusCards(
      reducedPage,
      width,
      height,
      "reduced motion"
    );
    await verifySearchScroll(reducedPage, "auto", width);
    await reducedContext.close();
  }
  return evidence;
}

async function verifyNoJavaScriptFallback(browser, baseUrl, expectedPosts) {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/focused-blog/?saved=1`, { waitUntil: "load" });
  const state = await page.evaluate(() => ({
    entries: document.querySelectorAll(".galaxy-entry").length,
    feedTabIndex: document.querySelector("#blog-feed")?.tabIndex,
    mainText: document.querySelector("main")?.innerText || "",
    tunerDisplay: getComputedStyle(document.querySelector("#galaxy-tuner")).display
  }));
  assert(state.entries === expectedPosts, `No-JavaScript Logs lost entries when Saved appeared in the URL: ${state.entries}.`);
  assert(state.feedTabIndex === -1,
    `Generated Logs fallback lost the programmatically focusable Published writing target: ${state.feedTabIndex}.`);
  assert(state.mainText.includes("Writing in orbit."), "No-JavaScript Logs lost its readable archive.");
  assert(state.tunerDisplay === "none", "No-JavaScript Logs exposed an inert Saved/search control.");

  await page.goto(`${baseUrl}/fixture-article.html`, { waitUntil: "load" });
  assert(await page.locator("#share-post-button").isVisible() === false,
    "No-JavaScript article exposed an inert Share button.");
  assert(await page.locator("#bookmark-post-button").isVisible() === false,
    "No-JavaScript article exposed an inert Bookmark button.");
  await context.close();
}

async function verifyLostSignal(browser, baseUrl) {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const response = await page.goto(`${baseUrl}/definitely-lost-coordinate`, { waitUntil: "load" });
  assert(response?.status() === 404, `Lost route returned ${response?.status()} instead of 404.`);
  const state = await page.evaluate(() => ({
    robots: document.querySelector('meta[name="robots"]')?.content,
    formAction: document.querySelector(".lost-signal__search")?.getAttribute("action"),
    inputName: document.querySelector("#lost-signal-search")?.getAttribute("name"),
    label: document.querySelector('label[for="lost-signal-search"]')?.textContent.trim(),
    routes: [...document.querySelectorAll(".lost-signal__routes a")].map((link) => link.getAttribute("href")),
    rootWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  assert(state.robots === "noindex,follow", `404 robots policy drifted: ${state.robots}.`);
  assert(state.formAction === "/search.html" && state.inputName === "q" && state.label === "Search published evidence",
    `404 search recovery is not wired to published evidence: ${JSON.stringify(state)}.`);
  assert(JSON.stringify(state.routes) === JSON.stringify(["/", "/work.html", "/blog/", "/contact.html"]),
    `404 recovery routes drifted: ${JSON.stringify(state.routes)}.`);
  assert(state.rootWidth <= state.viewportWidth + 2, `404 overflows mobile: ${state.rootWidth}/${state.viewportWidth}.`);

  await page.fill("#lost-signal-search", "release reliability");
  await Promise.all([
    page.waitForURL("**/search.html?q=release+reliability"),
    page.locator('.lost-signal__search button[type="submit"]').click()
  ]);
  assert(new URL(page.url()).searchParams.get("q") === "release reliability", "404 did not preserve its recovery query.");
  const styles = fs.readFileSync(path.join(ROOT, "assets", "css", "lost-signal.css"), "utf8");
  assert(styles.includes("--faint: #58615d"), "Lost Signal quiet text regressed below the intended AA color.");
  assert(styles.includes("color: #fff;"), "Lost Signal hover text lost its high-contrast color.");
  await context.close();
}

async function main() {
  assert(publication.optionalPublicRootFiles.includes("404.html"), "404.html is outside the publication allowlist.");
  const posts = JSON.parse(fs.readFileSync(path.join(ROOT, "blog", "posts.json"), "utf8"));
  assert(posts.length >= 2, "Saved Reading test needs at least two published posts.");
  const server = createServer(fixtureArticle(posts[0]), focusedBlogFallback(posts));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const port = server.address()?.port;
  const baseUrl = `http://${HOST}:${port}`;
  const browser = await chromium.launch({ headless: true });

  try {
    await verifyPrerenderHydrationIdentity(browser, baseUrl, posts);
    await verifyMigrationAndUrlState(browser, baseUrl, posts);
    await verifyArticleInteroperability(browser, baseUrl, posts[0]);
    await verifySavedFocusHandoff(browser, baseUrl, posts);
    const galaxyRuntime = await verifyGalaxyPlacementRuntime(browser, baseUrl);
    await verifyNoJavaScriptFallback(browser, baseUrl, posts.length);
    await verifyLostSignal(browser, baseUrl);
    console.log(`Saved Reading and Lost Signal contract passed; galaxy placement runtime: ${JSON.stringify(galaxyRuntime)}; focus evidence: ${FOCUS_EVIDENCE_ROOT}.`);
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
