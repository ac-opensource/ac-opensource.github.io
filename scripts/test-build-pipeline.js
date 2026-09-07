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
const {
  injectBigBangLoader,
  localizeProductionFonts,
  minifyPublishedRouteStyles
} = require("./build-site");
const { DEFAULT_DB_PATH, openDatabase } = require("./lib/blog-db");
const {
  LOGS_SOCIAL_PREVIEW_PATH,
  buildSocialPreviewManifest,
  logsSocialPreviewAlt,
  postSocialPreviewAlt,
  postSocialPreviewPath
} = require("./lib/social-previews");

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
    .filter((node) => {
      const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
      return types.includes(type);
    });
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

function metaContent(html, attribute, value) {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = (String(html).match(/<meta\b[^>]*>/gi) || []).find((candidate) =>
    new RegExp(`${attribute}\\s*=\\s*["']${escapedValue}["']`, "i").test(candidate)
  );
  return tag?.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1]
    || tag?.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1]
    || "";
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&");
}

function main() {
  const aboutSource = fs.readFileSync(path.join(__dirname, "..", "about.html"), "utf8");
  if (!/<script\b[^>]*\bsrc=["']\/assets\/js\/about-spectrograph\.js[^"']*["'][^>]*\bdefer\b[^>]*><\/script>/i.test(aboutSource)) {
    throw new Error("The About enhancer must remain deferred so it does not block first paint.");
  }
  const articleStyles = fs.readFileSync(
    path.join(__dirname, "..", "assets", "css", "article-debrief.css"),
    "utf8"
  );
  if (!articleStyles.includes('html.article-js .article-region[data-article-mode="case-study"] .article-region__actions button[hidden]')
    || !articleStyles.includes("display: inline-flex !important;")
    || !articleStyles.includes("visibility: hidden;")
    || !articleStyles.includes("pointer-events: none;")
    || !articleStyles.includes('html.article-js body[data-universe-region="article"] .article-region[data-article-mode="case-study"] .article-region__actions')
    || !articleStyles.includes("padding-left: 3rem !important;")) {
    throw new Error("Case-study actions must reserve their hydrated footprint without exposing inactive controls.");
  }

  const routeStyleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac-route-style-minify-test-"));
  const routeStylePaths = [
    "assets/css/about-spectrograph.css",
    "assets/css/orbital-option-8.css",
    "assets/css/work-portfolio.css"
  ];
  const routeStyleFixture = `
    /* Non-critical authoring whitespace must not reach the render path. */
    .route-card {
      color: rgb(40, 100, 199);
      margin: calc(1rem + 2px);
    }
    @media (prefers-reduced-motion: reduce) {
      .route-card { animation: none !important; }
    }
  `;
  try {
    for (const relativePath of routeStylePaths) {
      const absolutePath = path.join(routeStyleRoot, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, routeStyleFixture, "utf8");
    }
    minifyPublishedRouteStyles(routeStyleRoot);
    for (const relativePath of routeStylePaths) {
      const optimized = fs.readFileSync(path.join(routeStyleRoot, relativePath), "utf8");
      if (Buffer.byteLength(optimized) >= Buffer.byteLength(routeStyleFixture)
        || !optimized.includes(".route-card{")
        || !optimized.includes("@media (prefers-reduced-motion:reduce)")
        || !optimized.includes("animation:none!important")) {
        throw new Error(`Published route stylesheet optimization changed or failed to compact ${relativePath}.`);
      }
    }
  } finally {
    fs.rmSync(routeStyleRoot, { recursive: true, force: true });
  }

  const remoteFontFixture = '<!doctype html><html><head><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/><link href="https://fonts.googleapis.com/css2?family=Manrope&display=swap" rel="stylesheet"/></head><body>Ready</body></html>';
  const localFontFixture = localizeProductionFonts(remoteFontFixture, "fixture.html");
  if (/fonts\.(?:googleapis|gstatic)\.com/.test(localFontFixture)
    || !localFontFixture.includes('/assets/css/site-fonts.css?v=20260819-local1')
    || !localFontFixture.includes('/assets/fonts/manrope-latin-variable.woff2')
    || !localFontFixture.includes('/assets/fonts/space-grotesk-latin-variable.woff2')) {
    throw new Error("Production font localization did not remove third-party requests and preload both local fonts.");
  }
  if (localizeProductionFonts(localFontFixture, "fixture.html") !== localFontFixture) {
    throw new Error("Production font localization is not idempotent.");
  }

  const loaderFixture = "<!doctype html><html><head><title>Fixture</title></head><body>Ready</body></html>";
  const loaderEnhanced = injectBigBangLoader(loaderFixture, "work.html");
  if (!loaderEnhanced.includes('data-big-bang-bootstrap')
    || !loaderEnhanced.includes('/assets/css/big-bang-loader.css?v=20260819-performance2')
    || !loaderEnhanced.includes('/assets/js/big-bang-loader.js?v=20260819-performance2')
    || !loaderEnhanced.includes('root.dataset.bigBang="pending"')
    || !loaderEnhanced.includes('root.dataset.universePerspectiveTo==="work"')
    || !loaderEnhanced.includes('sessionStorage.getItem("ac.bigBangPortfolioPlayed.v1")')
    || !loaderEnhanced.includes('window.matchMedia("(max-width: 700px)").matches')
    || !loaderEnhanced.includes('connection.saveData')
    || !loaderEnhanced.includes('loader.async=false')
    || !loaderEnhanced.includes('},900)')
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
    '<head><meta property="og:image" content="https://ac-opensource.github.io/assets/images/og/blog.png"><meta property="og:image:alt" content="Stale Logs preview"><meta name="twitter:image" content="https://ac-opensource.github.io/assets/images/og/blog.png"><meta name="twitter:image:alt" content="Stale Logs preview"><!-- generated: blog-collection-jsonld:start --><script type="application/ld+json">{}</script><!-- generated: blog-collection-jsonld:end --></head><main><section id="blog-feed" class="space-y-12" aria-label="Latest blog posts"><p>Stale fallback</p></section></main>\n',
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
    const thirdPartyHero = initial.posts.find((post) => {
      const hero = String(post.hero_image || "").trim();
      return /^https?:\/\//i.test(hero) && !hero.startsWith(`${SITE_ORIGIN}/`);
    });
    if (thirdPartyHero) {
      throw new Error(`${thirdPartyHero.slug}: published hero images must be deterministic first-party assets.`);
    }
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
    const expectedLogsImage = `${SITE_ORIGIN}${LOGS_SOCIAL_PREVIEW_PATH}`;
    if (metaContent(initialIndex, "property", "og:image") !== expectedLogsImage
      || metaContent(initialIndex, "name", "twitter:image") !== expectedLogsImage
      || decodeHtmlEntities(metaContent(initialIndex, "property", "og:image:alt")) !== logsSocialPreviewAlt(initial.posts)
      || metaContent(initialIndex, "property", "og:image:alt") !== metaContent(initialIndex, "name", "twitter:image:alt")) {
      throw new Error("The Logs fallback did not refresh its route-specific preview and current published count.");
    }
    const blogCollection = jsonLdOfType(initialIndex, "CollectionPage", "blog/index.html");
    const blogItemList = jsonLdOfType(initialIndex, "ItemList", "blog/index.html");
    if (blogCollection.author?.["@id"] !== PERSON_ID
      || blogCollection.mainEntity?.["@id"] !== blogItemList["@id"]
      || blogItemList.numberOfItems !== initial.posts.length
      || blogItemList.itemListElement?.length !== initial.posts.length) {
      throw new Error("The Logs structured archive does not match the published database rows.");
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
    const articleJsMarker = '<script>document.documentElement.classList.add("article-js");</script>';
    if (!firstPostPage.includes(articleJsMarker)
      || firstPostPage.indexOf(articleJsMarker) > firstPostPage.indexOf('/assets/css/article-debrief.css')) {
      throw new Error("Generated articles must reserve JavaScript action geometry before first render.");
    }
    if (!firstPostPage.includes('<meta property="og:image:type" content="image/png"/>')
      || !firstPostPage.includes('<meta property="og:image:width" content="1200"/>')
      || !firstPostPage.includes('<meta property="og:image:height" content="630"/>')
      || !firstPostPage.includes(postSocialPreviewPath(initial.posts[0]))) {
      throw new Error("Generated articles must publish a declared 1200x630 PNG social preview.");
    }
    if (firstPostPage.includes("hero-overlay-alpha") || firstPostPage.includes("overlayAlphaPulse")) {
      throw new Error("Article hero images must render without a show/hide animation.");
    }
    if (!/\/assets\/css\/article-debrief\.css\?v=[^"']+/.test(firstPostPage)
      || !firstPostPage.includes('/assets/js/article-debrief.js?v=20260807-regions1')
      || !firstPostPage.includes('/assets/css/universe-field-map.css?v=20260819-safe1')
      || !firstPostPage.includes('/assets/css/universe-perspective-navigation.css?v=20260820-fast-travel1')
      || !firstPostPage.includes('/assets/js/universe-theme-transition.js?v=20260820-fast-travel1')
      || !firstPostPage.includes('/assets/js/universe-field-map.js?v=20260809-guide9')) {
      throw new Error("Generated articles are missing their region and shared navigation assets.");
    }

    const expectedSocialManifest = buildSocialPreviewManifest(initial.posts);
    if (expectedSocialManifest.posts.length !== initial.posts.length
      || new Set(expectedSocialManifest.posts.map((record) => record.path)).size !== initial.posts.length) {
      throw new Error("The social-preview manifest did not assign one deterministic asset to every published post.");
    }
    const articleSocialImages = new Set();
    for (const post of initial.posts) {
      const postPage = fs.readFileSync(path.join(outputRoot, "blog", `${post.slug}.html`), "utf8");
      const blogPosting = jsonLdOfType(postPage, "BlogPosting", post.slug);
      if (blogPosting.author?.["@id"] !== PERSON_ID || blogPosting.publisher?.["@id"] !== PERSON_ID) {
        throw new Error(`${post.slug}: BlogPosting author and publisher must reference ${PERSON_ID}.`);
      }
      const expectedImage = `${SITE_ORIGIN}${postSocialPreviewPath(post)}`;
      const openGraphImage = metaContent(postPage, "property", "og:image");
      const openGraphAlt = metaContent(postPage, "property", "og:image:alt");
      if (openGraphImage !== expectedImage
        || metaContent(postPage, "name", "twitter:image") !== expectedImage
        || decodeHtmlEntities(openGraphAlt) !== postSocialPreviewAlt(post)
        || metaContent(postPage, "name", "twitter:image:alt") !== openGraphAlt
        || blogPosting.image !== expectedImage
        || articleSocialImages.has(expectedImage)
        || /\/(?:blog|project-detail)\.png$/.test(expectedImage)) {
        throw new Error(`${post.slug}: generated article did not receive its unique canonical social preview.`);
      }
      articleSocialImages.add(expectedImage);
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
    if (articleSocialImages.size !== initial.posts.length) {
      throw new Error("Generated articles reused a social-preview asset.");
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
    if ((ocbcPage.match(/width="608" height="1080"/g) || []).length !== 3) {
      throw new Error("The OCBC project note did not reserve every portrait screen's intrinsic geometry.");
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
    for (const file of fs.readdirSync(path.join(outputRoot, "blog"))) {
      if (!file.startsWith("case-study-") || !file.endsWith(".html") || file.includes("ocbc")) continue;
      const workPage = fs.readFileSync(path.join(outputRoot, "blog", file), "utf8");
      if (!/id="post-hero-image"[^>]*width="1600" height="1200"/.test(workPage)) {
        throw new Error(`${file} did not reserve its rendered work-hero geometry.`);
      }
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
