(() => {
  "use strict";

  const root = document.querySelector("[data-synthesis]");
  if (!root) return;

  const overview = root.querySelector("[data-overview]");
  const plane = root.querySelector("[data-orbit-plane]");
  const cameraWindow = root.querySelector("[data-camera-window]");
  const nodes = [...root.querySelectorAll("[data-orbit-object]")];
  const tracks = [...root.querySelectorAll("[data-track]")];
  const mapControls = [...root.querySelectorAll("[data-map-target]")];
  const mapHome = root.querySelector("[data-map-home]");
  const details = [...root.querySelectorAll("[data-facet-detail]")];
  const detailLayer = root.querySelector("[data-detail-layer]");
  const backdrop = root.querySelector("[data-detail-backdrop]");
  const closeButton = root.querySelector("[data-detail-close]");
  const viewToggle = root.querySelector("[data-view-toggle]");
  const motionToggle = root.querySelector("[data-motion-toggle]");
  const resetToggle = root.querySelector("[data-orbit-reset]");
  const viewAction = root.querySelector("[data-view-action]");
  const viewLabel = root.querySelector("[data-view-label]");
  const viewReadout = root.querySelector("[data-view-readout]");
  const motionReadout = root.querySelector("[data-motion-readout]");
  const previewPanel = root.querySelector("[data-dashboard-preview]");
  const previewArticles = [...root.querySelectorAll("[data-preview]")];
  const previewCode = root.querySelector("[data-preview-code]");
  const previewStatus = root.querySelector("[data-preview-status]");
  const previousFacet = root.querySelector("[data-facet-previous]");
  const nextFacet = root.querySelector("[data-facet-next]");
  const facetPosition = root.querySelector("[data-facet-position]");
  const facetStatus = root.querySelector("[data-facet-status]");

  if (
    !overview || !plane || !cameraWindow || nodes.length !== 6 || tracks.length !== 6 || mapControls.length !== 6 ||
    details.length !== 6 || !mapHome || !detailLayer || !backdrop || !closeButton ||
    !viewToggle || !motionToggle || !resetToggle || !previewPanel || previewArticles.length !== 6 ||
    !previousFacet || !nextFacet || !facetPosition || !facetStatus
  ) return;

  const keys = ["about", "profile", "work", "projects", "threads", "contact"];
  const transferOutDuration = 420;
  const transferNeutralDuration = 34;
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
  const trackByKey = new Map(tracks.map((track) => [track.dataset.track, track]));
  const detailByKey = new Map(details.map((detail) => [detail.dataset.facetDetail, detail]));

  // Each track has its own eccentricity, center and tilt. The paths stay purely
  // parametric so no collision response can introduce visible jumps or edge parking.
  const profiles = [
    { key: "about", angle: -62, rx: .19, ry: .125, cx: .03, cy: -.005, tilt: -8, period: 178 },
    { key: "profile", angle: 12, rx: .255, ry: .17, cx: .065, cy: -.025, tilt: 13, period: 204 },
    { key: "work", angle: 82, rx: .315, ry: .215, cx: .02, cy: .025, tilt: -17, period: 232 },
    { key: "projects", angle: 137, rx: .37, ry: .255, cx: .08, cy: -.035, tilt: 7, period: 260 },
    { key: "threads", angle: 211, rx: .42, ry: .29, cx: .11, cy: -.01, tilt: 19, period: 286 },
    { key: "contact", angle: 292, rx: .47, ry: .325, cx: .065, cy: .035, tilt: -11, period: 314 },
  ];
  const phoneProfiles = new Map([
    ["about", { angleOffset: -88, rx: .24, ry: .26, cx: .01, cy: .04, tilt: -6 }],
    ["profile", { angleOffset: -102, rx: .29, ry: .31, cx: .015, cy: 0, tilt: 8 }],
    ["work", { angleOffset: -112, rx: .34, ry: .355, cx: 0, cy: .01, tilt: -10 }],
    ["projects", { angleOffset: -107, rx: .385, ry: .40, cx: .02, cy: -.015, tilt: 5 }],
    ["threads", { angleOffset: -121, rx: .425, ry: .44, cx: .025, cy: -.005, tilt: 11 }],
    ["contact", { angleOffset: -142, rx: .46, ry: .47, cx: -.04, cy: .015, tilt: -8 }],
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
    drag: null,
    cometKey: null,
    cometAwaitingPointerExit: new Set(),
    customOrbits: new Map(),
    resetTimers: new Map(),
    suppressClick: null,
    overviewScrollY: 0,
    reduced: reducedMotionQuery.matches,
    phone: phoneQuery.matches,
    compact: compactQuery.matches,
    short: shortQuery.matches,
    audioContext: null,
    activeAudio: new Set(),
    nodeVisibility: new Map(keys.map((key) => [key, 1])),
    orbitRates: new Map(keys.map((key) => [key, 1])),
    focusAfterTransition: null,
    facetGesture: null,
    pendingFacet: null,
  };

  const cometParticlePalette = [
    "40,100,199",
    "104,127,196",
    "22,140,134",
    "233,139,39",
    "223,100,44",
  ];
  const cometParticleSample = (nodeIndex, particleIndex, salt) => {
    const value = Math.sin((nodeIndex + 1) * 31.73 + (particleIndex + 1) * 19.19 + salt * 11.41) * 43758.5453;
    return value - Math.floor(value);
  };

  nodes.forEach((node) => node.setAttribute("aria-grabbed", "false"));

  // Only one body can be the active comet. Reuse one wake instead of keeping
  // six filtered particle systems in the scene, which avoids unnecessary
  // style/compositing work while preserving the exact visible tail.
  const cometWake = document.createElement("span");
  const cometParticleSeed = keys.indexOf("projects");
  cometWake.className = "comet-wake";
  cometWake.setAttribute("aria-hidden", "true");
  for (let line = 0; line < 3; line += 1) cometWake.append(document.createElement("i"));
  for (let particleIndex = 0; particleIndex < 22; particleIndex += 1) {
    const particle = document.createElement("b");
    const dust = particleIndex % 5 === 1 || particleIndex % 5 === 4;
    const duration = (dust ? 1.6 : 1.08) + cometParticleSample(cometParticleSeed, particleIndex, 1) * (dust ? .9 : .68);
    const distance = (dust ? 52 : 72) + cometParticleSample(cometParticleSeed, particleIndex, 2) * (dust ? 54 : 58);
    const size = (dust ? 1.05 : .82) + cometParticleSample(cometParticleSeed, particleIndex, 3) * (dust ? 2.3 : 1.82);
    const trail = (dust ? 5 : 7) + cometParticleSample(cometParticleSeed, particleIndex, 4) * (dust ? 9 : 12);
    const vertical = (cometParticleSample(cometParticleSeed, particleIndex, 5) - .5) * (dust ? 9 : 5.5);
    const jitter = (cometParticleSample(cometParticleSeed, particleIndex, 6) - .5) * (dust ? 5 : 2.5);
    const paletteIndex = dust
      ? 3 + (particleIndex % 2)
      : particleIndex % 3;
    particle.className = `comet-particle comet-particle--${dust ? "dust" : "ion"}`;
    particle.style.setProperty("--particle-rgb", cometParticlePalette[paletteIndex]);
    particle.style.setProperty("--particle-delay", `${(-duration * cometParticleSample(cometParticleSeed, particleIndex, 7)).toFixed(3)}s`);
    particle.style.setProperty("--particle-duration", `${duration.toFixed(3)}s`);
    particle.style.setProperty("--particle-distance", `${distance.toFixed(2)}px`);
    particle.style.setProperty("--particle-size", `${size.toFixed(2)}px`);
    particle.style.setProperty("--particle-mobile-size", `${Math.max(.7, size * .82).toFixed(2)}px`);
    particle.style.setProperty("--particle-trail", `${trail.toFixed(2)}px`);
    particle.style.setProperty("--particle-y", `${vertical.toFixed(2)}px`);
    particle.style.setProperty("--particle-jitter", `${jitter.toFixed(2)}px`);
    particle.style.setProperty("--particle-alpha", (.54 + cometParticleSample(cometParticleSeed, particleIndex, 8) * .46).toFixed(3));
    cometWake.append(particle);
  }
  nodes[0].append(cometWake);

  // Threads has the broadest regular path, so it can spend longer beyond the
  // camera edge than the other nodes. IntersectionObserver keeps that check
  // outside the animation loop; the frame code then eases its rate up while
  // clipped and back to normal before it is fully visible again.
  const visibilityObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const key = entry.target.dataset.orbitObject;
          if (key) state.nodeVisibility.set(key, entry.intersectionRatio);
        });
      }, {
        root: cameraWindow,
        threshold: [0, .01, .18, .42, .68, 1],
      })
    : null;
  visibilityObserver?.observe(nodeByKey.get("threads"));

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

  const clearTransferState = () => {
    state.pendingFacet = null;
    delete root.dataset.transferStage;
    delete root.dataset.transferFrom;
    delete root.dataset.transferTo;
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
    if (window.UniverseSound && !window.UniverseSound.enabled()) {
      root.dataset.audioState = "muted";
      return null;
    }
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

  const tone = (context, { frequency, endFrequency = frequency, duration, offset = 0, gain = .03, type = "sine", cutoff = 900 }) => {
    const start = context.currentTime + offset;
    const oscillator = trackSource(context.createOscillator());
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, start);
    filter.Q.value = .45;
    envelope.gain.setValueAtTime(.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + Math.min(.035, duration / 4));
    envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(filter).connect(envelope).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + .02);
  };

  const playCue = async (cue) => {
    const context = await ensureAudio();
    if (!context) return;
    window.dispatchEvent(new CustomEvent("orbital:sound", { detail: { cue } }));

    if (cue === "select") {
      tone(context, { frequency: 220, endFrequency: 290, duration: .1, gain: .065, type: "triangle", cutoff: 650 });
      tone(context, { frequency: 330, endFrequency: 360, duration: .08, offset: .085, gain: .04, type: "triangle", cutoff: 720 });
    } else if (cue === "focus") {
      tone(context, { frequency: 98, endFrequency: 110, duration: .32, gain: .055, cutoff: 420 });
      tone(context, { frequency: 196, endFrequency: 220, duration: .36, offset: .04, gain: .03, type: "triangle", cutoff: 560 });
    } else if (cue === "dismiss") {
      tone(context, { frequency: 220, endFrequency: 90, duration: .2, gain: .05, type: "triangle", cutoff: 520 });
    } else if (cue === "view") {
      tone(context, { frequency: 180, endFrequency: 220, duration: .08, gain: .045, type: "triangle", cutoff: 560 });
      tone(context, { frequency: 260, endFrequency: 300, duration: .08, offset: .09, gain: .03, type: "triangle", cutoff: 640 });
    } else if (cue === "motion") {
      tone(context, { frequency: state.paused ? 150 : 210, duration: .09, gain: .042, type: "triangle", cutoff: 540 });
    } else if (cue === "fling") {
      tone(context, { frequency: 78, endFrequency: 320, duration: .28, gain: .06, type: "triangle", cutoff: 620 });
      tone(context, { frequency: 360, endFrequency: 220, duration: .18, offset: .12, gain: .03, type: "triangle", cutoff: 680 });
    } else if (cue === "reset") {
      tone(context, { frequency: 300, endFrequency: 165, duration: .2, gain: .042, type: "triangle", cutoff: 620 });
    } else if (cue === "satellite") {
      tone(context, { frequency: 240, endFrequency: 330, duration: .13, gain: .045, type: "triangle", cutoff: 680 });
    }
  };

  const measure = () => {
    state.width = plane.clientWidth;
    state.height = plane.clientHeight;
  };

  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

  // Custom paths keep the AC origin at the left focus. Solving M = E + e·sin(E)
  // gives a restrained Kepler-like sweep: slow at the far end, quick near AC.
  const solveEccentricAnomaly = (meanAnomaly, eccentricity) => {
    const tau = Math.PI * 2;
    const mean = ((meanAnomaly + Math.PI) % tau + tau) % tau - Math.PI;
    let eccentric = mean;
    for (let iteration = 0; iteration < 6; iteration += 1) {
      const error = eccentric + eccentricity * Math.sin(eccentric) - mean;
      eccentric -= error / (1 + eccentricity * Math.cos(eccentric));
    }
    return eccentric;
  };

  const responsiveLayout = (profile) => {
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
      const verticalScale = state.short ? .82 : 1;
      layout = {
        ...profile,
        angleOffset: compact.angleOffset,
        rx: compact.rx,
        ry: compact.ry * verticalScale,
        cx: compact.cx,
        cy: compact.cy * verticalScale,
        tilt: compact.tilt,
      };
    }
    return layout;
  };

  const syncRegularTrack = (profile) => {
    if (!state.width || !state.height || state.customOrbits.has(profile.key)) return;
    const track = trackByKey.get(profile.key);
    if (!track) return;
    const layout = responsiveLayout(profile);
    track.style.setProperty("--tw", `${(layout.rx * 200).toFixed(2)}%`);
    track.style.setProperty("--th", `${(layout.ry * 200).toFixed(2)}%`);
    track.style.setProperty("--ox", `${(layout.cx * 100).toFixed(2)}%`);
    track.style.setProperty("--oy", `${(layout.cy * 100).toFixed(2)}%`);
    track.style.setProperty("--tr", `${layout.tilt.toFixed(2)}deg`);
  };

  const syncRegularTracks = () => profiles.forEach(syncRegularTrack);

  const pointOnEllipse = (profile) => {
    if (state.drag?.active && state.drag.key === profile.key) {
      return { ...state.drag.point, depth: 5, layer: 5 };
    }

    const custom = state.customOrbits.get(profile.key);
    const layout = responsiveLayout(profile);
    const phase = custom ? custom.angle : profile.angle + (layout.angleOffset || 0);
    const angle = custom
      ? solveEccentricAnomaly(phase * Math.PI / 180, custom.eccentricity)
      : phase * Math.PI / 180;
    const tilt = (custom?.tilt ?? layout.tilt) * Math.PI / 180;
    const scale = Math.min(state.width, state.height);
    const majorRadius = custom ? custom.majorRatio * scale : state.width * layout.rx;
    const minorRadius = custom ? custom.minorRatio * scale : state.height * layout.ry;
    const focusX = state.width * .04;
    const focusY = state.height * .02;
    const centerX = custom
      ? focusX + custom.eccentricity * majorRadius * Math.cos(tilt)
      : state.width * layout.cx;
    const centerY = custom
      ? focusY + custom.eccentricity * majorRadius * Math.sin(tilt)
      : state.height * layout.cy;
    const localX = Math.cos(angle) * majorRadius;
    const localY = Math.sin(angle) * minorRadius;
    const depth = ((Math.sin(angle) + 1) / 2) * 5;
    return {
      x: centerX + localX * Math.cos(tilt) - localY * Math.sin(tilt),
      y: centerY + localX * Math.sin(tilt) + localY * Math.cos(tilt),
      depth,
      layer: Math.round(depth),
    };
  };

  const syncTailDirection = (node, point) => {
    const focusX = state.width * .04;
    const focusY = state.height * .02;
    const awayFromFocus = Math.atan2(point.y - focusY, point.x - focusX) * 180 / Math.PI;
    node.style.setProperty("--tail-angle", `${awayFromFocus.toFixed(3)}deg`);
  };

  const syncCometWake = (node, point, previousPoint = null, orbitDirection = 1) => {
    if (cometWake.parentElement !== node) node.append(cometWake);
    const focusX = state.width * .04;
    const focusY = state.height * .02;
    const radialX = point.x - focusX;
    const radialY = point.y - focusY;
    const solarDistance = Math.hypot(radialX, radialY);
    const scale = Math.max(1, Math.min(state.width, state.height));
    const distanceRatio = clamp((solarDistance - scale * .045) / (scale * .73), 0, 1);
    const proximity = 1 - distanceRatio;
    const wakeScale = .64 + proximity * .78;
    let dustSide = -Math.sign(orbitDirection || 1);

    if (previousPoint) {
      const velocityX = point.x - previousPoint.x;
      const velocityY = point.y - previousPoint.y;
      const orbitalCross = radialX * velocityY - radialY * velocityX;
      if (Math.abs(orbitalCross) > .01) dustSide = -Math.sign(orbitalCross);
    }

    syncTailDirection(node, point);
    node.style.setProperty("--wake-scale", wakeScale.toFixed(3));
    node.style.setProperty("--wake-inverse", (1 / wakeScale).toFixed(3));
    node.style.setProperty("--wake-intensity", (.72 + proximity * .28).toFixed(3));
    node.style.setProperty("--solar-proximity", proximity.toFixed(3));
    node.style.setProperty("--dust-angle", `${(dustSide * (2.5 + proximity * 4.5)).toFixed(3)}deg`);
    node.style.setProperty("--dust-bend", `${(dustSide * (5 + proximity * 11)).toFixed(3)}px`);
  };

  const render = () => {
    if (!state.width || !state.height) measure();
    const points = profiles.map(pointOnEllipse);

    profiles.forEach((profile, index) => {
      const node = nodeByKey.get(profile.key);
      const point = points[index];
      const custom = state.customOrbits.get(profile.key);
      node.style.setProperty("--x", `${point.x.toFixed(2)}px`);
      node.style.setProperty("--y", `${point.y.toFixed(2)}px`);
      node.style.setProperty("--depth", point.depth.toFixed(3));
      node.style.setProperty("--layer", String(point.layer));
      if (custom && !(state.drag?.active && state.drag.key === profile.key)) {
        syncCometWake(node, point, custom.previousPoint, custom.direction);
        custom.previousPoint = point;
      }
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

  const easedOrbitRate = (profile, delta) => {
    if (profile.key !== "threads") return 1;
    const visibility = state.nodeVisibility.get(profile.key) ?? 1;
    const clippedAmount = clamp((.68 - visibility) / .68, 0, 1);
    const target = visibility <= .01
      ? 14
      : 1 + .9 * Math.pow(clippedAmount, 1.55);
    const current = state.orbitRates.get(profile.key) ?? 1;
    const timeConstant = target > current ? 180 : 260;
    const eased = current + (target - current) * (1 - Math.exp(-delta / timeConstant));
    state.orbitRates.set(profile.key, eased);
    return eased;
  };

  const frame = (timestamp) => {
    const delta = state.lastFrame ? Math.min(timestamp - state.lastFrame, 48) : 16;
    state.lastFrame = timestamp;
    profiles.forEach((profile) => {
      const custom = state.customOrbits.get(profile.key);
      if (state.held.has(profile.key)) return;
      const period = state.phone ? 360 : (state.compact ? 330 : profile.period);
      const orbitRate = custom ? 1 : easedOrbitRate(profile, delta);
      profile.angle += (profile.direction || 1) * (360 / period) * orbitRate * (delta / 1000);
      if (custom) custom.angle += custom.direction * (360 / custom.period) * (delta / 1000);
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

  const syncResetControl = () => {
    const altered = Boolean(state.cometKey);
    resetToggle.disabled = !altered;
    resetToggle.setAttribute("aria-disabled", String(!altered));
    if (altered) root.dataset.comet = state.cometKey;
    else delete root.dataset.comet;
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
      syncRegularTracks();
      if (state.cometKey) syncCustomTrack(state.cometKey);
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
    if (state.selected) {
      const selectedIndex = keys.indexOf(state.selected);
      const previousKey = keys[(selectedIndex - 1 + keys.length) % keys.length];
      const nextKey = keys[(selectedIndex + 1) % keys.length];
      facetPosition.textContent = `${String(selectedIndex + 1).padStart(2, "0")} / ${String(keys.length).padStart(2, "0")} · ${labels.get(state.selected).toUpperCase()}`;
      const summaries = {
        about: "Professional and personal.",
        profile: "Platforms, craft, and interests.",
        work: "Production record, leadership, and delivery.",
        projects: "Bitcoin.com Wallet and selected shipped systems.",
        threads: "Agents, privacy, and observation.",
        contact: "Complex systems and thoughtful collaboration."
      };
      facetStatus.textContent = `${labels.get(state.selected)} · ${summaries[state.selected]}`;
      previousFacet.setAttribute("aria-label", `Focus previous destination, ${labels.get(previousKey)}`);
      nextFacet.setAttribute("aria-label", `Focus next destination, ${labels.get(nextKey)}`);
      previousFacet.querySelector("small").textContent = labels.get(previousKey);
      nextFacet.querySelector("small").textContent = labels.get(nextKey);
    }
  };

  const setFocusShift = (key) => {
    const node = nodeByKey.get(key);
    const sculpture = node?.querySelector(".sculpture");
    if (!sculpture) return;

    // A destination can be selected at any point in its orbit. Measure the
    // unzoomed field synchronously, then make that live point the camera's
    // transform origin so the focus transition grows out of the object itself.
    cameraWindow.style.setProperty("transition", "none");
    cameraWindow.style.setProperty("transform", "none");
    const nodeRect = sculpture.getBoundingClientRect();
    const cameraRect = cameraWindow.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const nodeX = nodeRect.left + nodeRect.width / 2;
    const nodeY = nodeRect.top + nodeRect.height / 2;
    const targetX = rootRect.left + rootRect.width * (state.compact ? .5 : .63);
    const targetY = rootRect.top + rootRect.height * (state.compact ? .56 : .52);
    const shiftX = targetX - nodeX;
    const shiftY = targetY - nodeY;
    root.style.setProperty("--focus-origin-x", `${(nodeX - cameraRect.left).toFixed(1)}px`);
    root.style.setProperty("--focus-origin-y", `${(nodeY - cameraRect.top).toFixed(1)}px`);
    root.style.setProperty("--focus-shift-x", `${shiftX.toFixed(1)}px`);
    root.style.setProperty("--focus-shift-y", `${shiftY.toFixed(1)}px`);
    // Force the unzoomed measurement to become the start of the next camera
    // transition without exposing an intermediate painted frame.
    cameraWindow.getBoundingClientRect();
    cameraWindow.style.removeProperty("transition");
    cameraWindow.style.removeProperty("transform");
  };

  const focusDestination = () => {
    setPhase("focused");
    playCue("focus");
    const focusTarget = state.focusAfterTransition;
    state.focusAfterTransition = null;
    (focusTarget || closeButton).focus({ preventScroll: true });
  };

  const selectFacet = (key, options = {}) => {
    if (!validKey(key)) return;
    const { historyMode = "push", sound = true, immediate = false, opener = null, focusAfterTransition = null } = options;
    if (state.selected === key && state.phase === "focused") return;
    clearTransitionTimers();
    clearTransferState();
    const enteringFromOverview = !state.selected;
    const activeFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (state.phone && enteringFromOverview) state.overviewScrollY = window.scrollY;
    if (state.selected) state.held.delete(state.selected);
    state.selected = key;
    state.held.add(key);
    state.opener = opener || nodeByKey.get(key);
    state.focusAfterTransition = focusAfterTransition || (enteringFromOverview ? closeButton : activeFocus || closeButton);
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
      const focusTarget = state.focusAfterTransition || closeButton;
      state.focusAfterTransition = null;
      window.requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
      return;
    }
    later(focusDestination, 760);
  };

  const finishDismiss = (restoreFocus) => {
    detailLayer.hidden = true;
    overview.inert = false;
    const opener = state.opener;
    if (state.selected) state.held.delete(state.selected);
    state.selected = null;
    state.opener = null;
    delete root.dataset.selected;
    clearPreview();
    root.style.removeProperty("--focus-shift-x");
    root.style.removeProperty("--focus-shift-y");
    root.style.removeProperty("--focus-origin-x");
    root.style.removeProperty("--focus-origin-y");
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
    const { historyMode = "push", sound = true, restoreFocus = true, immediate = false, opener = null } = options;
    clearTransitionTimers();
    clearTransferState();
    if (opener?.isConnected) state.opener = opener;
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

  const finishFacetTransfer = () => {
    const transfer = state.pendingFacet;
    if (!transfer || state.phase !== "transferring") return;

    const outgoingKey = state.selected;
    if (outgoingKey) state.held.delete(outgoingKey);
    state.selected = transfer.key;
    state.held.add(transfer.key);
    state.opener = transfer.opener || nodeByKey.get(transfer.key);
    state.focusAfterTransition = transfer.focusTarget || closeButton;
    root.dataset.selected = transfer.key;
    root.dataset.transferStage = "incoming";
    clearPreview();
    syncSelection();
    detailLayer.scrollTop = 0;
    detailByKey.get(transfer.key).scrollTop = 0;
    setFocusShift(transfer.key);
    const heading = detailByKey.get(transfer.key)?.querySelector("h2");
    if (heading?.id) detailLayer.setAttribute("aria-labelledby", heading.id);
    if (transfer.historyMode) writeHistory(transfer.key, transfer.historyMode);
    overview.inert = true;
    startFrame();

    later(() => {
      if (state.pendingFacet !== transfer || state.phase !== "transferring") return;
      clearTransferState();
      setPhase("focusing");
      startFrame();
      later(focusDestination, 760);
    }, transferNeutralDuration);
  };

  const transferFacet = (key, options = {}) => {
    if (!validKey(key) || !state.selected || state.phase !== "focused" || key === state.selected) return;
    const {
      historyMode = "push",
      sound = true,
      opener = nodeByKey.get(key),
      focusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : closeButton,
    } = options;

    if (state.reduced) {
      selectFacet(key, { historyMode, sound, immediate: true, opener, focusAfterTransition: focusTarget });
      return;
    }

    clearTransitionTimers();
    clearTransferState();
    state.pendingFacet = { key, historyMode, opener, focusTarget };
    root.dataset.transferStage = "outgoing";
    root.dataset.transferFrom = state.selected;
    root.dataset.transferTo = key;
    facetStatus.textContent = `Transferring from ${labels.get(state.selected)} to ${labels.get(key)}.`;
    setPhase("transferring");
    if (sound) playCue("select");
    startFrame();
    later(finishFacetTransfer, transferOutDuration);
  };

  const traverseFacet = (step, { absolute = false, focusTarget = null } = {}) => {
    if (!state.selected || state.phase !== "focused") return;
    const currentIndex = keys.indexOf(state.selected);
    const nextIndex = absolute
      ? Math.max(0, Math.min(keys.length - 1, step))
      : (currentIndex + step + keys.length) % keys.length;
    const nextKey = keys[nextIndex];
    if (nextKey === state.selected) return;
    transferFacet(nextKey, {
      opener: nodeByKey.get(nextKey),
      focusTarget: focusTarget || (document.activeElement instanceof HTMLElement ? document.activeElement : closeButton),
    });
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

  const nodePoint = (node) => ({
    x: Number.parseFloat(node.style.getPropertyValue("--x")) || 0,
    y: Number.parseFloat(node.style.getPropertyValue("--y")) || 0,
  });

  // Calibrate the camera at the grabbed node. Two tiny, synchronous probes give
  // a local screen-space basis that already includes tilt, scale and perspective.
  const measureDragBasis = (node, point) => {
    const probe = 28;
    const center = () => {
      const bounds = node.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    };
    const origin = center();
    node.style.setProperty("--x", `${point.x + probe}px`);
    const xProbe = center();
    node.style.setProperty("--x", `${point.x}px`);
    node.style.setProperty("--y", `${point.y + probe}px`);
    const yProbe = center();
    node.style.setProperty("--y", `${point.y}px`);

    const xAxis = { x: (xProbe.x - origin.x) / probe, y: (xProbe.y - origin.y) / probe };
    const yAxis = { x: (yProbe.x - origin.x) / probe, y: (yProbe.y - origin.y) / probe };
    const determinant = xAxis.x * yAxis.y - xAxis.y * yAxis.x;
    if (Math.abs(determinant) > .0001) return { xAxis, yAxis, determinant };

    const bounds = plane.getBoundingClientRect();
    return {
      xAxis: { x: bounds.width / Math.max(state.width, 1), y: 0 },
      yAxis: { x: 0, y: bounds.height / Math.max(state.height, 1) },
      determinant: bounds.width * bounds.height / Math.max(state.width * state.height, 1),
    };
  };

  const pointerDeltaToPlane = (basis, x, y) => ({
    x: (x * basis.yAxis.y - y * basis.yAxis.x) / basis.determinant,
    y: (y * basis.xAxis.x - x * basis.xAxis.y) / basis.determinant,
  });

  const clearCustomTrack = (key) => {
    const track = trackByKey.get(key);
    track.classList.remove("is-comet-track");
    ["--tw", "--th", "--ox", "--oy", "--tr"].forEach((property) => track.style.removeProperty(property));
    const readout = track.querySelector("i");
    readout?.removeAttribute("data-eccentricity");
    readout?.removeAttribute("data-period");
    const profile = profiles.find((candidate) => candidate.key === key);
    if (profile) syncRegularTrack(profile);
  };

  const syncCustomTrack = (key) => {
    const custom = state.customOrbits.get(key);
    const track = trackByKey.get(key);
    if (!custom || !track || !state.width || !state.height) return;
    const scale = Math.min(state.width, state.height);
    const majorRadius = custom.majorRatio * scale;
    const minorRadius = custom.minorRatio * scale;
    const tiltRadians = custom.tilt * Math.PI / 180;
    const centerX = state.width * .04 + custom.eccentricity * majorRadius * Math.cos(tiltRadians);
    const centerY = state.height * .02 + custom.eccentricity * majorRadius * Math.sin(tiltRadians);
    track.style.setProperty("--tw", `${(majorRadius * 200 / state.width).toFixed(2)}%`);
    track.style.setProperty("--th", `${(minorRadius * 200 / state.height).toFixed(2)}%`);
    track.style.setProperty("--ox", `${(centerX * 100 / state.width).toFixed(2)}%`);
    track.style.setProperty("--oy", `${(centerY * 100 / state.height).toFixed(2)}%`);
    track.style.setProperty("--tr", `${custom.tilt.toFixed(2)}deg`);
  };

  const resetCustomOrbit = (key, { sound = true, immediate = state.reduced } = {}) => {
    if (!key || !state.customOrbits.has(key)) return;
    const node = nodeByKey.get(key);
    const previousTimer = state.resetTimers.get(key);
    if (previousTimer) window.clearTimeout(previousTimer);
    state.resetTimers.delete(key);
    state.customOrbits.delete(key);
    state.cometAwaitingPointerExit.delete(key);
    if (state.cometKey === key) state.cometKey = null;
    clearCustomTrack(key);
    node.classList.remove("is-comet", "is-dragging");
    node.classList.toggle("is-resetting", !immediate);
    state.held.add(key);
    render();

    const finish = () => {
      node.classList.remove("is-resetting");
      node.style.removeProperty("--tail-angle");
      node.style.removeProperty("--wake-scale");
      node.style.removeProperty("--wake-inverse");
      node.style.removeProperty("--wake-intensity");
      node.style.removeProperty("--solar-proximity");
      node.style.removeProperty("--dust-angle");
      node.style.removeProperty("--dust-bend");
      if (state.selected !== key && !node.matches(":hover") && document.activeElement !== node) state.held.delete(key);
      state.resetTimers.delete(key);
      startFrame();
    };
    if (immediate) finish();
    else state.resetTimers.set(key, window.setTimeout(finish, 760));
    syncResetControl();
    if (sound) playCue("reset");
  };

  const launchCustomOrbit = (
    key,
    point,
    velocity,
    { sound = true, awaitingPointerExit = true, source = "fling" } = {},
  ) => {
    if (state.reduced) return;
    if (state.cometKey && state.cometKey !== key) {
      resetCustomOrbit(state.cometKey, { sound: false });
    }

    const speed = Math.hypot(velocity.x, velocity.y);
    const focus = { x: state.width * .04, y: state.height * .02 };
    const focusVector = { x: point.x - focus.x, y: point.y - focus.y };
    const radius = Math.max(1, Math.hypot(focusVector.x, focusVector.y));
    const tiltRadians = radius > 8
      ? Math.atan2(focusVector.y, focusVector.x)
      : Math.atan2(velocity.y, velocity.x) - Math.PI / 2;
    const eccentricity = clamp(.9 + Math.min(speed, 1800) / 30000, .9, .96);
    const majorRadius = radius / (1 + eccentricity);
    const minorRadius = majorRadius * Math.sqrt(1 - eccentricity * eccentricity);
    const directionSignal = focusVector.x * velocity.y - focusVector.y * velocity.x;
    const direction = Math.abs(directionSignal) > 8 ? Math.sign(directionSignal) : 1;
    const scale = Math.min(state.width, state.height);
    const custom = {
      angle: 0,
      direction,
      eccentricity,
      majorRatio: majorRadius / Math.max(scale, 1),
      minorRatio: minorRadius / Math.max(scale, 1),
      period: clamp(34 - speed * .009, 18, 34),
      previousPoint: null,
      tilt: tiltRadians * 180 / Math.PI,
    };

    state.customOrbits.set(key, custom);
    if (awaitingPointerExit) state.cometAwaitingPointerExit.add(key);
    else state.cometAwaitingPointerExit.delete(key);
    state.cometKey = key;
    const node = nodeByKey.get(key);
    const track = trackByKey.get(key);
    const readout = track.querySelector("i");
    node.classList.add("is-comet");
    node.classList.remove("is-resetting");
    track.classList.add("is-comet-track");
    syncCustomTrack(key);
    readout?.setAttribute("data-eccentricity", custom.eccentricity.toFixed(2));
    readout?.setAttribute("data-period", String(Math.round(custom.period)));
    syncResetControl();
    render();
    startFrame();
    if (sound) playCue("fling");
    window.dispatchEvent(new CustomEvent("orbital:fling", {
      detail: { key, eccentricity: custom.eccentricity, period: custom.period, source },
    }));
  };

  const seedDefaultComet = () => {
    if (state.reduced || state.cometKey) return;
    const key = "projects";
    const point = {
      x: state.width * -.38,
      y: state.height * -.67,
    };
    const focus = { x: state.width * .04, y: state.height * .02 };
    const radial = { x: point.x - focus.x, y: point.y - focus.y };
    const radialLength = Math.max(1, Math.hypot(radial.x, radial.y));
    const tangentSpeed = 1200;
    const velocity = {
      x: -radial.y * tangentSpeed / radialLength,
      y: radial.x * tangentSpeed / radialLength,
    };
    launchCustomOrbit(key, point, velocity, {
      sound: false,
      awaitingPointerExit: false,
      source: "default",
    });
  };

  const beginNodeDrag = (event, key, node) => {
    if (
      state.drag || state.reduced || state.phase !== "overview" || state.cameraHeld ||
      node.classList.contains("is-resetting") || !event.isPrimary ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) return;
    const point = nodePoint(node);
    state.drag = {
      active: false,
      basis: measureDragBasis(node, point),
      key,
      node,
      point,
      pointerId: event.pointerId,
      samples: [{ ...point, time: performance.now() }],
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPoint: point,
    };
    state.held.add(key);
    node.classList.add("is-grabbed");
    try { node.setPointerCapture(event.pointerId); } catch (_error) { /* Synthetic pointers may not be capturable. */ }
  };

  const moveNodeDrag = (event) => {
    const drag = state.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const clientX = event.clientX - drag.startClientX;
    const clientY = event.clientY - drag.startClientY;
    if (!drag.active && Math.hypot(clientX, clientY) < (event.pointerType === "touch" ? 12 : 8)) return;
    drag.active = true;
    event.preventDefault();
    event.stopPropagation();
    clearPreview();
    drag.node.classList.add("is-dragging");
    drag.node.setAttribute("aria-grabbed", "true");
    root.dataset.dragging = drag.key;
    const delta = pointerDeltaToPlane(drag.basis, clientX, clientY);
    const previousPoint = drag.point;
    drag.point = {
      x: clamp(drag.startPoint.x + delta.x, state.width * -.54, state.width * .54),
      y: clamp(drag.startPoint.y + delta.y, state.height * -.5, state.height * .5),
    };
    syncCometWake(drag.node, drag.point, previousPoint);
    const time = performance.now();
    drag.samples.push({ ...drag.point, time });
    drag.samples = drag.samples.filter((sample) => time - sample.time <= 140);
    render();
  };

  const finishNodeDrag = (event, { cancelled = false } = {}) => {
    const drag = state.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state.drag = null;
    try { drag.node.releasePointerCapture(event.pointerId); } catch (_error) { /* Capture can already be lost. */ }
    drag.node.classList.remove("is-grabbed", "is-dragging");
    drag.node.setAttribute("aria-grabbed", "false");
    delete root.dataset.dragging;

    if (drag.active && !cancelled) {
      if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        const finalDelta = pointerDeltaToPlane(
          drag.basis,
          event.clientX - drag.startClientX,
          event.clientY - drag.startClientY,
        );
        drag.point = {
          x: clamp(drag.startPoint.x + finalDelta.x, state.width * -.54, state.width * .54),
          y: clamp(drag.startPoint.y + finalDelta.y, state.height * -.5, state.height * .5),
        };
      }
      const last = { ...drag.point, time: performance.now() };
      drag.samples.push(last);
      const recentSamples = drag.samples.filter((sample) => last.time - sample.time <= 120);
      const first = recentSamples[0] || last;
      const duration = Math.max((last.time - first.time) / 1000, .016);
      const velocity = { x: (last.x - first.x) / duration, y: (last.y - first.y) / duration };
      state.suppressClick = {
        key: drag.key,
        pointerId: event.pointerId,
        until: performance.now() + 320,
      };
      state.held.delete(drag.key);
      launchCustomOrbit(drag.key, drag.point, velocity);
      if (document.activeElement === drag.node) {
        resetToggle.focus({ preventScroll: true });
      }
    } else {
      if (
        state.selected !== drag.key && !drag.node.matches(":hover") &&
        document.activeElement !== drag.node
      ) state.held.delete(drag.key);
      render();
      startFrame();
    }
  };

  const cancelNodeDrag = () => {
    if (!state.drag) return;
    finishNodeDrag({ pointerId: state.drag.pointerId }, { cancelled: true });
  };

  nodes.forEach((node) => {
    const key = node.dataset.orbitObject;
    node.addEventListener("click", (event) => {
      const suppressed = state.suppressClick;
      if (
        suppressed?.key === key && performance.now() < suppressed.until &&
        (event.pointerId == null || event.pointerId === suppressed.pointerId)
      ) {
        event.preventDefault();
        event.stopPropagation();
        state.suppressClick = null;
        return;
      }
      state.suppressClick = null;
      selectFacet(key, { opener: node });
    });
    node.addEventListener("keydown", (event) => moveNodeFocus(node, event));
    node.addEventListener("pointerdown", (event) => beginNodeDrag(event, key, node));
    node.addEventListener("pointermove", moveNodeDrag);
    node.addEventListener("pointerup", (event) => finishNodeDrag(event));
    node.addEventListener("pointercancel", (event) => finishNodeDrag(event, { cancelled: true }));
    node.addEventListener("lostpointercapture", (event) => finishNodeDrag(event, { cancelled: true }));
    node.addEventListener("pointerenter", () => {
      if (!state.cometAwaitingPointerExit.has(key)) state.held.add(key);
      showPreview(key, node);
    });
    node.addEventListener("pointerleave", () => {
      state.cometAwaitingPointerExit.delete(key);
      if (state.selected !== key && state.drag?.key !== key) state.held.delete(key);
      clearPreview();
    });
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
      else if (state.selected && state.phase === "focused") {
        transferFacet(key, { opener: control, focusTarget: control });
      }
      else selectFacet(key, { opener: control });
    });
    control.addEventListener("pointerenter", () => showPreview(key, nodeByKey.get(key)));
    control.addEventListener("pointerleave", clearPreview);
    control.addEventListener("focus", () => showPreview(key, nodeByKey.get(key)));
    control.addEventListener("blur", clearPreview);
  });

  viewToggle.addEventListener("click", () => {
    cancelNodeDrag();
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

  resetToggle.addEventListener("click", () => {
    cancelNodeDrag();
    const key = state.cometKey;
    if (!key) return;
    resetCustomOrbit(key);
    window.dispatchEvent(new CustomEvent("orbital:reset", { detail: { key } }));
  });

  backdrop.addEventListener("click", () => dismiss({ opener: mapHome }));
  closeButton.addEventListener("click", () => dismiss({ opener: mapHome }));
  previousFacet.addEventListener("click", () => traverseFacet(-1, { focusTarget: previousFacet }));
  nextFacet.addEventListener("click", () => traverseFacet(1, { focusTarget: nextFacet }));
  detailLayer.addEventListener("pointerdown", (event) => {
    if (
      !state.selected || event.isPrimary === false || event.button > 0 ||
      event.target.closest("a, button, input, textarea, select, [contenteditable='true']")
    ) {
      state.facetGesture = null;
      return;
    }
    state.facetGesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
    };
  });
  detailLayer.addEventListener("pointercancel", () => {
    state.facetGesture = null;
  });
  detailLayer.addEventListener("pointerup", (event) => {
    const gesture = state.facetGesture;
    state.facetGesture = null;
    if (!gesture || gesture.id !== event.pointerId || !state.selected) return;
    const deltaX = event.clientX - gesture.x;
    const deltaY = event.clientY - gesture.y;
    if (
      performance.now() - gesture.time > 720 ||
      Math.abs(deltaX) < 56 ||
      Math.abs(deltaX) < Math.abs(deltaY) * 1.25
    ) return;
    event.preventDefault();
    traverseFacet(deltaX < 0 ? 1 : -1, { focusTarget: closeButton });
  });
  detailLayer.querySelectorAll(".focus-satellites a, .landing-copy > a").forEach((link) => {
    link.addEventListener("click", () => playCue("satellite"));
  });

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape" && state.selected) {
      event.preventDefault();
      dismiss({ opener: mapHome });
      return;
    }
    if (!state.selected || event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      traverseFacet(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      traverseFacet(1);
    } else if (event.key === "Home") {
      event.preventDefault();
      traverseFacet(0, { absolute: true });
    } else if (event.key === "End") {
      event.preventDefault();
      traverseFacet(keys.length - 1, { absolute: true });
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
  document.addEventListener("universe-sound:change", (event) => {
    const enabled = Boolean(event.detail?.enabled);
    if (!enabled) {
      root.dataset.audioState = "muted";
      state.audioContext?.suspend().catch(() => {});
      return;
    }
    root.dataset.audioState = state.audioContext?.state || "awaiting-gesture";
  });
  window.addEventListener("resize", () => {
    cancelNodeDrag();
    state.compact = compactQuery.matches;
    state.phone = phoneQuery.matches;
    state.short = shortQuery.matches;
    measure();
    syncRegularTracks();
    if (state.cometKey) syncCustomTrack(state.cometKey);
    if (state.preview) placePreview(state.previewAnchor || nodeByKey.get(state.preview));
    syncMotion();
  }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelNodeDrag();
    startFrame();
  });
  reducedMotionQuery.addEventListener?.("change", (event) => {
    cancelNodeDrag();
    state.reduced = event.matches;
    if (state.reduced && state.cometKey) {
      resetCustomOrbit(state.cometKey, { sound: false, immediate: true });
    }
    syncMotion();
  });
  compactQuery.addEventListener?.("change", (event) => {
    cancelNodeDrag();
    state.compact = event.matches;
    state.phone = phoneQuery.matches;
    state.short = shortQuery.matches;
    measure();
    syncRegularTracks();
    if (state.cometKey) syncCustomTrack(state.cometKey);
    syncMotion();
  });
  phoneQuery.addEventListener?.("change", (event) => {
    cancelNodeDrag();
    state.phone = event.matches;
    state.short = shortQuery.matches;
    measure();
    syncRegularTracks();
    if (state.cometKey) syncCustomTrack(state.cometKey);
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
  syncRegularTracks();
  syncResetControl();
  syncMotion();
  seedDefaultComet();
  restoreFromLocation();
})();
