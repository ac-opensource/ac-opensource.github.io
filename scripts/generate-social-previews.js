const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { openDatabase, assertSchema, getPostList, getPostWithTopics } = require("./lib/blog-db");
const {
  SOCIAL_PREVIEW_BRAND,
  SOCIAL_PREVIEW_GENERATOR,
  SOCIAL_PREVIEW_HEIGHT,
  SOCIAL_PREVIEW_MANIFEST_PATH,
  SOCIAL_PREVIEW_METADATA_KEY,
  SOCIAL_PREVIEW_POST_DIRECTORY,
  SOCIAL_PREVIEW_WIDTH,
  assertSocialPreviewSet,
  buildSocialPreviewManifest,
  socialMetadataFromPng
} = require("./lib/social-previews");

const ROOT_DIR = path.join(__dirname, "..");
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const CATEGORY_THEME = Object.freeze({
  portfolio: Object.freeze({ accent: "#2864c7", signal: "#df642c", label: "PORTFOLIO / DELIVERY RECORD" }),
  technical: Object.freeze({ accent: "#2864c7", signal: "#168c86", label: "TECHNICAL / SYSTEMS DEBRIEF" }),
  reflection: Object.freeze({ accent: "#687fc4", signal: "#8b5e83", label: "REFLECTION / OBSERVATION" }),
  hobby: Object.freeze({ accent: "#df8b27", signal: "#2864c7", label: "FIELD NOTE / IMAGE + PLACE" }),
  log: Object.freeze({ accent: "#2864c7", signal: "#168c86", label: "PUBLISHED LOG" }),
  logs: Object.freeze({ accent: "#2864c7", signal: "#168c86", label: "LOGS / PUBLISHED FIELD" }),
  "public evidence": Object.freeze({ accent: "#2864c7", signal: "#df642c", label: "SEARCH / PUBLIC EVIDENCE" })
});

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(value) {
  return escapeHtml(value);
}

function getArgValue(name) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : undefined;
}

function publishedPosts(dbPath) {
  const { db } = openDatabase(dbPath, { readonly: true });
  try {
    assertSchema(db);
    return getPostList(db)
      .filter((post) => post.status === "published")
      .sort(
        (left, right) =>
          String(right.published_date).localeCompare(String(left.published_date)) ||
          String(left.slug).localeCompare(String(right.slug))
      )
      .map((post) => getPostWithTopics(db, post.slug))
      .filter(Boolean);
  } finally {
    db.close();
  }
}

function formatDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "DATE RECORDED";
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])} · ${match[1]}`;
}

function seedFrom(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(value) {
  let seed = seedFrom(value);
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function crcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    return value >>> 0;
  });
}

const CRC_TABLE = crcTable();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function socialMetadata(record) {
  return {
    generator: SOCIAL_PREVIEW_GENERATOR,
    brand: SOCIAL_PREVIEW_BRAND,
    width: SOCIAL_PREVIEW_WIDTH,
    height: SOCIAL_PREVIEW_HEIGHT,
    record
  };
}

function embedSocialMetadata(buffer, record) {
  const keyword = Buffer.from(SOCIAL_PREVIEW_METADATA_KEY, "latin1");
  const text = Buffer.from(JSON.stringify(socialMetadata(record)), "utf8");
  const data = Buffer.concat([
    keyword,
    Buffer.from([0, 0, 0, 0, 0]),
    text
  ]);
  const ihdrEnd = 8 + 12 + buffer.readUInt32BE(8);
  return Buffer.concat([buffer.subarray(0, ihdrEnd), pngChunk("iTXt", data), buffer.subarray(ihdrEnd)]);
}

function fontData(rootDir, fileName) {
  return fs.readFileSync(path.join(rootDir, "assets", "fonts", fileName)).toString("base64");
}

function themeFor(record) {
  return CATEGORY_THEME[record.category] || CATEGORY_THEME.log;
}

function titleSize(title) {
  const length = [...String(title || "")].length;
  if (length > 70) return 49;
  if (length > 58) return 53;
  if (length > 46) return 58;
  if (length > 34) return 64;
  return 72;
}

function orbitField(record, nodeCount = 12) {
  const random = seededRandom(record.slug || record.kind || record.title);
  const theme = themeFor(record);
  const nodes = [];
  const rays = [];
  for (let index = 0; index < nodeCount; index += 1) {
    const angle = random() * Math.PI * 2;
    const distanceX = 70 + random() * 130;
    const distanceY = 44 + random() * 102;
    const x = 190 + Math.cos(angle) * distanceX;
    const y = 188 + Math.sin(angle) * distanceY;
    const radius = 2.5 + random() * 6;
    const color = index % 5 === 0 ? theme.signal : theme.accent;
    rays.push(`<path d="M190 188 L${x.toFixed(1)} ${y.toFixed(1)}" stroke="${color}" stroke-opacity="${(0.08 + random() * 0.12).toFixed(2)}"/>`);
    nodes.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}" fill="#faf9f4" stroke="${color}" stroke-width="1.5"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.5" fill="${color}"/>`);
  }

  const topicLabels = (record.topics || []).slice(0, 3).map((topic, index) => {
    const y = 326 + index * 18;
    return `<text x="18" y="${y}" fill="#5a5f65" font-family="Space Grotesk" font-size="9" letter-spacing="1.1">${escapeXml(String(topic).toUpperCase())}</text>`;
  }).join("");

  return `<svg class="field" viewBox="0 0 380 390" aria-hidden="true">
    <defs>
      <radialGradient id="core" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="${theme.signal}" stop-opacity="0.55"/>
        <stop offset="0.18" stop-color="${theme.accent}" stop-opacity="0.28"/>
        <stop offset="1" stop-color="${theme.accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <g fill="none" stroke="${theme.accent}" stroke-opacity="0.2">
      <ellipse cx="190" cy="188" rx="165" ry="88" transform="rotate(-13 190 188)"/>
      <ellipse cx="190" cy="188" rx="128" ry="64" transform="rotate(16 190 188)"/>
      <ellipse cx="190" cy="188" rx="84" ry="43" transform="rotate(-31 190 188)"/>
      <path d="M22 188 H358M190 18V356" stroke-opacity="0.08"/>
      ${rays.join("")}
    </g>
    <circle cx="190" cy="188" r="64" fill="url(#core)"/>
    <circle cx="190" cy="188" r="27" fill="#202720" stroke="#faf9f4" stroke-width="2"/>
    <ellipse cx="190" cy="188" rx="58" ry="12" fill="none" stroke="${theme.accent}" stroke-width="8" stroke-opacity="0.54" transform="rotate(-11 190 188)"/>
    <ellipse cx="190" cy="188" rx="58" ry="12" fill="none" stroke="#faf9f4" stroke-width="2" transform="rotate(-11 190 188)"/>
    ${nodes.join("")}
    ${topicLabels}
  </svg>`;
}

function logsField(record) {
  const random = seededRandom(`${record.kind}:${record.publishedCount}`);
  const theme = themeFor(record);
  const nodes = [];
  for (let index = 0; index < record.publishedCount; index += 1) {
    const arm = index % 4;
    const progress = 0.18 + Math.floor(index / 4) / Math.max(1, Math.ceil(record.publishedCount / 4) - 1) * 0.76;
    const angle = arm * Math.PI / 2 + progress * Math.PI * 2.35 + (random() - 0.5) * 0.14;
    const radius = 40 + progress * 145;
    const x = 190 + Math.cos(angle) * radius;
    const y = 188 + Math.sin(angle) * radius * 0.58;
    const color = index % 6 === 0 ? theme.signal : theme.accent;
    nodes.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${index < 4 ? 6.4 : 4.2}" fill="#faf9f4" stroke="${color}" stroke-width="1.5"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.4" fill="${color}"/>`);
  }
  return `<svg class="field" viewBox="0 0 380 390" aria-hidden="true">
    <g fill="none" stroke="${theme.accent}" stroke-opacity="0.18">
      <ellipse cx="190" cy="188" rx="174" ry="98" transform="rotate(-12 190 188)"/>
      <ellipse cx="190" cy="188" rx="136" ry="74" transform="rotate(15 190 188)"/>
      <ellipse cx="190" cy="188" rx="92" ry="48" transform="rotate(-27 190 188)"/>
    </g>
    <circle cx="190" cy="188" r="48" fill="${theme.accent}" opacity="0.08"/>
    <circle cx="190" cy="188" r="25" fill="#202720" stroke="#faf9f4" stroke-width="2"/>
    <ellipse cx="190" cy="188" rx="57" ry="11" fill="none" stroke="${theme.accent}" stroke-width="8" stroke-opacity="0.52" transform="rotate(-11 190 188)"/>
    <ellipse cx="190" cy="188" rx="57" ry="11" fill="none" stroke="#faf9f4" stroke-width="2" transform="rotate(-11 190 188)"/>
    ${nodes.join("")}
    <text x="190" y="372" text-anchor="middle" fill="#5a5f65" font-family="Space Grotesk" font-size="9" letter-spacing="1.2">${record.publishedCount} AUTHORED ENTRIES / ONE PUBLISHED FIELD</text>
  </svg>`;
}

