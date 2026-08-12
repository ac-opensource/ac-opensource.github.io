const fs = require("fs");
const path = require("path");

const SHARED_SEARCH_MARKER = "data-shared-site-search";
const SEARCH_INDEX_VERSION = 1;
const RADAR_LIST_START = "<!-- current-work:list:start -->";
const RADAR_LIST_END = "<!-- current-work:list:end -->";
const RADAR_UPDATED_START = "<!-- current-work:updated:start -->";
const RADAR_UPDATED_END = "<!-- current-work:updated:end -->";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeHtml(value) {
  const named = Object.freeze({
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    laquo: "«",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    mdash: "—",
    nbsp: " ",
    ndash: "–",
    quot: '"',
    raquo: "»",
    rdquo: "”",
    rsquo: "’"
  });
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, code) => {
    if (code[0] !== "#") return Object.hasOwn(named, code.toLowerCase()) ? named[code.toLowerCase()] : " ";
    const radix = code[1]?.toLowerCase() === "x" ? 16 : 10;
    const digits = radix === 16 ? code.slice(2) : code.slice(1);
    const point = Number.parseInt(digits, radix);
    if (!Number.isFinite(point) || point < 0 || point > 0x10ffff) return " ";
    try {
      return String.fromCodePoint(point);
    } catch (_error) {
      return " ";
    }
  });
}

