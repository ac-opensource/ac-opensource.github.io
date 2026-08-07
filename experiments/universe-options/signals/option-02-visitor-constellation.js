(function () {
  "use strict";

  const root = document.querySelector("[data-signals-option]");
  const contract = window.SignalsContract;
  const runtimeContract = window.ContactTransport;
  if (!root || !contract || !runtimeContract) return;

  const elements = {
    banner: root.querySelector("[data-runtime-banner]"),
    total: root.querySelector("[data-total]"),
    approved: root.querySelector("[data-approved]"),
    removed: root.querySelector("[data-removed]"),
    lines: root.querySelector("[data-constellation-lines]"),
    starField: root.querySelector("[data-star-field]"),
    empty: root.querySelector("[data-empty-state]"),
    status: root.querySelector("[data-feed-status]"),
    stream: root.querySelector("[data-record-stream]"),
    streamEmpty: root.querySelector("[data-stream-empty]"),
    focus: root.querySelector("[data-record-focus]"),
    focusKicker: root.querySelector("[data-focus-kicker]"),
    focusTitle: root.querySelector("[data-focus-title]"),
    focusQuote: root.querySelector("[data-focus-quote]"),
    focusCopy: root.querySelector("[data-focus-copy]"),
    focusMeta: root.querySelector("[data-focus-meta]"),
    focusTarget: root.querySelector("[data-focus-target]"),
    closeFocus: root.querySelector("[data-close-focus]")
  };
  if (Object.values(elements).some(function (element) { return !element; })) return;

  const fallbackRuntime = Object.freeze({
    version: 1,
    enabled: false,
    endpoint: "",
    publicFeedEndpoint: "",
    requestTimeoutMs: 8000
  });
  let feed = Object.freeze({ version: 1, records: Object.freeze([]) });
  let recordsById = new Map();
  let fetchController = null;
  let returnFocus = null;

  function parseJson(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error("Missing inline JSON: " + id);
    return JSON.parse(node.textContent);
  }

  function geometry(slot) {
    const angle = ((slot * 137.508 + 31) % 360) * Math.PI / 180;
    const track = slot % 6;
    const radiusX = 20 + track * 4.1;
    const radiusY = 16 + track * 3.2;
    return {
      x: Number((50 + Math.cos(angle) * radiusX).toFixed(3)),
      y: Number((50 + Math.sin(angle) * radiusY).toFixed(3))
    };
  }

  function appendMeta(term, description) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = description;
    row.append(dt, dd);
    elements.focusMeta.append(row);
  }

  function starFor(record) {
    const point = geometry(record.slot);
    const button = document.createElement("button");
    const label = document.createElement("span");
    button.type = "button";
    button.className = "visitor-star" + (record.status === "removed" ? " visitor-star--removed" : "");
    button.dataset.signalId = record.id;
    button.dataset.status = record.status;
    button.style.left = point.x + "%";
    button.style.top = point.y + "%";
    button.setAttribute(
      "aria-label",
      record.status === "approved"
        ? "Open approved public Signal " + record.id + " in slot " + String(record.slot).padStart(3, "0")
        : "Open removed public Signal tombstone " + record.id + " in slot " + String(record.slot).padStart(3, "0")
    );
    label.textContent = record.status === "approved"
      ? record.display.label + " · " + String(record.slot).padStart(3, "0")
      : "removed · " + String(record.slot).padStart(3, "0");
    button.append(label);
    return button;
  }

  function approvedArticle(record) {
    const target = contract.targetFor(record.target);
    const article = document.createElement("article");
    const header = document.createElement("header");
    const code = document.createElement("code");
    const state = document.createElement("span");
    const slot = document.createElement("span");
    const quote = document.createElement("blockquote");
    const footer = document.createElement("footer");
    const label = document.createElement("strong");
    const targetLink = document.createElement("a");
    const created = document.createElement("span");
    const approved = document.createElement("span");
    const focus = document.createElement("button");
    article.className = "visitor-record";
    article.id = "record-" + record.id;
    article.dataset.signalId = record.id;
    article.dataset.status = record.status;
    article.style.setProperty("--record-position", geometry(record.slot).x + "%");
    code.textContent = record.id;
    state.textContent = "[approved public record]";
    slot.textContent = "slot " + String(record.slot).padStart(3, "0");
    header.append(code, state, slot);
    quote.textContent = record.quote;
    label.textContent = record.display.label;
    targetLink.href = target.path;
    targetLink.textContent = target.label + " ↗";
    created.textContent = "created " + record.createdAt;
    approved.textContent = "approved " + record.approvedAt;
    focus.type = "button";
    focus.dataset.focusSignal = record.id;
    focus.textContent = "Open full-screen record";
    footer.append(label, targetLink, created, approved, focus);
    article.append(header, quote, footer);
    return article;
  }

  function removedArticle(record) {
    const article = document.createElement("article");
    const header = document.createElement("header");
    const code = document.createElement("code");
    const state = document.createElement("span");
    const slot = document.createElement("span");
    const title = document.createElement("h3");
    const copy = document.createElement("p");
    const footer = document.createElement("footer");
    const focus = document.createElement("button");
    article.className = "visitor-record visitor-record--removed";
    article.id = "record-" + record.id;
    article.dataset.signalId = record.id;
    article.dataset.status = record.status;
    article.style.setProperty("--record-position", geometry(record.slot).x + "%");
    code.textContent = record.id;
    state.textContent = "[removed]";
    slot.textContent = "slot " + String(record.slot).padStart(3, "0");
    header.append(code, state, slot);
    title.textContent = "A coordinate remains. The testimony does not.";
    copy.textContent = "This public tombstone contains no quote, attribution, local target, creation date, or approval date.";
    focus.type = "button";
    focus.dataset.focusSignal = record.id;
    focus.textContent = "Open privacy-minimal tombstone";
    footer.append(focus);
    article.append(header, title, copy, footer);
    return article;
  }

  function renderConstellation() {
    elements.starField.replaceChildren();
    elements.lines.replaceChildren();
    const points = feed.records.map(function (record) {
      elements.starField.append(starFor(record));
      return geometry(record.slot);
    });
    if (points.length > 1) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", points.map(function (point, index) {
        return (index ? "L" : "M") + " " + (point.x * 10).toFixed(2) + " " + (point.y * 7).toFixed(2);
      }).join(" "));
      elements.lines.append(path);
    }
    elements.empty.hidden = feed.records.length > 0;
  }

  function renderStream() {
    elements.stream.replaceChildren();
    if (!feed.records.length) {
      const empty = document.createElement("p");
      const title = document.createElement("strong");
      const copy = document.createElement("span");
      empty.className = "constellation-stream__empty";
      empty.dataset.streamEmpty = "";
      title.textContent = "No public Signals yet.";
      copy.textContent = "Nothing pending, rejected, private, or unmoderated is displayed.";
      empty.append(title, copy);
      elements.stream.append(empty);
      elements.streamEmpty = empty;
      return;
    }
    feed.records.forEach(function (record) {
      elements.stream.append(record.status === "approved" ? approvedArticle(record) : removedArticle(record));
    });
  }

  function updateTotals() {
    const approved = feed.records.filter(function (record) { return record.status === "approved"; }).length;
    const removed = feed.records.length - approved;
    elements.total.textContent = String(feed.records.length);
    elements.approved.textContent = String(approved);
    elements.removed.textContent = String(removed);
    root.dataset.feedState = feed.records.length ? "occupied" : "empty";
    elements.status.textContent = feed.records.length
      ? feed.records.length + " contract-valid public record" + (feed.records.length === 1 ? " is" : "s are") + " visible: " + approved + " approved, " + removed + " removed."
      : "The validated public feed contains no approved records or removal tombstones.";
  }

  function setCurrentMarkers(id) {
    root.querySelectorAll("[data-signal-id]").forEach(function (node) {
      if (id && node.dataset.signalId === id) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
  }

  function showFocus(record, shouldFocus) {
    setCurrentMarkers(record ? record.id : "");
    if (!record) {
      elements.focus.hidden = true;
      document.body.classList.remove("is-focus-open");
      return;
    }
    elements.focusMeta.replaceChildren();
    elements.focus.hidden = false;
    document.body.classList.add("is-focus-open");
    appendMeta("Stable ID", record.id);
    appendMeta("Status", record.status);
    appendMeta("Slot", String(record.slot).padStart(3, "0"));
    if (record.status === "approved") {
      const target = contract.targetFor(record.target);
      elements.focusKicker.textContent = "[approved public record]";
      elements.focusTitle.textContent = record.display.label;
      elements.focusQuote.hidden = false;
      elements.focusQuote.textContent = record.quote;
      elements.focusCopy.textContent = "This record crossed the configured public-feed contract and human moderation boundary.";
      appendMeta("Local target", target.label);
      appendMeta("Created", record.createdAt);
      appendMeta("Approved", record.approvedAt);
      elements.focusTarget.hidden = false;
      elements.focusTarget.href = target.path;
      elements.focusTarget.textContent = "Open " + target.label + " ↗";
    } else {
      elements.focusKicker.textContent = "[removed public tombstone]";
      elements.focusTitle.textContent = "Removed signal";
      elements.focusQuote.hidden = true;
      elements.focusQuote.textContent = "";
      elements.focusCopy.textContent = "The quote, attribution, target, creation date, and approval date are absent. This stable ID and slot are the entire public record.";
      elements.focusTarget.hidden = true;
      elements.focusTarget.removeAttribute("href");
    }
    if (shouldFocus) elements.focus.focus({ preventScroll: true });
  }

  function selectedId() {
    return new URL(window.location.href).searchParams.get("signal") || "";
  }

  function syncSelection(shouldFocus) {
    showFocus(recordsById.get(selectedId()) || null, shouldFocus);
  }

  function commitSelection(id, options) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("signal", id);
    else url.searchParams.delete("signal");
    window.history[options && options.replace ? "replaceState" : "pushState"]({ visitorConstellation: true }, "", url.pathname + url.search);
    syncSelection(options && options.focus);
  }

  function installFeed(candidate, source) {
    feed = contract.validateFeed(candidate);
    recordsById = new Map(feed.records.map(function (record) { return [record.id, record]; }));
    renderConstellation();
    renderStream();
    updateTotals();
    root.dataset.feedSource = source;
    syncSelection(false);
  }

  function runtimeConfig() {
    try {
      return runtimeContract.validateRuntimeConfig(parseJson("contact-runtime-config"), window.location);
    } catch (error) {
      elements.banner.hidden = false;
      elements.banner.classList.add("is-error");
      elements.banner.textContent = "[RUNTIME CONFIG REJECTED] The validated inline feed remains in place; no request was made.";
      console.error("Visitor Constellation runtime rejected.", error);
      return runtimeContract.validateRuntimeConfig(fallbackRuntime, window.location);
    }
  }

  async function maybeLoadFeed(runtime) {
    if (!runtime.enabled) return;
    const url = new URL(runtime.publicFeedEndpoint);
    const exactLoopback = window.location.protocol === "http:" && window.location.hostname === "127.0.0.1" && url.hostname === "127.0.0.1" && url.origin === window.location.origin;
    if (exactLoopback && new URL(window.location.href).searchParams.get("localDemo") !== "1") return;
    fetchController = new AbortController();
    const timeout = window.setTimeout(function () { fetchController.abort(); }, runtime.requestTimeoutMs);
    try {
      const response = await window.fetch(runtime.publicFeedEndpoint, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: fetchController.signal
      });
      if (!response.ok) throw new Error("Signals feed returned HTTP " + response.status + ".");
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) throw new Error("Signals feed was not JSON.");
      installFeed(await response.json(), exactLoopback ? "local_demo" : "configured_endpoint");
      elements.banner.hidden = false;
      elements.banner.classList.remove("is-error");
      elements.banner.textContent = exactLoopback
        ? "[LOCAL DEMO FEED] Exact 127.0.0.1 test records only — never production testimonials."
        : "[CONFIGURED PUBLIC FEED] Only contract-valid approved records and removed tombstones are shown.";
    } catch (error) {
      elements.banner.hidden = false;
      elements.banner.classList.add("is-error");
      elements.banner.textContent = "[PUBLIC FEED UNAVAILABLE] The validated build-time constellation remains in place.";
      console.error("Visitor Constellation feed unavailable.", error);
    } finally {
      window.clearTimeout(timeout);
      fetchController = null;
    }
  }

  root.addEventListener("click", function (event) {
    const trigger = event.target.closest(".visitor-star[data-signal-id], [data-focus-signal]");
    if (!trigger) return;
    const id = trigger.dataset.signalId || trigger.dataset.focusSignal;
    if (!recordsById.has(id)) return;
    returnFocus = trigger;
    commitSelection(id, { focus: true });
  });

  elements.closeFocus.addEventListener("click", function () {
    commitSelection("");
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  });

  window.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !elements.focus.hidden) elements.closeFocus.click();
  });
  window.addEventListener("popstate", function () { syncSelection(false); });
  window.addEventListener("pageshow", function (event) { if (event.persisted) syncSelection(false); });
  window.addEventListener("pagehide", function () { if (fetchController) fetchController.abort(); });

  try {
    installFeed(parseJson("signals-feed"), "build_time");
    maybeLoadFeed(runtimeConfig());
    root.dataset.signalsReady = "true";
  } catch (error) {
    root.dataset.signalsReady = "failed";
    root.dataset.feedState = "error";
    elements.banner.hidden = false;
    elements.banner.classList.add("is-error");
    elements.banner.textContent = "[PUBLIC CONTRACT REJECTED] No unvalidated object entered the constellation.";
    elements.empty.hidden = false;
    elements.empty.querySelector("strong").textContent = "FIELD UNAVAILABLE";
    elements.empty.querySelector("span").textContent = "No unvalidated record was rendered.";
    elements.starField.replaceChildren();
    elements.lines.replaceChildren();
    console.error("Visitor Constellation rejected its inline feed.", error);
  } finally {
    root.setAttribute("aria-busy", "false");
  }
})();
