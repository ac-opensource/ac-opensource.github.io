const { openDatabase, assertSchema } = require("./lib/blog-db");

function main() {
  const args = process.argv.slice(2);
  const dbArg = args.find((arg) => arg.startsWith("--db="));
  const dbPath = dbArg ? dbArg.split("=")[1] : undefined;

  const queryTokens = args.filter((arg) => !arg.startsWith("--db="));
  const sql = queryTokens.join(" ").trim() || "SELECT slug, title, published_date, category FROM posts ORDER BY published_date DESC;";

  const { db } = openDatabase(dbPath, { readonly: true });

  try {
    assertSchema(db);
    const rows = db.prepare(sql).all();
    console.table(rows);
  } finally {
    db.close();
  }
}

main();
