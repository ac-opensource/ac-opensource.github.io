const readline = require("readline");
const {
  openDatabase,
  ensureSchema,
  upsertPost
} = require("./lib/blog-db");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function main() {
  console.log("Create a New SQLite Blog Entry\n");

  const title = (await ask("Title: ")).trim();
  if (!title) {
    console.error("Title is required.");
    process.exit(1);
  }

  const summary = (await ask("Summary: ")).trim();
  const author = (await ask("Author (default: Andrew Concepcion): ")).trim() || "Andrew Concepcion";
  const category = (await ask("Category (technical/reflection/hobby/etc): ")).trim() || "technical";
  const readingTime = (await ask("Reading time (e.g. 8 min read): ")).trim() || "6 min read";
  const topicsInput = (await ask("Topics (comma separated): ")).trim();
  const heroImage = (await ask("Hero image URL/path (optional): ")).trim();
  const heroAlt = (await ask("Hero image alt (optional): ")).trim();
  const heroCaption = (await ask("Hero caption (optional): ")).trim();

  const topics = topicsInput
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const date = todayIso();
  const slug = `${date}-${slugify(title)}`;

  const { db, dbPath } = openDatabase();

  try {
    ensureSchema(db);

    upsertPost(db, {
      slug,
      title,
      author,
      summary,
      category,
      published_date: date,
      reading_time: readingTime,
      topics,
      hero_image: heroImage,
      hero_alt: heroAlt,
      hero_caption: heroCaption,
      body_html: `<p>${summary || "Write your post body here."}</p>`,
      status: "published"
    });

    console.log(`\nSaved to SQLite: ${dbPath}`);
    console.log(`Dynamic preview route: /blog/post.html?slug=${slug}`);
    console.log(`Static route after build: /blog/${slug}.html`);
    console.log("For WYSIWYG editing, run: npm run blog:writer");
  } finally {
    db.close();
    rl.close();
  }
}

main();
