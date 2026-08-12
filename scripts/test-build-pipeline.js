const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const {
  LLMS_SECTIONS,
  PERSON_ID,
  articleMode,
  buildStaticBlog,
  decorateArticleBody,
  trajectoryVariant
} = require("./build-static-blog-pages");
const { injectBigBangLoader } = require("./build-site");
const { DEFAULT_DB_PATH, openDatabase } = require("./lib/blog-db");

const SITE_ORIGIN = "https://ac-opensource.github.io";

function jsonLdOfType(html, type, label) {
  const documents = [...String(html).matchAll(
    /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )].map((match) => {
    try {
      return JSON.parse(match[1]);
    } catch (error) {
      throw new Error(`${label}: invalid JSON-LD: ${error.message}`);
    }
  });
  const matches = documents
    .flatMap((document) => Array.isArray(document?.["@graph"]) ? document["@graph"] : [document])
    .filter((node) => node?.["@type"] === type);
  if (matches.length !== 1) {
    throw new Error(`${label}: expected exactly one ${type} JSON-LD node, found ${matches.length}.`);
  }
  return matches[0];
}

function llmsSectionUrls(llms, section) {
  const startIndex = llms.indexOf(section.start);
  const endIndex = llms.indexOf(section.end);
  if (
    startIndex < 0 ||
    endIndex < startIndex ||
    llms.lastIndexOf(section.start) !== startIndex ||
    llms.lastIndexOf(section.end) !== endIndex
  ) {
    throw new Error(`llms.txt must contain exactly one ordered ${section.category} generated section.`);
  }
  const body = llms.slice(startIndex + section.start.length, endIndex);
  return [...body.matchAll(/^\s*-\s+\[[^\n]*?\]\(([^)\s]+)\)/gm)]
    .map((match) => match[1]);
}

function expectedLlmsUrls(posts, category) {
  return posts
    .filter(
      (post) =>
        post.status === "published" &&
        String(post.category || "").trim().toLowerCase() === category
    )
    .map((post) => `${SITE_ORIGIN}/blog/${encodeURIComponent(post.slug)}.html`);
}

function assertLlmsMatchesPosts(llms, posts, excludedSlugs = []) {
  for (const section of LLMS_SECTIONS) {
    const actual = llmsSectionUrls(llms, section);
    const expected = expectedLlmsUrls(posts, section.category);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `llms.txt ${section.category} URLs do not exactly match published database order: ` +
        `expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}.`
      );
    }
    if (new Set(actual).size !== actual.length) {
      throw new Error(`llms.txt ${section.category} section contains duplicate article URLs.`);
    }
  }
  for (const slug of excludedSlugs) {
    const url = `${SITE_ORIGIN}/blog/${encodeURIComponent(slug)}.html`;
    if (llms.includes(url)) throw new Error(`llms.txt exposed non-published post ${slug}.`);
  }
}

