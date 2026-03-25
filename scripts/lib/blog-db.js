const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DEFAULT_DB_PATH = path.join(__dirname, "..", "..", "assets", "data", "blog.sqlite");

function resolveDbPath(inputPath) {
  return inputPath ? path.resolve(inputPath) : DEFAULT_DB_PATH;
}

function openDatabase(inputPath) {
  const dbPath = resolveDbPath(inputPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return { db, dbPath };
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT 'Andrew Concepcion',
      summary TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      published_date TEXT NOT NULL,
      reading_time TEXT NOT NULL DEFAULT '',
      hero_image TEXT NOT NULL DEFAULT '',
      hero_alt TEXT NOT NULL DEFAULT '',
      hero_caption TEXT NOT NULL DEFAULT '',
      body_html TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'published',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS post_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_slug TEXT NOT NULL,
      topic TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(post_slug, topic),
      FOREIGN KEY(post_slug) REFERENCES posts(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_posts_published_date ON posts(published_date DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
    CREATE INDEX IF NOT EXISTS idx_post_topics_slug ON post_topics(post_slug);
  `);

  const postColumns = db
    .prepare("PRAGMA table_info(posts)")
    .all()
    .map((column) => column.name);

  if (!postColumns.includes("author")) {
    db.exec(
      "ALTER TABLE posts ADD COLUMN author TEXT NOT NULL DEFAULT 'Andrew Concepcion';"
    );
  }

  db.exec(
    "UPDATE posts SET author = 'Andrew Concepcion' WHERE author IS NULL OR TRIM(author) = '';"
  );
}

function normalizeTopics(topics) {
  if (!Array.isArray(topics)) return [];

  const seen = new Set();
  const output = [];

  for (const value of topics) {
    const topic = String(value || "").trim();
    if (!topic) continue;

    const key = topic.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(topic);
  }

  return output;
}

function upsertPost(db, post) {
  const slug = String(post.slug || "").trim();
  const title = String(post.title || "").trim();
  const publishedDate = String(post.published_date || "").trim();

  if (!slug) throw new Error("Post slug is required.");
  if (!title) throw new Error("Post title is required.");
  if (!publishedDate) throw new Error("Post published_date is required.");

  const payload = {
    slug,
    title,
    author: String(post.author || "Andrew Concepcion").trim() || "Andrew Concepcion",
    summary: String(post.summary || "").trim(),
    category: String(post.category || "general").trim().toLowerCase() || "general",
    published_date: publishedDate,
    reading_time: String(post.reading_time || "").trim(),
    hero_image: String(post.hero_image || "").trim(),
    hero_alt: String(post.hero_alt || "").trim(),
    hero_caption: String(post.hero_caption || "").trim(),
    body_html: String(post.body_html || "").trim(),
    status: String(post.status || "published").trim().toLowerCase() || "published"
  };

  const topics = normalizeTopics(post.topics);

  const tx = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO posts (
        slug,
        title,
        author,
        summary,
        category,
        published_date,
        reading_time,
        hero_image,
        hero_alt,
        hero_caption,
        body_html,
        status,
        created_at,
        updated_at
      ) VALUES (
        @slug,
        @title,
        @author,
        @summary,
        @category,
        @published_date,
        @reading_time,
        @hero_image,
        @hero_alt,
        @hero_caption,
        @body_html,
        @status,
        datetime('now'),
        datetime('now')
      )
      ON CONFLICT(slug) DO UPDATE SET
        title = excluded.title,
        author = excluded.author,
        summary = excluded.summary,
        category = excluded.category,
        published_date = excluded.published_date,
        reading_time = excluded.reading_time,
        hero_image = excluded.hero_image,
        hero_alt = excluded.hero_alt,
        hero_caption = excluded.hero_caption,
        body_html = excluded.body_html,
        status = excluded.status,
        updated_at = datetime('now')
      `
    ).run(payload);

    db.prepare("DELETE FROM post_topics WHERE post_slug = ?").run(slug);

    const insertTopic = db.prepare(
      "INSERT INTO post_topics (post_slug, topic, position) VALUES (?, ?, ?)"
    );

    topics.forEach((topic, index) => {
      insertTopic.run(slug, topic, index);
    });
  });

  tx();

  return slug;
}

function getPostWithTopics(db, slug) {
  const post = db
    .prepare(
      `
      SELECT
        slug,
        title,
        author,
        summary,
        category,
        published_date,
        reading_time,
        hero_image,
        hero_alt,
        hero_caption,
        body_html,
        status,
        created_at,
        updated_at
      FROM posts
      WHERE slug = ?
      `
    )
    .get(slug);

  if (!post) return null;

  const topics = db
    .prepare(
      `
      SELECT topic
      FROM post_topics
      WHERE post_slug = ?
      ORDER BY position ASC, topic ASC
      `
    )
    .all(slug)
    .map((row) => row.topic);

  return {
    ...post,
    topics
  };
}

function getPostList(db) {
  return db
    .prepare(
      `
      SELECT
        p.slug,
        p.title,
        p.author,
        p.summary,
        p.category,
        p.published_date,
        p.reading_time,
        p.hero_image,
        p.status,
        COALESCE(
          (
            SELECT GROUP_CONCAT(topic, '|||')
            FROM (
              SELECT topic
              FROM post_topics
              WHERE post_slug = p.slug
              ORDER BY position ASC, topic ASC
            )
          ),
          ''
        ) AS topics
      FROM posts p
      ORDER BY p.published_date DESC, p.created_at DESC
      `
    )
    .all()
    .map((row) => ({
      ...row,
      topics: row.topics ? row.topics.split("|||") : []
    }));
}

module.exports = {
  DEFAULT_DB_PATH,
  resolveDbPath,
  openDatabase,
  ensureSchema,
  normalizeTopics,
  upsertPost,
  getPostWithTopics,
  getPostList
};