function textFromHtml(html) {
  return decodeHtml(
    String(html || "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(?:script|style|svg|template|noscript|nav|form)\b[^>]*>[\s\S]*?<\/(?:script|style|svg|template|noscript|nav|form)>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/p\s*>/gi, " ")
      .replace(/<\/li\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function attributeFromTag(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(tag || "").match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? (match[1] ?? match[2] ?? "") : "";
}

function metaContent(html, attribute, value) {
  return (String(html).match(/<meta\b[^>]*>/gi) || [])
    .filter((tag) => attributeFromTag(tag, attribute).toLowerCase() === value.toLowerCase())
    .map((tag) => attributeFromTag(tag, "content"))
    .find(Boolean) || "";
}

function routeForHtml(relativePath) {
  if (relativePath === "index.html") return "/";
  if (relativePath.endsWith("/index.html")) return `/${relativePath.slice(0, -"index.html".length)}`;
  return `/${relativePath}`;
}

function pageKind(relativePath) {
  if (relativePath === "work.html") return "Portfolio";
  if (["about.html", "resume.html", "skills-graph.html"].includes(relativePath)) return "Profile evidence";
  if (relativePath.startsWith("blog/case-study-")) return "Case study";
  if (relativePath.startsWith("blog/") && relativePath !== "blog/index.html") return "Writing";
  if (relativePath === "blog/index.html") return "Writing archive";
  return "Page";
}

function mainHtml(html) {
  return String(html).match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    || String(html).match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    || String(html);
}

function stripSearchExcluded(html) {
  return String(html || "").replace(
    /<([a-z][\w:-]*)\b(?=[^>]*\bdata-search-exclude\b)[^>]*>[\s\S]*?<\/\1\s*>/gi,
    " "
  );
}

function extractSearchDocument(html, relativePath) {
  const searchableHtml = stripSearchExcluded(html);
  const main = mainHtml(searchableHtml);
  const headings = [...main.matchAll(/<h([1-3])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)];
  const documentTitle = textFromHtml(headings.find((match) => match[1] === "1")?.[3])
    || textFromHtml(searchableHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1])
    || routeForHtml(relativePath);
  const description = decodeHtml(
    metaContent(searchableHtml, "name", "description") || metaContent(searchableHtml, "property", "og:description")
  ).replace(/\s+/g, " ").trim();
  const publishedDate = metaContent(searchableHtml, "property", "article:published_time")
    || attributeFromTag(searchableHtml.match(/<time\b[^>]*\bdatetime\s*=\s*["'][^"']+["'][^>]*>/i)?.[0], "datetime");
  const sections = [];

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const title = textFromHtml(heading[3]);
    const id = attributeFromTag(heading[2], "id");
    const start = (heading.index || 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? main.length;
    const body = textFromHtml(main.slice(start, end));
    const text = `${title} ${body}`.replace(/\s+/g, " ").trim();
    if (!title || text.length < 12) continue;
    sections.push({
      id: /^[A-Za-z][\w:.-]*$/.test(id) ? id : "",
      title,
      text
    });
  }

  if (!sections.length) {
    sections.push({ id: "", title: documentTitle, text: textFromHtml(main) });
  }

  return {
    url: routeForHtml(relativePath),
    title: documentTitle,
    description,
    type: pageKind(relativePath),
    date: /^\d{4}-\d{2}-\d{2}/.test(publishedDate) ? publishedDate.slice(0, 10) : "",
    sections
  };
}

function safeSearchPath(stagingRoot, relativePath) {
  const normalized = String(relativePath || "").split(path.sep).join("/").replace(/^\/+/, "");
  if (!normalized.endsWith(".html") || normalized.includes("..") || path.posix.normalize(normalized) !== normalized) {
    throw new Error(`Search indexing received an unsafe or non-HTML path: ${relativePath}`);
  }
  const absolutePath = path.resolve(stagingRoot, normalized);
  const relative = path.relative(path.resolve(stagingRoot), absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Search indexing path escaped the publication staging root: ${relativePath}`);
  }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Search indexing expected a published page: ${relativePath}`);
  }
  return { absolutePath, normalized };
}

function buildPublishedSearchIndex({ stagingRoot, htmlFiles, outputPath } = {}) {
  if (!stagingRoot || !Array.isArray(htmlFiles) || !outputPath) {
    throw new Error("Search indexing requires stagingRoot, an explicit htmlFiles allowlist, and outputPath.");
  }
  const uniqueFiles = [...new Set(htmlFiles)].sort((a, b) => a.localeCompare(b));
  const documents = uniqueFiles.map((relativePath) => {
    const { absolutePath, normalized } = safeSearchPath(stagingRoot, relativePath);
    return extractSearchDocument(fs.readFileSync(absolutePath, "utf8"), normalized);
  });
  const payload = { version: SEARCH_INDEX_VERSION, documents };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

function parseCurrentWork(data) {
  if (!data || data.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(data.updated) || !Array.isArray(data.items)) {
    throw new Error("Current-work metadata must be version 1 with an ISO updated date and an items array.");
  }
  if (data.items.length !== 3) {
    throw new Error("The orbital current-work radar requires exactly three curated items.");
  }
  const seen = new Set();
  return {
    updated: data.updated,
    items: data.items.map((item, index) => {
      for (const field of ["date", "label", "title", "description", "href"]) {
        if (!String(item?.[field] || "").trim()) throw new Error(`Current-work item ${index + 1} is missing ${field}.`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) throw new Error(`Current-work item ${index + 1} has an invalid date.`);
      if (!/^\/(?!\/)[^\s]*$/.test(item.href)) throw new Error(`Current-work item ${index + 1} must use a root-relative public link.`);
      if (seen.has(item.href)) throw new Error(`Current-work metadata contains a duplicate link: ${item.href}`);
      seen.add(item.href);
      return {
        date: item.date,
        label: String(item.label).trim(),
        title: String(item.title).trim(),
        description: String(item.description).trim(),
        href: item.href
      };
    })
  };
}

function formatPublicDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${months[Number(month) - 1]} ${Number(day)} ${year}`;
}

function replaceMarkedContent(html, startMarker, endMarker, content, label) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start < 0 || end < 0 || end < start || html.indexOf(startMarker, start + startMarker.length) >= 0) {
    throw new Error(`Homepage is missing one deterministic ${label} marker pair.`);
  }
  return `${html.slice(0, start + startMarker.length)}\n${content}\n${html.slice(end)}`;
}

function renderCurrentWorkRadar(html, rawData) {
  const data = parseCurrentWork(rawData);
  const positions = [
    "--sx:3%;--sy:11%",
    "--sx:71%;--sy:8%",
    "--sx:77%;--sy:70%"
  ];
  const cards = data.items.map((item, index) => [
    `          <a style="${positions[index]}" href="${escapeHtml(item.href)}">`,
    `            <small><time datetime="${item.date}">${formatPublicDate(item.date)}</time> · ${escapeHtml(item.label)}</small>`,
    `            <strong>${escapeHtml(item.title)}</strong>`,
    `            <em>${escapeHtml(item.description)}</em>`,
    "          </a>"
  ].join("\n")).join("\n");
  const updated = `<time datetime="${data.updated}">${formatPublicDate(data.updated)}</time> · CHECKED-IN PUBLIC SIGNALS`;
  return replaceMarkedContent(
    replaceMarkedContent(html, RADAR_LIST_START, RADAR_LIST_END, cards, "current-work list"),
    RADAR_UPDATED_START,
    RADAR_UPDATED_END,
    updated,
    "current-work updated"
  );
}

function injectSharedSiteTools(html, relativePath) {
  if (!String(html).includes("<head>") || !String(html).includes("</body>")) {
    throw new Error(`Cannot add shared discovery controls to ${relativePath}: missing <head> or </body>.`);
  }
  const headAssets = [
    `<link href="/assets/css/site-search.css?v=20260812-2" rel="stylesheet" ${SHARED_SEARCH_MARKER}>`,
    `<script src="/assets/js/site-search.js?v=20260812-2" defer ${SHARED_SEARCH_MARKER}></script>`
  ].join("\n");
  return String(html).includes('/assets/css/site-search.css')
    ? html
    : String(html).replace("<head>", `<head>\n${headAssets}`);
}

module.exports = {
  RADAR_LIST_END,
  RADAR_LIST_START,
  RADAR_UPDATED_END,
  RADAR_UPDATED_START,
  SEARCH_INDEX_VERSION,
  buildPublishedSearchIndex,
  extractSearchDocument,
  injectSharedSiteTools,
  parseCurrentWork,
  renderCurrentWorkRadar,
  textFromHtml
};
