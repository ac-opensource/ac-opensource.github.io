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
    empty: root.querySelector("[data-empty-state]"),
    records: root.querySelector("[data-relay-records]"),
    status: root.querySelector("[data-feed-status]")
  };
  if (Object.values(elements).some(function (element) { return !element; })) return;

  const fallbackRuntime = Object.freeze({
    version: 1,
    enabled: false,
    endpoint: "",
    publicFeedEndpoint: "",
    requestTimeoutMs: 8000
  });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let feed = Object.freeze({ version: 1, records: Object.freeze([]) });
  let recordsById = new Map();
  let fetchController = null;
  let observer = null;

  function parseJson(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error("Missing inline JSON: " + id);
    return JSON.parse(node.textContent);
  }

  function phase(slot) {
    return 12 + ((slot * 73 + 19) % 77);
  }

  function headerFor(record) {
    const header = document.createElement("header");
    const id = document.createElement("code");
    const state = document.createElement("span");
    const slot = document.createElement("span");
    id.textContent = record.id;
    state.textContent = record.status === "approved" ? "[approved public relay]" : "[removed tombstone]";
    slot.textContent = "slot " + String(record.slot).padStart(3, "0");
    header.append(id, state, slot);
    return header;
  }

  function approvedPath(record, targetLabel) {
    const path = document.createElement("div");
    const line = document.createElement("span");
    const gate = document.createElement("span");
    const destination = document.createElement("span");
    const pulse = document.createElement("span");
    const echo = document.createElement("span");
    path.className = "relay-record__path";
    line.className = "relay-record__line";
    gate.className = "relay-record__gate";
    gate.textContent = "human moderation gate";
    destination.className = "relay-record__destination";
    destination.textContent = "public → " + targetLabel;
    pulse.className = "relay-record__pulse";
    echo.className = "relay-record__echo";
    path.append(line, gate, destination, pulse, echo);
    return path;
  }

  function removedPath() {
    const path = document.createElement("div");
    const line = document.createElement("span");
    const gate = document.createElement("span");
    const gap = document.createElement("span");
    path.className = "relay-record__path";
    line.className = "relay-record__line";
    gate.className = "relay-record__gate";
    gate.textContent = "privacy removal boundary";
    gap.className = "relay-record__gap";
    path.append(line, gate, gap);
    return path;
  }

  function selectionButton(record) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.selectRelay = record.id;
    button.setAttribute("aria-pressed", "false");
    button.textContent = record.status === "approved" ? "Lock this public relay" : "Lock this tombstone";
    return button;
  }

  function approvedRecord(record) {
    const target = contract.targetFor(record.target);
    const article = document.createElement("article");
    const quote = document.createElement("blockquote");
    const footer = document.createElement("footer");
    const label = document.createElement("strong");
    const targetLink = document.createElement("a");
    const created = document.createElement("span");
    const approved = document.createElement("span");
    article.className = "relay-record relay-record--approved";
    article.id = "relay-" + record.id;
    article.dataset.signalId = record.id;
    article.dataset.status = record.status;
    article.style.setProperty("--slot-phase", phase(record.slot) + "%");
    article.style.setProperty("--slot-delay", (-((record.slot % 60) / 10)).toFixed(1) + "s");
    article.style.setProperty("--slot-angle", (((record.slot * 17) % 18) - 9) + "deg");
    quote.textContent = record.quote;
    label.textContent = record.display.label;
    targetLink.href = target.path;
    targetLink.textContent = target.label + " ↗";
    created.textContent = "created " + record.createdAt;
    approved.textContent = "approved " + record.approvedAt;
    footer.append(label, targetLink, created, approved, selectionButton(record));
    article.append(headerFor(record), approvedPath(record, target.label), quote, footer);
    return article;
  }

  function removedRecord(record) {
    const article = document.createElement("article");
    const title = document.createElement("h3");
    const copy = document.createElement("p");
    const footer = document.createElement("footer");
    article.className = "relay-record relay-record--removed";
    article.id = "relay-" + record.id;
    article.dataset.signalId = record.id;
    article.dataset.status = record.status;
    article.style.setProperty("--slot-phase", phase(record.slot) + "%");
    article.style.setProperty("--slot-angle", (((record.slot * 17) % 18) - 9) + "deg");
    title.textContent = "The relay is gone. The privacy boundary is visible.";
    copy.textContent = "Only this opaque stable ID, removed status, and slot remain. Quote, attribution, target, and dates are not present in the public feed.";
    footer.append(selectionButton(record));
    article.append(headerFor(record), removedPath(), title, copy, footer);
    return article;
  }

  function renderRecords() {
    elements.records.replaceChildren();
    feed.records.forEach(function (record) {
      elements.records.append(record.status === "approved" ? approvedRecord(record) : removedRecord(record));
    });
    elements.empty.hidden = feed.records.length > 0;
    observeRecords();
  }

  function updateTotals() {
    const approved = feed.records.filter(function (record) { return record.status === "approved"; }).length;
    const removed = feed.records.length - approved;
    elements.total.textContent = String(feed.records.length);
    elements.approved.textContent = String(approved);
    elements.removed.textContent = String(removed);
    root.dataset.feedState = feed.records.length ? "occupied" : "empty";
    elements.status.textContent = feed.records.length
      ? feed.records.length + " contract-valid public relay" + (feed.records.length === 1 ? " is" : "s are") + " visible: " + approved + " approved, " + removed + " removed."
      : "The validated public feed contains no approved records or removal tombstones.";
  }

  function selectedId() {
    return new URL(window.location.href).searchParams.get("signal") || "";
  }

  function syncSelection(options) {
    const id = selectedId();
    root.querySelectorAll("[data-signal-id]").forEach(function (article) {
      article.classList.toggle("is-selected", Boolean(id && article.dataset.signalId === id));
      const button = article.querySelector("[data-select-relay]");
      if (button) button.setAttribute("aria-pressed", String(Boolean(id && article.dataset.signalId === id)));
    });
    const selected = recordsById.get(id);
    const article = selected ? document.getElementById("relay-" + selected.id) : null;
    if (article && options && options.scroll) {
      article.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "center" });
      const button = article.querySelector("[data-select-relay]");
      if (button && options.focus) button.focus({ preventScroll: true });
    }
  }

  function commitSelection(id, options) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("signal", id);
    else url.searchParams.delete("signal");
    window.history.pushState({ relayField: true }, "", url.pathname + url.search);
    syncSelection(options);
  }

  function observeRecords() {
    if (observer) observer.disconnect();
    if (!("IntersectionObserver" in window)) return;
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        entry.target.classList.toggle("is-active", entry.isIntersecting);
      });
    }, { rootMargin: "-35% 0px -35%", threshold: 0 });
    root.querySelectorAll("[data-signal-id]").forEach(function (record) { observer.observe(record); });
  }

  function installFeed(candidate, source) {
    feed = contract.validateFeed(candidate);
    recordsById = new Map(feed.records.map(function (record) { return [record.id, record]; }));
    renderRecords();
    updateTotals();
    root.dataset.feedSource = source;
    syncSelection();
  }

  function runtimeConfig() {
    try {
      return runtimeContract.validateRuntimeConfig(parseJson("contact-runtime-config"), window.location);
    } catch (error) {
      elements.banner.hidden = false;
      elements.banner.classList.add("is-error");
      elements.banner.textContent = "[RUNTIME CONFIG REJECTED] The validated inline relay state remains; no request was made.";
      console.error("Relay Field runtime rejected.", error);
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
        : "[CONFIGURED PUBLIC FEED] Only contract-valid approved records and removed tombstones energize relays.";
    } catch (error) {
      elements.banner.hidden = false;
      elements.banner.classList.add("is-error");
      elements.banner.textContent = "[PUBLIC FEED UNAVAILABLE] The validated build-time Relay field remains in place.";
      console.error("Relay Field feed unavailable.", error);
    } finally {
      window.clearTimeout(timeout);
      fetchController = null;
    }
  }

  root.addEventListener("click", function (event) {
    const button = event.target.closest("[data-select-relay]");
    if (!button || !recordsById.has(button.dataset.selectRelay)) return;
    const id = selectedId() === button.dataset.selectRelay ? "" : button.dataset.selectRelay;
    commitSelection(id, { scroll: Boolean(id), focus: Boolean(id) });
  });
  window.addEventListener("popstate", function () { syncSelection({ scroll: false }); });
  window.addEventListener("pageshow", function (event) { if (event.persisted) syncSelection({ scroll: false }); });
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
    elements.banner.textContent = "[PUBLIC CONTRACT REJECTED] No unvalidated object energized the Relay field.";
    elements.records.replaceChildren();
    elements.empty.hidden = false;
    elements.empty.querySelector("strong").textContent = "FIELD UNAVAILABLE";
    elements.empty.querySelector("span").textContent = "No unvalidated record or pulse was rendered.";
    console.error("Relay Field rejected its inline feed.", error);
  } finally {
    root.setAttribute("aria-busy", "false");
  }
})();
