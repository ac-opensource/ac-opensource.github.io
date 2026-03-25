const fs = require("fs");
const path = require("path");
const { openDatabase, ensureSchema, getPostList } = require("./lib/blog-db");

const REPO_ROOT = path.join(__dirname, "..");
const BLOG_POSTS_JSON = path.join(REPO_ROOT, "blog", "posts.json");

function main() {
  const requestedPath = process.argv.find((arg) => arg.startsWith("--db="));
  const dbPath = requestedPath ? requestedPath.split("=")[1] : undefined;

  const { db } = openDatabase(dbPath);

  try {
    ensureSchema(db);

    const rows = getPostList(db)
      .filter((post) => post.status === "published")
      .map((post) => ({
        slug: post.slug,
        title: post.title,
        author: post.author,
        summary: post.summary,
        date: post.published_date,
        readingTime: post.reading_time,
        topics: post.topics,
        category: post.category
      }));

    fs.writeFileSync(BLOG_POSTS_JSON, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
    console.log(`Wrote ${rows.length} posts to ${BLOG_POSTS_JSON}`);
  } finally {
    db.close();
  }
}

main();
