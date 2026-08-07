const fs = require("fs");
const path = require("path");
const SignalsContract = require("../assets/js/signals-contract");
const ContactTransport = require("../assets/js/contact-transport");

const SITE_LOCATION = Object.freeze({
  origin: "https://ac-opensource.github.io",
  protocol: "https:",
  hostname: "ac-opensource.github.io",
  host: "ac-opensource.github.io"
});

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error("Could not read " + label + ": " + error.message);
  }
}

function jsonForInlineScript(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function replaceScriptJson(html, id, value) {
  const pattern = new RegExp('(<script\\b[^>]*\\bid="' + id + '"[^>]*>)[\\s\\S]*?(<\\/script>)', "i");
  if (!pattern.test(html)) throw new Error("Missing inline JSON marker: " + id);
  const json = jsonForInlineScript(value);
  return html.replace(pattern, function (_match, opening, closing) {
    return opening + json + closing;
  });
}

function replaceMarkerRegion(html, name, rendered) {
  const start = "<!-- " + name + "_START -->";
  const end = "<!-- " + name + "_END -->";
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error("Missing or invalid render markers for " + name + ".");
  }
  if (html.indexOf(start, startIndex + start.length) >= 0 || html.indexOf(end, endIndex + end.length) >= 0) {
    throw new Error("Duplicate render markers for " + name + ".");
  }
  return html.slice(0, startIndex + start.length) + "\n" + rendered + "\n        " + html.slice(endIndex);
}

function renderApproved(record) {
  const escape = SignalsContract.escapeHtml;
  const target = SignalsContract.targetFor(record.target);
  return [
    '        <li class="signal-record" id="record-' + escape(record.id) + '" data-signal-record data-signal-id="' + escape(record.id) + '" data-status="approved" data-slot="' + String(record.slot) + '">',
    "          <article>",
    '            <header><code>' + escape(record.id) + '</code><span>[approved]</span><span>slot ' + String(record.slot).padStart(2, "0") + "</span></header>",
    "            <h3>" + escape(record.display.label) + "</h3>",
    "            <blockquote>" + escape(record.quote) + "</blockquote>",
    "            <dl>",
    "              <div><dt>Local target</dt><dd>" + escape(target.label) + "</dd></div>",
    '              <div><dt>Created</dt><dd><time datetime="' + escape(record.createdAt) + '">' + escape(record.createdAt) + "</time></dd></div>",
    '              <div><dt>Approved</dt><dd><time datetime="' + escape(record.approvedAt) + '">' + escape(record.approvedAt) + "</time></dd></div>",
    "            </dl>",
    '            <footer><a href="' + escape(target.path) + '">Open ' + escape(target.label) + '</a><button type="button" data-select-signal="' + escape(record.id) + '" aria-expanded="false" aria-controls="signal-detail">Read record</button></footer>',
    "          </article>",
    "        </li>"
  ].join("\n");
}

function renderRemoved(record) {
  const escape = SignalsContract.escapeHtml;
  return [
    '        <li class="signal-record signal-record--removed" id="record-' + escape(record.id) + '" data-signal-record data-signal-id="' + escape(record.id) + '" data-status="removed" data-slot="' + String(record.slot) + '">',
    "          <article>",
    '            <header><code>' + escape(record.id) + '</code><span>[removed]</span><span>slot ' + String(record.slot).padStart(2, "0") + "</span></header>",
    "            <h3>Removed signal tombstone</h3>",
    "            <p>The quote, attribution, target, and dates are no longer present in the public feed.</p>",
    '            <footer><button type="button" data-select-signal="' + escape(record.id) + '" aria-expanded="false" aria-controls="signal-detail">Read tombstone</button></footer>',
    "          </article>",
    "        </li>"
  ].join("\n");
}

function renderRegistry(feed) {
  if (!feed.records.length) {
    return [
      '        <li class="signals-empty-record" data-feed-empty>',
      "          <strong>No public Signals yet.</strong>",
      "          <span>The default feed is intentionally empty. Nothing pending, rejected, private, or unmoderated is displayed.</span>",
      "        </li>"
    ].join("\n");
  }
  return feed.records.map(function (record) {
    return record.status === "approved" ? renderApproved(record) : renderRemoved(record);
  }).join("\n");
}

