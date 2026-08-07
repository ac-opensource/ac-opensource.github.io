(() => {
  "use strict";

  const profile = window.AC_PROFILE_MAP;
  if (!profile?.datasets || !profile?.evidence) return;

  const elements = {
    bias: document.querySelector(".binary-bias"),
    boundary: document.querySelector(".binary-boundary__streams"),
    field: document.querySelector("[data-binary-field]"),
    lines: document.querySelector("[data-binary-lines]"),
    nodes: document.querySelector(".binary-field__nodes"),
    readout: document.querySelector("[data-binary-readout]"),
    sequence: document.querySelector(".binary-sequence"),
    status: document.querySelector("[data-bias-status]")
  };
  if (Object.values(elements).some((element) => !element)) return;

  const svgNamespace = "http://www.w3.org/2000/svg";
  const state = { bias: "whole", node: "" };
  const nodesById = new Map();
  const nodeRecords = new Map();
  const positions = new Map();
  const edges = [];

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
    if (state.bias !== "whole") url.searchParams.set("bias", state.bias);
    else url.searchParams.delete("bias");
    if (state.node) url.searchParams.set("node", state.node);
    else url.searchParams.delete("node");
    window.history[mode === "push" ? "pushState" : "replaceState"]({ ...state }, "", url);
  }

  function positionFor(domain, index, total) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / total;
    if (domain === "engineering") return { x: 40 + Math.cos(angle) * 23, y: 53 + Math.sin(angle) * 36 };
    return { x: 82 + Math.cos(angle) * 11, y: 58 + Math.sin(angle) * 24 };
  }

  function makeLine(start, end, domain, edge) {
    const line = document.createElementNS(svgNamespace, "line");
    line.setAttribute("x1", String(start.x));
    line.setAttribute("y1", String(start.y));
    line.setAttribute("x2", String(end.x));
    line.setAttribute("y2", String(end.y));
    line.setAttribute("class", "binary-edge");
    line.dataset.domain = domain;
    line.dataset.edge = edge.id;
    line.dataset.maturity = edge.maturity;
    elements.lines.append(line);
    edges.push({ domain, edge, line });
  }

  function buildField() {
    Object.entries(profile.datasets).forEach(([domain, dataset]) => {
      dataset.nodes.forEach((node, index) => {
        positions.set(node.id, positionFor(domain, index, dataset.nodes.length));
        nodeRecords.set(node.id, { ...node, domain, dataset });
      });
    });

    Object.entries(profile.datasets).forEach(([domain, dataset]) => {
      dataset.edges.forEach((edge) => makeLine(positions.get(edge.source), positions.get(edge.target), domain, edge));
      dataset.nodes.forEach((node, index) => {
        const position = positions.get(node.id);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "binary-node";
        button.dataset.domain = domain;
        button.dataset.node = node.id;
        button.style.setProperty("--node-x", `${position.x}%`);
        button.style.setProperty("--node-y", `${position.y}%`);
        button.setAttribute("aria-label", `${String(index + 1).padStart(2, "0")}: ${node.label}, ${dataset.label}, ${node.axis}`);
        button.setAttribute("aria-pressed", "false");
        button.innerHTML = `<b aria-hidden="true">${String(index + 1).padStart(2, "0")}</b><span aria-hidden="true"></span>`;
        button.querySelector("span").textContent = node.label;
        button.addEventListener("click", () => selectNode(node.id));
        nodesById.set(node.id, button);
        elements.nodes.append(button);
      });
    });

    elements.nodes.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      const nodeList = [...nodesById.values()];
      const current = nodeList.indexOf(document.activeElement);
      if (current < 0) return;
      const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      nodeList[(current + delta + nodeList.length) % nodeList.length].focus();
      event.preventDefault();
    });
  }

  function positionBoundarySources() {
    const sourceElements = [...elements.boundary.querySelectorAll("[data-evidence]")];
    const grouped = { engineering: [], interests: [] };
    sourceElements.forEach((element) => {
      if (grouped[element.dataset.domain]) grouped[element.dataset.domain].push(element);
    });

    grouped.engineering.forEach((element, index) => {
      const angle = -1.42 + (Math.PI * 2 * index) / grouped.engineering.length;
      element.style.setProperty("--source-x", `${62 + Math.cos(angle) * 34}%`);
      element.style.setProperty("--source-y", `${62 + Math.sin(angle) * 31}%`);
    });
    grouped.interests.forEach((element, index) => {
      const angle = -.9 + (Math.PI * 2 * index) / grouped.interests.length;
      element.style.setProperty("--source-x", `${62 + Math.cos(angle) * 15}%`);
      element.style.setProperty("--source-y", `${65 + Math.sin(angle) * 16}%`);
    });
  }

  function renderReadout() {
    const selected = nodeRecords.get(state.node);
    const activeEdges = selected
      ? selected.dataset.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id)
      : [];
    const related = new Set(activeEdges.flatMap((edge) => [edge.source, edge.target]).filter((id) => id !== selected?.id));

    nodesById.forEach((element, id) => {
      element.setAttribute("aria-pressed", String(selected?.id === id));
      element.classList.toggle("is-related", related.has(id));
    });
    edges.forEach(({ edge, line }) => {
      const active = Boolean(selected) && (edge.source === selected.id || edge.target === selected.id);
      line.classList.toggle("is-active", active);
      line.classList.toggle("is-muted", Boolean(selected) && !active);
    });

    if (!selected) {
      elements.readout.innerHTML = `<p>[whole-person readout]</p><h2>Choose any equal-size node.</h2><p>Exact intra-center edges and evidence resolve here. The canonical model contains no cross-center evidence edge, so this field invents none.</p>`;
      return;
    }

    const axis = selected.dataset.axes.find((candidate) => candidate.id === selected.axis);
    const receipts = selected.evidenceRefs.map((id) => {
      const evidence = profile.evidence[id];
      return `<a href="${escapeHtml(evidence.url)}"${externalAttributes(evidence.url)}>${escapeHtml(evidence.label)}</a>`;
    }).join("");
    const relatedLabels = [...related].map((id) => nodeRecords.get(id)?.label).filter(Boolean);
    elements.readout.innerHTML = `
      <p>[${escapeHtml(selected.dataset.label)} / ${escapeHtml(axis?.label || selected.axis)} · ${escapeHtml(selected.maturity)}]</p>
      <h2>${escapeHtml(selected.label)}</h2>
      <p>${escapeHtml(selected.summary)}</p>
      <p>${activeEdges.length} exact within-center ${activeEdges.length === 1 ? "edge" : "edges"}${relatedLabels.length ? ` · ${escapeHtml(relatedLabels.join(" · "))}` : ""}</p>
      <div class="binary-readout__evidence">${receipts}</div>`;
  }

  function renderBias() {
    const labels = {
      professional: "Professional practice is foregrounded; personal curiosity remains present.",
      whole: "Both centers are equally legible.",
      personal: "Personal curiosity is foregrounded; professional practice remains present."
    };
    elements.field.dataset.bias = state.bias;
    elements.sequence.dataset.bias = state.bias;
    elements.status.textContent = labels[state.bias];
    elements.bias.querySelectorAll("button[data-bias]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.bias === state.bias)));
  }

  function render() {
    renderBias();
    renderReadout();
  }

  function selectNode(id, mode = "push") {
    if (!nodeRecords.has(id)) return;
    state.node = id;
    renderReadout();
    setHistory(mode);
  }

  function restoreFromUrl() {
    const params = new URLSearchParams(window.location.search);
    state.bias = ["professional", "whole", "personal"].includes(params.get("bias")) ? params.get("bias") : "whole";
    state.node = nodeRecords.has(params.get("node")) ? params.get("node") : "";
    render();
  }

  function correctUniverseMap() {
    const nav = document.querySelector("[data-universe-route-map]");
    if (!nav) return;
    nav.querySelectorAll("[data-map-id]").forEach((link) => link.removeAttribute("aria-current"));
    nav.querySelector('[data-map-id="about"]')?.setAttribute("aria-current", "location");
  }

  buildField();
  positionBoundarySources();
  elements.field.hidden = false;
  elements.bias.hidden = false;
  restoreFromUrl();
  correctUniverseMap();

  elements.bias.querySelectorAll("button[data-bias]").forEach((button) => {
    button.addEventListener("click", () => {
      state.bias = button.dataset.bias;
      renderBias();
      setHistory();
    });
  });
  window.addEventListener("popstate", restoreFromUrl);
  window.addEventListener("hashchange", correctUniverseMap);
})();
