const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { openDatabase } = require("./lib/blog-db");

const ROOT = path.join(__dirname, "..");
const ORBITAL_POST = "2026-08-06-how-i-rebuilt-my-homepage-as-an-interactive-orbital-system";

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function openingTags(html) {
  return String(html).match(/<[a-z][^>]*>/gi) || [];
}

function tagName(tag) {
  return tag.match(/^<([a-z][\w-]*)/i)?.[1]?.toLowerCase() || "";
}

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.match(new RegExp(`\\b${escaped}=(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find((value) => value !== undefined) ?? null;
}

function hasAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\s${escaped}(?:\\s|=|/?>)`, "i").test(tag);
}

function tagsWithClass(html, className) {
  return openingTags(html).filter((tag) => (attribute(tag, "class") || "").split(/\s+/).includes(className));
}

function assertLabelledGroup(html, className, label, expectedCount = 1) {
  const tags = tagsWithClass(html, className).filter((tag) => attribute(tag, "aria-label") === label);
  assert.strictEqual(tags.length, expectedCount, `${className} must expose ${expectedCount} labelled group wrapper(s).`);
  tags.forEach((tag) => {
    assert.strictEqual(attribute(tag, "role"), "group", `${className} must use role=group when it carries aria-label.`);
  });
}

function assertRoleWrapper(html, dataAttribute, value, expectedTag, role) {
  const tags = openingTags(html).filter((tag) => attribute(tag, dataAttribute) === value);
  assert.strictEqual(tags.length, 1, `${dataAttribute}=${value} must identify exactly one wrapper.`);
  assert.strictEqual(tagName(tags[0]), expectedTag, `${dataAttribute}=${value} must use a ${expectedTag} element.`);
  assert.strictEqual(attribute(tags[0], "role"), role, `${dataAttribute}=${value} must use role=${role}.`);
}

function verifyStaticSemantics() {
  const index = read("index.html");
  const work = read("work.html");
  const about = read("about.html");
  const contact = read("contact.html");
  const search = read("search.html");
  const signals = read("signals.html");
  const briefing = read("assets/js/work-briefing.js");
  const aboutController = read("assets/js/about-spectrograph.js");
  const aboutStyles = read("assets/css/about-spectrograph.css");
  const homeStyles = read("assets/css/orbital-option-8.css");
  const contactStyles = read("assets/css/contact-payload-integration.css");

  assertLabelledGroup(index, "scene-controls", "Orbital field controls");
  const focusSatelliteGroups = tagsWithClass(index, "focus-satellites");
  assert.strictEqual(focusSatelliteGroups.length, 6, "Home must retain six focus-satellite groups.");
  focusSatelliteGroups.forEach((group) => {
    assert.strictEqual(attribute(group, "role"), "group", "Visible focus satellites must support their accessible label with role=group.");
    assert(attribute(group, "aria-label"), "Each focus-satellite group must retain a meaningful accessible label.");
  });
  assertLabelledGroup(work, "work-case__meta", "Bitcoin.com Wallet capabilities");
  assertLabelledGroup(work, "work-case__meta", "ITVX capabilities");
  assertLabelledGroup(about, "stellar-tree__toolbar", "Nebula profile controls");
  assertLabelledGroup(search, "evidence-search__suggestions", "Known evidence routes");
  assertLabelledGroup(signals, "signals-orbit__field", "Public Signals slot field");
  assertLabelledGroup(signals, "signals-orbit__readout", "Slot field readout");

  assert(aboutController.includes('meta.tabIndex = 0'), "Scrollable About metadata must be keyboard focusable.");
  assert(aboutController.includes('meta.setAttribute("aria-label", "Selected signal metadata. Scroll horizontally for every value.")'),
    "Scrollable About metadata must explain its horizontal content.");
  assert(!/\.stellar-focus-active \.is-stellar-muted\s*\{[^}]*opacity:\s*0?\.[0-9]/s.test(aboutStyles),
    "The selected About evidence lens must not lower readable text below full opacity.");
  assert(/\.focus-satellites small\s*\{[^}]*color:\s*#123f7d;[^}]*\b8px\b/s.test(homeStyles)
    && !/\.focus-satellites small\s*\{[^}]*font-size:\s*5\.5px/s.test(homeStyles),
    "Home focus labels must retain the readable high-contrast 8px treatment.");
  assert(!/(?:0?\.0*1|\.0*1)ms/.test(homeStyles),
    "Home reduced motion must use a true zero duration rather than a sampling-race duration.");
  assert(!/(?:0?\.0*1|\.0*1)ms/.test(contactStyles),
    "Contact reduced motion must use a true zero duration rather than a sampling-race duration.");

  assertRoleWrapper(work, "data-route-signal-receiver", "work", "div", "status");
  assertRoleWrapper(contact, "data-route-signal-receiver", "contact", "div", "status");

  const readouts = openingTags(about).filter((tag) => hasAttribute(tag, "data-stellar-readout"));
  assert.strictEqual(readouts.length, 1, "About must expose exactly one stellar evidence dialog.");
  assert.strictEqual(tagName(readouts[0]), "div", "The stellar evidence dialog must use a role-compatible div.");
  assert.strictEqual(attribute(readouts[0], "role"), "dialog", "The stellar evidence readout must retain role=dialog.");

  const panels = openingTags(work).filter((tag) => attribute(tag, "data-brief-panel") !== null);
  assert.strictEqual(panels.length, 4, "Work must retain four role-based briefing panels.");
  panels.forEach((panel) => {
    assert.strictEqual(tagName(panel), "div", "Briefing tabpanels must not override native article semantics.");
  });
  assert(briefing.includes('panel.setAttribute("role", "tabpanel")'), "The briefing controller must retain its tabpanel relationship.");

  for (const [name, html] of [["Work", work], ["About", about], ["Contact", contact], ["Signals", signals]]) {
    assert(!/<aside\b[^>]*\brole=(?:"(?:status|dialog|tabpanel)"|'(?:status|dialog|tabpanel)')/i.test(html),
      `${name} contains an aside with an unsupported ARIA role.`);
  }
}

function verifyCanonicalArticleSemantics() {
  const { db } = openDatabase(undefined, { readonly: true });
  try {
    const post = db.prepare("SELECT body_html FROM posts WHERE slug = ?").get(ORBITAL_POST);
    assert(post, "The orbital-homepage post must exist in the canonical SQLite database.");
    assert(!/<aside\b/i.test(post.body_html), "The orbital-homepage article must not nest a complementary landmark inside Article.");
    assert(/<section\b[^>]*\baria-labelledby="orbital-leverage-title"[^>]*>/i.test(post.body_html),
      "The orbital leverage callout must use a labelled section.");
    assert(/<h2\b[^>]*\bid="orbital-leverage-title"[^>]*>The loop became much faster\.<\/h2>/i.test(post.body_html),
      "The orbital leverage section must retain its visible heading relationship.");
  } finally {
    db.close();
  }
}

verifyStaticSemantics();
verifyCanonicalArticleSemantics();
console.log("Verified Axe-relevant wrapper roles and canonical article landmarks.");
