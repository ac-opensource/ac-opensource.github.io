const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildSite } = require("./build-site");
const { verifyDist, walkFiles } = require("./verify-dist");

function buildDigest(root) {
  const hash = crypto.createHash("sha256");
  const files = walkFiles(root);

  for (const file of files) {
    const relativePath = path.relative(root, file).split(path.sep).join("/");
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }

  return hash.digest("hex");
}

function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac-site-determinism-"));
  const first = path.join(temporaryRoot, "first");
  const second = path.join(temporaryRoot, "second");
  const originalTimezone = process.env.TZ;

  try {
    process.env.TZ = "UTC";
    buildSite({ outputRoot: first });
    process.env.TZ = "Pacific/Auckland";
    buildSite({ outputRoot: second });
    verifyDist({ distDir: first });
    verifyDist({ distDir: second });

    const firstDigest = buildDigest(first);
    const secondDigest = buildDigest(second);
    if (firstDigest !== secondDigest) {
      throw new Error(`Builds differ: ${firstDigest} != ${secondDigest}`);
    }

    console.log(`Deterministic publication digest: ${firstDigest}`);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main();
}
