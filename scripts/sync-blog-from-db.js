const fs = require("fs");
const path = require("path");
const {
  openDatabase,
  assertSchema,
  getPostList,
  getPostWithTopics
} = require("./lib/blog-db");
const { resolvePublicImage } = require("./lib/public-images");

const REPO_ROOT = path.join(__dirname, "..");
const BLOG_POSTS_JSON = path.join(REPO_ROOT, "blog", "posts.json");

function publishedPostManifest(post) {
  return {
    slug: post.slug,
    title: post.title,
    author: post.author,
    summary: post.summary,
    date: post.published_date,
    readingTime: post.reading_time,
    topics: post.topics,
    category: post.category,
    heroImage: resolvePublicImage(post.hero_image).src,
    heroAlt: post.hero_alt,
    heroCaption: post.hero_caption,
    updatedAt: post.updated_at,
    createdAt: post.created_at
  };
}

function syncBlogManifest({ dbPath, outputPath = BLOG_POSTS_JSON } = {}) {
  const { db } = openDatabase(dbPath, { readonly: true });

  try {
    assertSchema(db);

    const rows = getPostList(db)
      .filter((post) => post.status === "published")
      .map((post) => getPostWithTopics(db, post.slug))
      .filter(Boolean)
      .sort(
        (a, b) =>
          String(b.published_date).localeCompare(String(a.published_date)) ||
          String(a.slug).localeCompare(String(b.slug))
      )
      .map(publishedPostManifest);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
    return rows;
  } finally {
    db.close();
  }
}

function getArgValue(name) {
  const argument = process.argv.find((value) => value.startsWith(`--${name}=`));
  return argument ? argument.slice(name.length + 3) : undefined;
}

function main() {
  const outputPath = getArgValue("output");
  const rows = syncBlogManifest({
    dbPath: getArgValue("db"),
    outputPath: outputPath ? path.resolve(outputPath) : BLOG_POSTS_JSON
  });
  console.log(`Wrote ${rows.length} published posts to ${outputPath || "blog/posts.json"}.`);
}

if (require.main === module) {
  main();
}

module.exports = {
  BLOG_POSTS_JSON,
  publishedPostManifest,
  syncBlogManifest
};
