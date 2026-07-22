const fs = require("fs");
const path = require("path");
const { openDatabase, assertSchema } = require("./lib/blog-db");
const { shouldExcludeOriginal } = require("./lib/public-images");
const publication = require("./site-publication.config");

const ROOT_DIR = path.join(__dirname, "..");
const DEFAULT_DIST_DIR = path.join(ROOT_DIR, "dist");
const SITE_ORIGIN = "https://ac-opensource.github.io";
const GOOGLE_SITE_VERIFICATION = "cG-TBeLi9kd77kCjn9ujeH_G6b-5r-Jv69vGJiROZnU";

function walkFiles(root) {
  const files = [];
  const pending = [root];

  while (pending.length) {
    const current = pending.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      b.name.localeCompare(a.name)
    );
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolutePath);
      else if (entry.isFile()) files.push(absolutePath);
      else throw new Error(`Non-regular publication entry: ${path.relative(root, absolutePath)}`);
    }
  }

  return files.sort();
}

function relativePosix(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function assertPublicInventory(distDir, relativeFiles) {
  const relativeSet = new Set(relativeFiles);

  for (const requiredPath of [
    ...publication.publicPages,
    ...publication.publicDownloads,
    "blog/index.html",
    "blog/posts.json",
    "blog/rss.xml",
    "assets/css/tailwind.css",
    "robots.txt",
    "sitemap.xml",
    ".nojekyll"
  ]) {
    if (!relativeSet.has(requiredPath)) {
      throw new Error(`Required publication file is missing: ${requiredPath}`);
    }
  }

  for (const forbiddenPath of publication.forbiddenPublishedPaths) {
    const normalized = forbiddenPath.replace(/\/+$/, "");
    if (
      relativeSet.has(normalized) ||
      relativeFiles.some((relativePath) => relativePath.startsWith(`${normalized}/`))
    ) {
      throw new Error(`Forbidden path exists in publication output: ${forbiddenPath}`);
    }
  }

  const allowedRootEntries = new Set([
    ".nojekyll",
    "assets",
    "blog",
    "robots.txt",
    "sitemap.xml",
    ...publication.publicPages,
    ...publication.publicDownloads,
    ...publication.optionalPublicRootFiles
  ]);
  const actualRootEntries = fs.readdirSync(distDir);
  const unexpected = actualRootEntries.filter((entry) => !allowedRootEntries.has(entry));
  if (unexpected.length) {
    throw new Error(`Unexpected publication root entries: ${unexpected.sort().join(", ")}`);
  }

  const databaseFiles = relativeFiles.filter((relativePath) =>
    /(?:^|\/)[^/]+\.(?:sqlite(?:-(?:shm|wal))?|db)$/i.test(relativePath)
  );
  if (databaseFiles.length) {
    throw new Error(`Database files exist in publication output: ${databaseFiles.join(", ")}`);
  }

  const supersededImages = relativeFiles.filter(shouldExcludeOriginal);
  if (supersededImages.length) {
    throw new Error(`Superseded original images exist in publication output: ${supersededImages.join(", ")}`);
  }
}

function assertPublishedPosts(distDir, dbPath) {
  const manifestPath = path.join(distDir, "blog", "posts.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest)) throw new Error("blog/posts.json must contain an array.");

  const manifestSlugs = manifest.map((post) => String(post.slug || ""));
  if (manifestSlugs.some((slug) => !/^[a-z0-9][a-z0-9-]*$/.test(slug))) {
    throw new Error("blog/posts.json contains an invalid or empty slug.");
  }
  if (new Set(manifestSlugs).size !== manifestSlugs.length) {
    throw new Error("blog/posts.json contains duplicate slugs.");
  }

  for (const post of manifest) {
    for (const requiredKey of ["title", "summary", "date", "heroImage", "heroAlt", "topics"]) {
      if (!Object.hasOwn(post, requiredKey)) {
        throw new Error(`Published manifest entry ${post.slug} is missing ${requiredKey}.`);
      }
    }
    if (Object.hasOwn(post, "bodyHtml") || Object.hasOwn(post, "status")) {
      throw new Error(`Published manifest entry ${post.slug} contains authoring-only fields.`);
    }
  }

  const { db } = openDatabase(dbPath, { readonly: true });
  let expectedSlugs;
  try {
    assertSchema(db);
    expectedSlugs = db
      .prepare("SELECT slug FROM posts WHERE status = 'published' ORDER BY published_date DESC, slug ASC")
      .all()
      .map((row) => row.slug);
  } finally {
    db.close();
  }

  if (JSON.stringify(manifestSlugs) !== JSON.stringify(expectedSlugs)) {
    throw new Error("blog/posts.json does not exactly match the published rows in the authoring database.");
  }

  const generatedHtml = fs
    .readdirSync(path.join(distDir, "blog"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html") && entry.name !== "index.html")
    .map((entry) => entry.name.replace(/\.html$/, ""))
    .sort();
  const expectedHtml = [...manifestSlugs].sort();
  if (JSON.stringify(generatedHtml) !== JSON.stringify(expectedHtml)) {
    throw new Error("Published blog HTML does not exactly match blog/posts.json.");
  }

  return manifest.length;
}

function extractLocalReferences(html) {
  const references = [];
  const attributePattern = /\b(href|src|srcset)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attributePattern.exec(html))) {
    const values = match[1].toLowerCase() === "srcset"
      ? match[2].split(",").map((entry) => entry.trim().split(/\s+/)[0])
      : [match[2].trim()];

    for (const value of values) {
      if (!value || value.includes("${") || value.includes("{{") || value.startsWith("#")) continue;
      if (/^(?:data:|mailto:|tel:|javascript:)/i.test(value)) continue;

      let url;
      try {
        url = new URL(value, SITE_ORIGIN);
      } catch (_error) {
        continue;
      }
      if (url.origin !== SITE_ORIGIN) continue;
      references.push(decodeURIComponent(url.pathname));
    }
  }
  return references;
}

function referenceTarget(distDir, pathname) {
  if (pathname === "/") return path.join(distDir, "index.html");
  if (pathname.endsWith("/")) return path.join(distDir, pathname.slice(1), "index.html");
  return path.join(distDir, pathname.replace(/^\/+/, ""));
}

function assertReferencesResolve(distDir, files) {
  const missing = [];
  for (const absolutePath of files.filter((file) => file.endsWith(".html"))) {
    const html = fs.readFileSync(absolutePath, "utf8");
    for (const pathname of extractLocalReferences(html)) {
      const target = referenceTarget(distDir, pathname);
      if (!fs.existsSync(target)) {
        missing.push(`${relativePosix(distDir, absolutePath)} -> ${pathname}`);
      }
    }
  }

  if (missing.length) {
    throw new Error(`Missing internal publication targets:\n${[...new Set(missing)].sort().join("\n")}`);
  }
}

function routeForHtml(relativePath) {
  if (relativePath === "index.html") return "/";
  if (relativePath.endsWith("/index.html")) return `/${relativePath.slice(0, -"index.html".length)}`;
  return `/${relativePath}`;
}

function canonicalFromHtml(html) {
  const tags = String(html).match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/\brel=["']canonical["']/i.test(tag)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i);
    if (href) return href[1];
  }
  return null;
}

function isNoindexHtml(html) {
  const tags = String(html).match(/<meta\b[^>]*>/gi) || [];
  return tags.some((tag) =>
    /\bname=["']robots["']/i.test(tag) &&
    /\bcontent=["'][^"']*\bnoindex\b[^"']*["']/i.test(tag)
  );
}

function assertSitemapAndCanonicals(distDir, files) {
  const htmlFiles = files.filter((file) => file.endsWith(".html"));
  const expectedUrls = [];

  for (const htmlFile of htmlFiles) {
    const relativePath = relativePosix(distDir, htmlFile);
    const route = routeForHtml(relativePath);
    const expectedCanonical = `${SITE_ORIGIN}${route}`;
    const html = fs.readFileSync(htmlFile, "utf8");
    const canonical = canonicalFromHtml(html);
    if (isNoindexHtml(html)) {
      if (!canonical || !canonical.startsWith(`${SITE_ORIGIN}/`)) {
        throw new Error(`${relativePath} noindex page has an invalid canonical URL.`);
      }
      continue;
    }
    if (canonical !== expectedCanonical) {
      throw new Error(`${relativePath} canonical is ${canonical || "missing"}; expected ${expectedCanonical}.`);
    }
    expectedUrls.push(expectedCanonical);
  }

  const sitemap = fs.readFileSync(path.join(distDir, "sitemap.xml"), "utf8");
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  if (new Set(locations).size !== locations.length) {
    throw new Error("sitemap.xml contains duplicate <loc> values.");
  }
  if (JSON.stringify([...locations].sort()) !== JSON.stringify([...expectedUrls].sort())) {
    throw new Error("sitemap.xml does not exactly match the indexable canonical HTML in dist.");
  }

  const lastmods = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((match) => match[1]);
  for (const lastmod of lastmods) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) {
      throw new Error(`sitemap.xml contains an invalid lastmod: ${lastmod}`);
    }
    const parsed = new Date(`${lastmod}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== lastmod) {
      throw new Error(`sitemap.xml contains a non-calendar lastmod: ${lastmod}`);
    }
  }
}

function assertNoPublishedExif(distDir, files) {
  const exifSignature = Buffer.from("Exif\0\0", "binary");
  const withExif = files
    .filter((file) => /\.jpe?g$/i.test(file))
    .filter((file) => fs.readFileSync(file).includes(exifSignature))
    .map((file) => relativePosix(distDir, file));

  if (withExif.length) {
    throw new Error(`Published JPEGs contain EXIF metadata: ${withExif.join(", ")}`);
  }
}

function assertNoAuthoringReferences(distDir, files) {
  const forbiddenPatterns = [
    { pattern: /\/assets\/data\/blog\.sqlite/gi, label: "authoring SQLite URL" },
    { pattern: /sql-wasm(?:\.min)?\.(?:js|wasm)/gi, label: "sql.js/WASM runtime" },
    { pattern: /cdn\.tailwindcss\.com/gi, label: "Tailwind browser runtime" },
    { pattern: /id=["']tailwind-config["']/gi, label: "Tailwind browser configuration" },
    { pattern: /\/blog\/(?:post|writer|template)\.html/gi, label: "non-public blog route" }
  ];
  const textualFiles = files.filter((file) => /\.(?:html|js|css|json|xml|txt)$/i.test(file));

  for (const absolutePath of textualFiles) {
    const contents = fs.readFileSync(absolutePath, "utf8");
    for (const { pattern, label } of forbiddenPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(contents)) {
        throw new Error(`${label} found in ${relativePosix(distDir, absolutePath)}.`);
      }
    }
  }
}

function assertGoogleSiteVerification(distDir) {
  const homepage = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
  const expected = `<meta name="google-site-verification" content="${GOOGLE_SITE_VERIFICATION}">`;
  if (!homepage.includes(expected)) {
    throw new Error("Homepage is missing the Search Console verification tag.");
  }
}

function verifyDist({ distDir = DEFAULT_DIST_DIR, dbPath } = {}) {
  const resolvedDist = path.resolve(distDir);
  if (!fs.existsSync(resolvedDist) || !fs.statSync(resolvedDist).isDirectory()) {
    throw new Error(`Publication directory does not exist: ${resolvedDist}`);
  }

  const files = walkFiles(resolvedDist);
  const relativeFiles = files.map((file) => relativePosix(resolvedDist, file));
  assertPublicInventory(resolvedDist, relativeFiles);
  const postCount = assertPublishedPosts(resolvedDist, dbPath);
  assertNoAuthoringReferences(resolvedDist, files);
  assertNoPublishedExif(resolvedDist, files);
  assertGoogleSiteVerification(resolvedDist);
  assertReferencesResolve(resolvedDist, files);
  assertSitemapAndCanonicals(resolvedDist, files);

  return { fileCount: files.length, postCount };
}

function getArgValue(name) {
  const argument = process.argv.find((value) => value.startsWith(`--${name}=`));
  return argument ? argument.slice(name.length + 3) : undefined;
}

function main() {
  const dist = getArgValue("dist");
  const result = verifyDist({
    distDir: dist ? path.resolve(dist) : DEFAULT_DIST_DIR,
    dbPath: getArgValue("db")
  });
  console.log(`Verified ${result.fileCount} public files and ${result.postCount} published posts.`);
}

if (require.main === module) {
  main();
}

module.exports = {
  assertGoogleSiteVerification,
  assertNoAuthoringReferences,
  assertNoPublishedExif,
  assertPublishedPosts,
  assertSitemapAndCanonicals,
  verifyDist,
  walkFiles
};
