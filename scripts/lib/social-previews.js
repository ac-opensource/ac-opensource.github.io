const fs = require("fs");
const path = require("path");

const SOCIAL_PREVIEW_WIDTH = 1200;
const SOCIAL_PREVIEW_HEIGHT = 630;
const SOCIAL_PREVIEW_GENERATOR = "ac-social-previews-v1";
const SOCIAL_PREVIEW_BRAND = "Andrew Concepcion · AI-Native Software Engineer";
const SOCIAL_PREVIEW_METADATA_KEY = "ac.social-preview";
const SOCIAL_PREVIEW_MANIFEST_PATH = "assets/images/og/social-preview-manifest.json";
const SOCIAL_PREVIEW_POST_DIRECTORY = "assets/images/og/posts";
const LOGS_SOCIAL_PREVIEW_PATH = "/assets/images/og/logs-spiral-galaxy.png";
const SEARCH_SOCIAL_PREVIEW_PATH = "/assets/images/og/search-evidence-field.png";

function normalizeSlug(value) {
  const slug = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`Invalid published social-preview slug: ${slug || "(empty)"}`);
  }
  return slug;
}

function normalizeCategory(value) {
  const category = String(value || "log").trim().toLowerCase() || "log";
  return category === "work" ? "portfolio" : category;
}

function postSocialPreviewPath(post) {
  return `/${SOCIAL_PREVIEW_POST_DIRECTORY}/${normalizeSlug(post?.slug)}.png`;
}

function postSocialPreviewAlt(post) {
  const title = String(post?.title || "Untitled").trim() || "Untitled";
  const category = normalizeCategory(post?.category);
  return `${title} — ${category} social preview by Andrew Concepcion`;
}

function logsSocialPreviewAlt(posts) {
  const count = Array.isArray(posts) ? posts.length : 0;
  return `Andrew Concepcion's Logs: ${count} published ${count === 1 ? "entry" : "entries"} arranged as an authored orbital field`;
}

function searchSocialPreviewAlt() {
  return "Andrew Concepcion's public Evidence Search plotting a route from query to published engineering work";
}

function socialRecordForPost(post, index, total) {
  const slug = normalizeSlug(post?.slug);
  const title = String(post?.title || "").trim();
  if (!title) throw new Error(`${slug}: social preview requires a canonical title.`);
  return {
    kind: "post",
    slug,
    route: `/blog/${slug}.html`,
    path: postSocialPreviewPath(post),
    title,
    category: normalizeCategory(post?.category),
    publishedDate: String(post?.published_date || "").trim(),
    readingTime: String(post?.reading_time || "").trim(),
    topics: [...new Set((post?.topics || []).map((topic) => String(topic).trim()).filter(Boolean))].slice(0, 4),
    sequence: index + 1,
    total
  };
}

