const path = require("path");
const express = require("express");
const sanitizeHtml = require("sanitize-html");
const {
  openDatabase,
  ensureSchema,
  getPostList,
  getPostWithTopics,
  upsertPost
} = require("./lib/blog-db");

const PORT = Number(process.env.PORT || 4310);
const ROOT_DIR = path.join(__dirname, "..");
const WRITER_HTML = path.join(ROOT_DIR, "blog", "writer.html");

const { db, dbPath } = openDatabase(process.env.BLOG_DB_PATH);
ensureSchema(db);

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use("/assets", express.static(path.join(ROOT_DIR, "assets")));
app.use("/blog/images", express.static(path.join(ROOT_DIR, "blog", "images")));

function sanitizeBodyHtml(html) {
  return sanitizeHtml(String(html || ""), {
    allowedTags: [
      "p",
      "br",
      "h1",
      "h2",
      "h3",
      "h4",
      "blockquote",
      "ul",
      "ol",
      "li",
      "strong",
      "em",
      "u",
      "code",
      "pre",
      "a",
      "img",
      "hr",
      "span",
      "section",
      "figure",
      "figcaption"
    ],
    allowedAttributes: {
      "*": ["class", "id"],
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading", "decoding"],
      code: ["class"],
      span: ["class"],
      section: ["class"]
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    allowProtocolRelative: false
  });
}

function sanitizeText(value) {
  return String(value || "").trim();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function extractSummaryFromHtml(html) {
  const plain = sanitizeHtml(String(html || ""), { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
  if (!plain) return "";
  return plain.length <= 180 ? plain : `${plain.slice(0, 177)}...`;
}

function normalizeDate(value) {
  const raw = sanitizeText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const today = new Date();
  const y = today.getFullYear();
  const m = `${today.getMonth() + 1}`.padStart(2, "0");
  const d = `${today.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeTopics(value) {
  if (Array.isArray(value)) return value;
  return String(value || "")
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);
}

app.get("/", (_req, res) => {
  res.sendFile(WRITER_HTML);
});

app.get("/writer", (_req, res) => {
  res.sendFile(WRITER_HTML);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, dbPath });
});

app.get("/api/posts", (req, res) => {
  const search = sanitizeText(req.query.search || "").toLowerCase();

  const posts = getPostList(db)
    .filter((post) => post.status === "published")
    .filter((post) => {
      if (!search) return true;
      const bag = [
        post.slug,
        post.title,
        post.author,
        post.summary,
        post.category,
        ...(post.topics || [])
      ]
        .join(" ")
        .toLowerCase();
      return bag.includes(search);
    });

  res.json(posts);
});

app.get("/api/posts/:slug", (req, res) => {
  const slug = sanitizeText(req.params.slug);
  const post = getPostWithTopics(db, slug);

  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  res.json(post);
});

app.post("/api/posts", (req, res) => {
  try {
    const title = sanitizeText(req.body.title);
    if (!title) {
      res.status(400).json({ error: "Title is required." });
      return;
    }

    const publishedDate = normalizeDate(req.body.published_date || req.body.date);
    const preferredSlug = sanitizeText(req.body.slug);
    const slugBase = preferredSlug || `${publishedDate}-${slugify(title)}`;
    const slug = slugify(slugBase).startsWith("20") ? slugify(slugBase) : `${publishedDate}-${slugify(title)}`;

    const bodyHtml = sanitizeBodyHtml(req.body.body_html || "");
    const summary = sanitizeText(req.body.summary) || extractSummaryFromHtml(bodyHtml);

    upsertPost(db, {
      slug,
      title,
      author: sanitizeText(req.body.author || "Andrew Concepcion") || "Andrew Concepcion",
      summary,
      category: sanitizeText(req.body.category || "general") || "general",
      published_date: publishedDate,
      reading_time: sanitizeText(req.body.reading_time || "") || "5 min read",
      hero_image: sanitizeText(req.body.hero_image || ""),
      hero_alt: sanitizeText(req.body.hero_alt || ""),
      hero_caption: sanitizeText(req.body.hero_caption || ""),
      body_html: bodyHtml || `<p>${summary}</p>`,
      topics: normalizeTopics(req.body.topics),
      status: "published"
    });

    const post = getPostWithTopics(db, slug);
    res.json({ ok: true, post });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to save post." });
  }
});

app.delete("/api/posts/:slug", (req, res) => {
  const slug = sanitizeText(req.params.slug);
  if (!slug) {
    res.status(400).json({ error: "Slug is required." });
    return;
  }

  const result = db.prepare("DELETE FROM posts WHERE slug = ?").run(slug);
  res.json({ ok: true, deleted: result.changes });
});

const server = app.listen(PORT, () => {
  console.log(`Blog writer running at http://localhost:${PORT}`);
  console.log(`Using SQLite DB: ${dbPath}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
