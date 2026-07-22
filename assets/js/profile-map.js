(() => {
  "use strict";

  const DATA_URL = "/assets/data/profile-map.json";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const FLOW_COLORS = ["#2878f0", "#00a5a5", "#5865d8", "#8b5cf6"];
  const chartStates = new WeakMap();
  let instanceCounter = 0;

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function cubicPoint(curve, progress) {
    const inverse = 1 - progress;
    return {
      x: inverse ** 3 * curve.start.x
        + 3 * inverse ** 2 * progress * curve.control1.x
        + 3 * inverse * progress ** 2 * curve.control2.x
        + progress ** 3 * curve.end.x,
      y: inverse ** 3 * curve.start.y
        + 3 * inverse ** 2 * progress * curve.control1.y
        + 3 * inverse * progress ** 2 * curve.control2.y
        + progress ** 3 * curve.end.y
    };
  }

  function cubicPath(curve) {
    return `M ${curve.start.x} ${curve.start.y} C ${curve.control1.x} ${curve.control1.y}, ${curve.control2.x} ${curve.control2.y}, ${curve.end.x} ${curve.end.y}`;
  }

  function flowGeometry(compact, narrow) {
    if (narrow) {
      const origin = { x: 48, y: 356 };
      return {
        width: 420,
        height: 720,
        origin,
        curves: [
          { start: origin, control1: { x: 95, y: 120 }, control2: { x: 250, y: 62 }, end: { x: 354, y: 82 } },
          { start: origin, control1: { x: 138, y: 272 }, control2: { x: 252, y: 192 }, end: { x: 374, y: 224 } },
          { start: origin, control1: { x: 155, y: 390 }, control2: { x: 258, y: 360 }, end: { x: 366, y: 452 } },
          { start: origin, control1: { x: 120, y: 520 }, control2: { x: 270, y: 642 }, end: { x: 344, y: 628 } }
        ]
      };
    }

    const width = compact ? 840 : 900;
    const height = compact ? 480 : 560;
    const origin = compact ? { x: 82, y: 270 } : { x: 88, y: 316 };
    const scaleY = compact ? 0.84 : 1;
    const y = (value) => value * scaleY;
    return {
      width,
      height,
      origin,
      curves: [
        { start: origin, control1: { x: 235, y: y(62) }, control2: { x: 520, y: y(100) }, end: { x: width - 68, y: y(88) } },
        { start: origin, control1: { x: 270, y: y(158) }, control2: { x: 480, y: y(292) }, end: { x: width - 52, y: y(216) } },
        { start: origin, control1: { x: 260, y: y(420) }, control2: { x: 552, y: y(238) }, end: { x: width - 62, y: y(374) } },
        { start: origin, control1: { x: 268, y: y(520) }, control2: { x: 610, y: y(525) }, end: { x: width - 96, y: y(500) } }
      ]
    };
  }

  function sortNodes(nodes) {
    return [...nodes].sort((a, b) => {
      const contextDifference = b.evidenceContextCount - a.evidenceContextCount;
      if (contextDifference !== 0) return contextDifference;
      const dateDifference = String(b.lastEvidencedAt || "").localeCompare(String(a.lastEvidencedAt || ""));
      if (dateDifference !== 0) return dateDifference;
      return a.label.localeCompare(b.label);
    });
  }

  function createNodeMark(axisIndex, point, color) {
    const common = { class: "profile-map__node-mark", fill: color };
    if (axisIndex === 1) {
      return svgElement("rect", {
        ...common,
        x: point.x - 9.5,
        y: point.y - 9.5,
        width: 19,
        height: 19,
        rx: 2
      });
    }
    if (axisIndex === 2) {
      return svgElement("path", {
        ...common,
        d: `M ${point.x} ${point.y - 12} L ${point.x + 12} ${point.y} L ${point.x} ${point.y + 12} L ${point.x - 12} ${point.y} Z`
      });
    }
    if (axisIndex === 3) {
      return svgElement("path", {
        ...common,
        d: `M ${point.x} ${point.y - 12} L ${point.x + 11} ${point.y + 10} L ${point.x - 11} ${point.y + 10} Z`
      });
    }
    return svgElement("circle", { ...common, cx: point.x, cy: point.y, r: 10 });
  }

  function labelPlacement(point, nodeIndex) {
    const above = nodeIndex % 2 === 0;
    return {
      x: point.x + 15,
      y: point.y + (above ? -14 : 22),
      anchor: "start"
    };
  }

  function describeEvidence(node) {
    return `${node.label}. ${node.summary}`;
  }

  function populatePopover(popover, node, dataset, evidence, onClose) {
    popover.replaceChildren();
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "profile-map__popover-close";
    closeButton.setAttribute("aria-label", `Close ${node.label} details`);
    closeButton.textContent = "×";
    const title = document.createElement("strong");
    title.id = `${popover.id}-title`;
    title.textContent = node.label;
    const body = document.createElement("p");
    body.id = `${popover.id}-summary`;
    body.className = "profile-map__popover-summary";
    body.textContent = node.summary;
    const detail = document.createElement("span");
    const axis = dataset.axes.find((candidate) => candidate.id === node.axis);
    const maturityLabel = node.maturity === "shipped"
      ? "shipped work"
      : node.maturity === "published"
        ? "writing"
        : "personal note";
    detail.textContent = `${axis?.label || node.axis} · ${maturityLabel}`;
    popover.append(closeButton, title, body, detail);

    const firstEvidence = node.evidenceRefs.map((reference) => evidence[reference]).find(Boolean);
    if (firstEvidence) {
      const link = document.createElement("a");
      link.href = firstEvidence.url;
      link.textContent = `See: ${firstEvidence.label}`;
      link.className = "profile-map__readout-link";
      if (/^https?:\/\//.test(firstEvidence.url)) {
        link.target = "_blank";
        link.rel = "noreferrer";
      }
      popover.append(link);
    }

    popover.setAttribute("aria-labelledby", title.id);
    popover.setAttribute("aria-describedby", body.id);
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      onClose(true);
    });
    return closeButton;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
  }

  function positionPopover(visual, popover, svg, point) {
    if (popover.hidden || !point) return;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;

    const svgPoint = svg.createSVGPoint();
    svgPoint.x = point.x;
    svgPoint.y = point.y;
    const screenPoint = svgPoint.matrixTransform(matrix);
    const visualRect = visual.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const anchorX = screenPoint.x - visualRect.left;
    const anchorY = screenPoint.y - visualRect.top;
    const gap = 18;
    const inset = 12;
    const available = {
      left: anchorX,
      right: visualRect.width - anchorX,
      above: anchorY,
      below: visualRect.height - anchorY
    };

    let placement;
    if (visualRect.width < 600) {
      placement = available.below >= popoverRect.height + gap + inset || available.below >= available.above
        ? "below"
        : "above";
    } else {
      placement = available.right >= popoverRect.width + gap + inset || available.right >= available.left
        ? "right"
        : "left";
    }

    let left;
    let top;
    if (placement === "right" || placement === "left") {
      left = placement === "right"
        ? anchorX + gap
        : anchorX - popoverRect.width - gap;
      top = anchorY - popoverRect.height * 0.34;
    } else {
      left = anchorX - popoverRect.width / 2;
      top = placement === "below"
        ? anchorY + gap
        : anchorY - popoverRect.height - gap;
    }

    left = clamp(left, inset, visualRect.width - popoverRect.width - inset);
    top = clamp(top, inset, visualRect.height - popoverRect.height - inset);
    popover.dataset.placement = placement;
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.setProperty(
      "--profile-popover-arrow-x",
      `${clamp(anchorX - left, 20, popoverRect.width - 20)}px`
    );
    popover.style.setProperty(
      "--profile-popover-arrow-y",
      `${clamp(anchorY - top, 20, popoverRect.height - 20)}px`
    );
  }

  function setActiveNode(svg, nodeId) {
    svg.classList.add("profile-map__svg--inspecting");
    const relatedNodeIds = new Set([nodeId]);

    svg.querySelectorAll(".profile-map__edge").forEach((edge) => {
      const incident = edge.dataset.sourceId === nodeId || edge.dataset.targetId === nodeId;
      edge.classList.toggle("is-active", incident);
      edge.classList.toggle("is-muted", !incident);
      if (incident) {
        relatedNodeIds.add(edge.dataset.sourceId);
        relatedNodeIds.add(edge.dataset.targetId);
      }
    });

    svg.querySelectorAll(".profile-map__node").forEach((node) => {
      const active = node.dataset.nodeId === nodeId;
      const related = !active && relatedNodeIds.has(node.dataset.nodeId);
      node.classList.toggle("is-active", active);
      node.classList.toggle("is-related", related);
      node.classList.toggle("is-muted", !active && !related);
    });
  }

  function clearActiveNode(svg) {
    svg.classList.remove("profile-map__svg--inspecting");
    svg.querySelectorAll(".is-active, .is-related, .is-muted").forEach((element) => {
      element.classList.remove("is-active", "is-related", "is-muted");
    });
  }

  function renderChart(root, datasetKey, data) {
    chartStates.get(root)?.cleanup();
    const dataset = data.datasets[datasetKey];
    const compact = root.dataset.profileMapMode === "compact";
    const nodes = compact ? dataset.nodes.filter((node) => node.homepage) : dataset.nodes;
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = dataset.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    const visual = root.querySelector("[data-profile-map-visual]");
    const popover = root.querySelector("[data-profile-map-readout]");
    const datasetTitle = root.querySelector("[data-profile-map-dataset-title]");
    const datasetDescription = root.querySelector("[data-profile-map-dataset-description]");
    const status = root.querySelector("[data-profile-map-status]");

    if (!visual || !popover) return;
    visual.replaceChildren();
    popover.hidden = true;
    popover.classList.remove("is-open");
    visual.closest(".profile-map__stage")?.setAttribute("aria-label", `${dataset.label} profile map`);
    if (datasetTitle) datasetTitle.textContent = dataset.label;
    if (datasetDescription) datasetDescription.textContent = dataset.description;
    if (status) status.textContent = "[select a point]";

    const narrow = window.matchMedia("(max-width: 560px)").matches || visual.clientWidth < 520;
    const geometry = flowGeometry(compact, narrow);
    const { width, height, origin, curves } = geometry;
    const instanceId = `${datasetKey}-${instanceCounter += 1}`;
    const titleId = `profile-map-title-${instanceId}`;
    const descriptionId = `profile-map-description-${instanceId}`;
    popover.id = `profile-map-popover-${instanceId}`;

    const svg = svgElement("svg", {
      class: "profile-map__svg",
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-labelledby": `${titleId} ${descriptionId}`,
      preserveAspectRatio: "xMidYMid meet"
    });
    const title = svgElement("title", { id: titleId });
    title.textContent = `Andrew Concepcion: ${dataset.label}`;
    const description = svgElement("desc", { id: descriptionId });
    description.textContent = `${dataset.description} Andrew Concepcion appears at the origin. Activate a point to read more and follow its connections.`;
    svg.append(title, description);

    const defs = svgElement("defs");
    svg.append(defs);

    const nodePositions = new Map();
    const axisColors = new Map();
    const streamLayer = svgElement("g", { class: "profile-map__streams", "aria-hidden": "true" });
    const headingLayer = svgElement("g", { class: "profile-map__axis-headings", "aria-hidden": "true" });
    dataset.axes.forEach((axis, axisIndex) => {
      const curve = curves[axisIndex];
      const color = FLOW_COLORS[axisIndex % FLOW_COLORS.length];
      const streamGradientId = `profile-map-stream-${instanceId}-${axisIndex}`;
      axisColors.set(axis.id, color);
      const streamGradient = svgElement("linearGradient", {
        id: streamGradientId,
        gradientUnits: "userSpaceOnUse",
        x1: curve.start.x,
        y1: curve.start.y,
        x2: curve.end.x,
        y2: curve.end.y
      });
      streamGradient.append(
        svgElement("stop", { offset: "0%", "stop-color": color, "stop-opacity": "0.12" }),
        svgElement("stop", { offset: "28%", "stop-color": color, "stop-opacity": "0.5" }),
        svgElement("stop", { offset: "100%", "stop-color": color, "stop-opacity": "0.72" })
      );
      defs.append(streamGradient);
      [-6, 6].forEach((offset) => {
        streamLayer.append(svgElement("path", {
          class: "profile-map__stream-echo",
          d: cubicPath(curve),
          stroke: `url(#${streamGradientId})`,
          transform: `translate(0 ${offset})`
        }));
      });
      streamLayer.append(svgElement("path", {
        class: "profile-map__stream",
        d: cubicPath(curve),
        stroke: `url(#${streamGradientId})`,
        "data-axis-id": axis.id
      }));

      const axisNodes = sortNodes(nodes.filter((node) => node.axis === axis.id));
      axisNodes.forEach((node, nodeIndex) => {
        const progress = axisNodes.length === 1
          ? 0.5
          : 0.2 + (nodeIndex / (axisNodes.length - 1)) * 0.64;
        nodePositions.set(node.id, { ...cubicPoint(curve, progress), axisIndex });
      });

      const endpointDot = svgElement("circle", {
        class: "profile-map__axis-terminal",
        cx: curve.end.x,
        cy: curve.end.y,
        r: 3.5,
        fill: color
      });
      const axisLabel = svgElement("text", {
        class: "profile-map__axis-label",
        x: curve.end.x,
        y: curve.end.y - 13,
        "text-anchor": "end"
      });
      axisLabel.textContent = axis.label;
      headingLayer.append(endpointDot, axisLabel);
    });
    svg.append(streamLayer);

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edgeLayer = svgElement("g", { class: "profile-map__edges", "aria-hidden": "true" });
    edges.forEach((edge, edgeIndex) => {
      const source = nodePositions.get(edge.source);
      const target = nodePositions.get(edge.target);
      if (!source || !target) return;
      const deltaX = target.x - source.x;
      const deltaY = target.y - source.y;
      const bend = ((edgeIndex % 5) - 2) * 12;
      const sourceControl = {
        x: source.x + deltaX * 0.32,
        y: source.y + deltaY * 0.18 + bend
      };
      const targetControl = {
        x: source.x + deltaX * 0.68,
        y: target.y - deltaY * 0.18 + bend
      };
      const gradientId = `profile-map-edge-${instanceId}-${edgeIndex}`;
      const sourceColor = axisColors.get(nodeById.get(edge.source)?.axis) || "#64748b";
      const targetColor = axisColors.get(nodeById.get(edge.target)?.axis) || "#64748b";
      const gradient = svgElement("linearGradient", {
        id: gradientId,
        gradientUnits: "userSpaceOnUse",
        x1: source.x,
        y1: source.y,
        x2: target.x,
        y2: target.y
      });
      gradient.append(
        svgElement("stop", { offset: "0%", "stop-color": sourceColor }),
        svgElement("stop", { offset: "100%", "stop-color": targetColor })
      );
      defs.append(gradient);

      const path = svgElement("path", {
        class: `profile-map__edge profile-map__edge--${edge.maturity}`,
        d: `M ${source.x} ${source.y} C ${sourceControl.x} ${sourceControl.y}, ${targetControl.x} ${targetControl.y}, ${target.x} ${target.y}`,
        stroke: `url(#${gradientId})`,
        "stroke-width": Math.min(2.6, 1.45 + (edge.weight || 1) * 0.23),
        "data-source-id": edge.source,
        "data-target-id": edge.target,
        "data-edge-index": edgeIndex
      });
      edgeLayer.append(path);
    });
    svg.append(edgeLayer);

    const nodeLayer = svgElement("g", { class: "profile-map__nodes" });
    const axisNodeIndexes = new Map();
    dataset.axes.forEach((axis) => {
      sortNodes(nodes.filter((node) => node.axis === axis.id)).forEach((node, nodeIndex) => {
        axisNodeIndexes.set(node.id, nodeIndex);
      });
    });

    let activeNodeId = null;
    let activeTrigger = null;
    let activePoint = null;

    const repositionActivePopover = () => {
      if (activeNodeId && activePoint) positionPopover(visual, popover, svg, activePoint);
    };

    const closePopover = (restoreFocus = false) => {
      const trigger = activeTrigger;
      activeNodeId = null;
      activeTrigger = null;
      activePoint = null;
      clearActiveNode(svg);
      svg.querySelectorAll(".profile-map__node").forEach((candidate) => {
        candidate.setAttribute("aria-expanded", "false");
      });
      popover.hidden = true;
      popover.classList.remove("is-open");
      popover.removeAttribute("data-placement");
      popover.replaceChildren();
      if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
    };

    const openPopover = (node, trigger, point, moveFocus = false) => {
      if (activeNodeId === node.id && !popover.hidden) {
        closePopover(moveFocus);
        return;
      }

      activeNodeId = node.id;
      activeTrigger = trigger;
      activePoint = point;
      setActiveNode(svg, node.id);
      svg.querySelectorAll(".profile-map__node").forEach((candidate) => {
        candidate.setAttribute("aria-expanded", String(candidate === trigger));
      });
      const closeButton = populatePopover(popover, node, dataset, data.evidence, closePopover);
      popover.hidden = false;
      popover.classList.add("is-open");
      positionPopover(visual, popover, svg, point);
      window.requestAnimationFrame(() => {
        positionPopover(visual, popover, svg, point);
        if (moveFocus) closeButton.focus({ preventScroll: true });
      });
    };

    nodes.forEach((node) => {
      const point = nodePositions.get(node.id);
      if (!point) return;
      const axis = dataset.axes[point.axisIndex];
      const color = axisColors.get(axis.id);
      const group = svgElement("g", {
        class: "profile-map__node",
        tabindex: "0",
        role: "button",
        "aria-label": `${node.label}. Show details and sources.`,
        "aria-haspopup": "dialog",
        "aria-expanded": "false",
        "aria-controls": popover.id,
        "data-node-id": node.id,
        "data-axis-id": node.axis
      });
      const nodeTitle = svgElement("title");
      nodeTitle.textContent = describeEvidence(node);
      const hitArea = svgElement("circle", {
        class: "profile-map__node-hit",
        cx: point.x,
        cy: point.y,
        r: 22
      });
      const aura = svgElement("circle", {
        class: "profile-map__node-aura",
        cx: point.x,
        cy: point.y,
        r: 17,
        fill: color
      });
      const outline = svgElement("circle", {
        class: "profile-map__node-outline",
        cx: point.x,
        cy: point.y,
        r: 14,
        stroke: color
      });
      const placement = labelPlacement(point, axisNodeIndexes.get(node.id) || 0);
      const label = svgElement("text", {
        class: "profile-map__node-label",
        x: placement.x,
        y: placement.y,
        "text-anchor": placement.anchor
      });
      label.textContent = node.label;
      const centerDot = svgElement("circle", {
        class: "profile-map__node-center",
        cx: point.x,
        cy: point.y,
        r: 2.3
      });
      group.append(nodeTitle, hitArea, aura, outline, createNodeMark(point.axisIndex, point, color), centerDot, label);
      group.addEventListener("click", (event) => {
        event.stopPropagation();
        openPopover(node, group, point);
      });
      group.addEventListener("keydown", (event) => {
        if (!["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        openPopover(node, group, point, true);
      });
      nodeLayer.append(group);
    });
    svg.append(nodeLayer);

    const originGroup = svgElement("g", { class: "profile-map__origin", "aria-hidden": "true" });
    const originHalo = svgElement("circle", {
      class: "profile-map__origin-halo",
      cx: origin.x,
      cy: origin.y,
      r: 29
    });
    const originDot = svgElement("circle", {
      class: "profile-map__origin-dot",
      cx: origin.x,
      cy: origin.y,
      r: 21
    });
    const originMonogram = svgElement("text", {
      class: "profile-map__origin-monogram",
      x: origin.x,
      y: origin.y + 4
    });
    originMonogram.textContent = "AC";
    const originName = svgElement("text", {
      class: "profile-map__origin-name",
      x: origin.x + 34,
      y: origin.y + 5
    });
    originName.textContent = "ANDREW CONCEPCION";
    originGroup.append(originHalo, originDot, originMonogram, originName);
    svg.append(originGroup);
    svg.append(headingLayer);
    visual.append(svg, popover);

    const handleDocumentPointerDown = (event) => {
      if (popover.hidden) return;
      const target = event.target;
      if (popover.contains(target)) return;
      const nodeTarget = target?.closest?.(".profile-map__node");
      if (nodeTarget && svg.contains(nodeTarget)) return;
      closePopover();
    };
    const handleDocumentKeyDown = (event) => {
      if (event.key === "Escape" && !popover.hidden) {
        event.preventDefault();
        closePopover(true);
      }
    };
    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(repositionActivePopover)
      : null;
    resizeObserver?.observe(visual);
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);
    window.addEventListener("resize", repositionActivePopover, { passive: true });
    chartStates.set(root, {
      cleanup: () => {
        document.removeEventListener("pointerdown", handleDocumentPointerDown);
        document.removeEventListener("keydown", handleDocumentKeyDown);
        window.removeEventListener("resize", repositionActivePopover);
        resizeObserver?.disconnect();
        closePopover();
      }
    });
  }

  function setFallbackDataset(root, datasetKey) {
    root.querySelectorAll("[data-profile-map-fallback-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.profileMapFallbackPanel !== datasetKey;
    });
  }

  function configureTabs(root, onChange) {
    const tabs = [...root.querySelectorAll("[data-profile-map-tab]")];
    const activate = (tab, moveFocus = false) => {
      tabs.forEach((candidate) => {
        const selected = candidate === tab;
        candidate.setAttribute("aria-selected", String(selected));
        candidate.tabIndex = selected ? 0 : -1;
      });
      const datasetKey = tab.dataset.profileMapTab;
      setFallbackDataset(root, datasetKey);
      onChange(datasetKey);
      if (moveFocus) tab.focus();
    };

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activate(tab));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = tabs.length - 1;
        activate(tabs[nextIndex], true);
      });
    });

    const requested = root.dataset.profileMapDefault || "engineering";
    const initial = tabs.find((tab) => tab.dataset.profileMapTab === requested) || tabs[0];
    if (initial) activate(initial);
  }

  async function initialize(root) {
    let data = null;
    const mobileQuery = window.matchMedia("(max-width: 560px)");
    const renderSelectedDataset = () => {
      if (!data) return;
      const selectedTab = root.querySelector('[data-profile-map-tab][aria-selected="true"]');
      renderChart(root, selectedTab?.dataset.profileMapTab || "engineering", data);
    };
    configureTabs(root, (datasetKey) => {
      if (data) renderChart(root, datasetKey, data);
    });
    mobileQuery.addEventListener?.("change", renderSelectedDataset);

    try {
      const response = await fetch(DATA_URL, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Profile map data request failed: ${response.status}`);
      data = await response.json();
      root.classList.add("profile-map--enhanced");
      renderSelectedDataset();
      const fallback = root.querySelector(".profile-map__fallback");
      if (fallback) fallback.hidden = true;
    } catch (error) {
      root.classList.remove("profile-map--enhanced");
      const fallback = root.querySelector(".profile-map__fallback");
      if (fallback) fallback.hidden = false;
      const status = root.querySelector("[data-profile-map-status]");
      if (status) status.textContent = "[static profile available]";
      console.warn("Profile map enhancement unavailable; keeping the static profile.", error);
    }
  }

  document.querySelectorAll("[data-profile-map]").forEach(initialize);
})();
