const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildStaticBlog } = require("./build-static-blog-pages");
const { DEFAULT_DB_PATH, openDatabase } = require("./lib/blog-db");

function main() {
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
    const initial = buildStaticBlog({ dbPath: databasePath, outputRoot });
    if (!initial.posts.length) throw new Error("Expected at least one published post in the fixture database.");
    const initialIndex = fs.readFileSync(path.join(outputRoot, "blog", "index.html"), "utf8");
    if (!initialIndex.includes(initial.posts[0].title) || initialIndex.includes("Stale fallback")) {
      throw new Error("The no-JavaScript blog fallback was not rebuilt from published posts.");
    }

    const firstPostPage = fs.readFileSync(
      path.join(outputRoot, "blog", `${initial.posts[0].slug}.html`),
      "utf8"
    );
    if (firstPostPage.includes("hero-overlay-alpha") || firstPostPage.includes("overlayAlphaPulse")) {
      throw new Error("Article hero images must render without a show/hide animation.");
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
