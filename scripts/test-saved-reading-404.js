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
const MIME_TYPES = {
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
    count: document.querySelector(".galaxy-saved-filter__count")?.textContent,
    visibleSlugs: [...document.querySelectorAll(".galaxy-entry:not([hidden])")].map((entry) => entry.dataset.slug)
  }), { canonicalKey: CANONICAL_KEY, legacyKey: LEGACY_KEY });

  assert(
    JSON.stringify(migrated.canonical) === JSON.stringify([first.slug, second.slug].sort()),
    `Bookmark migration did not merge both keys without loss: ${JSON.stringify(migrated.canonical)}.`
  );
  assert(migrated.legacy === null, "Bookmark migration left the legacy key behind.");
  assert(migrated.pressed === "true" && /2 saved entries/.test(migrated.label || "") && migrated.count === "2",
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

async function verifyNoJavaScriptFallback(browser, baseUrl, expectedPosts) {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/focused-blog/?saved=1`, { waitUntil: "load" });
  const state = await page.evaluate(() => ({
    entries: document.querySelectorAll(".galaxy-entry").length,
    mainText: document.querySelector("main")?.innerText || "",
    tunerDisplay: getComputedStyle(document.querySelector("#galaxy-tuner")).display
  }));
  assert(state.entries === expectedPosts, `No-JavaScript Logs lost entries when Saved appeared in the URL: ${state.entries}.`);
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
    await verifyNoJavaScriptFallback(browser, baseUrl, posts.length);
    await verifyLostSignal(browser, baseUrl);
    console.log("Saved Reading and Lost Signal contract passed: merged storage, shared article/Logs state, accessible URL filter, no-JS fallback, and deterministic 404 recovery.");
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
