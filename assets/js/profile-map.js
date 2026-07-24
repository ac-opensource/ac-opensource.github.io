(() => {
  "use strict";

  const DATA_URL = "/assets/data/profile-map.json";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const BRANCH_COLORS = ["#2878f0", "#00a5a5", "#5865d8", "#8b5cf6"];
  const SHORT_NODE_LABELS = {
    swift: "Swift / Obj-C",
    "sql-postgis": "SQL / PostGIS",
    "javascript-node": "JS / Node",
    architecture: "Modular architecture",
    reliability: "Reliability",
    release: "Release hardening",
    "async-reactive": "Async data",
    "testing-qa": "Testing / QA",
    leadership: "Tech leadership",
    "cross-functional": "Cross-functional",
    "ai-engineering": "AI-assisted delivery",
    "agent-memory": "Agent orchestration"
  };
  const MOBILE_NODE_LABELS = {
    "shared-native": "Native core",
    "backend-apis": "Backend",
    swift: "Swift / Obj-C",
    "rust-uniffi": "Rust / UniFFI",
    "sql-postgis": "SQL",
    "javascript-node": "JS / Node",
    compose: "Compose",
    architecture: "Architecture",
    reliability: "Reliability",
    release: "Releases",
    "async-reactive": "Async data",
    "testing-qa": "Testing / QA",
    "privacy-security": "Privacy",
    leadership: "Leadership",
    "cross-functional": "Product delivery",
    "ai-engineering": "AI delivery",
    "agent-memory": "Agent systems"
  };
  const chartStates = new WeakMap();
  let instanceCounter = 0;

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function curveSegments(curve) {
    return curve.segments || [curve];
  }

  function curvePosition(curve, progress) {
    const segments = curveSegments(curve);
    const boundedProgress = clamp(progress, 0, 1);
    const scaledProgress = boundedProgress * segments.length;
    const index = Math.min(segments.length - 1, Math.floor(scaledProgress));
    return {
      segment: segments[index],
      progress: index === segments.length - 1 && boundedProgress === 1
        ? 1
        : scaledProgress - index
    };
  }

  function cubicPoint(curve, progress) {
    const position = curvePosition(curve, progress);
    const segment = position.segment;
    const localProgress = position.progress;
    const inverse = 1 - localProgress;
    return {
      x: inverse ** 3 * segment.start.x
        + 3 * inverse ** 2 * localProgress * segment.control1.x
        + 3 * inverse * localProgress ** 2 * segment.control2.x
        + localProgress ** 3 * segment.end.x,
      y: inverse ** 3 * segment.start.y
        + 3 * inverse ** 2 * localProgress * segment.control1.y
        + 3 * inverse * localProgress ** 2 * segment.control2.y
        + localProgress ** 3 * segment.end.y
    };
  }

  function cubicPath(curve) {
    const segments = curveSegments(curve);
    return `M ${segments[0].start.x} ${segments[0].start.y} ${segments.map((segment) => `C ${segment.control1.x} ${segment.control1.y}, ${segment.control2.x} ${segment.control2.y}, ${segment.end.x} ${segment.end.y}`).join(" ")}`;
  }

  function cubicTangent(curve, progress) {
    const position = curvePosition(curve, progress);
    const segment = position.segment;
    const localProgress = position.progress;
    const inverse = 1 - localProgress;
    return {
      x: 3 * inverse ** 2 * (segment.control1.x - segment.start.x)
        + 6 * inverse * localProgress * (segment.control2.x - segment.control1.x)
        + 3 * localProgress ** 2 * (segment.end.x - segment.control2.x),
      y: 3 * inverse ** 2 * (segment.control1.y - segment.start.y)
        + 6 * inverse * localProgress * (segment.control2.y - segment.control1.y)
        + 3 * localProgress ** 2 * (segment.end.y - segment.control2.y)
    };
  }

  function compoundCurve(segments) {
    return {
      start: segments[0].start,
      end: segments[segments.length - 1].end,
      segments
    };
  }

  function curveArcSample(curve, progress, steps = 96) {
    const samples = [{ progress: 0, point: cubicPoint(curve, 0), distance: 0 }];
    let distance = 0;
    for (let index = 1; index <= steps; index += 1) {
      const sampleProgress = index / steps;
      const point = cubicPoint(curve, sampleProgress);
      const previous = samples[samples.length - 1].point;
      distance += Math.hypot(point.x - previous.x, point.y - previous.y);
      samples.push({ progress: sampleProgress, point, distance });
    }
    const target = distance * clamp(progress, 0, 1);
    const nextIndex = Math.max(1, samples.findIndex((sample) => sample.distance >= target));
    const before = samples[nextIndex - 1];
    const after = samples[nextIndex];
    const span = after.distance - before.distance || 1;
    const ratio = (target - before.distance) / span;
    const sampledProgress = before.progress + (after.progress - before.progress) * ratio;
    return {
      point: cubicPoint(curve, sampledProgress),
      tangent: cubicTangent(curve, sampledProgress)
    };
  }

  function pointCurveDistance(point, curve, steps = 72) {
    let minimum = Number.POSITIVE_INFINITY;
    for (let index = 0; index <= steps; index += 1) {
      const sample = cubicPoint(curve, index / steps);
      minimum = Math.min(minimum, Math.hypot(point.x - sample.x, point.y - sample.y));
    }
    return minimum;
  }

  function curveCurveDistance(first, second, steps = 24) {
    let minimum = Number.POSITIVE_INFINITY;
    for (let firstIndex = 0; firstIndex <= steps; firstIndex += 1) {
      const firstPoint = cubicPoint(first, firstIndex / steps);
      for (let secondIndex = 0; secondIndex <= steps; secondIndex += 1) {
        const secondPoint = cubicPoint(second, secondIndex / steps);
        minimum = Math.min(minimum, Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y));
      }
    }
    return minimum;
  }

  function normalizedVector(vector) {
    const length = Math.hypot(vector.x, vector.y) || 1;
    return { x: vector.x / length, y: vector.y / length };
  }

  function rotatedVector(vector, degrees) {
    const radians = degrees * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return {
      x: vector.x * cosine - vector.y * sine,
      y: vector.x * sine + vector.y * cosine
    };
  }

  function rotatedPointAround(point, origin, degrees) {
    const rotated = rotatedVector({ x: point.x - origin.x, y: point.y - origin.y }, degrees);
    return { x: origin.x + rotated.x, y: origin.y + rotated.y };
  }

  function rotatedCurveAround(curve, origin, degrees) {
    return compoundCurve(curveSegments(curve).map((segment) => ({
      start: rotatedPointAround(segment.start, origin, degrees),
      control1: rotatedPointAround(segment.control1, origin, degrees),
      control2: rotatedPointAround(segment.control2, origin, degrees),
      end: rotatedPointAround(segment.end, origin, degrees)
    })));
  }

  function braidedFiberPath(curve, amplitude, phase, crossings, steps = 72) {
    const points = [];
    for (let index = 0; index <= steps; index += 1) {
      const progress = index / steps;
      const point = cubicPoint(curve, progress);
      const tangent = cubicTangent(curve, progress);
      const length = Math.hypot(tangent.x, tangent.y) || 1;
      const normal = { x: -tangent.y / length, y: tangent.x / length };
      const envelope = Math.sin(Math.PI * progress) ** 0.7;
      const offset = Math.sin(progress * Math.PI * crossings * 2 + phase) * amplitude * envelope;
      points.push({ x: point.x + normal.x * offset, y: point.y + normal.y * offset });
    }
    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  }

  function taperedCubicPath(curve, startWidth, endWidth, steps = 24) {
    const left = [];
    const right = [];
    for (let index = 0; index <= steps; index += 1) {
      const progress = index / steps;
      const point = cubicPoint(curve, progress);
      const tangent = cubicTangent(curve, progress);
      const length = Math.hypot(tangent.x, tangent.y) || 1;
      const normal = { x: -tangent.y / length, y: tangent.x / length };
      const halfWidth = (startWidth + (endWidth - startWidth) * progress) / 2;
      left.push({ x: point.x + normal.x * halfWidth, y: point.y + normal.y * halfWidth });
      right.push({ x: point.x - normal.x * halfWidth, y: point.y - normal.y * halfWidth });
    }
    const points = [...left, ...right.reverse()];
    return `${points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")} Z`;
  }

  function treeGeometry(compact, narrow) {
    if (narrow) {
      const root = { x: 210, y: 681 };
      const trunk = compoundCurve([
        { start: root, control1: { x: 197, y: 632 }, control2: { x: 225, y: 575 }, end: { x: 207, y: 520 } },
        { start: { x: 207, y: 520 }, control1: { x: 199, y: 486 }, control2: { x: 220, y: 448 }, end: { x: 211, y: 410 } },
        { start: { x: 211, y: 410 }, control1: { x: 204, y: 380 }, control2: { x: 223, y: 344 }, end: { x: 214, y: 310 } },
        { start: { x: 214, y: 310 }, control1: { x: 208, y: 280 }, control2: { x: 226, y: 243 }, end: { x: 218, y: 210 } },
        { start: { x: 218, y: 210 }, control1: { x: 212, y: 177 }, control2: { x: 229, y: 139 }, end: { x: 220, y: 105 } },
        { start: { x: 220, y: 105 }, control1: { x: 217, y: 90 }, control2: { x: 222, y: 77 }, end: { x: 218, y: 67 } }
      ]);
      const branchWithRotation = (segments, degrees) => {
        const origin = segments[0].start;
        const rotated = rotatedCurveAround(compoundCurve(segments), origin, degrees);
        const onLeft = rotated.end.x < root.x;
        return {
          ...rotated,
          label: {
            x: rotated.end.x + (onLeft ? -2 : 2),
            y: rotated.end.y + 24,
            anchor: onLeft ? "start" : "end"
          }
        };
      };
      const branches = [
        branchWithRotation([
          { start: { x: 214, y: 310 }, control1: { x: 209, y: 288 }, control2: { x: 190, y: 275 }, end: { x: 166, y: 278 } },
          { start: { x: 166, y: 278 }, control1: { x: 137, y: 282 }, control2: { x: 117, y: 305 }, end: { x: 89, y: 296 } },
          { start: { x: 89, y: 296 }, control1: { x: 62, y: 287 }, control2: { x: 40, y: 266 }, end: { x: 16, y: 275 } }
        ], 24),
        branchWithRotation([
          { start: { x: 218, y: 210 }, control1: { x: 220, y: 190 }, control2: { x: 239, y: 176 }, end: { x: 262, y: 179 } },
          { start: { x: 262, y: 179 }, control1: { x: 289, y: 183 }, control2: { x: 307, y: 205 }, end: { x: 335, y: 196 } },
          { start: { x: 335, y: 196 }, control1: { x: 357, y: 188 }, control2: { x: 374, y: 172 }, end: { x: 391, y: 180 } }
        ], -26),
        branchWithRotation([
          { start: { x: 207, y: 520 }, control1: { x: 202, y: 498 }, control2: { x: 185, y: 481 }, end: { x: 164, y: 478 } },
          { start: { x: 164, y: 478 }, control1: { x: 140, y: 474 }, control2: { x: 123, y: 495 }, end: { x: 98, y: 489 } },
          { start: { x: 98, y: 489 }, control1: { x: 78, y: 484 }, control2: { x: 67, y: 464 }, end: { x: 55, y: 470 } }
        ], 20),
        branchWithRotation([
          { start: { x: 211, y: 410 }, control1: { x: 214, y: 389 }, control2: { x: 233, y: 376 }, end: { x: 257, y: 380 } },
          { start: { x: 257, y: 380 }, control1: { x: 283, y: 385 }, control2: { x: 299, y: 406 }, end: { x: 326, y: 398 } },
          { start: { x: 326, y: 398 }, control1: { x: 353, y: 390 }, control2: { x: 378, y: 372 }, end: { x: 399, y: 382 } }
        ], -22)
      ];
      return {
        width: 420,
        height: 720,
        root,
        trunk,
        branches,
        roots: [
          { start: root, control1: { x: 177, y: 686 }, control2: { x: 111, y: 699 }, end: { x: 62, y: 710 } },
          { start: root, control1: { x: 190, y: 692 }, control2: { x: 158, y: 705 }, end: { x: 125, y: 714 } },
          { start: root, control1: { x: 233, y: 692 }, control2: { x: 265, y: 705 }, end: { x: 299, y: 714 } },
          { start: root, control1: { x: 246, y: 687 }, control2: { x: 311, y: 699 }, end: { x: 360, y: 710 } }
        ]
      };
    }

    const width = compact ? 840 : 900;
    const height = compact ? 525 : 560;
    const scaleX = width / 900;
    const scaleY = height / 560;
    const point = (x, y) => ({ x: x * scaleX, y: y * scaleY });
    const curve = (start, control1, control2, end) => ({
      start: point(...start),
      control1: point(...control1),
      control2: point(...control2),
      end: point(...end)
    });
    const compound = (segments) => compoundCurve(segments.map((segment) => curve(
      segment.start,
      segment.control1,
      segment.control2,
      segment.end
    )));
    const root = point(450, 515);
    const trunk = compound([
      { start: [450, 515], control1: [438, 466], control2: [466, 414], end: [447, 375] },
      { start: [447, 375], control1: [439, 347], control2: [461, 327], end: [451, 305] },
      { start: [451, 305], control1: [443, 281], control2: [466, 257], end: [454, 235] },
      { start: [454, 235], control1: [447, 211], control2: [469, 181], end: [458, 158] },
      { start: [458, 158], control1: [451, 133], control2: [472, 101], end: [464, 75] }
    ]);
    const branchWithRotation = (segments, degrees) => {
      const unrotated = compound(segments);
      const rotated = rotatedCurveAround(unrotated, unrotated.start, degrees);
      const onLeft = rotated.end.x < root.x;
      return {
        ...rotated,
        label: {
          x: rotated.end.x + (onLeft ? -4 * scaleX : 4 * scaleX),
          y: rotated.end.y + 24 * scaleY,
          anchor: onLeft ? "start" : "end"
        }
      };
    };
    return {
      width,
      height,
      root,
      trunk,
      branches: [
        branchWithRotation([
          { start: [454, 235], control1: [450, 215], control2: [427, 202], end: [398, 206] },
          { start: [398, 206], control1: [360, 212], control2: [335, 243], end: [296, 232] },
          { start: [296, 232], control1: [253, 220], control2: [223, 187], end: [182, 197] },
          { start: [182, 197], control1: [138, 209], control2: [96, 232], end: [52, 205] }
        ], 24),
        branchWithRotation([
          { start: [458, 158], control1: [460, 140], control2: [484, 127], end: [514, 131] },
          { start: [514, 131], control1: [551, 136], control2: [581, 164], end: [621, 155] },
          { start: [621, 155], control1: [663, 146], control2: [696, 119], end: [739, 130] },
          { start: [739, 130], control1: [758, 136], control2: [775, 151], end: [785, 142] }
        ], -26),
        branchWithRotation([
          { start: [447, 375], control1: [443, 354], control2: [423, 337], end: [394, 331] },
          { start: [394, 331], control1: [358, 324], control2: [330, 351], end: [294, 343] },
          { start: [294, 343], control1: [252, 333], control2: [222, 301], end: [181, 311] },
          { start: [181, 311], control1: [136, 323], control2: [112, 346], end: [95, 325] }
        ], 20),
        branchWithRotation([
          { start: [451, 305], control1: [455, 284], control2: [478, 272], end: [507, 277] },
          { start: [507, 277], control1: [545, 284], control2: [570, 314], end: [610, 307] },
          { start: [610, 307], control1: [650, 300], control2: [686, 272], end: [728, 281] },
          { start: [728, 281], control1: [768, 292], control2: [810, 317], end: [842, 291] }
        ], -21)
      ],
      roots: [
        curve([450, 515], [388, 520], [272, 532], [175, 550]),
        curve([450, 515], [416, 526], [355, 544], [310, 558]),
        curve([450, 515], [484, 526], [545, 544], [590, 558]),
        curve([450, 515], [512, 520], [628, 532], [725, 550])
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

  function labelBox(placement, text, narrow) {
    const fontSize = narrow ? 10.5 : 10;
    const estimatedWidth = Math.max(fontSize * 2.2, text.length * fontSize * 0.55);
    const left = placement.anchor === "start"
      ? placement.x
      : placement.anchor === "end"
        ? placement.x - estimatedWidth
        : placement.x - estimatedWidth / 2;
    return {
      left,
      right: left + estimatedWidth,
      top: placement.y - fontSize,
      bottom: placement.y + fontSize * 0.3
    };
  }

  function boxesOverlap(first, second, padding = 3) {
    return first.left < second.right + padding
      && first.right > second.left - padding
      && first.top < second.bottom + padding
      && first.bottom > second.top - padding;
  }

  function labelPlacement(point, text, width, height, narrow, occupiedBoxes, nodePoints) {
    const growth = point.growth || { x: point.x >= width / 2 ? 1 : -1, y: -1 };
    const onRight = Math.abs(growth.x) > 0.2 ? growth.x > 0 : point.x >= width / 2;
    const side = onRight ? 1 : -1;
    const sideAnchor = onRight ? "start" : "end";
    const horizontalGap = narrow ? 8 : 10;
    const verticalGap = narrow ? 11 : 13;
    const candidates = [
      { x: point.x + side * horizontalGap, y: point.y + (growth.y > 0 ? verticalGap : -7), anchor: sideAnchor },
      { x: point.x + side * horizontalGap, y: point.y + (growth.y > 0 ? -7 : verticalGap), anchor: sideAnchor },
      { x: point.x + side * (horizontalGap + 5), y: point.y + 3, anchor: sideAnchor },
      { x: point.x, y: point.y - verticalGap, anchor: "middle" },
      { x: point.x, y: point.y + verticalGap + 3, anchor: "middle" },
      { x: point.x - side * horizontalGap, y: point.y - 7, anchor: onRight ? "end" : "start" },
      { x: point.x - side * horizontalGap, y: point.y + verticalGap, anchor: onRight ? "end" : "start" }
    ];
    let best = null;

    for (const candidate of candidates) {
      const box = labelBox(candidate, text, narrow);
      const inside = box.left >= 4 && box.right <= width - 4 && box.top >= 4 && box.bottom <= height - 4;
      const labelCollisions = occupiedBoxes.filter((occupied) => boxesOverlap(box, occupied)).length;
      const nodeCollisions = nodePoints.filter((nodePoint) => {
        if (nodePoint.x === point.x && nodePoint.y === point.y) return false;
        return nodePoint.x > box.left - 7 && nodePoint.x < box.right + 7
          && nodePoint.y > box.top - 7 && nodePoint.y < box.bottom + 7;
      }).length;
      const score = (inside ? 0 : 100) + labelCollisions * 12 + nodeCollisions * 8;
      if (!best || score < best.score) best = { placement: candidate, box, score };
      if (score === 0) break;
    }

    occupiedBoxes.push(best.box);
    return best.placement;
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
    const activeNode = svg.querySelector(`.profile-map__node[data-node-id="${CSS.escape(nodeId)}"]`);
    const activeAxisId = activeNode?.dataset.axisId;

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

    svg.querySelectorAll(".profile-map__tendril").forEach((tendril) => {
      const active = tendril.dataset.nodeId === nodeId;
      const related = !active && relatedNodeIds.has(tendril.dataset.nodeId);
      tendril.classList.toggle("is-active", active);
      tendril.classList.toggle("is-related", related);
      tendril.classList.toggle("is-muted", !active && !related);
    });

    svg.querySelectorAll(".profile-map__branch-system").forEach((branch) => {
      branch.classList.toggle("is-active", branch.dataset.axisId === activeAxisId);
      branch.classList.toggle("is-muted", branch.dataset.axisId !== activeAxisId);
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
    visual.closest(".profile-map__stage")?.setAttribute("aria-label", `${dataset.label} profile tree`);
    if (datasetTitle) datasetTitle.textContent = dataset.label;
    if (datasetDescription) datasetDescription.textContent = dataset.description;
    if (status) status.textContent = "[select a junction]";

    const narrow = window.matchMedia("(max-width: 560px)").matches;
    const geometry = treeGeometry(compact, narrow);
    const { width, height, root: rootPoint, trunk, branches, roots } = geometry;
    const instanceId = `${datasetKey}-${instanceCounter += 1}`;
    const titleId = `profile-map-title-${instanceId}`;
    const descriptionId = `profile-map-description-${instanceId}`;
    popover.id = `profile-map-popover-${instanceId}`;

    const svg = svgElement("svg", {
      class: "profile-map__svg profile-map__tree",
      viewBox: `0 0 ${width} ${height}`,
      role: "group",
      "aria-labelledby": `${titleId} ${descriptionId}`,
      preserveAspectRatio: "xMidYMid meet"
    });
    const title = svgElement("title", { id: titleId });
    title.textContent = `Andrew Concepcion: ${dataset.label} profile tree`;
    const description = svgElement("desc", { id: descriptionId });
    const branchNames = dataset.axes.map((axis) => axis.label).join(", ");
    description.textContent = `${dataset.description} Andrew Concepcion is at the root. A luminous trunk opens into ${branchNames}; each topic is an interactive junction along the branching system. Select a junction to read its story and illuminate related topics.`;
    svg.append(title, description);

    const defs = svgElement("defs");
    const trunkGradientId = `profile-map-trunk-${instanceId}`;
    const trunkGradient = svgElement("linearGradient", {
      id: trunkGradientId,
      gradientUnits: "userSpaceOnUse",
      x1: trunk.start.x,
      y1: trunk.start.y,
      x2: trunk.end.x,
      y2: trunk.end.y
    });
    trunkGradient.append(
      svgElement("stop", { offset: "0%", "stop-color": "#405d8a" }),
      svgElement("stop", { offset: "36%", "stop-color": "#2878f0" }),
      svgElement("stop", { offset: "66%", "stop-color": "#00a5a5" }),
      svgElement("stop", { offset: "100%", "stop-color": "#8b5cf6" })
    );
    defs.append(trunkGradient);
    svg.append(defs);

    const canopyLayer = svgElement("g", { class: "profile-map__canopy", "aria-hidden": "true" });
    branches.forEach((branch, axisIndex) => {
      const center = cubicPoint(branch, 0.58);
      canopyLayer.append(svgElement("ellipse", {
        class: "profile-map__canopy-cloud",
        cx: center.x,
        cy: center.y,
        rx: narrow ? 105 : width * 0.19,
        ry: narrow ? 66 : height * 0.16,
        fill: BRANCH_COLORS[axisIndex % BRANCH_COLORS.length]
      }));
    });
    svg.append(canopyLayer);

    const rootLayer = svgElement("g", { class: "profile-map__roots", "aria-hidden": "true" });
    roots.forEach((rootCurve, rootIndex) => {
      rootLayer.append(svgElement("path", {
        class: "profile-map__root-line",
        d: cubicPath(rootCurve),
        pathLength: "1",
        style: `--root-index: ${rootIndex}`
      }));
    });
    svg.append(rootLayer);

    const trunkLayer = svgElement("g", { class: "profile-map__trunk-group", "aria-hidden": "true" });
    const trunkPath = cubicPath(trunk);
    trunkLayer.append(
      svgElement("path", { class: "profile-map__trunk-glow", d: taperedCubicPath(trunk, 48, 19), fill: `url(#${trunkGradientId})` }),
      svgElement("path", { class: "profile-map__trunk-shadow", d: taperedCubicPath(trunk, 31, 11) }),
      svgElement("path", { class: "profile-map__trunk", d: taperedCubicPath(trunk, 18, 6), fill: `url(#${trunkGradientId})` }),
      ...Array.from({ length: 7 }, (_, fiberIndex) => svgElement("path", {
        class: `profile-map__trunk-thread profile-map__trunk-thread--${["blue", "teal", "violet"][fiberIndex % 3]}`,
        d: braidedFiberPath(
          trunk,
          (narrow ? 6.4 : 8.5) + (fiberIndex % 3) * 0.7,
          fiberIndex * (Math.PI * 2 / 7),
          1.35 + (fiberIndex % 3) * 0.34
        ),
        pathLength: "1"
      })),
      svgElement("path", { class: "profile-map__trunk-highlight", d: trunkPath, pathLength: "1" })
    );
    svg.append(trunkLayer);

    const nodePositions = new Map();
    const axisColors = new Map();
    const branchLayer = svgElement("g", { class: "profile-map__branches", "aria-hidden": "true" });
    const tendrilLayer = svgElement("g", { class: "profile-map__tendrils", "aria-hidden": "true" });
    const headingLayer = svgElement("g", { class: "profile-map__axis-headings", "aria-hidden": "true" });
    const placedNodePoints = [];
    const placedTendrilCurves = [];
    const occupiedLabelBoxes = [];
    const canopyCenter = narrow ? { x: 210, y: 300 } : { x: width / 2, y: height * 0.43 };

    dataset.axes.forEach((axis, axisIndex) => {
      const branch = branches[axisIndex];
      const color = BRANCH_COLORS[axisIndex % BRANCH_COLORS.length];
      const gradientId = `profile-map-branch-${instanceId}-${axisIndex}`;
      axisColors.set(axis.id, color);
      const gradient = svgElement("linearGradient", {
        id: gradientId,
        gradientUnits: "userSpaceOnUse",
        x1: branch.start.x,
        y1: branch.start.y,
        x2: branch.end.x,
        y2: branch.end.y
      });
      gradient.append(
        svgElement("stop", { offset: "0%", "stop-color": color, "stop-opacity": "0.7" }),
        svgElement("stop", { offset: "34%", "stop-color": color, "stop-opacity": "0.84" }),
        svgElement("stop", { offset: "100%", "stop-color": color, "stop-opacity": "0.95" })
      );
      defs.append(gradient);

      const branchSystem = svgElement("g", {
        class: "profile-map__branch-system",
        "data-axis-id": axis.id
      });
      branchSystem.append(
        svgElement("path", {
          class: "profile-map__branch-glow",
          d: cubicPath(branch),
          stroke: color,
          pathLength: "1",
          style: `--branch-index: ${axisIndex}`
        }),
        svgElement("path", {
          class: "profile-map__branch-shadow",
          d: cubicPath(branch),
          pathLength: "1",
          style: `--branch-index: ${axisIndex}`
        }),
        svgElement("path", {
          class: "profile-map__branch",
          d: cubicPath(branch),
          stroke: `url(#${gradientId})`,
          pathLength: "1",
          "data-axis-id": axis.id,
          style: `--branch-index: ${axisIndex}`
        }),
        svgElement("path", {
          class: "profile-map__branch-thread",
          d: cubicPath(branch),
          pathLength: "1",
          style: `--branch-index: ${axisIndex}`
        })
      );
      branchLayer.append(branchSystem);

      const axisNodes = sortNodes(nodes.filter((node) => node.axis === axis.id));
      axisNodes.forEach((node, nodeIndex) => {
        const progress = axisNodes.length === 1
          ? 0.48
          : 0.13 + (nodeIndex / (axisNodes.length - 1)) * 0.72;
        const sampled = curveArcSample(branch, progress);
        const branchPoint = sampled.point;
        const tangentUnit = normalizedVector(sampled.tangent);
        const radialUnit = normalizedVector({
          x: branchPoint.x - canopyCenter.x,
          y: branchPoint.y - canopyCenter.y
        });
        const firstNormal = { x: -tangentUnit.y, y: tangentUnit.x };
        const outwardNormal = firstNormal.x * radialUnit.x + firstNormal.y * radialUnit.y >= 0
          ? firstNormal
          : { x: -firstNormal.x, y: -firstNormal.y };
        const sproutNormal = nodeIndex % 2 === 0
          ? outwardNormal
          : { x: -outwardNormal.x, y: -outwardNormal.y };
        const baseGrowth = normalizedVector({
          x: sproutNormal.x * 0.96 + tangentUnit.x * 0.16,
          y: sproutNormal.y * 0.96 + tangentUnit.y * 0.16
        });
        const organicAngles = [-12, 10, -18, 16, -9, 20, -15];
        const lengths = narrow ? [27, 35, 24, 32, 38, 26, 34] : [38, 47, 34, 43, 50, 36, 45];
        const mirroredAngle = organicAngles[(nodeIndex + axisIndex) % organicAngles.length]
          * (axisIndex % 2 === 1 ? -1 : 1);
        const angleDeltas = [0, 12, -12, 24, -24, 38, -38, 54, -54, 72, -72, 96, -96, 120, -120, 150, -150, 180];
        const lengthDeltas = [0, 7, -5, 13, 20, -9, 28, 38, 48];
        const inset = narrow ? 22 : 26;
        const minimumDistance = narrow ? 40 : 38;
        const branchClearance = narrow ? 13 : 17;
        const nodePathClearance = narrow ? 12 : 15;
        const tendrilClearance = narrow ? 1.5 : 2;
        let placement = null;
        let bestPlacement = null;

        for (const angleDelta of angleDeltas) {
          for (const lengthDelta of lengthDeltas) {
            const length = Math.max(narrow ? 18 : 24, lengths[nodeIndex % lengths.length] + lengthDelta);
            const growth = rotatedVector(baseGrowth, mirroredAngle + angleDelta);
            const candidate = {
              x: branchPoint.x + growth.x * length,
              y: branchPoint.y + growth.y * length
            };
            const inside = candidate.x >= inset && candidate.x <= width - inset
              && candidate.y >= inset && candidate.y <= height - inset;
            if (!inside) continue;
            const nearestNode = placedNodePoints.reduce(
              (minimum, point) => Math.min(minimum, Math.hypot(candidate.x - point.x, candidate.y - point.y)),
              Number.POSITIVE_INFINITY
            );
            const clearOfOtherBranches = branches.every((candidateBranch, candidateAxisIndex) => (
              candidateAxisIndex === axisIndex || pointCurveDistance(candidate, candidateBranch) >= branchClearance
            ));
            const clearOfTrunk = pointCurveDistance(candidate, trunk) >= branchClearance;
            const sproutLead = Math.min(narrow ? 3 : 4, length * 0.1);
            const tendrilCurve = {
              start: branchPoint,
              control1: {
                x: branchPoint.x + tangentUnit.x * sproutLead + growth.x * length * 0.2,
                y: branchPoint.y + tangentUnit.y * sproutLead + growth.y * length * 0.2
              },
              control2: {
                x: branchPoint.x + growth.x * length * 0.7,
                y: branchPoint.y + growth.y * length * 0.7
              },
              end: candidate
            };
            const nearestNodeToPath = placedNodePoints.reduce(
              (minimum, point) => Math.min(minimum, pointCurveDistance(point, tendrilCurve, 36)),
              Number.POSITIVE_INFINITY
            );
            const nearestTendrilToNode = placedTendrilCurves.reduce(
              (minimum, curve) => Math.min(minimum, pointCurveDistance(candidate, curve, 36)),
              Number.POSITIVE_INFINITY
            );
            const nearestTendril = placedTendrilCurves.reduce(
              (minimum, curve) => Math.min(minimum, curveCurveDistance(tendrilCurve, curve, 18)),
              Number.POSITIVE_INFINITY
            );
            const score = (clearOfOtherBranches && clearOfTrunk ? 1000 : 0)
              + Math.min(nearestNode, 100) * 6
              + Math.min(nearestNodeToPath, 60) * 2
              + Math.min(nearestTendrilToNode, 60) * 2
              + Math.min(nearestTendril, 30);
            if (!bestPlacement || score > bestPlacement.score) {
              bestPlacement = { point: candidate, growth, length, tendrilCurve, score };
            }
            if (nearestNode >= minimumDistance
              && nearestNodeToPath >= nodePathClearance
              && nearestTendrilToNode >= nodePathClearance
              && nearestTendril >= tendrilClearance
              && clearOfOtherBranches
              && clearOfTrunk) {
              placement = { point: candidate, growth, length, tendrilCurve };
              break;
            }
          }
          if (placement) break;
        }

        if (!placement) {
          placement = bestPlacement || {
            point: { x: clamp(branchPoint.x, inset, width - inset), y: clamp(branchPoint.y, inset, height - inset) },
            growth: baseGrowth,
            length: 0,
            tendrilCurve: { start: branchPoint, control1: branchPoint, control2: branchPoint, end: branchPoint }
          };
        }

        const point = placement.point;
        placedNodePoints.push(point);
        nodePositions.set(node.id, {
          ...point,
          branchPoint,
          growth: placement.growth,
          scale: 1,
          axisIndex,
          nodeIndex
        });
        placedTendrilCurves.push(placement.tendrilCurve);
        tendrilLayer.append(svgElement("path", {
          class: `profile-map__tendril profile-map__tendril--${node.maturity}`,
          d: cubicPath(placement.tendrilCurve),
          stroke: color,
          pathLength: "1",
          "data-node-id": node.id,
          "data-axis-id": node.axis,
          style: `--signal-index: ${nodeIndex}`
        }));
      });

      const terminalGlow = svgElement("circle", {
        class: "profile-map__axis-terminal-glow",
        cx: branch.end.x,
        cy: branch.end.y,
        r: 5,
        fill: color
      });
      const terminal = svgElement("circle", {
        class: "profile-map__axis-terminal",
        cx: branch.end.x,
        cy: branch.end.y,
        r: 2.2,
        fill: color,
      });
      const axisLabel = svgElement("text", {
        class: "profile-map__axis-label",
        x: branch.label.x,
        y: branch.label.y,
        "text-anchor": branch.label.anchor
      });
      axisLabel.textContent = axis.label;
      headingLayer.append(terminalGlow, terminal, axisLabel);
      const axisLabelBox = labelBox(branch.label, axis.label, narrow);
      occupiedLabelBoxes.push({
        left: axisLabelBox.left - 7,
        right: axisLabelBox.right + 7,
        top: axisLabelBox.top - 4,
        bottom: axisLabelBox.bottom + 4
      });
    });
    svg.append(branchLayer);

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edgeLayer = svgElement("g", { class: "profile-map__edges", "aria-hidden": "true" });
    edges.forEach((edge, edgeIndex) => {
      const source = nodePositions.get(edge.source);
      const target = nodePositions.get(edge.target);
      if (!source || !target) return;
      const deltaX = target.x - source.x;
      const deltaY = target.y - source.y;
      const bend = ((edgeIndex % 5) - 2) * (narrow ? 8 : 12);
      const sourceControl = { x: source.x + deltaX * 0.32, y: source.y + deltaY * 0.18 + bend };
      const targetControl = { x: source.x + deltaX * 0.68, y: target.y - deltaY * 0.18 + bend };
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
      edgeLayer.append(svgElement("path", {
        class: `profile-map__edge profile-map__edge--${edge.maturity}`,
        d: `M ${source.x} ${source.y} C ${sourceControl.x} ${sourceControl.y}, ${targetControl.x} ${targetControl.y}, ${target.x} ${target.y}`,
        stroke: `url(#${gradientId})`,
        "stroke-width": Math.min(2.2, 0.8 + (edge.weight || 1) * 0.3),
        "data-source-id": edge.source,
        "data-target-id": edge.target,
        "data-edge-index": edgeIndex
      }));
    });
    svg.append(edgeLayer, tendrilLayer);

    const nodeLayer = svgElement("g", { class: "profile-map__nodes" });
    const allNodePoints = [...nodePositions.values()];
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
      if (status) status.textContent = "[select a junction]";
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
      if (status) status.textContent = `[selected: ${node.label}]`;
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
      const evidenceCount = Math.max(1, node.evidenceContextCount || 1);
      const nodeScale = point.scale * (narrow ? 0.86 : 0.95);
      const maturityLabel = node.maturity === "shipped"
        ? "shipped work"
        : node.maturity === "published"
          ? "published work"
          : "self-described";
      const group = svgElement("g", {
        class: `profile-map__node profile-map__signal profile-map__signal--${node.maturity}`,
        tabindex: "0",
        role: "button",
        "aria-label": `${node.label}, junction on the ${axis.label} branch, ${maturityLabel}, ${evidenceCount} evidence context${evidenceCount === 1 ? "" : "s"}. Show details and sources.`,
        "aria-haspopup": "dialog",
        "aria-expanded": "false",
        "aria-controls": popover.id,
        "data-node-id": node.id,
        "data-axis-id": node.axis,
        style: `--signal-index: ${point.nodeIndex}`
      });
      const nodeTitle = svgElement("title");
      nodeTitle.textContent = describeEvidence(node);
      const nearestCenterDistance = allNodePoints.reduce((minimum, candidate) => {
        if (candidate.x === point.x && candidate.y === point.y) return minimum;
        return Math.min(minimum, Math.hypot(candidate.x - point.x, candidate.y - point.y));
      }, Number.POSITIVE_INFINITY);
      const hitRadius = Math.min(26, Math.max(narrow ? 19.2 : 19, nearestCenterDistance / 2 - 1.5));
      const hitArea = svgElement("circle", {
        class: "profile-map__node-hit",
        cx: point.x,
        cy: point.y,
        r: hitRadius
      });
      const aura = svgElement("circle", {
        class: "profile-map__node-aura",
        cx: point.x,
        cy: point.y,
        r: 14 * nodeScale,
        fill: color,
      });
      const outline = svgElement("circle", {
        class: "profile-map__node-outline",
        cx: point.x,
        cy: point.y,
        r: 9.5 * nodeScale,
        stroke: color,
      });
      const orbit = svgElement("circle", {
        class: "profile-map__signal-orbit",
        cx: point.x,
        cy: point.y,
        r: 7 * nodeScale,
        stroke: color
      });
      const signal = svgElement("circle", {
        class: "profile-map__node-mark profile-map__signal-core",
        cx: point.x,
        cy: point.y,
        r: 4.4 * nodeScale,
        fill: color,
        stroke: color,
      });
      const displayLabel = (narrow ? MOBILE_NODE_LABELS[node.id] : SHORT_NODE_LABELS[node.id]) || node.label;
      const placement = labelPlacement(
        point,
        displayLabel,
        width,
        height,
        narrow,
        occupiedLabelBoxes,
        allNodePoints
      );
      const label = svgElement("text", {
        class: `profile-map__node-label${point.nodeIndex === 0 ? " is-priority-label" : ""}`,
        x: placement.x,
        y: placement.y,
        "text-anchor": placement.anchor
      });
      label.textContent = displayLabel;
      const centerDot = svgElement("circle", {
        class: "profile-map__node-center",
        cx: point.x,
        cy: point.y,
        r: 1.2
      });
      group.append(nodeTitle, hitArea, aura, outline, orbit, signal, centerDot, label);
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

    const rootGroup = svgElement("g", { class: "profile-map__root", "aria-hidden": "true" });
    const rootHalo = svgElement("circle", {
      class: "profile-map__root-halo",
      cx: rootPoint.x,
      cy: rootPoint.y,
      r: narrow ? 27 : 30
    });
    const rootDot = svgElement("circle", {
      class: "profile-map__root-dot",
      cx: rootPoint.x,
      cy: rootPoint.y,
      r: narrow ? 19 : 21
    });
    const rootMonogram = svgElement("text", {
      class: "profile-map__root-monogram",
      x: rootPoint.x,
      y: rootPoint.y + 4
    });
    rootMonogram.textContent = "AC";
    const rootName = svgElement("text", {
      class: "profile-map__root-name",
      x: rootPoint.x,
      y: rootPoint.y + (narrow ? 31 : 34),
      "text-anchor": "middle"
    });
    rootName.textContent = "ANDREW CONCEPCION";
    rootGroup.append(rootHalo, rootDot, rootMonogram, rootName);
    svg.append(rootGroup, headingLayer);
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