function searchField(record) {
  const theme = themeFor(record);
  return `<svg class="field" viewBox="0 0 380 390" aria-hidden="true">
    <g fill="none" stroke="${theme.accent}">
      <path d="M30 316 C72 224 105 112 190 72 C264 38 322 88 350 150" stroke-opacity="0.22"/>
      <path d="M34 348 C86 262 138 184 224 142 C282 114 326 130 350 166" stroke-opacity="0.12"/>
      <circle cx="190" cy="190" r="136" stroke-opacity="0.14"/>
      <circle cx="190" cy="190" r="88" stroke-opacity="0.2"/>
      <circle cx="190" cy="190" r="42" stroke-opacity="0.28"/>
      <path d="M190 16V364M16 190H364" stroke-opacity="0.08"/>
    </g>
    <path d="M74 295 L190 190 L311 102" fill="none" stroke="${theme.signal}" stroke-width="2"/>
    <circle cx="74" cy="295" r="8" fill="#faf9f4" stroke="${theme.accent}" stroke-width="2"/>
    <circle cx="190" cy="190" r="16" fill="#202720" stroke="#faf9f4" stroke-width="3"/>
    <circle cx="311" cy="102" r="11" fill="#faf9f4" stroke="${theme.signal}" stroke-width="3"/>
    <text x="54" y="322" fill="#5a5f65" font-family="Space Grotesk" font-size="9" letter-spacing="1">QUERY</text>
    <text x="284" y="80" fill="#5a5f65" font-family="Space Grotesk" font-size="9" letter-spacing="1">EVIDENCE</text>
    <text x="190" y="372" text-anchor="middle" fill="#5a5f65" font-family="Space Grotesk" font-size="9" letter-spacing="1.2">PUBLIC ROUTES ONLY / PRIVATE DATA EXCLUDED</text>
  </svg>`;
}

function metadataLine(record) {
  if (record.kind === "post") {
    const sequence = String(record.sequence).padStart(2, "0");
    const total = String(record.total).padStart(2, "0");
    return `${formatDate(record.publishedDate)} / ${record.readingTime || "READING TIME RECORDED"} / ${sequence}:${total}`;
  }
  if (record.kind === "logs-index") return `${record.publishedCount} PUBLISHED ENTRIES / 2022 → 2026`;
  return "PUBLISHED ROUTES / PORTFOLIO · PROFILE · WRITING";
}

function footerLine(record) {
  if (record.kind === "post") return record.route;
  if (record.kind === "logs-index") {
    const counts = record.categoryCounts;
    return `${counts.technical || 0} TECHNICAL · ${counts.portfolio || 0} PORTFOLIO · ${counts.reflection || 0} REFLECTION · ${counts.hobby || 0} FIELD NOTES`;
  }
  return "ac-opensource.github.io/search.html";
}

