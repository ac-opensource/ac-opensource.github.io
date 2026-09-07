const fs = require("fs");
const path = require("path");
const { LLMS_SECTIONS } = require("./build-static-blog-pages");
const { openDatabase, assertSchema, getPostList, getPostWithTopics } = require("./lib/blog-db");
const { shouldExcludeOriginal } = require("./lib/public-images");
const {
  LOGS_SOCIAL_PREVIEW_PATH,
  SEARCH_SOCIAL_PREVIEW_PATH,
  assertSocialPreviewSet,
  logsSocialPreviewAlt,
  postSocialPreviewAlt,
  postSocialPreviewPath,
  searchSocialPreviewAlt
} = require("./lib/social-previews");
const publication = require("./site-publication.config");
const SignalsContract = require("../assets/js/signals-contract");
const ContactTransport = require("../assets/js/contact-transport");

const ROOT_DIR = path.join(__dirname, "..");
const DEFAULT_DIST_DIR = path.join(ROOT_DIR, "dist");
const SITE_ORIGIN = "https://ac-opensource.github.io";
const PERSON_ID = `${SITE_ORIGIN}/#person`;
const GOOGLE_SITE_VERIFICATION = "cG-TBeLi9kd77kCjn9ujeH_G6b-5r-Jv69vGJiROZnU";
const SITE_LOCATION = Object.freeze({
  origin: SITE_ORIGIN,
  protocol: "https:",
  hostname: "ac-opensource.github.io",
  host: "ac-opensource.github.io"
});

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
    ...publication.publicExperimentFiles,
    ...publication.publicExperimentAssets,
    "blog/index.html",
    "blog/posts.json",
    "blog/rss.xml",
    "assets/css/tailwind.css",
    "assets/css/site-fonts.css",
    "assets/fonts/manrope-latin-variable.woff2",
    "assets/fonts/space-grotesk-latin-variable.woff2",
    "llms.txt",
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
    "experiments",
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

  const assertExactExperimentInventory = (prefix, expected) => {
    const actual = relativeFiles.filter((relativePath) => relativePath.startsWith(prefix)).sort();
    const allowed = [...expected].sort();
    if (JSON.stringify(actual) !== JSON.stringify(allowed)) {
      const missing = allowed.filter((relativePath) => !actual.includes(relativePath));
      const extra = actual.filter((relativePath) => !allowed.includes(relativePath));
      throw new Error(`Published ${prefix} inventory drifted; missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}.`);
    }
  };
  assertExactExperimentInventory("experiments/universe-options/", publication.publicExperimentFiles);
  assertExactExperimentInventory("assets/experiments/universe-options/", publication.publicExperimentAssets);

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

function assertLocalProductionFonts(distDir, files) {
  const fontFiles = [
    "assets/fonts/manrope-latin-variable.woff2",
    "assets/fonts/space-grotesk-latin-variable.woff2"
  ];
  for (const relativePath of fontFiles) {
    const size = fs.statSync(path.join(distDir, relativePath)).size;
    if (size < 10_000 || size > 64_000) {
      throw new Error(`Local font ${relativePath} has an unexpected ${size}-byte payload.`);
    }
  }

  for (const file of files.filter((candidate) => candidate.endsWith(".html"))) {
    const relativePath = relativePosix(distDir, file);
    const html = fs.readFileSync(file, "utf8");
    if (/https:\/\/fonts\.(?:googleapis|gstatic)\.com/i.test(html)) {
      throw new Error(`${relativePath} still makes a third-party Google Fonts request.`);
    }
    if (/Material\+Symbols/i.test(html)) {
      throw new Error(`${relativePath} still requests the Material Symbols font.`);
    }
    if (!html.includes('href="/assets/css/site-fonts.css?v=20260819-local1"')) {
      throw new Error(`${relativePath} is missing the local production font stylesheet.`);
    }
  }
}