function main() {
  const loaderFixture = "<!doctype html><html><head><title>Fixture</title></head><body>Ready</body></html>";
  const loaderEnhanced = injectBigBangLoader(loaderFixture, "work.html");
  if (!loaderEnhanced.includes('data-big-bang-bootstrap')
    || !loaderEnhanced.includes('/assets/css/big-bang-loader.css?v=20260812-motion1')
    || !loaderEnhanced.includes('/assets/js/big-bang-loader.js?v=20260812-motion1')
    || !loaderEnhanced.includes('root.dataset.bigBang="pending"')
    || !loaderEnhanced.includes('root.dataset.universePerspectiveTo==="work"')
    || !loaderEnhanced.includes('sessionStorage.getItem("ac.bigBangPortfolioPlayed.v1")')
    || loaderEnhanced.includes('window.location.search')) {
    throw new Error("The Portfolio session Big Bang assets or activation bootstrap are incomplete.");
  }
  if (injectBigBangLoader(loaderEnhanced, "work.html") !== loaderEnhanced) {
    throw new Error("The Big Bang loader injection is not idempotent.");
  }
  for (const route of [
    "index.html",
    "about.html",
    "blog/index.html",
    "blog/fixture-article.html",
    "contact/index.html",
    "experiments/fixture.html",
    "redirect.html"
  ]) {
    if (injectBigBangLoader(loaderFixture, route) !== loaderFixture) {
      throw new Error(`The Portfolio Big Bang loader leaked into ${route}.`);
    }
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac-blog-build-test-"));
  const outputRoot = path.join(tempRoot, "site");
  const databasePath = path.join(tempRoot, "blog.sqlite");
  fs.copyFileSync(DEFAULT_DB_PATH, databasePath);
  fs.mkdirSync(path.join(outputRoot, "blog"), { recursive: true });
  fs.writeFileSync(
    path.join(outputRoot, "blog", "index.html"),
    '<main><section id="blog-feed" class="space-y-12" aria-label="Latest blog posts"><p>Stale fallback</p></section></main>\n',
    "utf8"
  );

  try {
    const { db: expectationDb } = openDatabase(databasePath, { readonly: true });
    let expectedPublishedRows;
    let hiddenSlugs;
    try {
      expectedPublishedRows = expectationDb
        .prepare("SELECT slug, category FROM posts WHERE status = 'published' ORDER BY published_date DESC, slug ASC")
        .all();
      hiddenSlugs = expectationDb
        .prepare("SELECT slug FROM posts WHERE status <> 'published' ORDER BY slug ASC")
        .all()
        .map((row) => row.slug);
    } finally {
      expectationDb.close();
    }

    const databaseDigestBeforeBuild = crypto.createHash("sha256").update(fs.readFileSync(databasePath)).digest("hex");
    const initial = buildStaticBlog({ dbPath: databasePath, outputRoot });
    if (!initial.posts.length) throw new Error("Expected at least one published post in the fixture database.");
    if (initial.posts.length !== expectedPublishedRows.length) {
      throw new Error(`Expected all ${expectedPublishedRows.length} published posts, found ${initial.posts.length}.`);
    }
    const expectedPublishedSlugs = expectedPublishedRows.map((row) => row.slug);
    const builtPublishedSlugs = initial.posts.map((post) => post.slug);
    if (JSON.stringify(builtPublishedSlugs) !== JSON.stringify(expectedPublishedSlugs)) {
      throw new Error("The static build did not preserve the exact published database order.");
    }
    const initialIndex = fs.readFileSync(path.join(outputRoot, "blog", "index.html"), "utf8");
    if (!initialIndex.includes(initial.posts[0].title) || initialIndex.includes("Stale fallback")) {
      throw new Error("The no-JavaScript blog fallback was not rebuilt from published posts.");
    }
    if ((initialIndex.match(/class="galaxy-entry(?: has-media)?"/g) || []).length !== initial.posts.length) {
      throw new Error("The no-JavaScript Logs route did not preserve every published transmission.");
    }
    const initialLlms = fs.readFileSync(path.join(outputRoot, "llms.txt"), "utf8");
    assertLlmsMatchesPosts(initialLlms, initial.posts, hiddenSlugs);

    const firstPostPage = fs.readFileSync(
      path.join(outputRoot, "blog", `${initial.posts[0].slug}.html`),
      "utf8"
    );
    if (!firstPostPage.includes('id="share-post-button" type="button" hidden')
      || !firstPostPage.includes('id="bookmark-post-button" type="button" hidden')) {
      throw new Error("Generated articles must hide JavaScript-only actions until their handlers initialize.");
    }
    if (firstPostPage.includes("hero-overlay-alpha") || firstPostPage.includes("overlayAlphaPulse")) {
      throw new Error("Article hero images must render without a show/hide animation.");
    }
    if (!firstPostPage.includes('/assets/css/article-debrief.css?v=20260812-actions2')
      || !firstPostPage.includes('/assets/js/article-debrief.js?v=20260807-regions1')
      || !firstPostPage.includes('/assets/css/universe-field-map.css?v=20260809-guide9')
      || !firstPostPage.includes('/assets/css/universe-perspective-navigation.css?v=20260812-discovery1')
      || !firstPostPage.includes('/assets/js/universe-theme-transition.js?v=20260812-discovery1')
      || !firstPostPage.includes('/assets/js/universe-field-map.js?v=20260809-guide9')) {
      throw new Error("Generated articles are missing their region and shared navigation assets.");
    }

    for (const post of initial.posts) {
      const postPage = fs.readFileSync(path.join(outputRoot, "blog", `${post.slug}.html`), "utf8");
      const blogPosting = jsonLdOfType(postPage, "BlogPosting", post.slug);
      if (blogPosting.author?.["@id"] !== PERSON_ID || blogPosting.publisher?.["@id"] !== PERSON_ID) {
        throw new Error(`${post.slug}: BlogPosting author and publisher must reference ${PERSON_ID}.`);
      }
      const sourceHeadingCount = (post.body_html.match(/<h[23]\b/gi) || []).length;
      const sourceFigureCount = (post.body_html.match(/<figure\b/gi) || []).length;
      const decoratedHeadingCount = (postPage.match(/data-debrief-heading/g) || []).length;
      const trajectoryLinkCount = (postPage.match(/data-trajectory-link/g) || []).length;
      const expectedVariant = trajectoryVariant(post);
      const expectedMode = articleMode(post, post.body_html);
      const mappedStopCount = expectedMode === "photography" && sourceFigureCount
        ? sourceFigureCount
        : sourceHeadingCount;

      if (decoratedHeadingCount !== sourceHeadingCount) {
        throw new Error(`${post.slug}: the generated debrief did not preserve every semantic heading.`);
      }
      if (trajectoryLinkCount !== mappedStopCount * 2) {
        throw new Error(`${post.slug}: desktop/mobile trajectories were not derived exactly from real headings or frames.`);
      }
      if (!postPage.includes(`data-debrief-variant="${expectedVariant}"`)) {
        throw new Error(`${post.slug}: article debrief variant did not follow its source category.`);
      }
      if (!postPage.includes(`data-article-mode="${expectedMode}"`)) {
        throw new Error(`${post.slug}: article region did not follow its real content type.`);
      }
      if (/\[(?:context|constraint|decision|implementation|verification|outcome)\]/.test(postPage)) {
        throw new Error(`${post.slug}: article navigation received inferred engineering claims.`);
      }
    }

    const targetPage = fs.readFileSync(
      path.join(outputRoot, "blog", "2026-08-06-how-i-rebuilt-my-homepage-as-an-interactive-orbital-system.html"),
      "utf8"
    );
    const targetPhases = [...targetPage.matchAll(/data-debrief-heading data-debrief-phase="([^"]+)"/g)]
      .map((match) => match[1]);
    if (JSON.stringify(targetPhases) !== JSON.stringify(Array(8).fill("system"))) {
      throw new Error(`The technical region did not use its deterministic systems labels: ${targetPhases.join(", ")}`);
    }

    const reflectionPage = fs.readFileSync(
      path.join(outputRoot, "blog", "2026-07-22-the-fortress-we-mistake-for-home.html"),
      "utf8"
    );
    if ((reflectionPage.match(/\[observation\]/g) || []).length !== 10) {
      throw new Error("Reflection pages must use the calmer observation labels in both indexes.");
    }
    const photographyPage = fs.readFileSync(
      path.join(outputRoot, "blog", "2024-09-14-film-photography-gallery.html"),
      "utf8"
    );
    if (!photographyPage.includes('aria-label="Image sequence frames"')
      || (photographyPage.match(/data-trajectory-link/g) || []).length !== 6
      || !photographyPage.includes('href="#field-frame-01"')) {
      throw new Error("The photography region must map its three real figures without fabricated section stops.");
    }

    const exactFixture = '<section><h2 class="title">A &amp; B</h2><p><a href="/proof">Exact prose</a></p><figure><img src="x.png" alt="x"><figcaption>Caption</figcaption></figure><pre><code>value()</code></pre></section>';
    const fixtureResult = decorateArticleBody(exactFixture, { category: "technical", slug: "fixture" });
    const restoredFixture = fixtureResult.bodyHtml
      .replace(/ id="debrief-[^"]+"/, "")
      .replace(/ data-debrief-heading data-debrief-phase="[^"]+"/, "")
      .replace(/ id="field-frame-[^"]+" data-article-figure/, "");
    if (restoredFixture !== exactFixture) {
      throw new Error("Decorating headings changed body prose, links, figures, captions, or code.");
    }
    const databaseDigestAfterBuild = crypto.createHash("sha256").update(fs.readFileSync(databasePath)).digest("hex");
    if (databaseDigestAfterBuild !== databaseDigestBeforeBuild) {
      throw new Error("The static article generator mutated the authoring-only SQLite source.");
    }

    const ocbcPage = fs.readFileSync(
      path.join(outputRoot, "blog", "case-study-ocbc-banking-experience.html"),
      "utf8"
    );
    if (!ocbcPage.includes('data-work-hero-layout="gallery"')) {
      throw new Error("The OCBC project note did not use the official app-screen gallery.");
    }
    if ((ocbcPage.match(/class="work-post-hero__screen"/g) || []).length !== 3) {
      throw new Error("The OCBC project note did not render all three official app screens.");
    }
    if (!ocbcPage.includes('id="post-category"') || !ocbcPage.includes('[portfolio]') || ocbcPage.includes('[work]')) {
      throw new Error("The OCBC project note did not use the public portfolio label consistently.");
    }
    const openpayPage = fs.readFileSync(
      path.join(outputRoot, "blog", "case-study-openpay-bnpl-experience.html"),
      "utf8"
    );
    if (!openpayPage.includes('data-work-hero-layout="cover"')) {
      throw new Error("The openpay project note did not use the edge-to-edge hero presentation.");
    }

    buildStaticBlog({ dbPath: databasePath, outputRoot });
    const repeatedLlms = fs.readFileSync(path.join(outputRoot, "llms.txt"), "utf8");
    if (repeatedLlms !== initialLlms) {
      throw new Error("Generating llms.txt twice from unchanged published rows was not deterministic.");
    }

    const removedSlug = initial.posts[0].slug;
    const removedPage = path.join(outputRoot, "blog", `${removedSlug}.html`);
    const manualPage = path.join(outputRoot, "blog", "manual-page.html");
    fs.writeFileSync(manualPage, "<!doctype html><title>Manual page</title>\n", "utf8");

    const { db } = openDatabase(databasePath);
    try {
      db.prepare("UPDATE posts SET status = 'hidden' WHERE slug = ?").run(removedSlug);
    } finally {
      db.close();
    }

    const rebuilt = buildStaticBlog({ dbPath: databasePath, outputRoot });
    if (fs.existsSync(removedPage)) {
      throw new Error("A stale generator-owned page was not pruned.");
    }
    if (!rebuilt.removedFiles.includes(`blog/${removedSlug}.html`)) {
      throw new Error("The stale generated page was not reported as pruned.");
    }
    if (!fs.existsSync(manualPage)) {
      throw new Error("The generator pruned an unowned manual page.");
    }
    const rebuiltIndex = fs.readFileSync(path.join(outputRoot, "blog", "index.html"), "utf8");
    if (rebuiltIndex.includes(initial.posts[0].title) || !rebuiltIndex.includes(rebuilt.posts[0].title)) {
      throw new Error("The no-JavaScript blog fallback did not follow the latest published rows.");
    }
    const rebuiltLlms = fs.readFileSync(path.join(outputRoot, "llms.txt"), "utf8");
    assertLlmsMatchesPosts(rebuiltLlms, rebuilt.posts, [...hiddenSlugs, removedSlug]);

    console.log("Verified generated fallbacks and pruning while preserving manual pages.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