function slotGeometry(slot) {
  const angle = ((slot * 137.508 + 17) % 360) - 180;
  const track = slot % 8;
  const radiusX = 17.5 + track * 3.65;
  const radiusY = 13.5 + track * 2.95;
  const radians = angle * Math.PI / 180;
  return Object.freeze({
    angle: Number(angle.toFixed(3)),
    track: track + 1,
    x: Number((50 + Math.cos(radians) * radiusX).toFixed(3)),
    y: Number((50 + Math.sin(radians) * radiusY).toFixed(3))
  });
}

function renderSlotMarker(record) {
  const escape = SignalsContract.escapeHtml;
  const geometry = slotGeometry(record.slot);
  const slotLabel = String(record.slot).padStart(3, "0");
  const approved = record.status === "approved";
  const target = approved ? SignalsContract.targetFor(record.target) : null;
  const className = "signal-slot-marker signal-slot-marker--" + record.status + (approved ? " signal-satellite" : "");
  const label = approved
    ? "Open approved public signal " + record.id + " in slot " + slotLabel + " for " + target.label
    : "Open removed public signal tombstone " + record.id + " in slot " + slotLabel;
  return [
    '        <a class="' + className + '" href="#record-' + escape(record.id) + '"',
    '          style="--slot-x:' + geometry.x + '%;--slot-y:' + geometry.y + '%;--slot-angle:' + geometry.angle + 'deg"',
    '          data-slot-marker' + (approved ? " data-satellite" : "") + ' data-signal-id="' + escape(record.id) + '" data-status="' + record.status + '" data-slot="' + String(record.slot) + '"',
    '          aria-label="' + escape(label) + '"><span>slot</span><b>' + slotLabel + "</b></a>"
  ].join("\n");
}

function renderOrbit(feed) {
  return feed.records.map(renderSlotMarker).join("\n");
}

function replaceTextCount(html, attribute, count) {
  const pattern = new RegExp('(<([a-z][a-z0-9]*)\\b[^>]*\\b' + attribute + '[^>]*>)[^<]*(<\\/\\2>)', "i");
  if (!pattern.test(html)) throw new Error("Missing rendered count marker: " + attribute);
  return html.replace(pattern, "$1" + String(count) + "$3");
}

function toggleHiddenAttribute(html, attribute, hidden) {
  const pattern = new RegExp('<[a-z]+\\b[^>]*\\b' + attribute + '\\b[^>]*>', "i");
  if (!pattern.test(html)) throw new Error("Missing hidden-state marker: " + attribute);
  return html.replace(pattern, function (tag) {
    const normalized = tag.replace(/\s+hidden(?=\s|>)/gi, "");
    return hidden ? normalized.slice(0, -1) + " hidden>" : normalized;
  });
}

function renderSignalsHtml(html, rawFeed) {
  const feed = SignalsContract.validateFeed(rawFeed);
  const approved = feed.records.filter(function (record) { return record.status === "approved"; });
  const removed = feed.records.filter(function (record) { return record.status === "removed"; });
  let rendered = replaceMarkerRegion(html, "SIGNALS_REGISTRY", renderRegistry(feed));
  rendered = replaceMarkerRegion(rendered, "SIGNALS_ORBIT", renderOrbit(feed));
  rendered = replaceScriptJson(rendered, "signals-feed", feed);
  rendered = replaceTextCount(rendered, "data-registry-total", feed.records.length);
  rendered = replaceTextCount(rendered, "data-approved-total", approved.length);
  rendered = replaceTextCount(rendered, "data-removed-total", removed.length);
  rendered = replaceTextCount(rendered, "data-field-total", feed.records.length);
  rendered = replaceTextCount(rendered, "data-field-visible", feed.records.length);
  rendered = replaceTextCount(rendered, "data-visible-total", feed.records.length);
  rendered = rendered.replace(
    /<p class="signals-js-status" data-js-status role="status">[\s\S]*?<\/p>/,
    '<p class="signals-js-status" data-js-status role="status">' +
      (feed.records.length
        ? "Validated public feed loaded. Use search, filters, or record controls to explore it."
        : "The public feed currently contains no approved or removed records.") +
      "</p>"
  );
  rendered = toggleHiddenAttribute(rendered, "data-signal-filters", feed.records.length === 0);
  rendered = toggleHiddenAttribute(rendered, "data-results-summary", feed.records.length === 0);
  rendered = toggleHiddenAttribute(rendered, "data-orbit-empty", feed.records.length !== 0);
  rendered = rendered.replace(
    /<meta name="robots" content="[^"]+">/,
    '<meta name="robots" content="' + (approved.length ? "index,follow" : "noindex,follow") + '">'
  );
  return rendered;
}