function assertResponsiveImageDelivery(distDir) {
  const workHtml = fs.readFileSync(path.join(distDir, "work.html"), "utf8");
  for (const stem of ["img_itvx_library", "img_itvx_live", "img_itvx_home"]) {
    for (const width of [192, 384]) {
      const relativePath = `assets/images/work/${stem}-${width}.avif`;
      if (!workHtml.includes(`/${relativePath} ${width}w`)) {
        throw new Error(`work.html is missing the ${width}px responsive source for ${stem}.`);
      }
      const size = fs.statSync(path.join(distDir, relativePath)).size;
      if (size > 55_000) {
        throw new Error(`${relativePath} exceeds its 55 KB portfolio-card budget (${size} bytes).`);
      }
    }
  }

  const logsHtml = fs.readFileSync(path.join(distDir, "blog", "index.html"), "utf8");
  for (const stem of ["fortress-we-mistake-for-home", "not-okay-is-a-starting-point"]) {
    for (const width of [320, 640]) {
      const relativePath = `blog/images/${stem}-${width}.avif`;
      if (!logsHtml.includes(`/${relativePath} ${width}w`)) {
        throw new Error(`Logs fallback is missing the ${width}px responsive source for ${stem}.`);
      }
      const size = fs.statSync(path.join(distDir, relativePath)).size;
      if (size > 100_000) {
        throw new Error(`${relativePath} exceeds its 100 KB Logs-thumbnail budget (${size} bytes).`);
      }
    }
  }
}

function jsonLdNodes(html, label) {
  const documents = [...String(html).matchAll(
    /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )].map((match) => {
    try {
      return JSON.parse(match[1]);
    } catch (error) {
      throw new Error(`${label} contains invalid JSON-LD: ${error.message}`);
    }
  });
  const nodes = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Object.hasOwn(value, "@type")) nodes.push(value);
    Object.values(value).forEach(visit);
  };
  documents.forEach(visit);
  return nodes;
}

function hasJsonLdType(node, type) {
  const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
  return types.includes(type);
}

function jsonLdOfType(html, type, label) {
  const matches = jsonLdNodes(html, label).filter((node) => hasJsonLdType(node, type));
  if (matches.length !== 1) {
    throw new Error(`${label} must contain exactly one ${type} JSON-LD node; found ${matches.length}.`);
  }
  return matches[0];
}

