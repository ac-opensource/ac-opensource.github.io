(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SignalsContract = Object.freeze(api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TARGETS = Object.freeze({
    dashboard: Object.freeze({ label: "Dashboard", path: "/" }),
    portfolio: Object.freeze({ label: "Portfolio", path: "/work.html" }),
    logs: Object.freeze({ label: "Logs", path: "/blog/" }),
    about: Object.freeze({ label: "About", path: "/about.html" }),
    contact: Object.freeze({ label: "Contact", path: "/contact.html" }),
    resume: Object.freeze({ label: "Resume", path: "/resume.html" }),
    skills: Object.freeze({ label: "Skills graph", path: "/skills-graph.html" })
  });
  const FEED_KEYS = ["records", "version"];
  const APPROVED_KEYS = ["approvedAt", "createdAt", "display", "id", "quote", "slot", "status", "target"];
  const REMOVED_KEYS = ["id", "slot", "status"];
  const DISPLAY_KEYS = ["label", "mode"];
  const ID_PATTERN = /^sig_[A-Za-z0-9_-]{12,64}$/;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const BIDI_OR_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;

  function exactKeys(value, expected) {
    return Boolean(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify(Array.from(expected).sort())
    );
  }

  function assertText(value, label, limits) {
    const min = limits && limits.min !== undefined ? limits.min : 1;
    const max = limits && limits.max !== undefined ? limits.max : 280;
    if (typeof value !== "string" || value !== value.trim() || value.length < min || value.length > max) {
      throw new Error(label + " must be trimmed text between " + min + " and " + max + " characters.");
    }
    if (BIDI_OR_CONTROL.test(value)) throw new Error(label + " contains unsafe control characters.");
    return value;
  }

  function dateValue(value, label) {
    if (!DATE_PATTERN.test(value || "")) throw new Error(label + " must use YYYY-MM-DD.");
    const parsed = new Date(value + "T00:00:00Z");
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new Error(label + " is not a calendar date.");
    }
    return parsed.getTime();
  }

  function validateRecord(record) {
    const removed = record && record.status === "removed";
    if (!exactKeys(record, removed ? REMOVED_KEYS : APPROVED_KEYS)) {
      throw new Error("Signal record has unknown, private, or missing fields.");
    }
    if (!ID_PATTERN.test(record.id || "")) throw new Error("Signal ID must be opaque and stable.");
    if (!Number.isInteger(record.slot) || record.slot < 0 || record.slot > 999) {
      throw new Error("Signal slot must be an integer from 0 to 999.");
    }
    if (removed) return Object.freeze(Object.assign({}, record));
    if (record.status !== "approved") {
      throw new Error("Only approved records or privacy-minimal removed tombstones are public.");
    }
    if (!exactKeys(record.display, DISPLAY_KEYS)) throw new Error("Signal display shape is invalid.");
    if (record.display.mode !== "anonymous" && record.display.mode !== "named") {
      throw new Error("Signal display mode is invalid.");
    }
    assertText(record.display.label, "Signal display label", { min: 2, max: 80 });
    if (record.display.mode === "anonymous" && record.display.label !== "Anonymous") {
      throw new Error("Anonymous signal must use the Anonymous label.");
    }
    assertText(record.quote, "Signal quote", { min: 1, max: 280 });
    if (!Object.hasOwn(TARGETS, record.target)) {
      throw new Error("Signal target is not an allowed local destination.");
    }
    const created = dateValue(record.createdAt, "Signal created date");
    const approved = dateValue(record.approvedAt, "Signal approved date");
    if (approved < created) throw new Error("Signal approval cannot predate creation.");
    return Object.freeze(Object.assign({}, record, {
      display: Object.freeze(Object.assign({}, record.display))
    }));
  }

  function validateFeed(feed) {
    if (!exactKeys(feed, FEED_KEYS) || feed.version !== 1 || !Array.isArray(feed.records)) {
      throw new Error("Signals feed must use version 1 and the exact public shape.");
    }
    if (feed.records.length > 250) throw new Error("Signals feed exceeds the public registry limit.");
    const ids = new Set();
    const slots = new Set();
    const records = feed.records.map(function (record) {
      const validated = validateRecord(record);
      if (ids.has(validated.id)) throw new Error("Duplicate signal ID: " + validated.id);
      if (slots.has(validated.slot)) throw new Error("Duplicate signal slot: " + validated.slot);
      ids.add(validated.id);
      slots.add(validated.slot);
      return validated;
    });
    records.sort(function (left, right) {
      return left.slot - right.slot || left.id.localeCompare(right.id);
    });
    return Object.freeze({ version: 1, records: Object.freeze(records) });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function approvedRecords(feed) {
    return validateFeed(feed).records.filter(function (record) {
      return record.status === "approved";
    });
  }

  function orbitRecords(feed) {
    return approvedRecords(feed).slice(0, 5);
  }

  function targetFor(id) {
    if (!Object.hasOwn(TARGETS, id)) throw new Error("Unknown signal target.");
    return TARGETS[id];
  }

  return Object.freeze({
    TARGETS,
    approvedRecords,
    escapeHtml,
    exactKeys,
    orbitRecords,
    targetFor,
    validateFeed,
    validateRecord
  });
});
