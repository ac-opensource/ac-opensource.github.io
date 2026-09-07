const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");

const ROOT_DIR = path.join(__dirname, "..");
const HOST = "127.0.0.1";
const OUTPUT_PATH = path.join(ROOT_DIR, "resume_concepcion_andrew.pdf");
const PREVIEW_PATH = path.join(require("os").tmpdir(), "resume-preview.png");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const withIndex = relativePath.endsWith("/") ? `${relativePath}index.html` : relativePath;
  const resolved = path.resolve(ROOT_DIR, withIndex);
  const relative = path.relative(ROOT_DIR, resolved);
  return relative.startsWith("..") || path.isAbsolute(relative) ? null : resolved;
}

function createStaticServer() {
  return http.createServer((request, response) => {
    if (!request.url || !["GET", "HEAD"].includes(request.method || "")) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    let filePath;
    try {
      filePath = resolveRequestPath(request.url);
    } catch (_error) {
      response.writeHead(400);
      response.end("Bad request");
      return;
    }
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": fs.statSync(filePath).size,
      "Cache-Control": "no-store"
    });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(filePath).pipe(response);
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("Resume server did not allocate a port.");
  return address.port;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function normalizeExtractedText(text) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

async function extractPdfPages(pdfBytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    isEvalSupported: false,
    useWorkerFetch: false
  });
  const document = await loadingTask.promise;
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(normalizeExtractedText(
        content.items
          .filter((item) => typeof item.str === "string")
          .map((item) => item.str)
          .join(" ")
      ));
      page.cleanup();
    }
  } finally {
    await document.cleanup();
    await loadingTask.destroy();
  }

  return pages;
}

function assertExtractedResume(pages) {
  if (pages.length !== 3) throw new Error(`Resume extraction expected three pages; found ${pages.length}.`);

  const firstPage = pages[0];
  if (!firstPage.startsWith("ANDREW V. CONCEPCION")) {
    throw new Error(`Resume extraction must begin with Andrew's identity; found: ${firstPage.slice(0, 96)}`);
  }

  const firstPageRequirements = [
    "aarconcepcion@gmail.com",
    "ac-opensource.github.io",
    "github.com/ac-opensource",
    "linkedin.com/in/aarconcepcion",
    "AI-Native Software Engineer",
    "Kotlin, Java"
  ];
  for (const requirement of firstPageRequirements) {
    if (!firstPage.includes(requirement)) {
      throw new Error(`Resume extraction is missing or fragmented on page one: ${requirement}`);
    }
  }

  const fullText = pages.join(" ");
  for (const requirement of ["Red Airship", "Candyspace", "MySTC", "Bitcoin.com"]) {
    if (!fullText.includes(requirement)) {
      throw new Error(`Resume extraction is missing an expected experience label: ${requirement}`);
    }
  }
}

async function main() {
  const server = createStaticServer();
  const port = await listen(server);
  const temporaryOutput = `${OUTPUT_PATH}.building-${process.pid}`;
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });
    await page.emulateMedia({ media: "print", colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(`http://${HOST}:${port}/resume.html?phone=all`, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      const base = document.createElement("base");
      base.href = "https://ac-opensource.github.io/";
      document.head.prepend(base);
      document.body.classList.add("pdf-export");
      if (document.fonts?.ready) await document.fonts.ready;
    });

    await page.pdf({
      path: temporaryOutput,
      format: "A4",
      printBackground: true,
      tagged: true,
      outline: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: [
        '<div style="box-sizing:border-box;width:100%;padding:0 12mm;color:#5a5f65;font:7px/1.2 Arial,sans-serif;letter-spacing:.04em;">',
        '<span>Andrew Concepcion · ac-opensource.github.io</span>',
        '<span style="float:right;"><span class="pageNumber"></span> / <span class="totalPages"></span></span>',
        "</div>"
      ].join(""),
      margin: { top: "10mm", right: "11mm", bottom: "14mm", left: "11mm" }
    });
    await page.screenshot({ path: PREVIEW_PATH, fullPage: true });

    const pdfBytes = fs.readFileSync(temporaryOutput);
    const header = pdfBytes.subarray(0, 5).toString("ascii");
    if (header !== "%PDF-") throw new Error("Chromium did not produce a valid PDF document.");
    const pdfSource = pdfBytes.toString("latin1");
    const pageCount = (pdfSource.match(/\/Type\s*\/Page\b/g) || []).length;
    if (pageCount !== 3) throw new Error(`Resume PDF must contain exactly three A4 pages; found ${pageCount}.`);
    if (!pdfSource.includes("/StructTreeRoot")) throw new Error("Resume PDF is missing its tagged structure tree.");
    if (/127\.0\.0\.1|localhost/i.test(pdfSource)) throw new Error("Resume PDF contains a local-only link.");
    assertExtractedResume(await extractPdfPages(pdfBytes));
    fs.renameSync(temporaryOutput, OUTPUT_PATH);
  } finally {
    if (browser) await browser.close();
    if (fs.existsSync(temporaryOutput)) fs.unlinkSync(temporaryOutput);
    await close(server);
  }

  console.log(`Generated tagged A4 resume: ${OUTPUT_PATH}`);
  console.log(`Rendered resume preview: ${PREVIEW_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