function assertCanonicalPersonIdentity(distDir) {
  const homepagePath = path.join(distDir, "index.html");
  const aboutPath = path.join(distDir, "about.html");
  const homepage = fs.readFileSync(homepagePath, "utf8");
  const about = fs.readFileSync(aboutPath, "utf8");
  const resume = fs.readFileSync(path.join(distDir, "resume.html"), "utf8");
  const blog = fs.readFileSync(path.join(distDir, "blog", "index.html"), "utf8");
  const homePeople = jsonLdNodes(homepage, "index.html").filter((node) => hasJsonLdType(node, "Person"));
  const aboutPeople = jsonLdNodes(about, "about.html").filter((node) => hasJsonLdType(node, "Person"));
  if (!homePeople.length || homePeople.some((person) => person["@id"] !== PERSON_ID)) {
    throw new Error(`Homepage Person JSON-LD must use canonical identity ${PERSON_ID}.`);
  }
  if (!aboutPeople.length || aboutPeople.some((person) => person["@id"] !== PERSON_ID)) {
    throw new Error(`About Person JSON-LD must use canonical identity ${PERSON_ID}.`);
  }
  const profilePage = jsonLdOfType(about, "ProfilePage", "about.html");
  if (profilePage.mainEntity?.["@id"] !== PERSON_ID) {
    throw new Error(`About ProfilePage.mainEntity must reference canonical identity ${PERSON_ID}.`);
  }
  const resumeProfilePage = jsonLdOfType(resume, "ProfilePage", "resume.html");
  if (resumeProfilePage.mainEntity?.["@id"] !== PERSON_ID) {
    throw new Error(`Résumé ProfilePage.mainEntity must reference canonical identity ${PERSON_ID}.`);
  }
  const collectionPage = jsonLdOfType(blog, "CollectionPage", "blog/index.html");
  const itemList = jsonLdOfType(blog, "ItemList", "blog/index.html");
  const expectedPostUrls = fs
    .readdirSync(path.join(distDir, "blog"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html") && entry.name !== "index.html")
    .map((entry) => `${SITE_ORIGIN}/blog/${entry.name}`)
    .sort();
  const structuredPostUrls = (itemList.itemListElement || [])
    .map((entry) => entry?.url)
    .filter(Boolean)
    .sort();
  if (
    collectionPage.author?.["@id"] !== PERSON_ID ||
    collectionPage.mainEntity?.["@id"] !== itemList["@id"] ||
    itemList.numberOfItems !== expectedPostUrls.length ||
    JSON.stringify(structuredPostUrls) !== JSON.stringify(expectedPostUrls)
  ) {
    throw new Error("Blog CollectionPage/ItemList structured data does not match the canonical published archive.");
  }
}

function assertGeneratedArticleIdentity(distDir, slugs) {
  for (const slug of slugs) {
    const relativePath = `blog/${slug}.html`;
    const html = fs.readFileSync(path.join(distDir, relativePath), "utf8");
    const blogPosting = jsonLdOfType(html, "BlogPosting", relativePath);
    if (blogPosting.author?.["@id"] !== PERSON_ID || blogPosting.publisher?.["@id"] !== PERSON_ID) {
      throw new Error(`${relativePath} author and publisher must reference canonical Person ${PERSON_ID}.`);
    }
  }
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

function assertLlmsPublishedPosts(distDir, publishedRows, excludedSlugs) {
  const llms = fs.readFileSync(path.join(distDir, "llms.txt"), "utf8");
  for (const section of LLMS_SECTIONS) {
    const expected = publishedRows
      .filter((row) => String(row.category || "").trim().toLowerCase() === section.category)
      .map((row) => `${SITE_ORIGIN}/blog/${encodeURIComponent(row.slug)}.html`);
    const actual = llmsSectionUrls(llms, section);
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
    if (llms.includes(url)) throw new Error(`llms.txt exposes non-published post ${slug}.`);
  }
}

function assertRetiredPublicWording(distDir, files) {
  const textualFiles = files.filter((file) => /\.(?:html|js|css|json|xml|txt)$/i.test(file));
  for (const absolutePath of textualFiles) {
    const contents = fs.readFileSync(absolutePath, "utf8");
    const relativePath = relativePosix(distDir, absolutePath);
    if (contents.includes("[status: online]")) {
      throw new Error(`Retired [status: online] wording found in ${relativePath}.`);
    }
    if (contents.includes("Verified public ")) {
      throw new Error(`Retired Verified public evidence label found in ${relativePath}.`);
    }
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
  let expectedRows;
  let excludedSlugs;
  try {
    assertSchema(db);
    expectedRows = db
      .prepare("SELECT slug, category FROM posts WHERE status = 'published' ORDER BY published_date DESC, slug ASC")
      .all();
    excludedSlugs = db
      .prepare("SELECT slug FROM posts WHERE status <> 'published' ORDER BY slug ASC")
      .all()
      .map((row) => row.slug);
  } finally {
    db.close();
  }

  const expectedSlugs = expectedRows.map((row) => row.slug);

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

  assertGeneratedArticleIdentity(distDir, manifestSlugs);
  assertLlmsPublishedPosts(distDir, expectedRows, excludedSlugs);

  return manifest.length;
}

function extractLocalReferences(html, documentRoute = "/") {
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
        url = new URL(value, new URL(documentRoute, `${SITE_ORIGIN}/`));
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
    const relativePath = relativePosix(distDir, absolutePath);
    for (const pathname of extractLocalReferences(html, routeForHtml(relativePath))) {
      const target = referenceTarget(distDir, pathname);
      if (!fs.existsSync(target)) {
        missing.push(`${relativePath} -> ${pathname}`);
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
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function assertSocialMetadata(distDir, posts = []) {
  const generatedPosts = fs
    .readdirSync(path.join(distDir, "blog"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html") && entry.name !== "index.html")
    .map((entry) => path.posix.join("blog", entry.name));
  const canonicalPages = [...publication.publicPages, "blog/index.html", ...generatedPosts];

  const postBySlug = new Map(posts.map((post) => [String(post.slug), post]));
  const claimedPostImages = new Set();

  for (const relativePath of canonicalPages) {
    const html = fs.readFileSync(path.join(distDir, relativePath), "utf8");
    const canonical = canonicalFromHtml(html);
    const expectedType = relativePath.startsWith("blog/") && relativePath !== "blog/index.html"
      ? "article"
      : "website";
    const metadata = {
      locale: metaContent(html, "property", "og:locale"),
      siteName: metaContent(html, "property", "og:site_name"),
      type: metaContent(html, "property", "og:type"),
      url: metaContent(html, "property", "og:url"),
      title: metaContent(html, "property", "og:title"),
      description: metaContent(html, "property", "og:description"),
      image: metaContent(html, "property", "og:image"),
      imageType: metaContent(html, "property", "og:image:type"),
      imageWidth: metaContent(html, "property", "og:image:width"),
      imageHeight: metaContent(html, "property", "og:image:height"),
      imageAlt: metaContent(html, "property", "og:image:alt"),
      twitterCard: metaContent(html, "name", "twitter:card"),
      twitterTitle: metaContent(html, "name", "twitter:title"),
      twitterDescription: metaContent(html, "name", "twitter:description"),
      twitterImage: metaContent(html, "name", "twitter:image"),
      twitterAlt: metaContent(html, "name", "twitter:image:alt")
    };

    if (
      metadata.locale !== "en_US" ||
      metadata.siteName !== "Andrew Concepcion" ||
      metadata.type !== expectedType ||
      metadata.url !== canonical ||
      !metadata.title ||
      !metadata.description ||
      !metadata.image ||
      !metadata.imageAlt ||
      metadata.twitterCard !== "summary_large_image" ||
      metadata.twitterTitle !== metadata.title ||
      metadata.twitterDescription !== metadata.description ||
      metadata.twitterImage !== metadata.image ||
      metadata.twitterAlt !== metadata.imageAlt
    ) {
      throw new Error(`${relativePath} has incomplete or inconsistent Open Graph/Twitter metadata: ${JSON.stringify(metadata)}`);
    }

    if (
      metadata.imageType !== "image/png" ||
      metadata.imageWidth !== "1200" ||
      metadata.imageHeight !== "630"
    ) {
      throw new Error(`${relativePath} social preview must declare a 1200x630 PNG.`);
    }

    const imageUrl = new URL(metadata.image, `${SITE_ORIGIN}/`);
    if (imageUrl.origin === SITE_ORIGIN && !fs.existsSync(referenceTarget(distDir, imageUrl.pathname))) {
      throw new Error(`${relativePath} social preview does not exist in publication output: ${imageUrl.pathname}`);
    }

    let expectedImage = "";
    let expectedAlt = "";
    if (relativePath === "blog/index.html") {
      expectedImage = `${SITE_ORIGIN}${LOGS_SOCIAL_PREVIEW_PATH}`;
      expectedAlt = logsSocialPreviewAlt(posts);
    } else if (relativePath === "search.html") {
      expectedImage = `${SITE_ORIGIN}${SEARCH_SOCIAL_PREVIEW_PATH}`;
      expectedAlt = searchSocialPreviewAlt();
    } else if (relativePath.startsWith("blog/")) {
      const slug = path.basename(relativePath, ".html");
      const post = postBySlug.get(slug);
      if (!post) throw new Error(`${relativePath} has no matching published database row for its social preview.`);
      expectedImage = `${SITE_ORIGIN}${postSocialPreviewPath(post)}`;
      expectedAlt = postSocialPreviewAlt(post);
      if (claimedPostImages.has(expectedImage)) {
        throw new Error(`${relativePath} reuses another published post's social preview: ${expectedImage}`);
      }
      claimedPostImages.add(expectedImage);
    }

    if (expectedImage && (metadata.image !== expectedImage || decodeHtmlEntities(metadata.imageAlt) !== expectedAlt)) {
      throw new Error(`${relativePath} does not use its canonical route-specific social preview.`);
    }
    if (relativePath.startsWith("blog/") && /\/(?:blog|project-detail)\.png(?:$|[?#])/.test(metadata.image)) {
      throw new Error(`${relativePath} still uses a retired shared article preview.`);
    }
  }

  if (claimedPostImages.size !== posts.length) {
    throw new Error(`Expected ${posts.length} unique post social previews, found ${claimedPostImages.size}.`);
  }
}

function publishedPostsFromDatabase(dbPath) {
  const { db } = openDatabase(dbPath, { readonly: true });
  try {
    assertSchema(db);
    return getPostList(db)
      .filter((post) => post.status === "published")
      .sort(
        (left, right) =>
          String(right.published_date).localeCompare(String(left.published_date)) ||
          String(left.slug).localeCompare(String(right.slug))
      )
      .map((post) => getPostWithTopics(db, post.slug))
      .filter(Boolean);
  } finally {
    db.close();
  }
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

function assertSearchIndexPrivacy(distDir) {
  const indexPath = path.join(distDir, "assets", "data", "search-index.json");
  if (!fs.existsSync(indexPath)) throw new Error("Published search index is missing.");
  const serialized = fs.readFileSync(indexPath, "utf8");
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(serialized)
    || /\+(?:\d[\s-]?){8,}\d/.test(serialized)
    || /\b(?:mailto|tel):/i.test(serialized)) {
    throw new Error("Published search index contains direct email or phone contact data.");
  }
}

function readInlineJson(html, id) {
  const pattern = new RegExp('<script\\b[^>]*\\bid="' + id + '"[^>]*>([\\s\\S]*?)<\\/script>', "i");
  const match = html.match(pattern);
  if (!match) throw new Error("Missing inline JSON boundary: " + id);
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new Error("Invalid inline JSON for " + id + ": " + error.message);
  }
}

function assertNoContactSignalsArtifacts(distDir, relativeFiles) {
  const forbidden = relativeFiles.filter(function (relativePath) {
    return publication.forbiddenPublishedNamePattern.test(relativePath);
  });
  if (forbidden.length) {
    throw new Error("Local-only Contact/Signals artifacts reached publication output: " + forbidden.join(", "));
  }
  const localOnlyRoots = ["scripts", ".agents", "test-results", "playwright-report"];
  for (const relativePath of relativeFiles) {
    if (localOnlyRoots.some(function (rootName) {
      return relativePath === rootName || relativePath.startsWith(rootName + "/");
    })) {
      throw new Error("Local-only runtime or evidence reached publication output: " + relativePath);
    }
  }
  const forbiddenMarkers = [
    /\bfixtures?\b/i,
    /\bmocks?\b/i,
    /LOCAL DEMO DATA/i,
    /local_(?:private|public)_receipt/i,
    /sig_local_demo/i,
    /Local demo record:/i
  ];
  relativeFiles
    .filter(function (relativePath) { return /\.(?:css|html|js|json|txt|xml)$/i.test(relativePath); })
    .forEach(function (relativePath) {
      const contents = fs.readFileSync(path.join(distDir, relativePath), "utf8");
      forbiddenMarkers.forEach(function (pattern) {
        if (pattern.test(contents)) {
          throw new Error("Local-only Contact/Signals marker reached publication output: " + relativePath);
        }
      });
    });
}

function assertContactSignalsPublication(distDir, relativeFiles) {
  const required = [
    "signals.html",
    "assets/data/contact-runtime.json",
    "assets/data/signals.json"
  ];
  required.forEach(function (relativePath) {
    if (!relativeFiles.includes(relativePath)) {
      throw new Error("Required Contact/Signals publication file is missing: " + relativePath);
    }
  });

  const runtimePath = path.join(distDir, "assets", "data", "contact-runtime.json");
  const feedPath = path.join(distDir, "assets", "data", "signals.json");
  const runtime = ContactTransport.validateRuntimeConfig(
    JSON.parse(fs.readFileSync(runtimePath, "utf8")),
    SITE_LOCATION
  );
  if (runtime.enabled) {
    const endpoint = new URL(runtime.endpoint);
    const approvedAppsScriptEndpoint = runtime.transport === "apps_script_iframe" &&
      endpoint.protocol === "https:" &&
      endpoint.hostname === "script.google.com" &&
      /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint.pathname) &&
      !endpoint.search &&
      !runtime.publicFeedEndpoint;
    if (!approvedAppsScriptEndpoint) {
      throw new Error("Public Contact runtime may enable only the approved Apps Script /exec Sheet bridge with no public feed endpoint.");
    }
  } else if (runtime.transport !== "disabled" || runtime.endpoint || runtime.publicFeedEndpoint) {
    throw new Error("Disabled public Contact runtime must use the disabled transport with blank endpoints.");
  }
  const feed = SignalsContract.validateFeed(JSON.parse(fs.readFileSync(feedPath, "utf8")));
  const signalsHtml = fs.readFileSync(path.join(distDir, "signals.html"), "utf8");
  const contactHtml = fs.readFileSync(path.join(distDir, "contact.html"), "utf8");
  const signalsInlineFeed = SignalsContract.validateFeed(readInlineJson(signalsHtml, "signals-feed"));
  const signalsRuntime = ContactTransport.validateRuntimeConfig(
    readInlineJson(signalsHtml, "contact-runtime-config"),
    SITE_LOCATION
  );
  const contactRuntime = ContactTransport.validateRuntimeConfig(
    readInlineJson(contactHtml, "contact-runtime-config"),
    SITE_LOCATION
  );
  if (JSON.stringify(signalsInlineFeed) !== JSON.stringify(feed)) {
    throw new Error("Signals inline feed does not match the published public feed.");
  }
  if (JSON.stringify(signalsRuntime) !== JSON.stringify(runtime) || JSON.stringify(contactRuntime) !== JSON.stringify(runtime)) {
    throw new Error("Contact runtime inline config does not match the published config.");
  }

  const registryIds = Array.from(
    signalsHtml.matchAll(/<li\b[^>]*\bdata-signal-record\b[^>]*\bdata-signal-id="([^"]+)"/g),
    function (match) { return match[1]; }
  );
  const expectedRegistryIds = feed.records.map(function (record) { return record.id; });
  if (JSON.stringify(registryIds) !== JSON.stringify(expectedRegistryIds)) {
    throw new Error("Rendered Signals registry does not exactly match the validated feed.");
  }
  const orbitIds = Array.from(
    signalsHtml.matchAll(/<a\b[^>]*\bdata-satellite\b[^>]*\bdata-signal-id="([^"]+)"/g),
    function (match) { return match[1]; }
  );
  const expectedOrbitIds = SignalsContract.orbitRecords(feed).map(function (record) { return record.id; });
  if (JSON.stringify(orbitIds) !== JSON.stringify(expectedOrbitIds) || orbitIds.length > 5) {
    throw new Error("Rendered Signals orbit is not the deterministic maximum-five approved subset.");
  }
  if (!expectedOrbitIds.length) {
    if (!/<meta name="robots" content="noindex,follow">/.test(signalsHtml)) {
      throw new Error("Signals must remain noindex,follow while it has no approved orbit.");
    }
    if (!signalsHtml.includes("No public Signals yet.") && feed.records.length === 0) {
      throw new Error("Empty Signals feed is missing its honest empty state.");
    }
  }
  if (/DEMO QUOTE|DEMO TESTIMONIAL|FIXTURE QUOTE/i.test(signalsHtml + fs.readFileSync(feedPath, "utf8"))) {
    throw new Error("Demo testimonial content reached the public Signals boundary.");
  }
  assertNoContactSignalsArtifacts(distDir, relativeFiles);
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
  assertLocalProductionFonts(resolvedDist, files);
  assertResponsiveImageDelivery(resolvedDist);
  assertCanonicalPersonIdentity(resolvedDist);
  assertContactSignalsPublication(resolvedDist, relativeFiles);
  const postCount = assertPublishedPosts(resolvedDist, dbPath);
  const publishedPosts = publishedPostsFromDatabase(dbPath);
  if (publishedPosts.length !== postCount) {
    throw new Error("Published social-preview source rows drifted from the generated post inventory.");
  }
  assertSocialPreviewSet({ rootDir: resolvedDist, posts: publishedPosts });
  assertNoAuthoringReferences(resolvedDist, files);
  assertSearchIndexPrivacy(resolvedDist);
  assertNoPublishedExif(resolvedDist, files);
  assertRetiredPublicWording(resolvedDist, files);
  assertGoogleSiteVerification(resolvedDist);
  assertReferencesResolve(resolvedDist, files);
  assertSitemapAndCanonicals(resolvedDist, files);
  assertSocialMetadata(resolvedDist, publishedPosts);

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
  assertCanonicalPersonIdentity,
  assertContactSignalsPublication,
  assertGeneratedArticleIdentity,
  assertGoogleSiteVerification,
  assertLocalProductionFonts,
  assertLlmsPublishedPosts,
  assertNoAuthoringReferences,
  assertNoPublishedExif,
  assertPublishedPosts,
  assertResponsiveImageDelivery,
  assertRetiredPublicWording,
  assertSearchIndexPrivacy,
  assertSitemapAndCanonicals,
  assertSocialMetadata,
  publishedPostsFromDatabase,
  verifyDist,
  walkFiles
};
