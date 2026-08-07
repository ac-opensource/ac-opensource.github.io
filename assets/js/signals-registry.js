(function () {
  "use strict";

  document.documentElement.classList.remove("no-js");
  document.documentElement.classList.add("js");

  const root = document.querySelector("[data-signals-root]");
  const contract = window.SignalsContract;
  const runtimeContract = window.ContactTransport;
  if (!root || !contract || !runtimeContract) return;

  const list = root.querySelector("[data-signals-list]");
  const orbit = root.querySelector("[data-signals-orbit]");
  const orbitField = root.querySelector("[data-orbit-field]");
  const orbitPreview = root.querySelector("[data-orbit-preview]");
  const orbitEmpty = root.querySelector("[data-orbit-empty]");
  const orbitFilterEmpty = root.querySelector("[data-orbit-filter-empty]");
  const filters = root.querySelector("[data-signal-filters]");
  const search = document.getElementById("signal-search");
  const target = document.getElementById("signal-target-filter");
  const date = document.getElementById("signal-date-filter");
  const clear = root.querySelector("[data-clear-filters]");
  const total = root.querySelector("[data-registry-total]");
  const approvedTotal = root.querySelector("[data-approved-total]");
  const removedTotal = root.querySelector("[data-removed-total]");
  const fieldTotal = root.querySelector("[data-field-total]");
  const fieldVisible = root.querySelector("[data-field-visible]");
  const visibleTotal = root.querySelector("[data-visible-total]");
  const resultsSummary = root.querySelector("[data-results-summary]");
  const empty = root.querySelector("[data-filter-empty]");
  const status = root.querySelector("[data-js-status]");
  const detail = root.querySelector("[data-signal-detail]");
  const detailKicker = root.querySelector("[data-detail-kicker]");
  const detailTitle = root.querySelector("[data-detail-title]");
  const detailQuote = root.querySelector("[data-detail-quote]");
  const detailMeta = root.querySelector("[data-detail-meta]");
  const detailTarget = root.querySelector("[data-detail-target]");
  const closeDetail = root.querySelector("[data-close-detail]");
  const banner = root.querySelector("[data-signals-runtime-banner]");
  const required = [
    list,
    orbit,
    orbitField,
    orbitPreview,
    orbitEmpty,
    orbitFilterEmpty,
    filters,
    search,
    target,
    date,
    clear,
    total,
    approvedTotal,
    removedTotal,
    fieldTotal,
    fieldVisible,
    visibleTotal,
    resultsSummary,
    empty,
    status,
    detail,
    detailKicker,
    detailTitle,
    detailQuote,
    detailMeta,
    detailTarget,
    closeDetail,
    banner
  ];
  if (required.some(function (element) { return !element; })) return;

  const fallbackRuntime = Object.freeze({
    version: 1,
    enabled: false,
    endpoint: "",
    publicFeedEndpoint: "",
    requestTimeoutMs: 8000
  });
  let feed = { version: 1, records: [] };
  let recordsById = new Map();
  let state = { q: "", target: "", date: "", signal: "" };
  let fetchController = null;

  function parseInlineJson(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error("Missing inline JSON: " + id);
    return JSON.parse(node.textContent);
  }

  function slotGeometry(slot) {
    const angle = ((slot * 137.508 + 17) % 360) - 180;
    const track = slot % 8;
    const radiusX = 17.5 + track * 3.65;
    const radiusY = 13.5 + track * 2.95;
    const radians = angle * Math.PI / 180;
    return {
      angle: Number(angle.toFixed(3)),
      track: track + 1,
      x: Number((50 + Math.cos(radians) * radiusX).toFixed(3)),
      y: Number((50 + Math.sin(radians) * radiusY).toFixed(3))
    };
  }

  function appendMeta(term, description) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = description;
    row.append(dt, dd);
    detailMeta.append(row);
  }

  function appendRecordMeta(metadata, term, description, datetime) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    if (datetime) {
      const time = document.createElement("time");
      time.dateTime = datetime;
      time.textContent = description;
      dd.append(time);
    } else {
      dd.textContent = description;
    }
    row.append(dt, dd);
    metadata.append(row);
  }

  function buttonForRecord(record) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.selectSignal = record.id;
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "signal-detail");
    button.textContent = record.status === "removed" ? "Read tombstone" : "Read record";
    return button;
  }

  function renderApprovedRecord(record) {
    const targetInfo = contract.targetFor(record.target);
    const item = document.createElement("li");
    const article = document.createElement("article");
    const header = document.createElement("header");
    const code = document.createElement("code");
    const stateLabel = document.createElement("span");
    const slot = document.createElement("span");
    const name = document.createElement("h3");
    const quote = document.createElement("blockquote");
    const metadata = document.createElement("dl");
    const footer = document.createElement("footer");
    const targetLink = document.createElement("a");
    item.className = "signal-record";
    item.id = "record-" + record.id;
    item.dataset.signalRecord = "";
    item.dataset.signalId = record.id;
    item.dataset.status = record.status;
    item.dataset.slot = String(record.slot);
    code.textContent = record.id;
    stateLabel.textContent = "[approved]";
    slot.textContent = "slot " + String(record.slot).padStart(3, "0");
    header.append(code, stateLabel, slot);
    name.textContent = record.display.label;
    quote.textContent = record.quote;
    appendRecordMeta(metadata, "Local target", targetInfo.label);
    appendRecordMeta(metadata, "Created", record.createdAt, record.createdAt);
    appendRecordMeta(metadata, "Approved", record.approvedAt, record.approvedAt);
    targetLink.href = targetInfo.path;
    targetLink.textContent = "Open " + targetInfo.label;
    footer.append(targetLink, buttonForRecord(record));
    article.append(header, name, quote, metadata, footer);
    item.append(article);
    return item;
  }

  function renderRemovedRecord(record) {
    const item = document.createElement("li");
    const article = document.createElement("article");
    const header = document.createElement("header");
    const code = document.createElement("code");
    const stateLabel = document.createElement("span");
    const slot = document.createElement("span");
    const title = document.createElement("h3");
    const copy = document.createElement("p");
    const footer = document.createElement("footer");
    item.className = "signal-record signal-record--removed";
    item.id = "record-" + record.id;
    item.dataset.signalRecord = "";
    item.dataset.signalId = record.id;
    item.dataset.status = record.status;
    item.dataset.slot = String(record.slot);
    code.textContent = record.id;
    stateLabel.textContent = "[removed]";
    slot.textContent = "slot " + String(record.slot).padStart(3, "0");
    title.textContent = "Removed signal tombstone";
    copy.textContent = "The quote, attribution, target, and dates are no longer present in the public feed.";
    header.append(code, stateLabel, slot);
    footer.append(buttonForRecord(record));
    article.append(header, title, copy, footer);
    item.append(article);
    return item;
  }

  function renderRegistry() {
    list.replaceChildren();
    if (!feed.records.length) {
      const item = document.createElement("li");
      const title = document.createElement("strong");
      const copy = document.createElement("span");
      item.className = "signals-empty-record";
      item.dataset.feedEmpty = "";
      title.textContent = "No public Signals yet.";
      copy.textContent = "The default feed is intentionally empty. Nothing pending, rejected, private, or unmoderated is displayed.";
      item.append(title, copy);
      list.append(item);
    } else {
      feed.records.forEach(function (record) {
        list.append(record.status === "approved" ? renderApprovedRecord(record) : renderRemovedRecord(record));
      });
    }
  }

  function createSlotMarker(record) {
    const marker = document.createElement("a");
    const label = document.createElement("span");
    const value = document.createElement("b");
    const geometry = slotGeometry(record.slot);
    const slotLabel = String(record.slot).padStart(3, "0");
    marker.className = "signal-slot-marker signal-slot-marker--" + record.status +
      (record.status === "approved" ? " signal-satellite" : "");
    marker.href = "#record-" + record.id;
    marker.dataset.slotMarker = "";
    if (record.status === "approved") marker.dataset.satellite = "";
    marker.dataset.signalId = record.id;
    marker.dataset.status = record.status;
    marker.dataset.slot = String(record.slot);
    marker.style.setProperty("--slot-x", geometry.x + "%");
    marker.style.setProperty("--slot-y", geometry.y + "%");
    marker.style.setProperty("--slot-angle", geometry.angle + "deg");
    label.textContent = "slot";
    value.textContent = slotLabel;
    marker.append(label, value);
    if (record.status === "approved") {
      const targetInfo = contract.targetFor(record.target);
      marker.setAttribute(
        "aria-label",
        "Open approved public signal " + record.id + " in slot " + slotLabel + " for " + targetInfo.label
      );
    } else {
      marker.setAttribute(
        "aria-label",
        "Open removed public signal tombstone " + record.id + " in slot " + slotLabel
      );
    }
    marker.addEventListener("pointerenter", function () { previewRecord(record); });
    marker.addEventListener("pointerleave", resetPreview);
    marker.addEventListener("focus", function () { previewRecord(record); });
    marker.addEventListener("blur", function () {
      if (state.signal !== record.id) resetPreview();
    });
    marker.addEventListener("click", function (event) {
      event.preventDefault();
      selectRecord(record.id, true);
    });
    return marker;
  }

  function renderOrbit() {
    orbit.hidden = false;
    orbitField.querySelectorAll("[data-slot-marker]").forEach(function (node) { node.remove(); });
    feed.records.forEach(function (record) {
      orbitField.append(createSlotMarker(record));
    });
  }

  function previewRecord(record) {
    const slotLabel = String(record.slot).padStart(3, "0");
    if (record.status === "removed") {
      orbitPreview.textContent = "Slot " + slotLabel + " · removed tombstone · " + record.id +
        " · no quote, attribution, target, or dates retained.";
      return;
    }
    const targetInfo = contract.targetFor(record.target);
    orbitPreview.textContent = "Slot " + slotLabel + " · " + record.display.label + " · " +
      targetInfo.label + " · " + record.quote;
  }

  function resetPreview() {
    const selected = state.signal && recordsById.get(state.signal);
    if (selected && recordMatches(selected, state)) {
      previewRecord(selected);
    } else if (!feed.records.length) {
      orbitPreview.textContent = "No approved public feedback has been published yet.";
    } else {
      orbitPreview.textContent = "Focus a public slot for a compact preview; select it to open the authoritative registry detail.";
    }
  }

  function recordMatches(record, snapshot) {
    const active = snapshot || state;
    const q = active.q.toLocaleLowerCase();
    if (active.target && (record.status !== "approved" || record.target !== active.target)) return false;
    if (active.date && (record.status !== "approved" || !record.approvedAt.startsWith(active.date))) return false;
    if (!q) return true;
    if (record.status === "removed") return (record.id + " removed tombstone slot " + record.slot).toLocaleLowerCase().includes(q);
    const targetInfo = contract.targetFor(record.target);
    return [
      record.id,
      record.display.label,
      record.quote,
      record.target,
      targetInfo.label,
      record.createdAt,
      record.approvedAt,
      record.slot
    ].join(" ").toLocaleLowerCase().includes(q);
  }

  function stateFromLocation() {
    if (!recordsById.size) return { q: "", target: "", date: "", signal: "" };
    const url = new URL(window.location.href);
    const candidate = {
      q: (url.searchParams.get("q") || "").trim().slice(0, 80),
      target: Object.hasOwn(contract.TARGETS, url.searchParams.get("target") || "")
        ? url.searchParams.get("target")
        : "",
      date: /^\d{4}-\d{2}$/.test(url.searchParams.get("date") || "") ? url.searchParams.get("date") : "",
      signal: recordsById.has(url.searchParams.get("signal") || "") ? url.searchParams.get("signal") : ""
    };
    if (candidate.signal && !recordMatches(recordsById.get(candidate.signal), candidate)) candidate.signal = "";
    return candidate;
  }

  function stateUrl(next) {
    const url = new URL(window.location.href);
    ["q", "target", "date", "signal"].forEach(function (key) { url.searchParams.delete(key); });
    if (next.q) url.searchParams.set("q", next.q);
    if (next.target) url.searchParams.set("target", next.target);
    if (next.date) url.searchParams.set("date", next.date);
    if (next.signal) url.searchParams.set("signal", next.signal);
    url.hash = "";
    return url.pathname + url.search;
  }

  function showDetail(record, focus) {
    root.querySelectorAll("[data-select-signal]").forEach(function (button) {
      const selected = Boolean(record && button.dataset.selectSignal === record.id);
      button.setAttribute("aria-expanded", String(selected));
      button.closest("[data-signal-record]")?.classList.toggle("is-selected", selected);
    });
    root.querySelectorAll("[data-slot-marker]").forEach(function (marker) {
      if (record && marker.dataset.signalId === record.id) marker.setAttribute("aria-current", "true");
      else marker.removeAttribute("aria-current");
    });
    if (!record) {
      detail.hidden = true;
      resetPreview();
      return;
    }
    detail.hidden = false;
    detailMeta.replaceChildren();
    detailKicker.textContent = record.status === "removed" ? "[REMOVED TOMBSTONE]" : "[APPROVED RECORD]";
    detailTitle.textContent = record.status === "removed" ? "Removed signal " + record.id : record.display.label;
    detailQuote.hidden = record.status !== "approved";
    detailQuote.textContent = record.status === "approved" ? record.quote : "";
    appendMeta("Stable ID", record.id);
    appendMeta("Status", record.status);
    appendMeta("Slot", String(record.slot).padStart(3, "0"));
    if (record.status === "approved") {
      const targetInfo = contract.targetFor(record.target);
      appendMeta("Local target", targetInfo.label);
      appendMeta("Created", record.createdAt);
      appendMeta("Approved", record.approvedAt);
      detailTarget.hidden = false;
      detailTarget.href = targetInfo.path;
    } else {
      detailTarget.hidden = true;
      detailTarget.removeAttribute("href");
    }
    previewRecord(record);
    if (focus) {
      detail.focus({ preventScroll: true });
      detail.scrollIntoView({ behavior: "auto", block: "nearest" });
    }
  }

  function syncFeedControls() {
    const hasRecords = feed.records.length > 0;
    const approved = feed.records.filter(function (record) { return record.status === "approved"; }).length;
    const removed = feed.records.length - approved;
    root.dataset.feedState = hasRecords ? "occupied" : "empty";
    filters.hidden = !hasRecords;
    resultsSummary.hidden = !hasRecords;
    filters.querySelectorAll("input, select, button").forEach(function (control) {
      control.disabled = !hasRecords;
    });
    orbitEmpty.hidden = hasRecords;
    total.textContent = String(feed.records.length);
    approvedTotal.textContent = String(approved);
    removedTotal.textContent = String(removed);
    fieldTotal.textContent = String(feed.records.length);
  }

  function applyState(options) {
    search.value = state.q;
    target.value = state.target;
    date.value = state.date;
    let count = 0;
    const visibleIds = new Set();
    root.querySelectorAll("[data-signal-record]").forEach(function (item) {
      const record = recordsById.get(item.dataset.signalId);
      const visible = Boolean(record && recordMatches(record, state));
      item.hidden = !visible;
      if (visible) {
        count += 1;
        visibleIds.add(record.id);
      }
    });
    root.querySelectorAll("[data-slot-marker]").forEach(function (marker) {
      marker.hidden = !visibleIds.has(marker.dataset.signalId);
    });
    visibleTotal.textContent = String(count);
    fieldVisible.textContent = String(count);
    empty.hidden = count !== 0 || feed.records.length === 0;
    orbitFilterEmpty.hidden = feed.records.length === 0 || count !== 0;
    root.dataset.feedState = feed.records.length === 0 ? "empty" : (count === 0 ? "filtered-empty" : "occupied");
    status.textContent = feed.records.length
      ? count + " of " + feed.records.length + " validated public records shown in the registry and slot field."
      : "The public feed currently contains no approved or removed records.";
    const selected = recordsById.get(state.signal);
    showDetail(selected && visibleIds.has(selected.id) ? selected : null, options && options.focusDetail);
  }

  function commitState(candidate, options) {
    const next = Object.assign({}, state, candidate);
    const url = stateUrl(next);
    window.history[options && options.replace ? "replaceState" : "pushState"]({ signalsRegistry: true }, "", url);
    state = stateFromLocation();
    applyState({ focusDetail: options && options.focusDetail });
  }

  function selectRecord(id, focus) {
    const record = recordsById.get(id);
    if (!record || !recordMatches(record, state)) return;
    commitState({ signal: id }, { focusDetail: focus });
  }

  function bind() {
    filters.addEventListener("submit", function (event) { event.preventDefault(); });
    search.addEventListener("input", function () {
      commitState({ q: search.value.slice(0, 80), signal: "" }, { replace: true });
    });
    target.addEventListener("change", function () {
      commitState({ target: target.value, signal: "" });
    });
    date.addEventListener("change", function () {
      commitState({ date: date.value, signal: "" });
    });
    clear.addEventListener("click", function () {
      commitState({ q: "", target: "", date: "", signal: "" });
      search.focus();
    });
    list.addEventListener("click", function (event) {
      const button = event.target.closest("[data-select-signal]");
      if (button) selectRecord(button.dataset.selectSignal, true);
    });
    closeDetail.addEventListener("click", function () {
      const returnTarget = root.querySelector('[data-select-signal="' + state.signal + '"]');
      commitState({ signal: "" });
      if (returnTarget && !returnTarget.closest("[hidden]")) returnTarget.focus();
    });
    window.addEventListener("popstate", function () {
      state = stateFromLocation();
      applyState();
    });
    window.addEventListener("pageshow", function (event) {
      if (!event.persisted) return;
      state = stateFromLocation();
      applyState();
    });
  }

  function installFeed(candidate, options) {
    feed = contract.validateFeed(candidate);
    recordsById = new Map(feed.records.map(function (record) { return [record.id, record]; }));
    renderRegistry();
    renderOrbit();
    syncFeedControls();
    state = stateFromLocation();
    applyState();
    root.dataset.feedSource = options.source;
  }

  function runtimeConfig() {
    try {
      return runtimeContract.validateRuntimeConfig(parseInlineJson("contact-runtime-config"), window.location);
    } catch (error) {
      banner.hidden = false;
      banner.classList.add("is-error");
      banner.textContent = "[RUNTIME CONFIG REJECTED] The validated inline registry remains available; no feed request was made.";
      console.error("Signals runtime config rejected.", error);
      return runtimeContract.validateRuntimeConfig(fallbackRuntime, window.location);
    }
  }

  async function maybeLoadConfiguredFeed(runtime) {
    if (!runtime.enabled || !runtime.publicFeedEndpoint) return;
    const feedUrl = new URL(runtime.publicFeedEndpoint);
    const exactLoopback =
      window.location.protocol === "http:" &&
      window.location.hostname === "127.0.0.1" &&
      feedUrl.hostname === "127.0.0.1" &&
      feedUrl.origin === window.location.origin;
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
      const contentType = response.headers.get("content-type") || "";
      if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new Error("Signals feed was not JSON.");
      installFeed(await response.json(), { source: exactLoopback ? "local_demo" : "configured_endpoint" });
      banner.hidden = false;
      banner.classList.remove("is-error");
      banner.textContent = exactLoopback
        ? "[LOCAL DEMO FEED] Exact 127.0.0.1 test records are visibly local and never production testimonials."
        : "[CONFIGURED PUBLIC FEED] Only contract-valid approved records and removed tombstones are rendered.";
    } catch (error) {
      banner.hidden = false;
      banner.classList.add("is-error");
      banner.textContent = "[PUBLIC FEED UNAVAILABLE] The validated build-time registry remains in place.";
      console.error("Configured Signals feed unavailable.", error);
    } finally {
      window.clearTimeout(timeout);
      fetchController = null;
    }
  }

  try {
    installFeed(parseInlineJson("signals-feed"), { source: "build_time" });
    bind();
    maybeLoadConfiguredFeed(runtimeConfig());
    root.dataset.signalsReady = "true";
  } catch (error) {
    root.dataset.signalsReady = "failed";
    root.dataset.feedState = "error";
    filters.hidden = true;
    filters.querySelectorAll("input, select, button").forEach(function (control) { control.disabled = true; });
    resultsSummary.hidden = true;
    banner.hidden = false;
    banner.classList.add("is-error");
    banner.textContent = "[REGISTRY CONTRACT REJECTED] No unvalidated record was rendered.";
    list.replaceChildren();
    const item = document.createElement("li");
    item.className = "signals-empty-record";
    item.textContent = "Public Signals are unavailable because validation failed.";
    list.append(item);
    orbit.hidden = false;
    orbitField.querySelectorAll("[data-slot-marker]").forEach(function (node) { node.remove(); });
    orbitEmpty.hidden = false;
    orbitEmpty.querySelector("strong").textContent = "PUBLIC FEEDBACK UNAVAILABLE";
    orbitEmpty.querySelector("span").textContent = "No unvalidated or private words were exposed.";
    console.error("Signals registry rejected its inline feed.", error);
  } finally {
    root.setAttribute("aria-busy", "false");
  }

  window.addEventListener("pagehide", function () {
    if (fetchController) fetchController.abort();
  });
})();
