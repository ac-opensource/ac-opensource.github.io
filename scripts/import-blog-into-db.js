const fs = require("fs");
const path = require("path");
const {
  openDatabase,
  ensureSchema,
  upsertPost
} = require("./lib/blog-db");

const REPO_ROOT = path.join(__dirname, "..");
const BLOG_DIR = path.join(REPO_ROOT, "blog");
const POSTS_JSON_PATH = path.join(BLOG_DIR, "posts.json");

function extractMetaContent(html, attribute, value) {
  const expression = new RegExp(
    `<meta\\s+[^>]*${attribute}=["']${escapeRegExp(value)}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    "i"
  );

  const reverseExpression = new RegExp(
    `<meta\\s+[^>]*content=["']([^"']*)["'][^>]*${attribute}=["']${escapeRegExp(value)}["'][^>]*>`,
    "i"
  );

  const direct = html.match(expression);
  if (direct) return decodeHtmlEntities(direct[1]);

  const reverse = html.match(reverseExpression);
  return reverse ? decodeHtmlEntities(reverse[1]) : "";
}

function extractTagAttr(tag, attribute) {
  if (!tag) return "";
  const match = tag.match(new RegExp(`${attribute}=["']([^"']*)["']`, "i"));
  return match ? decodeHtmlEntities(match[1]) : "";
}

function normalizeAssetPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:")) {
    return raw;
  }

  if (raw.startsWith("/")) {
    return raw;
  }

  const normalized = raw.replace(/^\.\//, "").replace(/^\//, "");
  return `/blog/${normalized}`;
}

function extractHeroData(html) {
  const figureMatch = html.match(/<figure[^>]*>([\s\S]*?)<\/figure>/i);
  const figureHtml = figureMatch ? figureMatch[1] : "";

  const imageTag =
    (figureHtml && figureHtml.match(/<img[^>]*>/i)?.[0]) ||
    html.match(/<img[^>]*>/i)?.[0] ||
    "";

  const figureCaption =
    (figureHtml.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] || "")
      .replace(/\s+/g, " ")
      .trim();

  const heroImage =
    extractMetaContent(html, "property", "og:image") ||
    extractTagAttr(imageTag, "src") ||
    "";

  const heroAlt =
    extractMetaContent(html, "property", "og:image:alt") ||
    extractTagAttr(imageTag, "alt") ||
    "";

  const heroCaption = decodeHtmlEntities(figureCaption);

  return {
    hero_image: normalizeAssetPath(heroImage),
    hero_alt: heroAlt,
    hero_caption: heroCaption
  };
}

function extractBodyHtml(html, fallbackSummary) {
  const articleInner = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] || "";

  if (articleInner) {
    const sections = [...articleInner.matchAll(/<section[^>]*>[\s\S]*?<\/section>/gi)].map((m) => m[0].trim());

    if (sections.length) {
      return sections.join("\n\n");
    }

    let cleaned = articleInner
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .trim();

    if (cleaned) return cleaned;
  }

  const proseMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] || "";
  if (proseMatch) {
    const paragraphs = [...proseMatch.matchAll(/<p[^>]*>[\s\S]*?<\/p>/gi)].map((m) => m[0].trim());
    if (paragraphs.length) return paragraphs.join("\n\n");
  }

  const safeSummary = escapeHtml(String(fallbackSummary || "No content provided."));
  return `<p>${safeSummary}</p>`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function readPostHtml(slug) {
  const filePath = path.join(BLOG_DIR, `${slug}.html`);
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

function main() {
  const requestedPath = process.argv.find((arg) => arg.startsWith("--db="));
  const dbPath = requestedPath ? requestedPath.split("=")[1] : undefined;
  const noReset = process.argv.includes("--no-reset");

  if (!fs.existsSync(POSTS_JSON_PATH)) {
    throw new Error(`posts.json not found at ${POSTS_JSON_PATH}`);
  }

  const posts = JSON.parse(fs.readFileSync(POSTS_JSON_PATH, "utf8"));
  const { db, dbPath: resolvedDbPath } = openDatabase(dbPath);

  try {
    ensureSchema(db);

    if (!noReset) {
      db.exec("DELETE FROM post_topics; DELETE FROM posts;");
    }

    let importedCount = 0;

    for (const post of posts) {
      const slug = String(post.slug || "").trim();
      if (!slug) continue;

      const html = readPostHtml(slug);
      const hero = html ? extractHeroData(html) : {
        hero_image: "",
        hero_alt: "",
        hero_caption: ""
      };

      const bodyHtml = html
        ? extractBodyHtml(html, post.summary)
        : `<p>${escapeHtml(post.summary || "No content provided.")}</p>`;

      upsertPost(db, {
        slug,
        title: post.title,
        author: post.author || "Andrew Concepcion",
        summary: post.summary,
        category: post.category || "general",
        published_date: post.date,
        reading_time: post.readingTime || "",
        topics: post.topics || [],
        hero_image: hero.hero_image,
        hero_alt: hero.hero_alt,
        hero_caption: hero.hero_caption,
        body_html: bodyHtml,
        status: "published"
      });

      importedCount += 1;
    }

    console.log(`Imported ${importedCount} posts into ${resolvedDbPath}`);
  } finally {
    db.close();
  }
}

main();