function previewHtml(record, fonts) {
  const theme = themeFor(record);
  const title = escapeHtml(record.title);
  const kicker = theme.label;
  const titleFontSize = record.kind === "logs-index" ? 72 : titleSize(record.title);
  const field = record.kind === "logs-index"
    ? logsField(record)
    : record.kind === "search" ? searchField(record) : orbitField(record);
  const descriptor = record.kind === "logs-index"
    ? "Engineering, AI, privacy, photography, and life—arranged as one authored orbital archive."
    : record.kind === "search"
      ? "Search the public portfolio, résumé evidence, case studies, and writing without crossing the authoring boundary."
      : `${record.category === "portfolio" ? "Engineering case study" : "Published log"} by Andrew Concepcion.`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: "Manrope"; src: url(data:font/woff2;base64,${fonts.manrope}) format("woff2"); font-weight: 300 800; }
    @font-face { font-family: "Space Grotesk"; src: url(data:font/woff2;base64,${fonts.space}) format("woff2"); font-weight: 300 700; }
    * { box-sizing: border-box; }
    html, body { width: 1200px; height: 630px; margin: 0; overflow: hidden; background: #faf9f4; }
    body { color: #2f342d; font-family: "Manrope", sans-serif; }
    .card { --accent: ${theme.accent}; --signal: ${theme.signal}; position: relative; width: 1200px; height: 630px; overflow: hidden; padding: 42px 52px 34px; background:
      linear-gradient(rgba(90,95,101,.045) 1px, transparent 1px),
      linear-gradient(90deg, rgba(90,95,101,.045) 1px, transparent 1px),
      radial-gradient(circle at 82% 43%, color-mix(in srgb, var(--accent) 11%, transparent), transparent 34%),
      #faf9f4; background-size: 48px 48px, 48px 48px, auto, auto; }
    .card::before { position: absolute; inset: 0; border: 1px solid rgba(47,52,45,.08); content: ""; pointer-events: none; }
    .card::after { position: absolute; top: 0; left: 52px; width: 148px; height: 4px; background: var(--accent); content: ""; }
    .topline, .footer { position: relative; z-index: 3; display: flex; align-items: center; justify-content: space-between; color: #5a5f65; font-family: "Space Grotesk"; font-size: 12px; font-weight: 600; letter-spacing: .11em; text-transform: uppercase; }
    .topline strong { color: #2f342d; font-weight: 700; }
    .topline .system { color: var(--accent); }
    .rule { position: absolute; z-index: 1; top: 83px; right: 52px; left: 52px; height: 1px; background: linear-gradient(90deg, rgba(47,52,45,.25), rgba(47,52,45,.05)); }
    main { position: relative; z-index: 2; display: grid; grid-template-columns: minmax(0, 710px) 1fr; gap: 34px; height: 465px; padding-top: 65px; }
    .copy { position: relative; min-width: 0; }
    .kicker { margin-bottom: 24px; color: var(--accent); font-family: "Space Grotesk"; font-size: 13px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
    h1 { max-width: 710px; margin: 0; color: #252b25; font-family: "Space Grotesk"; font-size: ${titleFontSize}px; font-weight: 650; letter-spacing: -.055em; line-height: .96; text-wrap: balance; }
    .descriptor { max-width: 650px; margin: 24px 0 0; color: #5a5f65; font-size: 17px; line-height: 1.55; }
    .metadata { display: flex; gap: 12px; align-items: center; margin-top: 30px; color: #5a5f65; font-family: "Space Grotesk"; font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; }
    .metadata::before { width: 32px; height: 1px; background: var(--signal); content: ""; }
    .visual { position: relative; display: grid; place-items: center; min-width: 0; margin-top: -26px; }
    .visual::before { position: absolute; inset: 22px -28px 0 0; border-left: 1px solid rgba(47,52,45,.12); content: ""; }
    .field { position: relative; z-index: 1; display: block; width: 390px; height: 400px; }
    .footer { position: absolute; z-index: 4; right: 52px; bottom: 34px; left: 52px; padding-top: 17px; border-top: 1px solid rgba(47,52,45,.16); font-size: 10px; }
    .footer .route { max-width: 720px; overflow: hidden; color: #2f342d; text-overflow: ellipsis; white-space: nowrap; }
    .footer .mark { color: var(--accent); }
  </style></head><body><article class="card">
    <header class="topline"><span><strong>Andrew Concepcion</strong> / AI-Native Software Engineer</span><span class="system">[PUBLIC EVIDENCE / ${escapeHtml(record.kind.replace(/-/g, " "))}]</span></header>
    <div class="rule"></div>
    <main>
      <section class="copy">
        <div class="kicker">[${escapeHtml(kicker)}]</div>
        <h1>${title}</h1>
        <p class="descriptor">${escapeHtml(descriptor)}</p>
        <p class="metadata">${escapeHtml(metadataLine(record))}</p>
      </section>
      <aside class="visual">${field}</aside>
    </main>
    <footer class="footer"><span class="route">${escapeHtml(footerLine(record))}</span><span class="mark">AC / ${SOCIAL_PREVIEW_GENERATOR.replace("ac-social-previews-", "")}</span></footer>
  </article></body></html>`;
}

async function renderRecord(page, record, outputRoot, fonts) {
  await page.setContent(previewHtml(record, fonts), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(() => {
    const bounds = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const copy = document.querySelector(".copy");
    return {
      viewport: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      title: bounds("h1"),
      descriptor: bounds(".descriptor"),
      metadata: bounds(".metadata"),
      field: bounds(".field"),
      footer: bounds(".footer"),
      copyOverflow: copy ? copy.scrollWidth - copy.clientWidth : Infinity
    };
  });
  const textBlocks = [layout.title, layout.descriptor, layout.metadata];
  if (
    layout.viewport.width !== SOCIAL_PREVIEW_WIDTH ||
    layout.viewport.height !== SOCIAL_PREVIEW_HEIGHT ||
    textBlocks.some((rect) => !rect || rect.left < 0 || rect.right > SOCIAL_PREVIEW_WIDTH || rect.top < 0) ||
    !layout.field || layout.field.right > SOCIAL_PREVIEW_WIDTH || layout.field.bottom > SOCIAL_PREVIEW_HEIGHT ||
    !layout.footer || textBlocks.some((rect) => rect.bottom >= layout.footer.top - 8) ||
    layout.copyOverflow > 1
  ) {
    throw new Error(`${record.path}: social-preview layout overflowed its 1200x630 canvas: ${JSON.stringify(layout)}`);
  }
  const screenshot = await page.screenshot({
    type: "png",
    clip: { x: 0, y: 0, width: SOCIAL_PREVIEW_WIDTH, height: SOCIAL_PREVIEW_HEIGHT },
    animations: "disabled"
  });
  const payload = embedSocialMetadata(screenshot, record);
  const outputPath = path.join(outputRoot, record.path.replace(/^\//, ""));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, payload);
}

function pruneGeneratedPostPreviews(outputRoot, expectedPaths) {
  const directory = path.join(outputRoot, SOCIAL_PREVIEW_POST_DIRECTORY);
  if (!fs.existsSync(directory)) return [];
  const expected = new Set(expectedPaths.map((value) => path.resolve(outputRoot, value.replace(/^\//, ""))));
  const removed = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".png")) continue;
    const filePath = path.join(directory, entry.name);
    if (expected.has(path.resolve(filePath))) continue;
    try {
      if (socialMetadataFromPng(fs.readFileSync(filePath)).generator !== SOCIAL_PREVIEW_GENERATOR) continue;
    } catch (_error) {
      continue;
    }
    fs.unlinkSync(filePath);
    removed.push(filePath);
  }
  return removed;
}

async function generateSocialPreviews({ dbPath, outputRoot = ROOT_DIR } = {}) {
  const resolvedOutputRoot = path.resolve(outputRoot);
  const posts = publishedPosts(dbPath);
  const manifest = buildSocialPreviewManifest(posts);
  const fonts = {
    manrope: fontData(ROOT_DIR, "manrope-latin-variable.woff2"),
    space: fontData(ROOT_DIR, "space-grotesk-latin-variable.woff2")
  };
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: SOCIAL_PREVIEW_WIDTH, height: SOCIAL_PREVIEW_HEIGHT },
      deviceScaleFactor: 1,
      reducedMotion: "reduce"
    });
    const page = await context.newPage();
    await renderRecord(page, manifest.logs, resolvedOutputRoot, fonts);
    await renderRecord(page, manifest.search, resolvedOutputRoot, fonts);
    for (const record of manifest.posts) await renderRecord(page, record, resolvedOutputRoot, fonts);
    await context.close();
  } finally {
    await browser.close();
  }

  const manifestPath = path.join(resolvedOutputRoot, SOCIAL_PREVIEW_MANIFEST_PATH);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const removed = pruneGeneratedPostPreviews(resolvedOutputRoot, manifest.posts.map((record) => record.path));
  assertSocialPreviewSet({ rootDir: resolvedOutputRoot, posts });
  return { manifest, removed };
}

async function main() {
  const outputRoot = getArgValue("output-root") || ROOT_DIR;
  const dbPath = getArgValue("db");
  if (process.argv.includes("--check")) {
    const posts = publishedPosts(dbPath);
    const manifest = assertSocialPreviewSet({ rootDir: path.resolve(outputRoot), posts });
    console.log(`Verified ${manifest.posts.length} post previews plus Logs and Search.`);
    return;
  }
  const result = await generateSocialPreviews({ dbPath, outputRoot });
  console.log(`Generated ${result.manifest.posts.length} post previews plus Logs and Search${
    result.removed.length ? `; pruned ${result.removed.length} stale generated preview(s)` : ""
  }.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  CATEGORY_THEME,
  embedSocialMetadata,
  formatDate,
  generateSocialPreviews,
  orbitField,
  previewHtml,
  publishedPosts,
  socialMetadata
};
