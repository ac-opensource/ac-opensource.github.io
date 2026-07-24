const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { buildSite, DEFAULT_OUTPUT_ROOT } = require("./build-site");

const HOST = "127.0.0.1";
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8"
};

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const withIndex = relativePath.endsWith("/") ? `${relativePath}index.html` : relativePath;
  const resolved = path.resolve(DEFAULT_OUTPUT_ROOT, withIndex);
  const relative = path.relative(DEFAULT_OUTPUT_ROOT, resolved);
  return relative.startsWith("..") || path.isAbsolute(relative) ? null : resolved;
}

function createStaticServer() {
  return http.createServer((req, res) => {
    if (!req.url || !["GET", "HEAD"].includes(req.method || "")) {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }

    let filePath;
    try {
      filePath = resolveRequestPath(req.url);
    } catch (_error) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const headers = {
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": fs.statSync(filePath).size,
      "Cache-Control": "no-store"
    };
    res.writeHead(200, headers);
    if (req.method === "HEAD") res.end();
    else fs.createReadStream(filePath).pipe(res);
  });
}

async function main() {
  buildSite();
  const server = createStaticServer();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  if (!port) throw new Error("The E2E static server did not allocate a port.");

  const child = spawn(process.execPath, [path.join(__dirname, "e2e-check.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      BASE_URL: `http://${HOST}:${port}`,
      SITE_ROOT: "dist"
    },
    stdio: "inherit"
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`E2E process ended with signal ${signal}.`));
      else resolve(code === null ? 1 : code);
    });
  }).finally(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  );

  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