function injectRuntimeHtml(html, rawConfig) {
  const config = ContactTransport.validateRuntimeConfig(rawConfig, SITE_LOCATION);
  return replaceScriptJson(html, "contact-runtime-config", config);
}

function injectContactRuntimeHtml(html, rawConfig) {
  const config = ContactTransport.validateRuntimeConfig(rawConfig, SITE_LOCATION);
  let rendered = replaceScriptJson(html, "contact-runtime-config", config);
  const configured = config.enabled && config.transport === "apps_script_iframe";
  rendered = rendered.replace(
    /(<p\b[^>]*\bdata-noscript-contact\b[^>]*>)[\s\S]*?(<\/p>)/i,
    "$1" + (configured
      ? "JavaScript is required for verified record storage. Use LinkedIn below if scripting is unavailable; this form does not submit or open an email client."
      : "The personal record endpoint is not connected in this build. Use LinkedIn below; this form does not open an email client or claim a stored message.") + "$2"
  );
  return rendered;
}

function renderPublication(options) {
  const signalsPath = path.join(options.stagingRoot, "signals.html");
  const contactPath = path.join(options.stagingRoot, "contact.html");
  const feedPath = path.join(options.stagingRoot, "assets", "data", "signals.json");
  const runtimePath = path.join(options.stagingRoot, "assets", "data", "contact-runtime.json");
  const feed = SignalsContract.validateFeed(readJson(feedPath, "public Signals feed"));
  const runtime = readJson(runtimePath, "Contact runtime config");
  const signalsHtml = injectRuntimeHtml(
    renderSignalsHtml(fs.readFileSync(signalsPath, "utf8"), feed),
    runtime
  );
  const contactHtml = injectContactRuntimeHtml(fs.readFileSync(contactPath, "utf8"), runtime);
  fs.writeFileSync(signalsPath, signalsHtml, "utf8");
  fs.writeFileSync(contactPath, contactHtml, "utf8");
  return {
    feed,
    runtime,
    approvedCount: feed.records.filter(function (record) { return record.status === "approved"; }).length
  };
}

function syncSignalsSitemap(stagingRoot, publicationResult) {
  if (!publicationResult.approvedCount) return false;
  const approvedDates = publicationResult.feed.records
    .filter(function (record) { return record.status === "approved"; })
    .map(function (record) { return record.approvedAt; })
    .sort();
  const lastmod = approvedDates[approvedDates.length - 1];
  const sitemapPath = path.join(stagingRoot, "sitemap.xml");
  let sitemap = fs.readFileSync(sitemapPath, "utf8");
  const location = "https://ac-opensource.github.io/signals.html";
  if (sitemap.includes("<loc>" + location + "</loc>")) {
    throw new Error("Signals sitemap entry already exists before publication synchronization.");
  }
  const entry = [
    "  <url>",
    "    <loc>" + location + "</loc>",
    "    <lastmod>" + lastmod + "</lastmod>",
    "  </url>"
  ].join("\n");
  if (!sitemap.includes("</urlset>")) throw new Error("Cannot synchronize Signals URL: sitemap root is missing.");
  sitemap = sitemap.replace("</urlset>", entry + "\n</urlset>");
  fs.writeFileSync(sitemapPath, sitemap, "utf8");
  return true;
}

module.exports = {
  SITE_LOCATION,
  injectContactRuntimeHtml,
  injectRuntimeHtml,
  jsonForInlineScript,
  renderPublication,
  renderRegistry,
  renderSignalsHtml,
  slotGeometry,
  syncSignalsSitemap
};
