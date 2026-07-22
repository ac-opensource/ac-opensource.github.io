const crypto = require("crypto");
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
const WRITER_HOST = String(process.env.WRITER_HOST || "127.0.0.1").trim();
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
const ROOT_DIR = path.join(__dirname, "..");
const WRITER_HTML = path.join(ROOT_DIR, "blog", "writer.html");
const WRITER_SESSION_TOKEN = crypto.randomBytes(32).toString("hex");

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}
if (!LOOPBACK_HOSTS.has(WRITER_HOST)) {
  throw new Error("WRITER_HOST must be 127.0.0.1 or localhost; remote binding is not supported.");
}

const { db } = openDatabase(process.env.BLOG_DB_PATH);
ensureSchema(db);

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (!LOOPBACK_HOSTS.has(req.hostname)) {
    res.status(403).json({ error: "Loopback host required." });
    return;
  }
  next();
});
app.use(express.json({ limit: "4mb" }));
app.get("/assets/js/blog-writer-app.js", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "assets", "js", "blog-writer-app.js"));
});
app.use("/blog/images", express.static(path.join(ROOT_DIR, "blog", "images")));

function parseCookies(header) {
  const cookies = new Map();
  for (const pair of String(header || "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (key) cookies.set(key, value);
  }
  return cookies;
}

function matchesSessionToken(candidate) {
  const received = Buffer.from(String(candidate || ""));
  const expected = Buffer.from(WRITER_SESSION_TOKEN);
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function isAllowedOrigin(value) {
  try {
    const origin = new URL(String(value || ""));
    return (
      origin.protocol === "http:" &&
      LOOPBACK_HOSTS.has(origin.hostname) &&
      origin.port === String(PORT)
    );
  } catch (_error) {
    return false;
  }
}

function setWriterSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `ac_writer_session=${WRITER_SESSION_TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`
  );
  res.setHeader("Cache-Control", "no-store");
}

app.use("/api", (req, res, next) => {
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (!mutation) {
    next();
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  if (
    !isAllowedOrigin(req.get("origin")) ||
    !matchesSessionToken(cookies.get("ac_writer_session"))
  ) {
    res.status(403).json({ error: "Writer session validation failed. Reload the local writer and try again." });
    return;
  }

  next();
});

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
  setWriterSessionCookie(res);
  res.sendFile(WRITER_HTML);
});

app.get("/writer", (_req, res) => {
  setWriterSessionCookie(res);
  res.sendFile(WRITER_HTML);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, storage: "ready" });
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
    console.error("Failed to save blog post.", error);
    res.status(500).json({ error: "Failed to save post." });
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

app.use((error, _req, res, _next) => {
  console.error("Blog writer request failed.", error);
  if (res.headersSent) return;
  res.status(500).json({ error: "The local writer could not complete the request." });
});

const server = app.listen(PORT, WRITER_HOST, () => {
  console.log(`Blog writer running at http://${WRITER_HOST}:${PORT}`);
  console.log("Using the configured local blog database.");
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
