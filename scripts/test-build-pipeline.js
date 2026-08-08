const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const {
  articleMode,
  buildStaticBlog,
  decorateArticleBody,
  trajectoryVariant
} = require("./build-static-blog-pages");
const { injectBigBangLoader } = require("./build-site");
const { DEFAULT_DB_PATH, openDatabase } = require("./lib/blog-db");

function main() {
  const loaderFixture = "<!doctype html><html><head><title>Fixture</title></head><body>Ready</body></html>";
  const loaderEnhanced = injectBigBangLoader(loaderFixture, "work.html");
  if (!loaderEnhanced.includes('data-big-bang-bootstrap')
    || !loaderEnhanced.includes('/assets/css/big-bang-loader.css?v=20260808-7')
    || !loaderEnhanced.includes('/assets/js/big-bang-loader.js?v=20260808-7')
    || !loaderEnhanced.includes('root.dataset.bigBang="pending"')
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
    const databaseDigestBeforeBuild = crypto.createHash("sha256").update(fs.readFileSync(databasePath)).digest("hex");
    const initial = buildStaticBlog({ dbPath: databasePath, outputRoot });
    if (!initial.posts.length) throw new Error("Expected at least one published post in the fixture database.");
    if (initial.posts.length !== 26) throw new Error(`Expected all 26 published posts, found ${initial.posts.length}.`);
    const initialIndex = fs.readFileSync(path.join(outputRoot, "blog", "index.html"), "utf8");
    if (!initialIndex.includes(initial.posts[0].title) || initialIndex.includes("Stale fallback")) {
      throw new Error("The no-JavaScript blog fallback was not rebuilt from published posts.");
    }
    if ((initialIndex.match(/class="galaxy-entry(?: has-media)?"/g) || []).length !== initial.posts.length) {
      throw new Error("The no-JavaScript Logs route did not preserve every published transmission.");
    }

    const firstPostPage = fs.readFileSync(
      path.join(outputRoot, "blog", `${initial.posts[0].slug}.html`),
      "utf8"
    );
    if (firstPostPage.includes("hero-overlay-alpha") || firstPostPage.includes("overlayAlphaPulse")) {
      throw new Error("Article hero images must render without a show/hide animation.");
    }
    if (!firstPostPage.includes('/assets/css/article-debrief.css?v=20260807-regions2')
      || !firstPostPage.includes('/assets/js/article-debrief.js?v=20260807-regions1')
      || !firstPostPage.includes('/assets/css/universe-field-map.css?v=20260807')
      || !firstPostPage.includes('/assets/js/universe-theme-transition.js?v=20260807-fast2')
      || !firstPostPage.includes('/assets/js/universe-field-map.js?v=20260807')) {
      throw new Error("Generated articles are missing their region and shared navigation assets.");
    }

    for (const post of initial.posts) {
      const postPage = fs.readFileSync(path.join(outputRoot, "blog", `${post.slug}.html`), "utf8");
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

    console.log("Verified generated fallbacks and pruning while preserving manual pages.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
