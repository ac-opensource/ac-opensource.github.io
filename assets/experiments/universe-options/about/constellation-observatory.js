(() => {
  "use strict";

  const profile = window.AC_PROFILE_MAP;
  if (!profile?.datasets || !profile?.evidence) return;

  const svgNamespace = "http://www.w3.org/2000/svg";
  const state = { plate: "", node: "", receipts: false };
  const instruments = new Map();

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function externalAttributes(url) {
    return /^https?:\/\//.test(String(url || "")) ? ' target="_blank" rel="noreferrer"' : "";
  }

  function setHistory(mode = "replace") {
    const url = new URL(window.location.href);
    if (state.plate && state.node) {
      url.searchParams.set("plate", state.plate);
      url.searchParams.set("node", state.node);
    } else {
      url.searchParams.delete("plate");
      url.searchParams.delete("node");
    }
    if (state.receipts) url.searchParams.set("receipts", "1");
    else url.searchParams.delete("receipts");
    window.history[mode === "push" ? "pushState" : "replaceState"]({ ...state }, "", url);
  }

  function nodePosition(index, total) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / total;
    return { x: 64 + Math.cos(angle) * 31, y: 55 + Math.sin(angle) * 37 };
  }

  function evidencePosition(index, total) {
    const angle = -1.18 + (Math.PI * 2 * index) / total;
    return { x: 64 + Math.cos(angle) * 18, y: 55 + Math.sin(angle) * 24 };
  }

  function makeLine(className, start, end, attributes = {}) {
    const line = document.createElementNS(svgNamespace, "line");
    line.setAttribute("x1", String(start.x));
    line.setAttribute("y1", String(start.y));
    line.setAttribute("x2", String(end.x));
    line.setAttribute("y2", String(end.y));
    line.setAttribute("class", className);
    Object.entries(attributes).forEach(([key, value]) => { line.dataset[key] = String(value); });
    return line;
  }

  function renderReadout(instrument) {
    const selected = instrument.dataset.nodes.find((node) => node.id === state.node && state.plate === instrument.key);
    const edges = selected
      ? instrument.dataset.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id)
      : [];
    const related = new Set(edges.flatMap((edge) => [edge.source, edge.target]).filter((id) => id !== selected?.id));
    const receipts = new Set(selected?.evidenceRefs || []);

    instrument.nodes.forEach((element, id) => {
      element.setAttribute("aria-pressed", String(selected?.id === id));
      element.classList.toggle("is-related", related.has(id));
      element.classList.toggle("is-muted", Boolean(selected) && selected.id !== id && !related.has(id));
    });
    instrument.edges.forEach(({ edge, line }) => {
      const active = Boolean(selected) && (edge.source === selected.id || edge.target === selected.id);
      line.classList.toggle("is-active", active);
      line.classList.toggle("is-muted", Boolean(selected) && !active);
    });
    instrument.evidence.forEach((element, id) => element.classList.toggle("is-active", receipts.has(id)));
    instrument.receiptLines.forEach(({ evidenceId, line, nodeId }) => {
      line.classList.toggle("is-active", instrument.plate.classList.contains("is-receipts") && selected?.id === nodeId && receipts.has(evidenceId));
    });

    if (!selected) {
      instrument.readout.innerHTML = `<p>[stable node readout]</p><h3>Choose a ${escapeHtml(instrument.dataset.label.toLowerCase())} node.</h3><p>Its exact canonical edges and public evidence will illuminate without changing node size.</p>`;
      return;
    }

    const axis = instrument.dataset.axes.find((candidate) => candidate.id === selected.axis);
    const evidenceLinks = selected.evidenceRefs.map((id) => {
      const evidence = profile.evidence[id];
      return `<a href="${escapeHtml(evidence.url)}"${externalAttributes(evidence.url)}>${escapeHtml(evidence.label)}</a>`;
    }).join("");
    const relatedLabels = [...related].map((id) => instrument.dataset.nodes.find((node) => node.id === id)?.label).filter(Boolean);
    instrument.readout.innerHTML = `
      <p>[${escapeHtml(instrument.dataset.label)} / ${escapeHtml(axis?.label || selected.axis)} · ${escapeHtml(selected.maturity)}]</p>
      <h3>${escapeHtml(selected.label)}</h3>
      <p>${escapeHtml(selected.summary)}</p>
      <p>${edges.length} exact ${edges.length === 1 ? "edge" : "edges"}${relatedLabels.length ? ` · ${escapeHtml(relatedLabels.join(" · "))}` : ""}</p>
      <div class="observatory-readout__receipts">${evidenceLinks}</div>`;
  }

  function renderAll() {
    instruments.forEach((instrument) => {
      instrument.plate.classList.toggle("is-receipts", state.receipts);
      instrument.receiptsToggle.setAttribute("aria-pressed", String(state.receipts));
      instrument.receiptsToggle.textContent = state.receipts ? "hide receipts" : "show receipts";
      renderReadout(instrument);
    });
  }

  function selectNode(key, id, mode = "push") {
    const instrument = instruments.get(key);
    if (!instrument?.dataset.nodes.some((node) => node.id === id)) return;
    state.plate = key;
    state.node = id;
    renderAll();
    setHistory(mode);
  }

  function buildInstrument(plate) {
    const key = plate.dataset.profilePlate;
    const dataset = profile.datasets[key];
    const graph = plate.querySelector(`[data-profile-graph="${key}"]`);
    const lines = graph?.querySelector("[data-profile-lines]");
    const nodesRoot = graph?.querySelector(".observatory-graph__nodes");
    const evidenceRoot = graph?.querySelector(".observatory-graph__receipts");
    const axesRoot = graph?.querySelector(".observatory-graph__axes");
    const readout = plate.querySelector("[data-profile-readout]");
    const receiptsToggle = plate.querySelector("[data-receipts-toggle]");
    const reset = plate.querySelector("[data-plate-reset]");
    if (!dataset || !graph || !lines || !nodesRoot || !evidenceRoot || !axesRoot || !readout || !receiptsToggle || !reset) return;

    const nodePositions = new Map();
    const nodes = new Map();
    const edges = [];
    const receiptLines = [];
    dataset.nodes.forEach((node, index) => nodePositions.set(node.id, nodePosition(index, dataset.nodes.length)));

    const evidenceIds = [...new Set(dataset.nodes.flatMap((node) => node.evidenceRefs))];
    const evidencePositions = new Map();
    const evidence = new Map();
    evidenceIds.forEach((id, index) => evidencePositions.set(id, evidencePosition(index, evidenceIds.length)));

    dataset.edges.forEach((edge) => {
      const line = makeLine("observatory-edge", nodePositions.get(edge.source), nodePositions.get(edge.target), { maturity: edge.maturity, edge: edge.id });
      lines.append(line);
      edges.push({ edge, line });
    });

    dataset.nodes.forEach((node, index) => {
      node.evidenceRefs.forEach((evidenceId) => {
        const line = makeLine("observatory-receipt-line", nodePositions.get(node.id), evidencePositions.get(evidenceId), { node: node.id, evidence: evidenceId });
        lines.append(line);
        receiptLines.push({ evidenceId, line, nodeId: node.id });
      });

      const button = document.createElement("button");
      const position = nodePositions.get(node.id);
      button.type = "button";
      button.className = "observatory-node";
      button.dataset.node = node.id;
      button.style.setProperty("--node-x", `${position.x}%`);
      button.style.setProperty("--node-y", `${position.y}%`);
      button.setAttribute("aria-label", `${String(index + 1).padStart(2, "0")}: ${node.label}, ${dataset.label}, ${node.axis}`);
      button.setAttribute("aria-pressed", "false");
      button.innerHTML = `<b aria-hidden="true">${String(index + 1).padStart(2, "0")}</b><span aria-hidden="true"></span>`;
      button.querySelector("span").textContent = node.label;
      button.addEventListener("click", () => selectNode(key, node.id));
      nodes.set(node.id, button);
      nodesRoot.append(button);
    });

    evidenceIds.forEach((id) => {
      const record = profile.evidence[id];
      const position = evidencePositions.get(id);
      const link = document.createElement("a");
      link.className = "observatory-evidence";
      link.dataset.evidence = id;
      link.style.setProperty("--node-x", `${position.x}%`);
      link.style.setProperty("--node-y", `${position.y}%`);
      link.href = record.url;
      link.textContent = record.label;
      if (/^https?:\/\//.test(record.url)) { link.target = "_blank"; link.rel = "noreferrer"; }
      evidence.set(id, link);
      evidenceRoot.append(link);
    });

    const axisPositions = [{ x: 46, y: 36 }, { x: 68, y: 31 }, { x: 75, y: 69 }, { x: 49, y: 73 }];
    dataset.axes.forEach((axis, index) => {
      const label = document.createElement("span");
      label.className = "observatory-graph__axis";
      label.style.setProperty("--axis-x", `${axisPositions[index].x}%`);
      label.style.setProperty("--axis-y", `${axisPositions[index].y}%`);
      label.textContent = axis.label;
      axesRoot.append(label);
    });

    graph.hidden = false;
    const instrument = { dataset, edges, evidence, graph, key, nodes, plate, readout, receiptLines, receiptsToggle };
    instruments.set(key, instrument);

    receiptsToggle.addEventListener("click", () => {
      state.receipts = !state.receipts;
      renderAll();
      setHistory();
    });
    reset.addEventListener("click", () => {
      if (state.plate === key) { state.plate = ""; state.node = ""; }
      renderAll();
      setHistory("push");
    });
    nodesRoot.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      const nodeList = [...nodes.values()];
      const current = nodeList.indexOf(document.activeElement);
      if (current < 0) return;
      const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      nodeList[(current + delta + nodeList.length) % nodeList.length].focus();
      event.preventDefault();
    });
  }

  function restoreFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const plate = params.get("plate") || "";
    const node = params.get("node") || "";
    state.plate = profile.datasets[plate]?.nodes.some((candidate) => candidate.id === node) ? plate : "";
    state.node = state.plate ? node : "";
    state.receipts = params.get("receipts") === "1";
    renderAll();
  }

  function correctUniverseMap() {
    const nav = document.querySelector("[data-universe-route-map]");
    if (!nav) return;
    nav.querySelectorAll("[data-map-id]").forEach((link) => link.removeAttribute("aria-current"));
    nav.querySelector('[data-map-id="about"]')?.setAttribute("aria-current", "location");
  }

  document.querySelectorAll("[data-profile-plate]").forEach(buildInstrument);
  restoreFromUrl();
  correctUniverseMap();
  window.addEventListener("popstate", restoreFromUrl);
  window.addEventListener("hashchange", correctUniverseMap);
})();
