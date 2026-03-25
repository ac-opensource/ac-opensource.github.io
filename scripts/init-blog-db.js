const { openDatabase, ensureSchema } = require("./lib/blog-db");

function main() {
  const requestedPath = process.argv[2];
  const { db, dbPath } = openDatabase(requestedPath);

  try {
    ensureSchema(db);
    console.log(`SQLite schema ready: ${dbPath}`);
  } finally {
    db.close();
  }
}

main();
