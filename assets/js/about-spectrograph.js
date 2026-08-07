(() => {
  "use strict";

  const DATA_URL = "/assets/data/profile-map.json";
  const DATASET_ORDER = ["engineering", "interests"];
  const BAND_TONES = {
    "engineering:surfaces": "#65a8ff",
    "engineering:languages": "#7f91ff",
    "engineering:craft": "#aa86ff",
    "engineering:delivery": "#55c8df",
    "interests:place": "#5bd5bc",
    "interests:observation": "#83cbff",
    "interests:reflection": "#c0a5ff",
    "interests:building": "#d9b979"
  };
  const SOURCE_CONTEXTS = [
    {
      id: "career",
      label: "Career history",
      refs: new Set(["resume", "career"])
    },
    {
      id: "projects",
      label: "Projects",
      refs: new Set(["work", "persons-finder", "mystc", "ocbc", "owto", "websafety", "portfolio-repo"])
    },
    {
      id: "writing",
      label: "Writing",
      refs: new Set([
        "persons-finder-notes",
        "rust-core",
        "kotlin-swift",
        "ai-fleet",
        "mempalace",
        "agent-receipts",
        "visual-qa",
        "travel-log",
        "photography",
        "quiet-systems"
      ])
    },
    {
      id: "personal",
      label: "Personal entries",
      refs: new Set(["about-personal"])
    }
  ];
  const MATURITY_LABELS = {
    shipped: "Shipped work / public project",
    published: "Published evidence",
    "self-described": "Explicit public self-description"
  };
  const TREE_LAYOUT = {
    "engineering:surfaces": {
      anchor: [282, 575, 110],
      leaves: [[100, 565, -45], [180, 470, 62], [280, 425, 165], [250, 500, 28]]
    },
    "engineering:languages": {
      anchor: [194, 365, -58],
      leaves: [[72, 342, -126], [96, 232, -42], [170, 143, 92], [252, 166, 156], [306, 278, 22], [258, 352, -102]]
    },
    "engineering:craft": {
      anchor: [423, 268, 178],
      leaves: [[292, 326, 86], [332, 132, 152], [408, 72, 230], [486, 88, 118], [548, 160, 24], [568, 328, 210], [452, 190, 270]]
    },
    "engineering:delivery": {
      anchor: [440, 525, -116],
      leaves: [[284, 652, -185], [420, 632, -54], [470, 430, 36], [538, 574, -165]]
    },
    "interests:place": {
      anchor: [618, 582, 104],
      leaves: [[538, 645, 30], [582, 492, 162], [694, 510, 68]]
    },
    "interests:observation": {
      anchor: [824, 372, -72],
      leaves: [[770, 245, 74], [914, 278, -142]]
    },
    "interests:reflection": {
      anchor: [628, 240, 166],
      leaves: [[586, 104, 102], [666, 70, 236], [726, 166, 56]]
    },
    "interests:building": {
      anchor: [800, 570, -128],
      leaves: [[836, 476, -46], [912, 660, -196]]
    }
  };
  const LEFT_NODE_LABELS = new Set(["sql-postgis", "compose", "shared-native", "agent-memory"]);

  const root = document.querySelector("[data-stellar-spectrum]");
  if (!root) return;

  const CAMERA_DEFAULTS = Object.freeze({
    projection: "free",
    yaw: -0.14,
    pitch: 0.035,
    roll: 0,
    zoom: 1
  });
  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 2.6;
  const bandsElement = root.querySelector("[data-stellar-bands]");
  const readoutElement = root.querySelector("[data-stellar-readout]");
  const statusElement = root.querySelector("[data-stellar-status]");
  const stageElement = root.querySelector(".stellar-spectrum__stage");
  const projectionButtons = Array.from(root.querySelectorAll("[data-tree-projection]"));
  const zoomRange = root.querySelector("[data-tree-zoom-range]");
  const zoomOutput = root.querySelector("[data-tree-zoom-output]");
  const interactionToggle = root.querySelector("[data-tree-interaction-toggle]");
  const interactionLabel = root.querySelector("[data-tree-interaction-label]");
  const resetViewButton = root.querySelector("[data-tree-reset]");
  const themeButton = root.querySelector("[data-about-theme-toggle]");
  const evidenceDetails = document.getElementById("profile-map-evidence");
  const labJournal = document.getElementById("about-lab-journal");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobileTreeInteraction = window.matchMedia("(max-width: 720px)");
  if (!bandsElement || !readoutElement || !statusElement || !stageElement || !evidenceDetails) return;

  let profile = null;
  let bands = [];
  let nodeIndex = new Map();
  let stageIsVisible = true;
  let scanTimer = 0;
  let treeScene = null;
  let popupReturnTarget = null;
  let rootMarkerElement = null;
  let evidenceBackdropElement = null;
  let sourcePanelOpen = false;
  let idleRotationFrame = 0;
  let idleRotationTimestamp = 0;
  let fixedViewPhase = 0;
  let cameraInteractionUntil = 0;
  let cameraPointerActive = false;
  let zoomTweenFrame = 0;
  let zoomTweenStartTimestamp = 0;
  let zoomTweenStart = CAMERA_DEFAULTS.zoom;
  let zoomTweenDuration = 0;
  let zoomTarget = CAMERA_DEFAULTS.zoom;
  let treeInteractionLocked = mobileTreeInteraction.matches;
  let sourceTabsSequence = 0;
  let popupSettleTimer = 0;
  const IDLE_ROTATION_DELAY = 2200;
  const IDLE_ROTATION_SPEED = 0.000026;
  const CANVAS_PIXEL_BUDGET = 600000;
  const zoomMotionScale = () => Math.sqrt(Math.max(1, state.zoom));
  const idleRotationFrameInterval = () => (mobileTreeInteraction.matches ? 72 : 60) / zoomMotionScale();
  const state = {
    scan: root.dataset.stellarDefault || "combined",
    bandId: null,
    nodeId: null,
    ...CAMERA_DEFAULTS
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === "string") node.textContent = text;
    return node;
  }

  function sourceDate(source) {
    if (!source.date) return "";
    const parsed = new Date(`${source.date}T00:00:00`);
    if (Number.isNaN(parsed.valueOf())) return source.date;
    return new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(parsed);
  }

  function normalizeProfile(data) {
    if (!data || typeof data !== "object" || !data.evidence || !data.datasets || !data.method) {
      throw new Error("Profile map data is incomplete.");
    }

    const normalizedBands = [];
    const normalizedNodes = new Map();
    DATASET_ORDER.forEach((datasetKey) => {
      const dataset = data.datasets[datasetKey];
      if (!dataset || !Array.isArray(dataset.axes) || !Array.isArray(dataset.nodes) || !Array.isArray(dataset.edges)) {
        throw new Error(`Profile map dataset is incomplete: ${datasetKey}`);
      }

      dataset.axes.forEach((axis) => {
        const axisNodes = dataset.nodes.filter((node) => node.axis === axis.id);
        const id = `${datasetKey}:${axis.id}`;
        normalizedBands.push({
          id,
          datasetKey,
          dataset,
          axis,
          nodes: axisNodes,
          edges: dataset.edges,
          tone: BAND_TONES[id] || "#426b95"
        });
        axisNodes.forEach((node) => normalizedNodes.set(node.id, { node, datasetKey, dataset, axis, bandId: id }));
      });
    });

    if (normalizedBands.length !== 8 || normalizedNodes.size !== 31) {
      throw new Error("Profile map group or node count changed unexpectedly.");
    }

    profile = data;
    bands = normalizedBands;
    nodeIndex = normalizedNodes;
  }

  function bandsForMode(mode) {
    if (mode === "combined") return bands;
    return bands.filter((band) => band.datasetKey === mode);
  }

  function bandForId(id) {
    return bands.find((band) => band.id === id) || null;
  }

  function modeContainsBand(mode, bandId) {
    return bandsForMode(mode).some((band) => band.id === bandId);
  }

  function readLocationState() {
    const params = new URLSearchParams(window.location.search);
    state.scan = "combined";
    state.bandId = params.get("band");
    state.nodeId = params.get("node");
    const requestedProjection = params.get("projection");
    state.projection = ["front", "top"].includes(requestedProjection) ? requestedProjection : "free";

    if (state.nodeId && !state.bandId) {
      const indexedNode = nodeIndex.get(state.nodeId);
      if (indexedNode && modeContainsBand(state.scan, indexedNode.bandId)) state.bandId = indexedNode.bandId;
    }

    if (!state.bandId || !modeContainsBand(state.scan, state.bandId)) {
      state.bandId = null;
      state.nodeId = null;
      return;
    }

    const selectedBand = bandForId(state.bandId);
    if (!state.nodeId || !selectedBand.nodes.some((node) => node.id === state.nodeId)) state.nodeId = null;
  }

  function writeLocationState(method = "pushState") {
    const url = new URL(window.location.href);
    url.searchParams.delete("scan");
    if (state.bandId) url.searchParams.set("band", state.bandId);
    else url.searchParams.delete("band");
    if (state.nodeId) url.searchParams.set("node", state.nodeId);
    else url.searchParams.delete("node");
    url.searchParams.delete("receipts");
    if (["front", "top"].includes(state.projection)) url.searchParams.set("projection", state.projection);
    else url.searchParams.delete("projection");
    const hasInstrumentState = state.bandId || state.nodeId || state.projection !== "free";
    if (hasInstrumentState) url.hash = "profile-map";
    else if (url.hash === "#profile-map") url.hash = "";
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === current) return;
    window.history[method]({ stellarSpectrum: { ...state } }, "", next);
  }

  function startScan() {
    window.clearTimeout(scanTimer);
    stageElement.classList.remove("is-scanning");
    if (reducedMotion.matches || document.hidden || !stageIsVisible) return;
    window.requestAnimationFrame(() => {
      stageElement.classList.add("is-scanning");
      scanTimer = window.setTimeout(() => stageElement.classList.remove("is-scanning"), 760);
    });
  }

  function sourceRefsForBand(band) {
    const refs = [];
    const seen = new Set();
    band.nodes.forEach((node) => {
      node.evidenceRefs.forEach((ref) => {
        if (!seen.has(ref)) {
          seen.add(ref);
          refs.push(ref);
        }
      });
    });
    return refs;
  }

  function refsByContext(refs) {
    const grouped = new Map(SOURCE_CONTEXTS.map((context) => [context.id, []]));
    const unclassified = [];
    refs.forEach((ref) => {
      const context = SOURCE_CONTEXTS.find((candidate) => candidate.refs.has(ref));
      if (context) grouped.get(context.id).push(ref);
      else unclassified.push(ref);
    });
    return { grouped, unclassified };
  }

  function sourceLink(ref) {
    const source = profile.evidence[ref];
    if (!source) return element("span", "stellar-spectrum__source-empty", `Missing source: ${ref}`);
    const link = element("a", "stellar-spectrum__source-link", source.label);
    link.href = source.url;
    const details = [MATURITY_LABELS[source.kind] || source.kind, sourceDate(source)].filter(Boolean);
    if (details.length) link.setAttribute("aria-label", `${source.label}; ${details.join("; ")}`);
    return link;
  }

  function renderSourceContexts(refs, extraPanels = []) {
    const grid = element("div", "stellar-spectrum__source-grid");
    const seenSourceUrls = new Set();
    const uniqueRefs = (refs || []).filter((ref) => {
      const source = profile.evidence[ref];
      const key = normalizedHref(source?.url) || `ref:${ref}`;
      if (seenSourceUrls.has(key)) return false;
      seenSourceUrls.add(key);
      return true;
    });
    const { grouped, unclassified } = refsByContext(uniqueRefs);

    const panels = SOURCE_CONTEXTS
      .map((context) => ({
        id: context.id,
        label: context.label,
        refs: grouped.get(context.id)
      }))
      .filter((panel) => panel.refs.length);

    if (unclassified.length) {
      panels.push({ id: "other", label: "Other current sources", refs: unclassified });
    }

    extraPanels.forEach((panel) => {
      if (!panel || !panel.content || panel.count === 0) return;
      panels.push({
        id: panel.id,
        label: panel.label,
        count: panel.count,
        content: panel.content
      });
    });

    if (!panels.length) {
      grid.append(element("p", "stellar-spectrum__source-empty", "No attached source in current profile data."));
      return grid;
    }

    const instance = ++sourceTabsSequence;
    const sections = panels.map((panel) => {
      const section = element("section", "stellar-spectrum__source-context has-sources");
      section.dataset.sourceContext = panel.id;
      section.id = `stellar-source-panel-${instance}-${panel.id}`;
      section.append(element("h5", "", panel.label));

      if (panel.content) {
        section.append(panel.content);
      } else {
        const list = element("ul");
        panel.refs.forEach((ref) => {
          const item = element("li");
          item.dataset.sourceRef = ref;
          item.append(sourceLink(ref));
          const date = profile.evidence[ref] && sourceDate(profile.evidence[ref]);
          if (date) item.append(document.createTextNode(` · ${date}`));
          list.append(item);
        });
        section.append(list);
      }

      grid.append(section);
      return section;
    });

    if (panels.length > 1) {
      grid.classList.add("is-tabbed");
      const tabList = element("div", "stellar-spectrum__source-tabs");
      tabList.setAttribute("role", "tablist");
      tabList.setAttribute("aria-label", "Evidence sections");
      const tabs = panels.map((panel, index) => {
        const count = panel.count ?? panel.refs.length;
        const tab = element("button", "stellar-spectrum__source-tab");
        tab.type = "button";
        tab.id = `stellar-source-tab-${instance}-${panel.id}`;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", sections[index].id);
        tab.setAttribute("aria-label", `${panel.label}, ${count} ${count === 1 ? "item" : "items"}`);
        tab.append(
          document.createTextNode(panel.label),
          element("span", "stellar-spectrum__source-tab-count", String(count))
        );
        sections[index].setAttribute("role", "tabpanel");
        sections[index].setAttribute("aria-labelledby", tab.id);
        tabList.append(tab);
        return tab;
      });

      const activateTab = (nextIndex, { focus = false } = {}) => {
        tabs.forEach((tab, index) => {
          const active = index === nextIndex;
          tab.setAttribute("aria-selected", String(active));
          tab.tabIndex = active ? 0 : -1;
          sections[index].hidden = !active;
        });
        if (focus) tabs[nextIndex].focus();
      };

      tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => activateTab(index));
        tab.addEventListener("keydown", (event) => {
          let nextIndex = index;
          if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
          else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
          else if (event.key === "Home") nextIndex = 0;
          else if (event.key === "End") nextIndex = tabs.length - 1;
          else return;
          event.preventDefault();
          activateTab(nextIndex, { focus: true });
        });
      });

      grid.prepend(tabList);
      activateTab(0);
    }

    return grid;
  }

  function appendReadoutHeader(label) {
    readoutElement.replaceChildren();
    const header = element("div", "stellar-tree__popup-header");
    const closeButton = element("button", "stellar-tree__popup-close", "Close");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close selected profile evidence");
    closeButton.addEventListener("click", () => closePopup({ restore: true }));
    header.append(element("p", "stellar-spectrum__readout-kicker", label), closeButton);
    readoutElement.append(header);
  }

  function appendMeta(values) {
    const meta = element("div", "stellar-spectrum__readout-meta");
    values.filter(Boolean).forEach((value) => meta.append(element("span", "", value)));
    readoutElement.append(meta);
  }

  function tokenSet(value) {
    return new Set(String(value || "").split(/\s+/).map((token) => token.trim()).filter(Boolean));
  }

  function intersects(first, second) {
    for (const value of first) if (second.has(value)) return true;
    return false;
  }

  function normalizedHref(value) {
    if (!value) return "";
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin === window.location.origin) {
        return `${url.pathname.replace(/\/index\.html$/, "/")}${url.search}${url.hash}`;
      }
      return url.href;
    } catch (_error) {
      return String(value);
    }
  }

  function markElement(target, related) {
    target.classList.toggle("is-stellar-related", related);
    target.classList.toggle("is-stellar-muted", !related);
  }

  function clearHighlights() {
    document.documentElement.classList.remove("stellar-focus-active");
    document.querySelectorAll(".is-stellar-related, .is-stellar-muted, .is-stellar-source").forEach((target) => {
      target.classList.remove("is-stellar-related", "is-stellar-muted", "is-stellar-source", "is-stellar-primary");
    });
  }

  function syncPageLens() {
    root.dataset.stellarActiveScan = state.scan;
    root.querySelectorAll("[data-stellar-lens], [data-stellar-lens-copy]").forEach((target) => {
      const lens = target.dataset.stellarLens || target.dataset.stellarLensCopy;
      const emphasized = state.scan === "combined" || lens === "whole" || lens === state.scan;
      target.dataset.stellarLensEmphasis = emphasized ? "primary" : "secondary";
    });
  }

  function applyHighlights() {
    clearHighlights();
    const indexedNode = state.nodeId && nodeIndex.get(state.nodeId);
    if (!indexedNode) return;

    document.documentElement.classList.add("stellar-focus-active");
    const evidenceRefs = new Set(indexedNode.node.evidenceRefs || []);
    const relatedNodeIds = edgesForNode(indexedNode).map((edge) => (
      edge.source === indexedNode.node.id ? edge.target : edge.source
    ));
    const nodeIds = new Set([indexedNode.node.id, ...relatedNodeIds]);
    const evidenceUrls = new Set(
      Array.from(evidenceRefs)
        .map((reference) => profile.evidence[reference]?.url)
        .filter(Boolean)
        .map(normalizedHref)
    );

    document.querySelectorAll("[data-stellar-surface='career']").forEach((entry) => {
      const entryEvidence = tokenSet(entry.dataset.stellarEvidence);
      const entryNodes = tokenSet(entry.dataset.stellarNodes);
      markElement(
        entry,
        (entryEvidence.size > 0 && intersects(entryEvidence, evidenceRefs)) ||
          (entryNodes.size > 0 && intersects(entryNodes, nodeIds))
      );
    });

    document.querySelectorAll("[data-stellar-surface='stack']").forEach((entry) => {
      const entryNodes = tokenSet(entry.dataset.stellarNodes);
      markElement(entry, entryNodes.size > 0 && intersects(entryNodes, nodeIds));
    });

    document.querySelectorAll(".profile-map-evidence tbody tr").forEach((row) => {
      const rowNodeId = row.id.replace(/^profile-map-evidence-/, "");
      markElement(row, nodeIds.has(rowNodeId));
      row.classList.toggle("is-stellar-primary", rowNodeId === indexedNode.node.id);
    });

    if (labJournal) {
      Array.from(labJournal.children).forEach((entry) => {
        if (!entry.matches("article, a")) return;
        const links = Array.from(entry.querySelectorAll("a[href]"));
        if (entry.matches("a[href]")) links.push(entry);
        markElement(entry, links.some((link) => evidenceUrls.has(normalizedHref(link.getAttribute("href")))));
      });
    }

    document.querySelectorAll("main a[href]").forEach((link) => {
      link.classList.toggle("is-stellar-source", evidenceUrls.has(normalizedHref(link.getAttribute("href"))));
    });
  }

  function renderEmptyReadout() {
    readoutElement.replaceChildren();
  }

  function renderBandReadout(band) {
    const refs = sourceRefsForBand(band);
    appendReadoutHeader(`[${band.dataset.label.toUpperCase()} / ${band.axis.label.toUpperCase()}]`);
    readoutElement.append(
      element("h3", "", `${band.dataset.label} · ${band.axis.label}`),
      element("p", "stellar-spectrum__readout-summary", band.axis.description)
    );
    appendMeta([`${band.nodes.length} signals`, `${refs.length} sources`]);
    readoutElement.append(element("h4", "", "Evidence"), renderSourceContexts(refs));
  }

  function edgesForNode(indexedNode) {
    return indexedNode.dataset.edges.filter((edge) => edge.source === indexedNode.node.id || edge.target === indexedNode.node.id);
  }

  function selectRelatedNode(nodeId) {
    const indexedNode = nodeIndex.get(nodeId);
    if (!indexedNode || !modeContainsBand(state.scan, indexedNode.bandId)) return;
    state.bandId = indexedNode.bandId;
    state.nodeId = nodeId;
    popupReturnTarget = { type: "node", id: nodeId };
    writeLocationState();
    render({ focus: "popup" });
  }

  function renderRelationships(indexedNode) {
    const edges = edgesForNode(indexedNode);
    if (!edges.length) return element("p", "stellar-spectrum__source-empty", "No relationship edge is attached to this node in the current profile data.");

    const list = element("div", "stellar-spectrum__relationships");
    edges.forEach((edge) => {
      const otherId = edge.source === indexedNode.node.id ? edge.target : edge.source;
      const other = nodeIndex.get(otherId);
      if (!other) return;
      const relation = element("section", "stellar-spectrum__relationship");
      relation.dataset.maturity = edge.maturity;
      relation.dataset.edgeId = edge.id;
      const heading = element("div", "stellar-spectrum__relationship-heading");
      const button = element("button", "stellar-spectrum__related-node", other.node.label);
      button.type = "button";
      button.dataset.relatedNode = otherId;
      button.addEventListener("click", () => selectRelatedNode(otherId));
      heading.append(button, element("span", "stellar-spectrum__relationship-style", MATURITY_LABELS[edge.maturity] || edge.maturity));
      const description = element("p", "", `${edge.relation}. Supported by `);
      edge.evidenceRefs.forEach((ref, index) => {
        if (index > 0) description.append(document.createTextNode(index === edge.evidenceRefs.length - 1 ? " and " : ", "));
        const source = profile.evidence[ref];
        description.append(element(
          "span",
          "stellar-spectrum__relationship-source",
          source?.label || `Missing source: ${ref}`
        ));
      });
      description.append(document.createTextNode("."));
      relation.append(heading, description);
      list.append(relation);
    });
    return list;
  }

  function renderNodeReadout(band, node) {
    const indexedNode = nodeIndex.get(node.id);
    const maturity = MATURITY_LABELS[node.maturity] || node.maturity;
    appendReadoutHeader(`[${band.dataset.label.toUpperCase()} / ${band.axis.label.toUpperCase()}]`);
    readoutElement.append(
      element("h3", "", node.label),
      element("p", "stellar-spectrum__readout-summary", node.summary)
    );
    appendMeta([
      `${band.dataset.label} / ${band.axis.label}`,
      maturity,
      node.lastEvidencedAt ? `Last dated evidence ${node.lastEvidencedAt}` : "No dated evidence",
      node.reviewedAt ? `Data reviewed ${node.reviewedAt}` : ""
    ]);
    const relationshipCount = edgesForNode(indexedNode).length;
    readoutElement.append(
      element("h4", "", "Evidence and relationships"),
      renderSourceContexts(node.evidenceRefs, [{
        id: "relationships",
        label: "Relationships",
        count: relationshipCount,
        content: renderRelationships(indexedNode)
      }])
    );
    const tableLink = element("a", "stellar-spectrum__table-link", "Open this node in the complete source table →");
    tableLink.href = `#profile-map-evidence-${node.id}`;
    tableLink.addEventListener("click", (event) => {
      event.preventDefault();
      setEvidenceOpen(true, { focus: true, rowId: `profile-map-evidence-${node.id}` });
    });
    readoutElement.append(tableLink);
  }

  function renderReadout() {
    const band = state.bandId && bandForId(state.bandId);
    if (!band) {
      renderEmptyReadout();
      readoutElement.hidden = true;
      return;
    }
    readoutElement.hidden = false;
    const node = state.nodeId && band.nodes.find((candidate) => candidate.id === state.nodeId);
    if (node) renderNodeReadout(band, node);
    else renderBandReadout(band);
  }

  function nodeButton(band, node) {
    const button = element("button", "stellar-spectrum__node");
    button.type = "button";
    button.dataset.nodeId = node.id;
    button.dataset.maturity = node.maturity;
    if (LEFT_NODE_LABELS.has(node.id)) button.dataset.treeLabelSide = "left";
    button.style.setProperty("--band-tone", band.tone);
    button.setAttribute("aria-pressed", String(state.nodeId === node.id));
    button.setAttribute("aria-label", `${node.label}; ${MATURITY_LABELS[node.maturity] || node.maturity}; ${node.evidenceRefs.length} cited source${node.evidenceRefs.length === 1 ? "" : "s"}`);
    button.append(element("span", "stellar-spectrum__node-mark"), element("span", "stellar-spectrum__node-label", node.label));
    button.addEventListener("click", () => {
      const closing = state.nodeId === node.id;
      popupReturnTarget = { type: "node", id: node.id };
      state.bandId = band.id;
      state.nodeId = closing ? null : node.id;
      writeLocationState();
      if (closing) render({ focus: "node", focusId: node.id });
      else render({ focus: "popup" });
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(root.querySelectorAll(`[data-band-id="${band.id}"] .stellar-spectrum__node`));
      const currentIndex = buttons.indexOf(event.currentTarget);
      let nextIndex = currentIndex;
      if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = buttons.length - 1;
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % buttons.length;
      else nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      buttons[nextIndex].focus();
    });
    return button;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeAngle(angle) {
    const fullTurn = Math.PI * 2;
    return ((angle + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
  }

  function frontProjectionCamera() {
    const orbit = fixedViewPhase * 1.25;
    return {
      yaw: Math.sin(orbit) * 0.12,
      pitch: Math.cos(orbit) * 0.075,
      roll: 0
    };
  }

  function matchFixedProjectionCamera(projection) {
    if (projection === "front") {
      Object.assign(state, frontProjectionCamera());
    } else if (projection === "top") {
      state.yaw = fixedViewPhase * 0.48;
      state.pitch = -Math.PI / 2;
      state.roll = 0;
    }
  }

  function enterFreeProjection() {
    if (state.projection === "free") return false;
    matchFixedProjectionCamera(state.projection);
    state.projection = "free";
    writeLocationState("replaceState");
    updateProjectionControls();
    return true;
  }

  function noteCameraInteraction(delay = IDLE_ROTATION_DELAY) {
    cameraInteractionUntil = window.performance.now() + delay;
    if (root.dataset.treeMotion !== "paused") root.dataset.treeMotion = "paused";
  }

  function runIdleRotation(timestamp) {
    const canRotate = !reducedMotion.matches
      && !document.hidden
      && stageIsVisible
      && !state.bandId
      && !sourcePanelOpen
      && !cameraPointerActive
      && timestamp >= cameraInteractionUntil;

    if (canRotate) {
      if (root.dataset.treeMotion !== "idle-rotation") root.dataset.treeMotion = "idle-rotation";
      const elapsed = idleRotationTimestamp ? timestamp - idleRotationTimestamp : 0;
      if (elapsed >= idleRotationFrameInterval()) {
        const boundedElapsed = Math.min(100, elapsed);
        const zoomAdjustedSpeed = IDLE_ROTATION_SPEED / zoomMotionScale();
        root.style.setProperty("--stellar-idle-tween-duration", `${Math.ceil(idleRotationFrameInterval() * 1.35)}ms`);
        idleRotationTimestamp = timestamp;
        if (state.projection === "free") {
          state.yaw = normalizeAngle(state.yaw + boundedElapsed * zoomAdjustedSpeed);
          syncCameraControls();
        } else {
          fixedViewPhase += boundedElapsed * zoomAdjustedSpeed * 1.8;
        }
        drawTreeScene();
      }
    } else {
      idleRotationTimestamp = timestamp;
      const motionState = reducedMotion.matches ? "reduced" : "paused";
      if (root.dataset.treeMotion !== motionState) {
        root.dataset.treeMotion = motionState;
      }
    }
    idleRotationFrame = window.requestAnimationFrame(runIdleRotation);
  }

  function startIdleRotation() {
    if (idleRotationFrame) return;
    idleRotationTimestamp = 0;
    cameraInteractionUntil = window.performance.now() + 350;
    idleRotationFrame = window.requestAnimationFrame(runIdleRotation);
  }

  function syncTreeInteractionControl() {
    const locked = mobileTreeInteraction.matches && treeInteractionLocked;
    root.dataset.treeInteraction = locked ? "locked" : "unlocked";
    if (!interactionToggle) return;
    interactionToggle.setAttribute("aria-pressed", String(locked));
    const label = locked ? "Unlock stellar tree interaction" : "Lock stellar tree interaction";
    interactionToggle.setAttribute("aria-label", label);
    interactionToggle.title = locked ? "Unlock drag and pinch controls" : "Lock drag and pinch controls";
    if (interactionLabel) interactionLabel.textContent = label;
  }

  function cancelZoomTween({ sync = true } = {}) {
    if (zoomTweenFrame) window.cancelAnimationFrame(zoomTweenFrame);
    zoomTweenFrame = 0;
    zoomTweenStartTimestamp = 0;
    zoomTweenStart = state.zoom;
    zoomTweenDuration = 0;
    zoomTarget = state.zoom;
    if (sync) {
      syncCameraControls();
      updateStatus();
    }
  }

  function tweenZoomTo(target) {
    const nextTarget = clamp(target, MIN_ZOOM, MAX_ZOOM);
    zoomTweenStart = state.zoom;
    zoomTarget = nextTarget;
    zoomTweenStartTimestamp = 0;
    zoomTweenDuration = clamp(280 + Math.abs(zoomTarget - zoomTweenStart) * 95, 300, 460);
    const targetPercentage = Math.round(nextTarget * 100);
    if (zoomRange) {
      zoomRange.value = String(targetPercentage);
      zoomRange.setAttribute("aria-valuetext", `${targetPercentage} percent`);
    }
    if (reducedMotion.matches) {
      cancelZoomTween({ sync: false });
      state.zoom = nextTarget;
      syncCameraControls();
      updateStatus();
      drawTreeScene();
      return;
    }
    if (zoomTweenFrame) return;
    const step = (timestamp) => {
      if (reducedMotion.matches) {
        const reducedMotionTarget = zoomTarget;
        cancelZoomTween({ sync: false });
        state.zoom = reducedMotionTarget;
        syncCameraControls();
        updateStatus();
        drawTreeScene();
        return;
      }
      if (!zoomTweenStartTimestamp) {
        zoomTweenStartTimestamp = timestamp;
        zoomTweenFrame = window.requestAnimationFrame(step);
        return;
      }
      const progress = clamp((timestamp - zoomTweenStartTimestamp) / zoomTweenDuration, 0, 1);
      const easedProgress = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      state.zoom = zoomTweenStart + (zoomTarget - zoomTweenStart) * easedProgress;
      const settled = progress >= 1;
      if (settled) state.zoom = zoomTarget;
      syncCameraControls({ syncZoomRange: settled });
      drawTreeScene();
      if (settled) {
        zoomTweenFrame = 0;
        zoomTweenStartTimestamp = 0;
        zoomTweenStart = state.zoom;
        zoomTweenDuration = 0;
        updateStatus();
      } else {
        zoomTweenFrame = window.requestAnimationFrame(step);
      }
    };
    zoomTweenFrame = window.requestAnimationFrame(step);
  }

  function bindReducedMotionZoom() {
    reducedMotion.addEventListener?.("change", () => {
      if (!reducedMotion.matches || !zoomTweenFrame) return;
      const reducedMotionTarget = zoomTarget;
      cancelZoomTween({ sync: false });
      state.zoom = reducedMotionTarget;
      syncCameraControls();
      updateStatus();
      drawTreeScene();
    });
  }

  function bindTreeInteractionControl() {
    syncTreeInteractionControl();
    interactionToggle?.addEventListener("click", () => {
      treeInteractionLocked = !treeInteractionLocked;
      syncTreeInteractionControl();
      updateStatus();
      interactionToggle.focus();
    });
    const resetForViewport = (event) => {
      treeInteractionLocked = event.matches;
      syncTreeInteractionControl();
      updateStatus();
    };
    if (typeof mobileTreeInteraction.addEventListener === "function") {
      mobileTreeInteraction.addEventListener("change", resetForViewport);
    } else {
      mobileTreeInteraction.addListener(resetForViewport);
    }
  }

  function syncEvidenceTrigger() {
    if (!rootMarkerElement) return;
    rootMarkerElement.setAttribute("aria-expanded", String(sourcePanelOpen));
    rootMarkerElement.classList.toggle("is-open", sourcePanelOpen);
  }

  function setEvidenceOpen(open, { focus = false, rowId = "" } = {}) {
    sourcePanelOpen = Boolean(open);
    evidenceDetails.open = sourcePanelOpen;
    evidenceDetails.dataset.panelOpen = String(sourcePanelOpen);
    evidenceDetails.toggleAttribute("inert", !sourcePanelOpen);
    if (sourcePanelOpen) evidenceDetails.removeAttribute("aria-hidden");
    else evidenceDetails.setAttribute("aria-hidden", "true");
    if (evidenceBackdropElement) evidenceBackdropElement.hidden = !sourcePanelOpen;
    root.dataset.sourceIndex = sourcePanelOpen ? "open" : "closed";
    syncEvidenceTrigger();
    noteCameraInteraction();
    if (!sourcePanelOpen) {
      if (focus) rootMarkerElement?.focus();
      return;
    }
    window.requestAnimationFrame(() => {
      const row = rowId ? document.getElementById(rowId) : null;
      const scroller = evidenceDetails.querySelector(".profile-map-evidence__body");
      if (!rowId) scroller?.scrollTo({ top: 0, left: 0, behavior: "instant" });
      row?.scrollIntoView({ block: "center", inline: "nearest" });
      if (focus) evidenceDetails.querySelector("summary")?.focus();
    });
  }

  function bindEvidencePanel() {
    sourcePanelOpen = false;
    evidenceDetails.open = false;
    evidenceDetails.dataset.panelOpen = "false";
    evidenceDetails.setAttribute("aria-hidden", "true");
    evidenceDetails.setAttribute("inert", "");
    evidenceDetails.classList.add("profile-map-evidence--tree-panel");
    const summary = evidenceDetails.querySelector("summary");
    summary?.addEventListener("click", (event) => {
      event.preventDefault();
      if (sourcePanelOpen) setEvidenceOpen(false, { focus: true });
    });
    const backdrop = element("button", "stellar-tree__source-backdrop");
    backdrop.type = "button";
    backdrop.hidden = true;
    backdrop.dataset.sourceDismiss = "";
    backdrop.setAttribute("aria-label", "Close sources and map key");
    const dismissFromBackdrop = (event) => {
      event.preventDefault();
      setEvidenceOpen(false);
    };
    backdrop.addEventListener("pointerdown", dismissFromBackdrop);
    backdrop.addEventListener("click", dismissFromBackdrop);
    evidenceBackdropElement = backdrop;
    stageElement.append(backdrop);
    stageElement.append(evidenceDetails);
    root.dataset.sourceIndex = "closed";

    let printPrepared = false;
    const preparePrintSources = () => {
      if (printPrepared) return;
      printPrepared = true;
      // Chromium can paginate from the screen layout before print-only CSS has
      // expanded a visually collapsed disclosure. Mirror the open screen state
      // before pagination, then restore the user's actual state after printing.
      evidenceDetails.dataset.panelOpen = "true";
      evidenceDetails.open = true;
      evidenceDetails.removeAttribute("aria-hidden");
      evidenceDetails.removeAttribute("inert");
      if (evidenceBackdropElement) evidenceBackdropElement.hidden = true;
      // Force the expanded disclosure through layout while the beforeprint
      // event is still synchronous; Chromium otherwise keeps the pagination
      // count from the collapsed screen state and truncates later rows.
      void evidenceDetails.offsetHeight;
      void document.documentElement.offsetHeight;
    };
    const restorePrintSources = () => {
      if (!printPrepared) return;
      printPrepared = false;
      evidenceDetails.open = sourcePanelOpen;
      evidenceDetails.dataset.panelOpen = String(sourcePanelOpen);
      evidenceDetails.toggleAttribute("inert", !sourcePanelOpen);
      if (sourcePanelOpen) evidenceDetails.removeAttribute("aria-hidden");
      else evidenceDetails.setAttribute("aria-hidden", "true");
      if (evidenceBackdropElement) evidenceBackdropElement.hidden = !sourcePanelOpen;
      root.dataset.sourceIndex = sourcePanelOpen ? "open" : "closed";
      syncEvidenceTrigger();
    };
    const printMedia = window.matchMedia("print");
    window.addEventListener("beforeprint", preparePrintSources);
    window.addEventListener("afterprint", restorePrintSources);
    const handlePrintMedia = (event) => event.matches ? preparePrintSources() : restorePrintSources();
    if (typeof printMedia.addEventListener === "function") printMedia.addEventListener("change", handlePrintMedia);
    else printMedia.addListener(handlePrintMedia);
    if (printMedia.matches) preparePrintSources();
  }

  function hashSeed(value) {
    let hash = 2166136261;
    for (const character of value) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function randomFromSeed(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function lerp(first, second, progress) {
    return first + (second - first) * progress;
  }

  function lerpPoint(first, second, progress) {
    return {
      x: lerp(first.x, second.x, progress),
      y: lerp(first.y, second.y, progress),
      z: lerp(first.z, second.z, progress)
    };
  }

  function cubicPoint(first, controlA, controlB, last, progress) {
    const inverse = 1 - progress;
    return {
      x: inverse ** 3 * first.x + 3 * inverse ** 2 * progress * controlA.x + 3 * inverse * progress ** 2 * controlB.x + progress ** 3 * last.x,
      y: inverse ** 3 * first.y + 3 * inverse ** 2 * progress * controlA.y + 3 * inverse * progress ** 2 * controlB.y + progress ** 3 * last.y,
      z: inverse ** 3 * first.z + 3 * inverse ** 2 * progress * controlA.z + 3 * inverse * progress ** 2 * controlB.z + progress ** 3 * last.z
    };
  }

  function layoutPoint(point, datasetKey) {
    if (state.scan === "combined") return { x: point[0], y: point[1], z: point[2] || 0 };
    const start = datasetKey === "engineering" ? 52 : 520;
    const span = datasetKey === "engineering" ? 510 : 430;
    return {
      x: 82 + ((point[0] - start) / span) * 836,
      y: point[1],
      z: point[2] || 0
    };
  }

  function worldPoint(point, datasetKey) {
    const authored = Array.isArray(point) ? layoutPoint(point, datasetKey) : point;
    return {
      x: (authored.x - 500) / 120,
      y: (400 - authored.y) / 55,
      z: authored.z / 65
    };
  }

  function curveBetween(first, last, bend = 0, depthBend = 0, samples = 26) {
    const controlA = lerpPoint(first, last, 0.34);
    const controlB = lerpPoint(first, last, 0.72);
    controlA.x += bend;
    controlB.x -= bend * 0.28;
    controlA.z += depthBend;
    controlB.z -= depthBend * 0.35;
    return Array.from({ length: samples }, (_, index) => cubicPoint(first, controlA, controlB, last, index / (samples - 1)));
  }

  function treeBranchButton(band) {
    const active = state.bandId === band.id;
    const trigger = element("button", "stellar-tree__branch-label");
    trigger.id = `stellar-spectrum-band-${band.datasetKey}-${band.axis.id}`;
    trigger.type = "button";
    trigger.dataset.bandTrigger = band.id;
    trigger.setAttribute("aria-pressed", String(active));
    trigger.setAttribute("aria-label", `${band.dataset.label}, ${band.axis.label}; ${band.nodes.length} equal signal points`);
    trigger.append(
      element("span", "stellar-tree__branch-dataset", band.dataset.label),
      element("strong", "", band.axis.label),
      element("span", "stellar-tree__branch-count", `${band.nodes.length} signals`)
    );
    trigger.addEventListener("click", () => {
      const closing = state.bandId === band.id;
      popupReturnTarget = { type: "band", id: band.id };
      state.bandId = closing ? null : band.id;
      state.nodeId = null;
      writeLocationState();
      if (closing) render({ focus: "band", focusId: band.id });
      else render({ focus: "popup" });
    });
    trigger.addEventListener("keydown", (event) => {
      if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const triggers = Array.from(root.querySelectorAll("[data-band-trigger]"));
      const currentIndex = triggers.indexOf(event.currentTarget);
      let nextIndex = currentIndex;
      if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = triggers.length - 1;
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % triggers.length;
      else nextIndex = (currentIndex - 1 + triggers.length) % triggers.length;
      triggers[nextIndex]?.focus();
    });
    return trigger;
  }

  function pathParticles(path, count, radius, size, alpha, seed) {
    const random = randomFromSeed(hashSeed(seed));
    return Array.from({ length: count }, () => {
      const progress = random() * (path.points.length - 1);
      const index = Math.min(path.points.length - 2, Math.floor(progress));
      const center = lerpPoint(path.points[index], path.points[index + 1], progress - index);
      const angle = random() * Math.PI * 2;
      const radial = radius * Math.sqrt(random());
      const layerRoll = random();
      const layer = layerRoll < 0.14 ? "shadow" : layerRoll < 0.3 ? "haze" : layerRoll > 0.88 ? "rim" : "body";
      const layerSize = layer === "haze" ? 1.7 : layer === "shadow" ? 1.18 : 1;
      const layerAlpha = layer === "haze" ? 0.42 : layer === "rim" ? 0.5 : layer === "shadow" ? 0.86 : 1;
      return {
        x: center.x + Math.cos(angle) * radial,
        y: center.y + Math.sin(angle) * radial * (0.52 + random() * 0.5),
        z: center.z + (random() - 0.5) * radius * 2.8,
        size: size * (0.48 + random() * 1.25) * layerSize,
        alpha: alpha * (0.45 + random() * 0.68) * layerAlpha,
        aspect: 0.58 + random() * 1.08,
        rotation: random() * Math.PI,
        variant: Math.floor(random() * 5),
        layer,
        color: path.color
      };
    });
  }

  function buildTreeGeometry(visibleBands) {
    const rootPoint = worldPoint({ x: 500, y: 752, z: 0 });
    const engineeringJunction = worldPoint(state.scan === "combined" ? { x: 374, y: 655, z: 105 } : { x: 500, y: 655, z: 105 });
    const interestsJunction = worldPoint(state.scan === "combined" ? { x: 626, y: 655, z: -92 } : { x: 500, y: 655, z: -92 });
    const paths = [];
    const controlPoints = new Map([["root", rootPoint]]);
    const pointByNode = new Map();

    const addPath = (kind, id, points, color, width, alpha, maturity = "shipped") => {
      paths.push({ kind, id, points, color, width, alpha, maturity });
    };

    if (state.scan === "combined") {
      addPath("trunk", "trunk-engineering", curveBetween(rootPoint, engineeringJunction, -0.28, 0.82), "#65a8ff", 0.085, 0.84);
      addPath("trunk", "trunk-interests", curveBetween(rootPoint, interestsJunction, 0.28, -0.66), "#5bd5bc", 0.085, 0.82);
    } else {
      const junction = state.scan === "engineering" ? engineeringJunction : interestsJunction;
      addPath("trunk", "trunk", curveBetween(rootPoint, junction, 0, state.scan === "engineering" ? 0.78 : -0.72), visibleBands[0]?.tone || "#65a8ff", 0.09, 0.86);
    }

    visibleBands.forEach((band, bandIndex) => {
      const layout = TREE_LAYOUT[band.id];
      if (!layout || layout.leaves.length !== band.nodes.length) return;
      const anchor = worldPoint(layout.anchor, band.datasetKey);
      const junction = band.datasetKey === "engineering" ? engineeringJunction : interestsJunction;
      controlPoints.set(`band:${band.id}`, anchor);
      addPath(
        "limb",
        `limb:${band.id}`,
        curveBetween(junction, anchor, (bandIndex % 2 ? 1 : -1) * 0.34, (bandIndex - 3.5) * 0.19),
        band.tone,
        0.052,
        state.bandId && state.bandId !== band.id ? 0.15 : 0.74
      );

      band.nodes.forEach((node, nodeIndexInBand) => {
        const point = worldPoint(layout.leaves[nodeIndexInBand], band.datasetKey);
        pointByNode.set(node.id, point);
        controlPoints.set(`node:${node.id}`, point);
        addPath(
          "twig",
          `twig:${node.id}`,
          curveBetween(anchor, point, (nodeIndexInBand - (band.nodes.length - 1) / 2) * 0.06, (nodeIndexInBand % 2 ? 1 : -1) * 0.24),
          band.tone,
          state.nodeId === node.id ? 0.044 : 0.022,
          state.bandId && state.bandId !== band.id ? 0.1 : state.nodeId === node.id ? 0.96 : 0.5,
          node.maturity
        );
      });
    });

    const seenEdges = new Set();
    visibleBands.forEach((band) => band.edges.forEach((edge) => {
      if (seenEdges.has(edge.id)) return;
      seenEdges.add(edge.id);
      const source = pointByNode.get(edge.source);
      const target = pointByNode.get(edge.target);
      if (!source || !target) return;
      const active = state.nodeId && (edge.source === state.nodeId || edge.target === state.nodeId);
      addPath("filament", `edge:${edge.id}`, curveBetween(source, target, 0.12, 0.34, 18), active ? "#d5e9ff" : "#6c8fb5", active ? 0.018 : 0.008, active ? 0.62 : 0.045, edge.maturity);
    }));

    const cloudParticles = [];
    paths.filter((path) => path.kind !== "filament").forEach((path) => {
      const specification = path.kind === "trunk"
        ? { count: 220, radius: 0.72, size: 0.19, alpha: 0.115 }
        : path.kind === "limb"
          ? { count: 125, radius: 0.54, size: 0.16, alpha: 0.095 }
          : { count: 25, radius: 0.27, size: 0.09, alpha: 0.072 };
      cloudParticles.push(...pathParticles(path, specification.count, specification.radius, specification.size, specification.alpha, path.id));
    });

    const random = randomFromSeed(hashSeed(`stars:${state.scan}`));
    const stars = Array.from({ length: 260 }, (_, index) => ({
      x: (random() - 0.5) * 10.8,
      y: (random() - 0.5) * 14.2,
      z: (random() - 0.5) * 11.5,
      size: index % 61 === 0 ? 2.7 : index % 17 === 0 ? 1.55 : 0.5 + random() * 0.72,
      alpha: 0.28 + random() * 0.66,
      color: index % 13 === 0 ? "#c8ddff" : index % 19 === 0 ? "#fff0d3" : "#edf6ff"
    }));

    return { paths, cloudParticles, stars, controlPoints };
  }

  function rotateWithCamera(point, yaw, pitch, roll) {
    const cosineYaw = Math.cos(yaw);
    const sineYaw = Math.sin(yaw);
    const cosinePitch = Math.cos(pitch);
    const sinePitch = Math.sin(pitch);
    const cosineRoll = Math.cos(roll);
    const sineRoll = Math.sin(roll);
    const yawedX = point.x * cosineYaw + point.z * sineYaw;
    const firstDepth = -point.x * sineYaw + point.z * cosineYaw;
    const pitchedY = point.y * cosinePitch - firstDepth * sinePitch;
    const pitchedDepth = point.y * sinePitch + firstDepth * cosinePitch;
    return {
      x: yawedX * cosineRoll - pitchedY * sineRoll,
      y: yawedX * sineRoll + pitchedY * cosineRoll,
      z: pitchedDepth
    };
  }

  function rotateTreePoint(point) {
    if (state.projection === "front") {
      const camera = frontProjectionCamera();
      return rotateWithCamera(point, camera.yaw, camera.pitch, camera.roll);
    }
    if (state.projection === "top") {
      const spin = fixedViewPhase * 0.48;
      const cosine = Math.cos(spin);
      const sine = Math.sin(spin);
      return {
        x: point.x * cosine + point.z * sine,
        y: -point.x * sine + point.z * cosine,
        z: -point.y
      };
    }
    return rotateWithCamera(point, state.yaw, state.pitch, state.roll);
  }

  function projectTreePoint(point, width, height, offsetX = 0, offsetY = 0, originY = height * 0.5) {
    const rotated = rotateTreePoint(point);
    const cameraDistance = 12.5;
    const baseScale = Math.min(width / 8.6, height / 15.5) * state.zoom;
    const perspective = clamp(cameraDistance / (cameraDistance - rotated.z), 0.48, 1.75);
    return {
      x: offsetX + width * 0.5 + rotated.x * baseScale * perspective,
      y: offsetY + originY - rotated.y * baseScale * perspective,
      depth: rotated.z,
      scale: perspective,
      visible: cameraDistance - rotated.z > 1.2
    };
  }

  const cloudSprites = new Map();

  function hexChannels(color) {
    const normalized = color.replace("#", "");
    return {
      red: Number.parseInt(normalized.slice(0, 2), 16),
      green: Number.parseInt(normalized.slice(2, 4), 16),
      blue: Number.parseInt(normalized.slice(4, 6), 16)
    };
  }

  function cloudSprite(color, variant, layer) {
    const key = `${color}:${variant}:${layer}`;
    if (cloudSprites.has(key)) return cloudSprites.get(key);
    const sprite = document.createElement("canvas");
    sprite.width = 128;
    sprite.height = 128;
    const context = sprite.getContext("2d");
    const random = randomFromSeed(hashSeed(key));
    const source = hexChannels(color);
    const channels = layer === "shadow"
      ? { red: 2, green: 8, blue: 23 }
      : layer === "rim"
        ? {
            red: Math.round(lerp(source.red, 235, 0.34)),
            green: Math.round(lerp(source.green, 246, 0.34)),
            blue: Math.round(lerp(source.blue, 255, 0.34))
          }
        : source;
    const lobeCount = layer === "haze" ? 6 : 9;

    for (let index = 0; index < lobeCount; index += 1) {
      const x = 64 + (random() - 0.5) * 44;
      const y = 64 + (random() - 0.5) * 42;
      const radius = 20 + random() * 29;
      const stretch = 0.54 + random() * 0.86;
      const gradient = context.createRadialGradient(0, 0, 1, 0, 0, radius);
      const centerAlpha = layer === "shadow" ? 0.62 : layer === "haze" ? 0.28 : layer === "rim" ? 0.68 : 0.55;
      gradient.addColorStop(0, `rgba(${channels.red}, ${channels.green}, ${channels.blue}, ${centerAlpha})`);
      gradient.addColorStop(0.34, `rgba(${channels.red}, ${channels.green}, ${channels.blue}, ${centerAlpha * 0.7})`);
      gradient.addColorStop(0.72, `rgba(${channels.red}, ${channels.green}, ${channels.blue}, ${centerAlpha * 0.18})`);
      gradient.addColorStop(1, `rgba(${channels.red}, ${channels.green}, ${channels.blue}, 0)`);
      context.save();
      context.translate(x, y);
      context.rotate((random() - 0.5) * 1.7);
      context.scale(stretch, 1);
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }

    context.globalCompositeOperation = "destination-out";
    for (let index = 0; index < 3; index += 1) {
      const x = 64 + (random() - 0.5) * 54;
      const y = 64 + (random() - 0.5) * 54;
      const radius = 8 + random() * 19;
      const tear = context.createRadialGradient(x, y, 0, x, y, radius);
      tear.addColorStop(0, `rgba(0, 0, 0, ${0.13 + random() * 0.2})`);
      tear.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = tear;
      context.fillRect(0, 0, 128, 128);
    }
    context.globalCompositeOperation = "source-over";
    cloudSprites.set(key, sprite);
    return sprite;
  }

  function sizeTreeCanvasSurface(canvas, viewport) {
    const opening = root.querySelector(".about-opening") || document.querySelector(".about-opening");
    if (!opening) return;
    const openingBounds = opening.getBoundingClientRect();
    const viewportBounds = viewport.getBoundingClientRect();
    const lowerOverflow = Math.max(window.innerHeight, viewportBounds.height * 0.75);
    canvas.style.left = `${-viewportBounds.left}px`;
    canvas.style.top = `${openingBounds.top - viewportBounds.top}px`;
    canvas.style.width = `${Math.max(1, document.documentElement.clientWidth)}px`;
    canvas.style.height = `${Math.max(openingBounds.height, viewportBounds.height, 1) + lowerOverflow}px`;
  }

  function drawTreeScene() {
    if (!treeScene) return;
    const { canvas, context, viewport, controlsLayer, geometry, controls } = treeScene;
    if (!treeScene.measurements) sizeTreeCanvasSurface(canvas, viewport);
    const measurements = treeScene.measurements || {
      canvasOffsetX: -canvas.offsetLeft,
      canvasOffsetY: -canvas.offsetTop,
      controlsLayerOffsetLeft: controlsLayer.offsetLeft,
      controlsOffsetX: -controlsLayer.offsetLeft,
      controlsOffsetY: -controlsLayer.offsetTop,
      height: Math.max(1, canvas.clientHeight),
      sceneHeight: Math.max(1, viewport.clientHeight),
      sceneWidth: Math.max(1, viewport.clientWidth),
      width: Math.max(1, canvas.clientWidth)
    };
    treeScene.measurements = measurements;
    const {
      canvasOffsetX,
      canvasOffsetY,
      controlsLayerOffsetLeft,
      controlsOffsetX,
      controlsOffsetY,
      height,
      sceneHeight,
      sceneWidth,
      width
    } = measurements;
    const requestedPixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const pixelRatio = Math.min(requestedPixelRatio, Math.sqrt(CANVAS_PIXEL_BUDGET / (width * height)));
    const sceneOriginY = sceneWidth <= 720 ? sceneHeight * 0.38 : sceneHeight * 0.5;
    const projectCanvasPoint = (point) => projectTreePoint(point, sceneWidth, sceneHeight, canvasOffsetX, canvasOffsetY, sceneOriginY);
    const projectControlPoint = (point) => projectTreePoint(point, sceneWidth, sceneHeight, controlsOffsetX, controlsOffsetY, sceneOriginY);
    if (canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const drawables = [];
    geometry.stars.forEach((star) => {
      const projected = projectCanvasPoint(star);
      if (projected.visible) drawables.push({ type: "star", projected, star, depth: projected.depth - 8 });
    });
    geometry.cloudParticles.forEach((particle) => {
      const projected = projectCanvasPoint(particle);
      if (projected.visible) drawables.push({ type: "cloud", projected, particle, depth: projected.depth });
    });
    geometry.paths.forEach((path) => {
      for (let index = 0; index < path.points.length - 1; index += 1) {
        const first = projectCanvasPoint(path.points[index]);
        const last = projectCanvasPoint(path.points[index + 1]);
        if (!first.visible || !last.visible) continue;
        drawables.push({ type: "segment", first, last, path, depth: (first.depth + last.depth) / 2 });
      }
    });
    drawables.sort((first, last) => first.depth - last.depth);

    for (const drawable of drawables) {
      if (drawable.type === "star") {
        const radius = clamp(drawable.star.size * drawable.projected.scale, 0.5, 3.2);
        if (radius > 1.7) {
          const halo = context.createRadialGradient(drawable.projected.x, drawable.projected.y, 0, drawable.projected.x, drawable.projected.y, radius * 3.4);
          halo.addColorStop(0, "rgba(217, 235, 255, 0.26)");
          halo.addColorStop(1, "rgba(217, 235, 255, 0)");
          context.globalAlpha = drawable.star.alpha;
          context.fillStyle = halo;
          context.beginPath();
          context.arc(drawable.projected.x, drawable.projected.y, radius * 3.4, 0, Math.PI * 2);
          context.fill();
        }
        context.globalAlpha = drawable.star.alpha;
        context.fillStyle = drawable.star.color;
        context.beginPath();
        context.arc(drawable.projected.x, drawable.projected.y, radius, 0, Math.PI * 2);
        context.fill();
      } else if (drawable.type === "cloud") {
        const baseScale = Math.min(sceneWidth / 8.6, sceneHeight / 15.5) * state.zoom;
        const size = clamp(drawable.particle.size * baseScale * drawable.projected.scale * 3.8, 6, 108);
        context.globalAlpha = drawable.particle.alpha;
        context.globalCompositeOperation = drawable.particle.layer === "rim" ? "screen" : "source-over";
        context.save();
        context.translate(drawable.projected.x, drawable.projected.y);
        context.rotate(drawable.particle.rotation);
        context.scale(drawable.particle.aspect, 1);
        context.drawImage(cloudSprite(drawable.particle.color, drawable.particle.variant, drawable.particle.layer), -size / 2, -size / 2, size, size);
        context.restore();
        context.globalCompositeOperation = "source-over";
      } else {
        const { path, first, last } = drawable;
        const baseScale = Math.min(sceneWidth / 8.6, sceneHeight / 15.5) * state.zoom;
        context.globalAlpha = path.kind === "filament" ? path.alpha : path.alpha * 0.11;
        context.strokeStyle = path.color;
        context.lineWidth = clamp(path.width * baseScale * ((first.scale + last.scale) / 2) * 0.58, 0.35, path.kind === "trunk" ? 2.8 : path.kind === "limb" ? 1.9 : 1.05);
        context.setLineDash(path.maturity === "shipped" ? [] : path.maturity === "published" ? [5, 6] : [2, 7]);
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(first.x, first.y);
        context.lineTo(last.x, last.y);
        context.stroke();
      }
    }
    context.setLineDash([]);

    const projectedControls = new Map();
    geometry.controlPoints.forEach((point, key) => {
      const projected = projectControlPoint(point);
      projectedControls.set(key, projected);
      const control = controls.get(key);
      if (!control) return;
      control.style.left = `${projected.x}px`;
      control.style.top = `${projected.y}px`;
      control.style.setProperty("--projected-scale", String(clamp(projected.scale, 0.72, 1.24)));
      control.style.setProperty("--projected-depth", String(projected.depth));
      control.style.zIndex = String(20 + Math.round((projected.depth + 7) * 4));
      control.hidden = !projected.visible;
      delete control.dataset.treeEdge;
      const visibleX = projected.x + controlsLayerOffsetLeft;
      if (visibleX < 88) control.dataset.treeEdge = "left";
      else if (visibleX > sceneWidth - 88) control.dataset.treeEdge = "right";
    });
    treeScene.projectedControls = projectedControls;
    viewport.dataset.treeYaw = state.yaw.toFixed(3);
    viewport.dataset.treePitch = state.pitch.toFixed(3);
    viewport.dataset.treeRoll = state.roll.toFixed(3);
    viewport.dataset.treeZoom = state.zoom.toFixed(3);
    viewport.dataset.treeView = state.projection;
    root.dataset.treeCanvasFrame = String((Number(root.dataset.treeCanvasFrame) || 0) + 1);
    root.dataset.treeCanvasPixels = String(canvas.width * canvas.height);
    positionPopup();
  }

  function positionPopup() {
    if (!treeScene || readoutElement.hidden) return;
    const key = state.nodeId ? `node:${state.nodeId}` : state.bandId ? `band:${state.bandId}` : null;
    const target = key && treeScene.controls?.get(key);
    const projectedTarget = key && treeScene.projectedControls?.get(key);
    if (!target || target.hidden || !projectedTarget) return;
    const stageBounds = stageElement.getBoundingClientRect();
    const controlsBounds = treeScene.controlsLayer.getBoundingClientRect();
    const stageWidth = stageElement.clientWidth;
    const stageHeight = treeScene.viewport.clientHeight;
    const inset = 12;
    const viewportInset = 8;
    const topbarBottom = document.getElementById("site-topbar")?.getBoundingClientRect().bottom || 0;
    const viewportTop = clamp(Math.max(viewportInset, topbarBottom + viewportInset) - stageBounds.top, inset, stageHeight - inset);
    const viewportBottom = clamp(window.innerHeight - viewportInset - stageBounds.top, inset, stageHeight - inset);
    const availableViewportHeight = Math.max(1, viewportBottom - viewportTop);
    readoutElement.style.setProperty("--popup-available-height", `${availableViewportHeight}px`);
    const popupWidth = readoutElement.offsetWidth || 330;
    const popupHeight = Math.min(readoutElement.offsetHeight || 300, stageHeight - inset * 2, availableViewportHeight);
    const gap = window.matchMedia("(max-width: 720px)").matches ? 14 : 22;
    const anchorX = controlsBounds.left - stageBounds.left + projectedTarget.x;
    const anchorY = controlsBounds.top - stageBounds.top + projectedTarget.y;
    const targetWidth = target.offsetWidth || 44;
    const targetHeight = target.offsetHeight || 44;
    const branchShift = target.matches(".stellar-tree__branch-label") && target.dataset.treeEdge === "right"
      ? targetWidth / 2 + 10
      : 0;
    const targetRect = {
      left: anchorX - targetWidth / 2 - branchShift,
      right: anchorX + targetWidth / 2 - branchShift,
      top: anchorY - targetHeight / 2,
      bottom: anchorY + targetHeight / 2
    };
    const maxLeft = Math.max(inset, stageWidth - popupWidth - inset);
    const minTop = Math.max(inset, viewportTop);
    const maxTop = Math.max(minTop, Math.min(stageHeight - popupHeight - inset, viewportBottom - popupHeight));
    const candidates = [
      { placement: "right", left: targetRect.right + gap, top: anchorY - popupHeight * 0.28 },
      { placement: "left", left: targetRect.left - popupWidth - gap, top: anchorY - popupHeight * 0.28 },
      { placement: "below", left: anchorX - popupWidth / 2, top: targetRect.bottom + gap },
      { placement: "above", left: anchorX - popupWidth / 2, top: targetRect.top - popupHeight - gap }
    ].map((candidate) => {
      const left = clamp(candidate.left, inset, maxLeft);
      const top = clamp(candidate.top, minTop, maxTop);
      const right = left + popupWidth;
      const bottom = top + popupHeight;
      const overlapWidth = Math.max(0, Math.min(right, targetRect.right) - Math.max(left, targetRect.left));
      const overlapHeight = Math.max(0, Math.min(bottom, targetRect.bottom) - Math.max(top, targetRect.top));
      const overlap = overlapWidth * overlapHeight;
      const horizontalDistance = Math.max(targetRect.left - right, left - targetRect.right, 0);
      const verticalDistance = Math.max(targetRect.top - bottom, top - targetRect.bottom, 0);
      return { ...candidate, left, top, overlap, distance: Math.hypot(horizontalDistance, verticalDistance) };
    }).sort((first, second) => first.overlap - second.overlap || first.distance - second.distance);
    const position = candidates[0];
    readoutElement.style.setProperty("--popup-left", `${position.left}px`);
    readoutElement.style.setProperty("--popup-top", `${position.top}px`);
    readoutElement.dataset.placement = position.placement;
  }

  /* The readout can reflow after it becomes visible (notably when mobile fonts
     and 44px evidence targets settle). Re-anchor after that size change so the
     initial bubble never keeps a placement calculated from its hidden width. */
  if ("ResizeObserver" in window) {
    const popupResizeObserver = new ResizeObserver(() => {
      if (!readoutElement.hidden) window.requestAnimationFrame(positionPopup);
    });
    popupResizeObserver.observe(readoutElement);
  }

  function bindTreeRotation(canvas) {
    const activePointers = new Map();
    let pointerId = null;
    let previousX = 0;
    let previousY = 0;
    let moved = false;
    let gesture = "idle";
    let pinchDistance = 0;
    let pinchAngle = 0;
    let pinchZoom = state.zoom;
    let pinchRoll = state.roll;

    const pointerPair = () => {
      const points = Array.from(activePointers.values());
      return points.length >= 2 ? [points[0], points[1]] : null;
    };

    const pairMetrics = () => {
      const points = pointerPair();
      if (!points) return { distance: 0, angle: 0 };
      const deltaX = points[1].x - points[0].x;
      const deltaY = points[1].y - points[0].y;
      return {
        distance: Math.hypot(deltaX, deltaY),
        angle: Math.atan2(deltaY, deltaX)
      };
    };

    const beginTwoPointerGesture = () => {
      const metrics = pairMetrics();
      gesture = "pinch";
      pointerId = null;
      enterFreeProjection();
      pinchDistance = metrics.distance;
      pinchAngle = metrics.angle;
      pinchZoom = state.zoom;
      pinchRoll = state.roll;
      moved = false;
      canvas.classList.add("is-rotating");
    };

    canvas.addEventListener("pointerdown", (event) => {
      if (mobileTreeInteraction.matches && treeInteractionLocked) return;
      if (event.button > 0) return;
      cancelZoomTween();
      cameraPointerActive = true;
      noteCameraInteraction();
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      if (activePointers.size >= 2) {
        beginTwoPointerGesture();
      } else {
        gesture = "rotate";
        pointerId = event.pointerId;
        previousX = event.clientX;
        previousY = event.clientY;
        moved = false;
        canvas.classList.add("is-rotating");
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!activePointers.has(event.pointerId)) return;
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (gesture === "pinch" && activePointers.size >= 2) {
        const metrics = pairMetrics();
        const distanceChange = Math.abs(metrics.distance - pinchDistance);
        const angleChange = normalizeAngle(metrics.angle - pinchAngle);
        if ((pinchDistance > 0 && distanceChange > 1) || Math.abs(angleChange) > 0.005) {
          event.preventDefault();
          moved = true;
          if (pinchDistance > 0) {
            state.zoom = clamp(pinchZoom * (metrics.distance / pinchDistance), MIN_ZOOM, MAX_ZOOM);
          }
          state.roll = normalizeAngle(pinchRoll + angleChange);
          syncCameraControls();
          updateStatus();
          drawTreeScene();
        }
        return;
      }
      if (event.pointerId !== pointerId) return;
      const deltaX = event.clientX - previousX;
      const deltaY = event.clientY - previousY;
      previousX = event.clientX;
      previousY = event.clientY;
      if (Math.abs(deltaX) + Math.abs(deltaY) <= 1) return;
      if (!moved) {
        moved = true;
        enterFreeProjection();
      }
      if (event.shiftKey) {
        state.roll = normalizeAngle(state.roll + (deltaX - deltaY * 0.35) * 0.0085);
      } else {
        state.yaw = normalizeAngle(state.yaw + deltaX * 0.0085);
        state.pitch = normalizeAngle(state.pitch + deltaY * 0.006);
      }
      syncCameraControls();
      updateStatus();
      drawTreeScene();
    });
    const release = (event) => {
      if (!activePointers.has(event.pointerId)) return;
      activePointers.delete(event.pointerId);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (gesture === "pinch" && moved) {
        canvas.dataset.zoomed = "true";
        canvas.dataset.rotated = "true";
      }
      else if (gesture === "rotate" && moved) canvas.dataset.rotated = "true";
      if (activePointers.size === 1) {
        const [remainingId, point] = activePointers.entries().next().value;
        gesture = "rotate";
        pointerId = remainingId;
        previousX = point.x;
        previousY = point.y;
        moved = false;
      } else if (event.pointerId === pointerId || activePointers.size === 0) {
        pointerId = null;
        gesture = "idle";
        cameraPointerActive = false;
        noteCameraInteraction();
        canvas.classList.remove("is-rotating");
      }
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("wheel", (event) => {
      if (mobileTreeInteraction.matches && treeInteractionLocked) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      cancelZoomTween();
      noteCameraInteraction();
      state.zoom = clamp(state.zoom * Math.exp(-event.deltaY * 0.004), MIN_ZOOM, MAX_ZOOM);
      syncCameraControls();
      updateStatus();
      drawTreeScene();
    }, { passive: false });
  }

  function renderBands() {
    treeScene?.resizeObserver?.disconnect();
    treeScene = null;
    bandsElement.replaceChildren();
    const visibleBands = bandsForMode(state.scan);
    const viewport = element("div", "stellar-tree__viewport");
    const canvas = element("canvas", "stellar-tree__canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.tabIndex = -1;
    const controlsLayer = element("div", "stellar-tree__controls-layer");
    const controls = new Map();

    visibleBands.forEach((band, bandIndex) => {
      const layout = TREE_LAYOUT[band.id];
      if (!layout || layout.leaves.length !== band.nodes.length) return;
      const branch = element("section", "stellar-tree__branch");
      branch.dataset.bandId = band.id;
      branch.setAttribute("role", "treeitem");
      branch.setAttribute("aria-selected", String(state.bandId === band.id));
      branch.style.setProperty("--band-tone", band.tone);
      const branchButton = treeBranchButton(band);
      controls.set(`band:${band.id}`, branchButton);
      branch.append(branchButton);
      const signals = element("div", "stellar-tree__signals");
      signals.setAttribute("role", "group");
      band.nodes.forEach((node, nodeIndexInBand) => {
        const button = nodeButton(band, node);
        button.classList.add("stellar-tree__signal");
        button.style.setProperty("--signal-index", String(nodeIndexInBand + bandIndex * 7));
        controls.set(`node:${node.id}`, button);
        signals.append(button);
      });
      branch.append(signals);
      controlsLayer.append(branch);
    });

    const rootMarker = element("button", "stellar-tree__root");
    rootMarker.type = "button";
    rootMarker.setAttribute("aria-controls", evidenceDetails.id);
    rootMarker.setAttribute("aria-label", "Open sources and map key");
    rootMarker.innerHTML = "<strong>AC</strong><span>sources</span>";
    rootMarker.addEventListener("click", () => {
      setEvidenceOpen(!sourcePanelOpen, { focus: !sourcePanelOpen });
    });
    rootMarkerElement = rootMarker;
    syncEvidenceTrigger();
    controls.set("root", rootMarker);
    controlsLayer.append(rootMarker);
    viewport.append(canvas, controlsLayer);
    bandsElement.append(viewport);

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Nebula canvas is unavailable.");
    const geometry = buildTreeGeometry(visibleBands);
    const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(() => {
      if (!treeScene || treeScene.viewport !== viewport) return;
      treeScene.measurements = null;
      drawTreeScene();
    }) : null;
    treeScene = {
      viewport,
      canvas,
      controlsLayer,
      context,
      controls,
      geometry,
      projectedControls: new Map(),
      measurements: null,
      resizeObserver
    };
    resizeObserver?.observe(viewport);
    bindTreeRotation(canvas);
    drawTreeScene();
  }

  function updateStatus() {
    const visibleBands = bandsForMode(state.scan);
    const visibleNodes = visibleBands.reduce((total, band) => total + band.nodes.length, 0);
    const projectionLabel = state.projection === "front" ? "front view" : state.projection === "top" ? "top view" : "free view";
    const interactionState = mobileTreeInteraction.matches
      ? ` · touch ${treeInteractionLocked ? "locked" : "unlocked"}`
      : "";
    let detail = `${state.scan} · ${visibleBands.length} branches · ${visibleNodes} signals · ${projectionLabel} · ${Math.round(state.zoom * 100)}% zoom${interactionState}`;
    const selected = state.nodeId && nodeIndex.get(state.nodeId);
    if (selected) detail += ` · ${selected.node.label}`;
    else if (state.bandId) detail += ` · ${bandForId(state.bandId).axis.label}`;
    statusElement.textContent = `[scan: ${detail}]`;
  }

  function restoreFocus(options) {
    if (!options || !options.focus) return;
    window.requestAnimationFrame(() => {
      if (options.focus === "node" && (options.focusId || state.nodeId)) {
        root.querySelector(`[data-node-id="${options.focusId || state.nodeId}"]`)?.focus();
      } else if (options.focus === "band" && options.focusId) {
        root.querySelector(`[data-band-trigger="${options.focusId}"]`)?.focus();
      } else if (options.focus === "popup") {
        readoutElement.querySelector(".stellar-tree__popup-close")?.focus();
      }
    });
  }

  function closePopup({ restore = false } = {}) {
    if (!state.bandId) return;
    const returnTarget = popupReturnTarget || (state.nodeId
      ? { type: "node", id: state.nodeId }
      : { type: "band", id: state.bandId });
    state.bandId = null;
    state.nodeId = null;
    writeLocationState();
    render(restore ? { focus: returnTarget.type, focusId: returnTarget.id } : {});
  }

  function render(options = {}) {
    syncPageLens();
    syncCameraControls();
    renderBands();
    renderReadout();
    updateStatus();
    applyHighlights();
    restoreFocus(options);
    window.requestAnimationFrame(positionPopup);
    window.clearTimeout(popupSettleTimer);
    popupSettleTimer = window.setTimeout(positionPopup, 220);
  }

  function updateProjectionControls() {
    root.dataset.treeProjection = state.projection;
    projectionButtons.forEach((button) => {
      const selected = button.dataset.treeProjection === state.projection;
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function syncCameraControls({ syncZoomRange = true } = {}) {
    updateProjectionControls();
    const percentage = Math.round(state.zoom * 100);
    if (zoomRange && syncZoomRange) {
      zoomRange.value = String(percentage);
      zoomRange.setAttribute("aria-valuetext", `${percentage} percent`);
    }
    if (zoomOutput) {
      zoomOutput.value = `${percentage}%`;
      zoomOutput.textContent = `${percentage}%`;
    }
    root.dataset.treeYaw = state.yaw.toFixed(3);
    root.dataset.treePitch = state.pitch.toFixed(3);
    root.dataset.treeRoll = state.roll.toFixed(3);
    root.dataset.treeZoom = state.zoom.toFixed(3);
    root.dataset.treeView = state.projection;
  }

  function resetCamera({ focus = false } = {}) {
    cancelZoomTween();
    Object.assign(state, CAMERA_DEFAULTS);
    writeLocationState("replaceState");
    syncCameraControls();
    updateStatus();
    drawTreeScene();
    if (focus) resetViewButton?.focus();
  }

  function bindProjectionControls() {
    projectionButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const projection = button.dataset.treeProjection;
        if (!["front", "top", "free"].includes(projection) || projection === state.projection) return;
        const leavingFixedView = projection === "free" && state.projection !== "free";
        noteCameraInteraction(250);
        if (leavingFixedView) matchFixedProjectionCamera(state.projection);
        state.projection = projection;
        writeLocationState();
        syncCameraControls();
        updateStatus();
        // Front/Top and Free now share the same perspective projection. The
        // current frame already matches the transferred camera exactly, so a
        // redundant redraw here can only introduce a visible handoff step.
        if (!leavingFixedView) drawTreeScene();
        startScan();
        button.focus();
      });
    });
    zoomRange?.addEventListener("input", () => {
      noteCameraInteraction();
      tweenZoomTo(Number(zoomRange.value) / 100);
    });
    resetViewButton?.addEventListener("click", () => {
      noteCameraInteraction();
      resetCamera({ focus: true });
    });
  }

  function bindCameraKeyboard() {
    stageElement.addEventListener("keydown", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("button, a, input, select, textarea")) return;
      const rotationStep = Math.PI / 18;
      const isRotationKey = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key);
      let handled = true;
      if (event.key === "Home") {
        resetCamera();
      } else if (["+", "=", "Add"].includes(event.key)) {
        cancelZoomTween();
        state.zoom = clamp(state.zoom + 0.08, MIN_ZOOM, MAX_ZOOM);
      } else if (["-", "_", "Subtract"].includes(event.key)) {
        cancelZoomTween();
        state.zoom = clamp(state.zoom - 0.08, MIN_ZOOM, MAX_ZOOM);
      } else if (event.shiftKey && event.key === "ArrowLeft") {
        enterFreeProjection();
        state.roll = normalizeAngle(state.roll - rotationStep);
      } else if (event.shiftKey && event.key === "ArrowRight") {
        enterFreeProjection();
        state.roll = normalizeAngle(state.roll + rotationStep);
      } else if (event.key === "ArrowLeft") {
        enterFreeProjection();
        state.yaw = normalizeAngle(state.yaw - rotationStep);
      } else if (event.key === "ArrowRight") {
        enterFreeProjection();
        state.yaw = normalizeAngle(state.yaw + rotationStep);
      } else if (event.key === "ArrowUp") {
        enterFreeProjection();
        state.pitch = normalizeAngle(state.pitch - rotationStep);
      } else if (event.key === "ArrowDown") {
        enterFreeProjection();
        state.pitch = normalizeAngle(state.pitch + rotationStep);
      } else {
        handled = false;
      }
      if (!handled) return;
      event.preventDefault();
      noteCameraInteraction();
      if (isRotationKey) writeLocationState("replaceState");
      syncCameraControls();
      updateStatus();
      drawTreeScene();
    });
  }

  function applyAboutTheme(theme, { persist = false } = {}) {
    const nextTheme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.aboutTheme = nextTheme;
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    root.dataset.aboutTheme = nextTheme;
    if (themeButton) {
      const isLight = nextTheme === "light";
      themeButton.setAttribute("aria-pressed", String(isLight));
      themeButton.setAttribute("aria-label", isLight ? "Use dark theme" : "Use light theme");
      themeButton.title = isLight ? "Use dark theme" : "Use light theme";
    }
    if (persist) {
      try {
        window.localStorage.setItem("about-theme", nextTheme);
      } catch (_error) {
        // The theme still applies when storage is unavailable.
      }
    }
    window.requestAnimationFrame(drawTreeScene);
  }

  function bindThemeControl() {
    const initialTheme = document.documentElement.dataset.aboutTheme === "light" ? "light" : "dark";
    applyAboutTheme(initialTheme);
    themeButton?.addEventListener("click", () => {
      const currentTheme = document.documentElement.dataset.aboutTheme === "light" ? "light" : "dark";
      applyAboutTheme(currentTheme === "light" ? "dark" : "light", { persist: true });
      themeButton.focus();
    });
  }

  function bindEscapeControl() {
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (sourcePanelOpen) {
        event.preventDefault();
        setEvidenceOpen(false, { focus: true });
      } else if (state.bandId) {
        event.preventDefault();
        closePopup({ restore: true });
      }
    });
  }

  function bindOutsidePopup() {
    document.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (sourcePanelOpen && !target.closest(".profile-map-evidence--tree-panel, .stellar-tree__root")) {
        setEvidenceOpen(false);
      }
      if (!state.bandId) return;
      if (target.closest("[data-stellar-readout], [data-band-trigger], [data-node-id]")) return;
      closePopup();
    }, true);
  }

  function observeVisibility() {
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      stageIsVisible = Boolean(entries[0] && entries[0].isIntersecting);
      if (!stageIsVisible) {
        window.clearTimeout(scanTimer);
        stageElement.classList.remove("is-scanning");
      }
    }, { rootMargin: "120px 0px" });
    observer.observe(stageElement);
  }

  async function enhance() {
    try {
      const response = await fetch(DATA_URL, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Profile map request failed: ${response.status}`);
      normalizeProfile(await response.json());
      readLocationState();
      writeLocationState("replaceState");
      bindEvidencePanel();
      bindTreeInteractionControl();
      bindProjectionControls();
      bindReducedMotionZoom();
      bindCameraKeyboard();
      bindThemeControl();
      bindEscapeControl();
      bindOutsidePopup();
      observeVisibility();
      window.addEventListener("popstate", () => {
        readLocationState();
        writeLocationState("replaceState");
        render();
      });
      window.addEventListener("pageshow", (event) => {
        if (!event.persisted) return;
        readLocationState();
        render();
      });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          window.clearTimeout(scanTimer);
          stageElement.classList.remove("is-scanning");
        }
      });
      root.classList.add("stellar-spectrum--enhanced");
      stageElement.hidden = false;
      if (labJournal && "MutationObserver" in window) {
        new MutationObserver(() => applyHighlights()).observe(labJournal, { childList: true, subtree: true });
      }
      render();
      startIdleRotation();
    } catch (error) {
      statusElement.textContent = "[static profile available]";
      console.warn("Stellar spectrograph enhancement unavailable.", error);
    }
  }

  enhance();
})();
