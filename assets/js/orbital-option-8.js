(() => {
  "use strict";

  const root = document.querySelector("[data-synthesis]");
  if (!root) return;

  const overview = root.querySelector("[data-overview]");
  const plane = root.querySelector("[data-orbit-plane]");
  const cameraWindow = root.querySelector("[data-camera-window]");
  const nodes = [...root.querySelectorAll("[data-orbit-object]")];
  const mapControls = [...root.querySelectorAll("[data-map-target]")];
  const mapHome = root.querySelector("[data-map-home]");
  const details = [...root.querySelectorAll("[data-facet-detail]")];
  const detailLayer = root.querySelector("[data-detail-layer]");
  const backdrop = root.querySelector("[data-detail-backdrop]");
  const closeButton = root.querySelector("[data-detail-close]");
  const viewToggle = root.querySelector("[data-view-toggle]");
  const motionToggle = root.querySelector("[data-motion-toggle]");
  const viewAction = root.querySelector("[data-view-action]");
  const viewLabel = root.querySelector("[data-view-label]");
  const viewReadout = root.querySelector("[data-view-readout]");
  const motionReadout = root.querySelector("[data-motion-readout]");
  const previewPanel = root.querySelector("[data-dashboard-preview]");
  const previewArticles = [...root.querySelectorAll("[data-preview]")];
  const previewCode = root.querySelector("[data-preview-code]");
  const previewStatus = root.querySelector("[data-preview-status]");

  if (
    !overview || !plane || !cameraWindow || nodes.length !== 6 || mapControls.length !== 6 ||
    details.length !== 6 || !mapHome || !detailLayer || !backdrop || !closeButton ||
    !viewToggle || !motionToggle || !previewPanel || previewArticles.length !== 6
  ) return;

  const keys = ["about", "profile", "work", "projects", "threads", "contact"];
  const labels = new Map([
    ["about", "About"],
    ["profile", "Skills + interests"],
    ["work", "Work"],
    ["projects", "Highlighted projects"],
    ["threads", "Current threads"],
    ["contact", "Contact"],
  ]);
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const shortQuery = window.matchMedia("(orientation: landscape) and (max-height: 560px) and (max-width: 1000px)");
  const phoneQuery = window.matchMedia("(max-width: 767px)");
  // Compact describes the available geometry only. It scales the same orbital
  // model; it never freezes motion or replaces the ellipses with a carousel.
  const compactQuery = window.matchMedia("(max-width: 1100px)");
  const nodeByKey = new Map(nodes.map((node) => [node.dataset.orbitObject, node]));
  const detailByKey = new Map(details.map((detail) => [detail.dataset.facetDetail, detail]));

  // Each track has its own eccentricity, center and tilt. The paths stay purely
  // parametric so no collision response can introduce visible jumps or edge parking.
  const profiles = [
    { key: "about", angle: -62, rx: .19, ry: .125, cx: .03, cy: .02, tilt: -8, period: 178 },
    { key: "profile", angle: 12, rx: .255, ry: .17, cx: .065, cy: -.025, tilt: 13, period: 204 },
    { key: "work", angle: 82, rx: .315, ry: .215, cx: .02, cy: .025, tilt: -17, period: 232 },
    { key: "projects", angle: 137, rx: .37, ry: .255, cx: .08, cy: -.035, tilt: 7, period: 260 },
    { key: "threads", angle: 211, rx: .42, ry: .29, cx: .11, cy: -.01, tilt: 19, period: 286 },
    { key: "contact", angle: 292, rx: .47, ry: .325, cx: .065, cy: .035, tilt: -11, period: 314 },
  ];

  const phoneProfiles = new Map([
    ["about", { angleOffset: -88, rx: .37, ry: .41, cx: 0, cy: 0, tilt: 0 }],
    ["profile", { angleOffset: -102, rx: .37, ry: .41, cx: 0, cy: 0, tilt: 0 }],
    ["work", { angleOffset: -112, rx: .37, ry: .41, cx: 0, cy: 0, tilt: 0 }],
    ["projects", { angleOffset: -107, rx: .37, ry: .41, cx: 0, cy: 0, tilt: 0 }],
    ["threads", { angleOffset: -121, rx: .37, ry: .41, cx: 0, cy: 0, tilt: 0 }],
    ["contact", { angleOffset: -142, rx: .37, ry: .41, cx: 0, cy: 0, tilt: 0 }],
  ]);

  const state = {
    width: 0,
    height: 0,
    lastFrame: 0,
    frameRequest: 0,
    cameraTimer: 0,
    transitionTimers: [],
    held: new Set(),
    preview: null,
    previewAnchor: null,
    previewFrame: 0,
    previewUntil: 0,
    view: "orbit",
    phase: "overview",
    selected: null,
    opener: null,
    paused: false,
    cameraHeld: false,
    overviewScrollY: 0,
    reduced: reducedMotionQuery.matches,
    phone: phoneQuery.matches,
    compact: compactQuery.matches,
    short: shortQuery.matches,
    audioContext: null,
    activeAudio: new Set(),
  };

  const validKey = (key) => keys.includes(key);
  const keyFromHash = () => {
    const match = window.location.hash.match(/^#facet-([a-z-]+)$/);
    return match && validKey(match[1]) ? match[1] : null;
  };

  const setPhase = (phase) => {
    state.phase = phase;
    root.dataset.transition = phase;
    root.dataset.phase = phase;
  };

  const clearTransitionTimers = () => {
    state.transitionTimers.forEach((timer) => window.clearTimeout(timer));
    state.transitionTimers = [];
  };

  const later = (callback, delay) => {
    const timer = window.setTimeout(callback, delay);
    state.transitionTimers.push(timer);
    return timer;
  };

  const writeHistory = (key, mode = "push") => {
    const url = new URL(window.location.href);
    url.hash = key ? `facet-${key}` : "";
    const method = mode === "replace" ? "replaceState" : "pushState";
    window.history[method]({ orbitalFacet: key }, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const ensureAudio = async () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      root.dataset.audioState = "unsupported";
      return null;
    }
    if (!state.audioContext) state.audioContext = new AudioContext();
    root.dataset.audioState = state.audioContext.state;
    if (state.audioContext.state === "suspended") {
      try {
        await state.audioContext.resume();
      } catch (_error) {
        root.dataset.audioState = "blocked";
        return null;
      }
    }
    root.dataset.audioState = state.audioContext.state;
    return state.audioContext.state === "running" ? state.audioContext : null;
  };

  const trackSource = (source) => {
    state.activeAudio.add(source);
    source.addEventListener?.("ended", () => state.activeAudio.delete(source), { once: true });
    return source;
  };

  const tone = (context, { frequency, endFrequency = frequency, duration, offset = 0, gain = .03, type = "sine" }) => {
    const start = context.currentTime + offset;
    const oscillator = trackSource(context.createOscillator());
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    envelope.gain.setValueAtTime(.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + Math.min(.035, duration / 4));
    envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(envelope).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + .02);
  };

  const playCue = async (cue) => {
    const context = await ensureAudio();
    if (!context) return;
    window.dispatchEvent(new CustomEvent("orbital:sound", { detail: { cue } }));

    if (cue === "select") {
      tone(context, { frequency: 520, endFrequency: 690, duration: .1, gain: .07, type: "triangle" });
      tone(context, { frequency: 780, endFrequency: 860, duration: .08, offset: .085, gain: .05, type: "triangle" });
    } else if (cue === "focus") {
      tone(context, { frequency: 196, endFrequency: 220, duration: .32, gain: .055 });
      tone(context, { frequency: 392, endFrequency: 440, duration: .36, offset: .04, gain: .035, type: "triangle" });
    } else if (cue === "dismiss") {
      tone(context, { frequency: 360, endFrequency: 150, duration: .2, gain: .055, type: "triangle" });
    } else if (cue === "view") {
      tone(context, { frequency: 520, endFrequency: 610, duration: .08, gain: .05, type: "square" });
      tone(context, { frequency: 690, endFrequency: 780, duration: .08, offset: .09, gain: .035, type: "square" });
    } else if (cue === "motion") {
      tone(context, { frequency: state.paused ? 310 : 470, duration: .09, gain: .045, type: "triangle" });
    } else if (cue === "satellite") {
      tone(context, { frequency: 680, endFrequency: 920, duration: .13, gain: .05 });
    }
  };

  const measure = () => {
    state.width = plane.clientWidth;
    state.height = plane.clientHeight;
  };

  const pointOnEllipse = (profile) => {
    let layout = profile;
    if (state.phone) {
      const phone = phoneProfiles.get(profile.key);
      const verticalScale = state.short ? .86 : 1;
      layout = {
        ...profile,
        angleOffset: phone.angleOffset,
        rx: phone.rx,
        ry: phone.ry * verticalScale,
        cx: phone.cx,
        cy: phone.cy * verticalScale,
        tilt: phone.tilt,
      };
    } else if (state.compact) {
      const compact = phoneProfiles.get(profile.key);
      layout = {
        ...profile,
        angleOffset: compact.angleOffset,
        rx: .34,
        ry: .42,
        cx: 0,
        cy: 0,
        tilt: 0,
      };
    }
    const angle = (profile.angle + (layout.angleOffset || 0)) * Math.PI / 180;
    const tilt = layout.tilt * Math.PI / 180;
    const localX = Math.cos(angle) * state.width * layout.rx;
    const localY = Math.sin(angle) * state.height * layout.ry;
    const depth = ((Math.sin(angle) + 1) / 2) * 5;
    return {
      x: state.width * layout.cx + localX * Math.cos(tilt) - localY * Math.sin(tilt),
      y: state.height * layout.cy + localX * Math.sin(tilt) + localY * Math.cos(tilt),
      depth,
      layer: Math.round(depth),
    };
  };

  const render = () => {
    if (!state.width || !state.height) measure();
    const points = profiles.map(pointOnEllipse);

    profiles.forEach((profile, index) => {
      const node = nodeByKey.get(profile.key);
      const point = points[index];
      node.style.setProperty("--x", `${point.x.toFixed(2)}px`);
      node.style.setProperty("--y", `${point.y.toFixed(2)}px`);
      node.style.setProperty("--depth", point.depth.toFixed(3));
      node.style.setProperty("--layer", String(point.layer));
    });
  };

  const stopFrame = () => {
    if (!state.frameRequest) return;
    window.cancelAnimationFrame(state.frameRequest);
    state.frameRequest = 0;
  };

  const shouldAnimate = () => (
    !state.reduced && !state.paused && !state.cameraHeld &&
    state.phase !== "dismissing" && !document.hidden
  );

  const frame = (timestamp) => {
    const delta = state.lastFrame ? Math.min(timestamp - state.lastFrame, 48) : 16;
    state.lastFrame = timestamp;
    profiles.forEach((profile) => {
      if (state.held.has(profile.key)) return;
      const period = state.phone ? 360 : (state.compact ? 330 : profile.period);
      profile.angle += (360 / period) * (delta / 1000);
    });
    render();
    state.frameRequest = shouldAnimate() ? window.requestAnimationFrame(frame) : 0;
  };

  const startFrame = () => {
    stopFrame();
    state.lastFrame = 0;
    render();
    if (shouldAnimate()) state.frameRequest = window.requestAnimationFrame(frame);
  };

  const syncMotion = () => {
    root.dataset.motion = state.reduced ? "reduced" : (state.paused ? "paused" : "active");
    motionToggle.setAttribute("aria-disabled", String(state.reduced));
    motionToggle.setAttribute("aria-pressed", String(state.paused));
    motionToggle.textContent = state.reduced ? "[reduced]" : (state.paused ? "[resume]" : "[pause]");
    if (motionReadout) motionReadout.textContent = `MOTION / ${root.dataset.motion.toUpperCase()}`;
    startFrame();
  };

  const setView = (view, { sound = true } = {}) => {
    state.view = view === "top" ? "top" : "orbit";
    root.dataset.view = state.view;
    const top = state.view === "top";
    viewToggle.setAttribute("aria-pressed", String(top));
    if (viewAction) viewAction.textContent = top ? "Tilt to orbit view" : "Rotate to top view";
    if (viewLabel) viewLabel.textContent = top ? "Top · 90°" : "Orbit · 38°";
    if (viewReadout) viewReadout.textContent = top ? "PLAN / 90°" : "PERSPECTIVE / 38°";
    // Responsive top-view rules can change the rig's width. Re-measure on the
    // next frame so the same nodes stay on their intended tracks.
    window.requestAnimationFrame(() => {
      measure();
      render();
    });
    if (sound) playCue("view");
  };

  const placePreview = (anchor) => {
    if (!anchor || previewPanel.offsetParent === null) return;
    const rootRect = root.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = previewPanel.getBoundingClientRect();
    const gap = 16;
    const margin = 18;
    let side = "right";
    let left = anchorRect.right - rootRect.left + gap;
    if (left + panelRect.width > rootRect.width - margin) {
      side = "left";
      left = anchorRect.left - rootRect.left - panelRect.width - gap;
    }
    const maxLeft = Math.max(margin, rootRect.width - panelRect.width - margin);
    const top = Math.max(72, Math.min(
      rootRect.height - panelRect.height - 24,
      anchorRect.top - rootRect.top + (anchorRect.height - panelRect.height) / 2,
    ));
    previewPanel.style.setProperty("--preview-x", `${Math.max(margin, Math.min(maxLeft, left)).toFixed(1)}px`);
    previewPanel.style.setProperty("--preview-y", `${top.toFixed(1)}px`);
    previewPanel.dataset.side = side;
  };

  const trackPreview = (time) => {
    if (!state.preview || time > state.previewUntil) {
      state.previewFrame = 0;
      return;
    }
    placePreview(state.previewAnchor || nodeByKey.get(state.preview));
    state.previewFrame = window.requestAnimationFrame(trackPreview);
  };

  const startPreviewTracking = () => {
    if (state.previewFrame) window.cancelAnimationFrame(state.previewFrame);
    state.previewUntil = performance.now() + 1150;
    state.previewFrame = window.requestAnimationFrame(trackPreview);
  };

  const showPreview = (key, anchor = nodeByKey.get(key)) => {
    if (!validKey(key) || state.selected) return;
    state.preview = key;
    state.previewAnchor = anchor;
    root.dataset.previewing = key;
    previewArticles.forEach((article) => {
      const active = article.dataset.preview === key;
      article.classList.toggle("is-active", active);
      article.setAttribute("aria-hidden", String(!active));
    });
    if (previewCode) previewCode.textContent = `[PREVIEW: ${labels.get(key).toUpperCase()}]`;
    if (previewStatus) previewStatus.textContent = "SELECT / RE-ROOT";
    placePreview(anchor);
    previewPanel.classList.add("is-active");
    startPreviewTracking();
  };

  const clearPreview = () => {
    if (state.selected) return;
    state.preview = null;
    state.previewAnchor = null;
    if (state.previewFrame) window.cancelAnimationFrame(state.previewFrame);
    state.previewFrame = 0;
    delete root.dataset.previewing;
    previewPanel.classList.remove("is-active");
    previewArticles.forEach((article) => {
      article.classList.remove("is-active");
      article.setAttribute("aria-hidden", "true");
    });
    if (previewCode) previewCode.textContent = "[HOVER PREVIEW]";
    if (previewStatus) previewStatus.textContent = "FIELD / READY";
  };

  const syncSelection = () => {
    nodes.forEach((node) => {
      const selected = node.dataset.orbitObject === state.selected;
      node.classList.toggle("is-selected", selected);
      node.setAttribute("aria-pressed", String(selected));
    });
    mapControls.forEach((control) => {
      const selected = control.dataset.mapTarget === state.selected;
      control.setAttribute("aria-pressed", String(selected));
      if (selected) control.setAttribute("aria-current", "location");
      else control.removeAttribute("aria-current");
    });
    mapHome.setAttribute("aria-current", state.selected ? "false" : "page");
    mapHome.setAttribute("aria-pressed", String(!state.selected));
    details.forEach((detail) => {
      const selected = detail.dataset.facetDetail === state.selected;
      detail.classList.toggle("is-active", selected);
      detail.setAttribute("aria-hidden", String(!selected));
      detail.inert = !selected;
    });
  };

  const setFocusShift = (key) => {
    const node = nodeByKey.get(key);
    const sculpture = node?.querySelector(".sculpture");
    const nodeRect = sculpture?.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    if (!nodeRect) return;
    const targetX = rootRect.left + rootRect.width * (state.compact ? .5 : .63);
    const targetY = rootRect.top + rootRect.height * (state.compact ? .56 : .5);
    const shiftX = Math.max(-190, Math.min(190, (targetX - (nodeRect.left + nodeRect.width / 2)) * .55));
    const shiftY = Math.max(-130, Math.min(130, (targetY - (nodeRect.top + nodeRect.height / 2)) * .55));
    root.style.setProperty("--focus-shift-x", `${shiftX.toFixed(1)}px`);
    root.style.setProperty("--focus-shift-y", `${shiftY.toFixed(1)}px`);
  };

  const focusDestination = () => {
    setPhase("focused");
    playCue("focus");
    closeButton.focus({ preventScroll: true });
  };

  const selectFacet = (key, options = {}) => {
    if (!validKey(key)) return;
    const { historyMode = "push", sound = true, immediate = false, opener = null } = options;
    if (state.selected === key && state.phase === "focused") return;
    clearTransitionTimers();
    const enteringFromOverview = !state.selected;
    if (state.phone && enteringFromOverview) state.overviewScrollY = window.scrollY;
    if (state.selected) state.held.delete(state.selected);
    state.selected = key;
    state.held.add(key);
    state.opener = opener || nodeByKey.get(key);
    root.dataset.selected = key;
    clearPreview();
    syncSelection();
    detailLayer.scrollTop = 0;
    detailByKey.get(key).scrollTop = 0;
    setFocusShift(key);
    detailLayer.hidden = false;
    const heading = detailByKey.get(key)?.querySelector("h2");
    if (heading?.id) detailLayer.setAttribute("aria-labelledby", heading.id);
    if (historyMode) writeHistory(key, historyMode);
    overview.inert = true;
    setPhase(immediate || state.reduced ? "focused" : "focusing");
    if (sound) playCue("select");
    startFrame();
    if (state.phone) {
      window.scrollTo({
        top: root.offsetTop,
        behavior: immediate || state.reduced ? "auto" : "smooth",
      });
    }

    if (immediate || state.reduced) {
      window.requestAnimationFrame(() => closeButton.focus({ preventScroll: true }));
      return;
    }
    later(focusDestination, 620);
  };

  const finishDismiss = (restoreFocus) => {
    detailLayer.hidden = true;
    overview.inert = false;
    const opener = state.opener;
    if (state.selected) state.held.delete(state.selected);
    state.selected = null;
    state.opener = null;
    delete root.dataset.selected;
    root.style.removeProperty("--focus-shift-x");
    root.style.removeProperty("--focus-shift-y");
    setPhase("overview");
    syncSelection();
    startFrame();
    if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
    if (state.phone) {
      window.scrollTo({
        top: state.overviewScrollY,
        behavior: state.reduced ? "auto" : "smooth",
      });
    }
  };

  const dismiss = (options = {}) => {
    if (!state.selected) return;
    const { historyMode = "push", sound = true, restoreFocus = true, immediate = false } = options;
    clearTransitionTimers();
    if (historyMode) writeHistory(null, historyMode);
    if (sound) playCue("dismiss");
    if (immediate || state.reduced) {
      finishDismiss(restoreFocus);
      return;
    }
    setPhase("dismissing");
    stopFrame();
    later(() => finishDismiss(restoreFocus), 480);
  };

  const moveMapFocus = (current, event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const controls = [mapHome, ...mapControls];
    let index = controls.indexOf(current);
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = controls.length - 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") index = (index + 1) % controls.length;
    else index = (index - 1 + controls.length) % controls.length;
    controls.forEach((control, controlIndex) => { control.tabIndex = controlIndex === index ? 0 : -1; });
    controls[index].focus({ preventScroll: true });
  };

  const moveNodeFocus = (current, event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let index = keys.indexOf(current.dataset.orbitObject);
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = keys.length - 1;
    else if (["ArrowRight", "ArrowDown"].includes(event.key)) index = (index + 1) % keys.length;
    else index = (index - 1 + keys.length) % keys.length;
    nodeByKey.get(keys[index])?.focus({ preventScroll: true });
  };

  nodes.forEach((node) => {
    const key = node.dataset.orbitObject;
    node.addEventListener("click", () => selectFacet(key, { opener: node }));
    node.addEventListener("keydown", (event) => moveNodeFocus(node, event));
    node.addEventListener("pointerenter", () => { state.held.add(key); showPreview(key, node); });
    node.addEventListener("pointerleave", () => { if (state.selected !== key) state.held.delete(key); clearPreview(); });
    node.addEventListener("focus", () => { state.held.add(key); showPreview(key, node); });
    node.addEventListener("blur", () => { if (state.selected !== key) state.held.delete(key); clearPreview(); });
  });

  [mapHome, ...mapControls].forEach((control, index) => {
    control.tabIndex = index === 0 ? 0 : -1;
    control.addEventListener("keydown", (event) => moveMapFocus(control, event));
  });

  mapHome.addEventListener("click", () => {
    if (state.selected) dismiss({ opener: mapHome });
    else document.querySelector("[data-identity-hero]")?.focus?.({ preventScroll: true });
  });
  mapHome.addEventListener("pointerenter", clearPreview);

  mapControls.forEach((control) => {
    const key = control.dataset.mapTarget;
    control.addEventListener("click", () => {
      if (state.selected === key) dismiss({ restoreFocus: false });
      else selectFacet(key, { opener: control });
    });
    control.addEventListener("pointerenter", () => showPreview(key, nodeByKey.get(key)));
    control.addEventListener("pointerleave", clearPreview);
    control.addEventListener("focus", () => showPreview(key, nodeByKey.get(key)));
    control.addEventListener("blur", clearPreview);
  });

  viewToggle.addEventListener("click", () => {
    state.cameraHeld = true;
    stopFrame();
    setView(state.view === "orbit" ? "top" : "orbit");
    window.clearTimeout(state.cameraTimer);
    state.cameraTimer = window.setTimeout(() => {
      state.cameraHeld = false;
      startFrame();
    }, state.reduced ? 0 : 1120);
  });

  motionToggle.addEventListener("click", () => {
    if (state.reduced) return;
    state.paused = !state.paused;
    playCue("motion");
    syncMotion();
  });

  backdrop.addEventListener("click", () => dismiss());
  closeButton.addEventListener("click", () => dismiss({ opener: mapHome }));
  detailLayer.querySelectorAll(".focus-satellites a, .landing-copy > a").forEach((link) => {
    link.addEventListener("click", () => playCue("satellite"));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.selected) {
      event.preventDefault();
      dismiss();
    }
  });

  const restoreFromLocation = () => {
    const key = keyFromHash();
    if (key) {
      if (state.selected === key && state.phase === "focused") return;
      selectFacet(key, { historyMode: null, sound: false, immediate: true, opener: nodeByKey.get(key) });
    } else if (state.selected) {
      dismiss({ historyMode: null, sound: false, restoreFocus: false, immediate: true });
    }
  };

  window.addEventListener("popstate", restoreFromLocation);
  window.addEventListener("resize", () => {
    state.compact = compactQuery.matches;
    state.phone = phoneQuery.matches;
    state.short = shortQuery.matches;
    measure();
    if (state.preview) placePreview(state.previewAnchor || nodeByKey.get(state.preview));
    syncMotion();
  }, { passive: true });
  document.addEventListener("visibilitychange", startFrame);
  reducedMotionQuery.addEventListener?.("change", (event) => {
    state.reduced = event.matches;
    syncMotion();
  });
  compactQuery.addEventListener?.("change", (event) => {
    state.compact = event.matches;
    state.phone = phoneQuery.matches;
    state.short = shortQuery.matches;
    measure();
    syncMotion();
  });
  phoneQuery.addEventListener?.("change", (event) => {
    state.phone = event.matches;
    state.short = shortQuery.matches;
    measure();
    syncMotion();
  });

  root.dataset.audio = "enabled";
  root.dataset.audioState = "awaiting-gesture";
  detailLayer.hidden = true;
  details.forEach((detail) => {
    detail.setAttribute("aria-hidden", "true");
    detail.inert = true;
  });
  previewArticles.forEach((article) => article.setAttribute("aria-hidden", "true"));
  document.documentElement.classList.replace("no-js", "has-js");
  setPhase("overview");
  setView("orbit", { sound: false });
  syncSelection();
  clearPreview();
  measure();
  syncMotion();
  restoreFromLocation();
})();