function categoryCounts(posts) {
  const counts = {};
  for (const post of posts) {
    const category = normalizeCategory(post?.category);
    counts[category] = (counts[category] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function logsSocialRecord(posts) {
  return {
    kind: "logs-index",
    route: "/blog/",
    path: LOGS_SOCIAL_PREVIEW_PATH,
    title: "Ideas with their own gravity.",
    category: "logs",
    publishedCount: posts.length,
    categoryCounts: categoryCounts(posts)
  };
}

function searchSocialRecord() {
  return {
    kind: "search",
    route: "/search.html",
    path: SEARCH_SOCIAL_PREVIEW_PATH,
    title: "Plot a route through the work.",
    category: "public evidence"
  };
}

function buildSocialPreviewManifest(posts) {
  const records = posts.map((post, index) => socialRecordForPost(post, index, posts.length));
  return {
    generator: SOCIAL_PREVIEW_GENERATOR,
    dimensions: {
      width: SOCIAL_PREVIEW_WIDTH,
      height: SOCIAL_PREVIEW_HEIGHT
    },
    brand: SOCIAL_PREVIEW_BRAND,
    logs: logsSocialRecord(posts),
    search: searchSocialRecord(),
    posts: records
  };
}

function pngDimensions(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error("Social preview is not a valid PNG payload.");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function pngChunks(buffer) {
  pngDimensions(buffer);
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new Error("Social preview contains a truncated PNG chunk.");
    chunks.push({
      type: buffer.toString("ascii", offset + 4, offset + 8),
      data: buffer.subarray(offset + 8, offset + 8 + length),
      start: offset,
      end
    });
    offset = end;
  }
  return chunks;
}

function readPngInternationalText(buffer, keyword) {
  for (const chunk of pngChunks(buffer)) {
    if (chunk.type !== "iTXt") continue;
    const firstNull = chunk.data.indexOf(0);
    if (firstNull < 0 || chunk.data.toString("latin1", 0, firstNull) !== keyword) continue;
    let cursor = firstNull + 3;
    const languageEnd = chunk.data.indexOf(0, cursor);
    if (languageEnd < 0) continue;
    cursor = languageEnd + 1;
    const translatedEnd = chunk.data.indexOf(0, cursor);
    if (translatedEnd < 0) continue;
    return chunk.data.toString("utf8", translatedEnd + 1);
  }
  return "";
}

function socialMetadataFromPng(buffer) {
  const raw = readPngInternationalText(buffer, SOCIAL_PREVIEW_METADATA_KEY);
  if (!raw) throw new Error(`PNG is missing ${SOCIAL_PREVIEW_METADATA_KEY} metadata.`);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`PNG has invalid ${SOCIAL_PREVIEW_METADATA_KEY} metadata: ${error.message}`);
  }
}

function assertSocialPreviewFile(filePath, expectedRecord) {
  if (!fs.existsSync(filePath)) throw new Error(`Social preview is missing: ${filePath}`);
  const payload = fs.readFileSync(filePath);
  const dimensions = pngDimensions(payload);
  if (dimensions.width !== SOCIAL_PREVIEW_WIDTH || dimensions.height !== SOCIAL_PREVIEW_HEIGHT) {
    throw new Error(`${filePath}: social preview must be ${SOCIAL_PREVIEW_WIDTH}x${SOCIAL_PREVIEW_HEIGHT}.`);
  }
  const metadata = socialMetadataFromPng(payload);
  const expected = {
    generator: SOCIAL_PREVIEW_GENERATOR,
    brand: SOCIAL_PREVIEW_BRAND,
    width: SOCIAL_PREVIEW_WIDTH,
    height: SOCIAL_PREVIEW_HEIGHT,
    record: expectedRecord
  };
  if (JSON.stringify(metadata) !== JSON.stringify(expected)) {
    throw new Error(`${filePath}: embedded social-preview metadata is stale.`);
  }
  return metadata;
}

function assertSocialPreviewSet({ rootDir, posts }) {
  const manifest = buildSocialPreviewManifest(posts);
  const manifestPath = path.join(rootDir, SOCIAL_PREVIEW_MANIFEST_PATH);
  if (!fs.existsSync(manifestPath)) throw new Error(`Social preview manifest is missing: ${manifestPath}`);
  const actualManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (JSON.stringify(actualManifest) !== JSON.stringify(manifest)) {
    throw new Error("Social preview manifest does not match the published post source of truth.");
  }

  assertSocialPreviewFile(path.join(rootDir, manifest.logs.path.replace(/^\//, "")), manifest.logs);
  assertSocialPreviewFile(path.join(rootDir, manifest.search.path.replace(/^\//, "")), manifest.search);
  for (const record of manifest.posts) {
    assertSocialPreviewFile(path.join(rootDir, record.path.replace(/^\//, "")), record);
  }
  return manifest;
}

module.exports = {
  LOGS_SOCIAL_PREVIEW_PATH,
  SEARCH_SOCIAL_PREVIEW_PATH,
  SOCIAL_PREVIEW_BRAND,
  SOCIAL_PREVIEW_GENERATOR,
  SOCIAL_PREVIEW_HEIGHT,
  SOCIAL_PREVIEW_MANIFEST_PATH,
  SOCIAL_PREVIEW_METADATA_KEY,
  SOCIAL_PREVIEW_POST_DIRECTORY,
  SOCIAL_PREVIEW_WIDTH,
  assertSocialPreviewFile,
  assertSocialPreviewSet,
  buildSocialPreviewManifest,
  logsSocialPreviewAlt,
  logsSocialRecord,
  pngChunks,
  pngDimensions,
  postSocialPreviewAlt,
  postSocialPreviewPath,
  readPngInternationalText,
  searchSocialPreviewAlt,
  searchSocialRecord,
  socialMetadataFromPng,
  socialRecordForPost
};
