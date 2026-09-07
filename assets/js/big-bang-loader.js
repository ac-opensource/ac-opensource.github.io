(function () {
  "use strict";

  const root = document.documentElement;
  const FULL_SEQUENCE_MS = 640;
  const MAX_SEQUENCE_MS = 900;
  const SESSION_KEY = "ac.bigBangPortfolioPlayed.v1";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // The bootstrap is the session gate. Bail out before any geometry work on
  // repeat Portfolio visits or on routes that never opted into the loader.
  if (root.dataset.bigBang !== "pending") return;

  const phaseTimers = [];
  const state = {
    active: false,
    landmarkCount: 0,
    landmarks: [],
    markedLandmarks: [],
    matterRenderer: null,
    origin: null,
    overlay: null,
    pageReady: false,
    particleCount: 0,
    phase: "idle",
    profile: null,
    readyAt: 0,
    readyDelayMs: null,
    releaseScheduled: false,
    revealAt: 0,
    revealStarted: false,
    startedAt: 0
  };

  const PROFILES = Object.freeze({
    work: {
      label: "PORTFOLIO SUPERNOVA",
      structure: "SHARED CORE / VERIFIED RELEASE",
      surface: "#faf9f4",
      ink: "#2f342d",
      accents: ["#e98b27", "#df642c", "#2864c7", "#168c86"],
      originSelectors: [".work-hero__art", ".work-pipeline__node--core", "#work-title"],
      fallbackOrigin: [0.72, 0.5],
      landmarkSelectors: [
        "#site-topbar > div > a",
        "#site-nav .site-nav-link",
        ".work-eyebrow",
        "#work-title",
        ".work-hero__intro",
        ".work-hero__actions a",
        ".work-pipeline__node",
        ".work-signals > *"
      ]
    }
  });

  window.clearTimeout(window.__bigBangLoaderGuard);
  delete window.__bigBangLoaderGuard;

  function emit(phase, reason) {
    state.phase = phase;
    document.dispatchEvent(new CustomEvent("bigbang:phase", {
      detail: {
        context: state.profile?.id || "site",
        elapsed: state.startedAt ? Math.round(performance.now() - state.startedAt) : 0,
        landmarkCount: state.landmarkCount,
        phase,
        reason: reason || "sequence"
      }
    }));
  }

  function clearPhaseTimers() {
    while (phaseTimers.length) window.clearTimeout(phaseTimers.pop());
  }

  function rememberSessionPlayback() {
    try {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch (error) {
      // Storage can be unavailable in hardened browsing modes. The animation
      // still completes normally; a later visit may replay it.
    }
  }

  function schedule(callback, delay) {
    phaseTimers.push(window.setTimeout(callback, delay));
  }

  function setTelemetry(time, label, detail) {
    if (!state.overlay) return;
    const timeNode = state.overlay.querySelector("[data-big-bang-time]");
    const labelNode = state.overlay.querySelector("[data-big-bang-label]");
    const detailNode = state.overlay.querySelector("[data-big-bang-detail]");
    if (timeNode) timeNode.textContent = time;
    if (labelNode) labelNode.textContent = label;
    if (detailNode) detailNode.textContent = detail;
  }

  function seededValue(index, salt) {
    const value = Math.sin((index + 1) * (12.9898 + salt * 17.137)) * 43758.5453;
    return value - Math.floor(value);
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function contextName() {
    return "work";
  }

  function pageProfile() {
    const id = contextName();
    const profile = { ...PROFILES[id], id, accents: [...PROFILES[id].accents] };
    return profile;
  }

  function visibleRect(element) {
    if (!(element instanceof Element) || element.closest("[data-big-bang-loader]")) return null;
    if (element.hasAttribute("hidden")) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width < 3 || rect.height < 3) return null;
    if (rect.right < -8 || rect.bottom < -8 || rect.left > window.innerWidth + 8 || rect.top > window.innerHeight + 8) return null;
    return rect;
  }

  function resolveOrigin(profile) {
    for (const selector of profile.originSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        const rect = visibleRect(element);
        if (!rect) continue;
        return {
          selector,
          x: clamp(rect.left + rect.width / 2, 28, window.innerWidth - 28),
          y: clamp(rect.top + rect.height / 2, 28, window.innerHeight - 28)
        };
      }
    }
    return {
      selector: "viewport-fallback",
      x: window.innerWidth * profile.fallbackOrigin[0],
      y: window.innerHeight * profile.fallbackOrigin[1]
    };
  }

  function normalizeLabel(element) {
    const raw = element.getAttribute("aria-label") || element.textContent || "";
    return raw.replace(/\s+/g, " ").trim().replace(/^\[|\]$/g, "").slice(0, 38);
  }

  function landmarkKind(element) {
    const tag = element.tagName.toLowerCase();
    if (/^h[1-3]$/.test(tag)) return "title";
    if (tag === "a" || tag === "button" || tag === "input") return "control";
    if (element.matches(".field-origin, .galaxy-core, .satellite__core, .stellar-tree__root")) return "origin";
    return "node";
  }

  function collectLandmarks(profile, origin) {
    const compact = window.matchMedia("(max-width: 700px)").matches;
    const maximum = compact ? 10 : 18;
    const elements = [];
    const seen = new Set();
    for (const selector of profile.landmarkSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element) || !visibleRect(element)) continue;
        seen.add(element);
        elements.push(element);
        if (elements.length >= maximum) break;
      }
      if (elements.length >= maximum) break;
    }

    return elements.map(function (element, index) {
      const rect = visibleRect(element);
      const x = clamp(rect.left + rect.width / 2, 8, window.innerWidth - 8);
      const y = clamp(rect.top + rect.height / 2, 8, window.innerHeight - 8);
      const kind = landmarkKind(element);
      const label = normalizeLabel(element);
      const color = profile.accents[index % profile.accents.length];
      const distance = Math.hypot(x - origin.x, y - origin.y);
      const delay = Math.round((distance / Math.hypot(window.innerWidth, window.innerHeight)) * 110 + index * 4);
      const showLabel = Boolean(label) && index < (compact ? 9 : 15) && kind !== "node";

      element.setAttribute("data-big-bang-landmark", kind);
      element.setAttribute("data-big-bang-landmark-index", String(index));
      element.style.setProperty("--big-bang-landmark-delay", `${Math.min(delay, 180)}ms`);
      state.markedLandmarks.push(element);

      return {
        color,
        delay,
        element,
        height: rect.height,
        index,
        kind,
        label,
        left: rect.left,
        showLabel,
        top: rect.top,
        width: rect.width,
        x,
        y
      };
    });
  }

  function easeOutQuart(value) {
    return 1 - Math.pow(1 - clamp(value, 0, 1), 4);
  }

  function createParticlePlan(profile, origin, landmarks, count) {
    const viewportRadius = Math.hypot(window.innerWidth, window.innerHeight) * 0.74;
    return Array.from({ length: count }, function (_, index) {
      const target = landmarks[index] || null;
      let deltaX;
      let deltaY;
      let color;
      let delay;
      let length;
      let size;

      if (target) {
        deltaX = target.x - origin.x;
        deltaY = target.y - origin.y;
        color = target.color;
        delay = Math.min(target.delay, 120);
        length = clamp(target.width * (target.kind === "title" ? 0.34 : 0.52), 14, target.kind === "title" ? 150 : 82);
        size = target.kind === "origin" ? 2.6 : 1.2 + seededValue(index, 4) * 1.2;
      } else {
        const debrisIndex = index - landmarks.length;
        const angle = (360 / Math.max(1, count - landmarks.length)) * debrisIndex
          + (seededValue(index, 1) - 0.5) * 17;
        const distance = viewportRadius * (0.76 + seededValue(index, 2) * 0.66);
        deltaX = Math.cos(angle * Math.PI / 180) * distance;
        deltaY = Math.sin(angle * Math.PI / 180) * distance;
        color = profile.accents[index % profile.accents.length];
        delay = Math.round(seededValue(index, 3) * 64);
        length = 14 + Math.round(seededValue(index, 4) * 44);
        size = 0.8 + seededValue(index, 5) * 1.8;
      }

      return {
        angle: Math.atan2(deltaY, deltaX),
        color,
        delay,
        deltaX,
        deltaY,
        length,
        matter: Boolean(target),
        opacity: 0.58 + seededValue(index, 6) * 0.34,
        overshoot: target ? 1.06 + seededValue(index, 7) * 0.06 : 1,
        size
      };
    });
  }

  function createMatterRenderer(canvas, profile, origin, landmarks) {
    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    const compact = window.matchMedia("(max-width: 700px)").matches;
    const particleCount = compact ? 24 : 48;
    const flightDuration = compact ? 320 : 400;
    let animationFrame = 0;
    let currentOrigin = origin;
    let currentLandmarks = landmarks;
    let currentProfile = profile;
    let expansionStarted = 0;
    let formationStarted = 0;
    let particles = [];
    let phase = "singularity";
    let stopped = false;

    function resize() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const pixelBudget = compact ? 900_000 : 2_000_000;
      const budgetRatio = Math.sqrt(pixelBudget / Math.max(1, width * height));
      const ratio = Math.max(0.75, Math.min(window.devicePixelRatio || 1, compact ? 1 : 1.25, budgetRatio));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      particles = createParticlePlan(currentProfile, currentOrigin, currentLandmarks, particleCount);
    }

    function drawTopology(now) {
      if (!formationStarted) return;
      context.save();
      context.globalCompositeOperation = "source-over";
      context.lineWidth = 0.7;
      for (const landmark of currentLandmarks) {
        const progress = easeOutQuart((now - formationStarted - Math.min(landmark.delay, 90)) / 180);
        if (progress <= 0) continue;
        context.globalAlpha = 0.16 * progress;
        context.strokeStyle = landmark.color;
        context.beginPath();
        context.moveTo(currentOrigin.x, currentOrigin.y);
        context.lineTo(
          currentOrigin.x + (landmark.x - currentOrigin.x) * progress,
          currentOrigin.y + (landmark.y - currentOrigin.y) * progress
        );
        context.stroke();
      }
      context.restore();
    }

    function particleProgress(particle, now) {
      if (!expansionStarted) return null;
      const progress = (now - expansionStarted - particle.delay) / flightDuration;
      if (progress < 0) return null;
      if (!particle.matter) return clamp(progress, 0, 1);
      if (progress < 0.7) return easeOutQuart(progress / 0.7) * particle.overshoot;
      return particle.overshoot + (1 - particle.overshoot) * easeOutQuart((progress - 0.7) / 0.3);
    }

    function drawParticles(now) {
      if (!expansionStarted) return;
      context.save();
      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";
      for (const particle of particles) {
        const raw = (now - expansionStarted - particle.delay) / flightDuration;
        const progress = particleProgress(particle, now);
        if (progress === null || (!particle.matter && raw >= 1)) continue;

        const x = currentOrigin.x + particle.deltaX * progress;
        const y = currentOrigin.y + particle.deltaY * progress;
        const fade = particle.matter ? Math.min(1, Math.max(0.18, raw * 3.2)) : Math.sin(Math.PI * clamp(raw, 0, 1));
        const trail = particle.length * (0.42 + Math.min(1, Math.max(0, raw)) * 0.58);
        const tailX = x - Math.cos(particle.angle) * trail;
        const tailY = y - Math.sin(particle.angle) * trail;

        context.globalAlpha = particle.opacity * fade * 0.28;
        context.strokeStyle = particle.color;
        context.lineWidth = particle.size * 3;
        context.beginPath();
        context.moveTo(tailX, tailY);
        context.lineTo(x, y);
        context.stroke();

        context.globalAlpha = particle.opacity * fade;
        context.lineWidth = particle.size;
        context.beginPath();
        context.moveTo(tailX, tailY);
        context.lineTo(x, y);
        context.stroke();
      }
      context.restore();
    }

    function shouldContinue(now) {
      if (phase === "expansion") return now - expansionStarted < flightDuration + 180;
      if (phase === "structure") return now - formationStarted < 420;
      return false;
    }

    function draw(now) {
      animationFrame = 0;
      if (stopped) return;
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      drawTopology(now);
      drawParticles(now);
      if (shouldContinue(now)) animationFrame = window.requestAnimationFrame(draw);
    }

    function requestDraw() {
      if (!animationFrame && !stopped) animationFrame = window.requestAnimationFrame(draw);
    }

    function setPhase(nextPhase, options) {
      const now = performance.now();
      const settings = options || {};
      phase = nextPhase;
      if (nextPhase === "expansion" && !expansionStarted) expansionStarted = now;
      if (nextPhase === "structure") {
        if (!expansionStarted || settings.settle) expansionStarted = now - flightDuration - 140;
        formationStarted = settings.settle ? now - 220 : now;
        draw(now);
      } else if (nextPhase === "reveal") {
        if (animationFrame) window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      } else {
        requestDraw();
      }
    }

    function updateGeometry(nextProfile, nextOrigin, nextLandmarks) {
      currentProfile = nextProfile;
      currentOrigin = nextOrigin;
      currentLandmarks = nextLandmarks;
      particles = createParticlePlan(currentProfile, currentOrigin, currentLandmarks, particleCount);
      canvas.dataset.linkCount = String(nextLandmarks.length);
      canvas.dataset.matterCount = String(nextLandmarks.length);
      canvas.dataset.particleCount = String(particleCount);
      if (phase === "expansion" || phase === "structure") draw(performance.now());
    }

    function destroy() {
      stopped = true;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }

    resize();
    updateGeometry(profile, origin, landmarks);
    return { destroy, particleCount, setPhase, updateGeometry };
  }

  function populateLocks(container, landmarks) {
    const fragment = document.createDocumentFragment();
    container.replaceChildren();
    for (const landmark of landmarks) {
      const lock = document.createElement("span");
      lock.className = "big-bang-loader__lock";
      lock.dataset.kind = landmark.kind;
      lock.dataset.landmarkIndex = String(landmark.index);
      if (landmark.showLabel) lock.dataset.label = landmark.label;
      lock.style.setProperty("--lock-color", landmark.color);
      lock.style.setProperty("--lock-delay", `${Math.min(landmark.delay, 110)}ms`);
      lock.style.setProperty("--lock-height", `${landmark.height.toFixed(2)}px`);
      lock.style.setProperty("--lock-left", `${landmark.left.toFixed(2)}px`);
      lock.style.setProperty("--lock-top", `${landmark.top.toFixed(2)}px`);
      lock.style.setProperty("--lock-width", `${landmark.width.toFixed(2)}px`);
      fragment.append(lock);
    }
    container.append(fragment);
  }

  function createOverlay() {
    const profile = pageProfile();
    const origin = resolveOrigin(profile);
    const landmarks = collectLandmarks(profile, origin);
    const overlay = document.createElement("div");

    state.profile = profile;
    state.origin = origin;
    state.landmarkCount = landmarks.length;
    state.landmarks = landmarks;
    root.style.setProperty("--big-bang-origin-x", `${origin.x.toFixed(1)}px`);
    root.style.setProperty("--big-bang-origin-y", `${origin.y.toFixed(1)}px`);

    overlay.className = "big-bang-loader";
    overlay.dataset.bigBangLoader = "";
    overlay.dataset.context = profile.id;
    overlay.style.setProperty("--big-bang-accent-a", profile.accents[0]);
    overlay.style.setProperty("--big-bang-accent-b", profile.accents[1]);
    overlay.style.setProperty("--big-bang-accent-c", profile.accents[2]);
    overlay.style.setProperty("--big-bang-ink", profile.ink);
    overlay.style.setProperty("--big-bang-surface", profile.surface);
    overlay.innerHTML = `
      <div class="big-bang-loader__visual" aria-hidden="true">
        <div class="big-bang-loader__void"></div>
        <div class="big-bang-loader__surface"></div>
        <div class="big-bang-loader__frame">
          <span>AC / ${profile.label}</span>
          <span data-big-bang-lock-count>DOM MATTER MAP / ${String(landmarks.length).padStart(2, "0")} LOCKS</span>
        </div>
        <canvas class="big-bang-loader__matter" data-big-bang-matter></canvas>
        <div class="big-bang-loader__locks" data-big-bang-locks></div>
        <div class="big-bang-loader__origin">
          <i class="big-bang-loader__horizon big-bang-loader__horizon--outer"></i>
          <i class="big-bang-loader__horizon big-bang-loader__horizon--middle"></i>
          <i class="big-bang-loader__horizon big-bang-loader__horizon--inner"></i>
          <i class="big-bang-loader__flash"></i>
          <i class="big-bang-loader__core"></i>
          <span>AC</span>
        </div>
        <div class="big-bang-loader__telemetry">
          <span data-big-bang-time>T − 00:00:01</span>
          <span class="big-bang-loader__telemetry-line"></span>
          <strong data-big-bang-label>${profile.label}</strong>
          <small data-big-bang-detail>live document compressed to origin</small>
        </div>
      </div>
      <button class="big-bang-loader__skip" type="button" data-big-bang-skip>
        <span>ESC</span> skip origin
      </button>`;

    populateLocks(overlay.querySelector("[data-big-bang-locks]"), landmarks);
    state.matterRenderer = createMatterRenderer(
      overlay.querySelector("[data-big-bang-matter]"),
      profile,
      origin,
      landmarks
    );
    state.particleCount = state.matterRenderer.particleCount;
    overlay.querySelector("[data-big-bang-skip]").addEventListener("click", function () {
      reveal("skipped", { immediate: true, moveFocus: true });
    });
    return overlay;
  }

  function moveFocusToContent() {
    const main = document.querySelector("main");
    if (!main) return;
    const hadTabindex = main.hasAttribute("tabindex");
    if (!hadTabindex) main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: true });
    if (!hadTabindex) {
      main.addEventListener("blur", function () { main.removeAttribute("tabindex"); }, { once: true });
    }
  }

  function clearLandmarkState() {
    for (const element of state.markedLandmarks) {
      element.removeAttribute("data-big-bang-landmark");
      element.removeAttribute("data-big-bang-landmark-index");
      element.style.removeProperty("--big-bang-landmark-delay");
    }
    state.markedLandmarks = [];
  }

  function routeIsReady() {
    return document.readyState !== "loading";
  }

  function finish(reason, moveFocus) {
    clearPhaseTimers();
    state.matterRenderer?.destroy();
    state.matterRenderer = null;
    state.overlay?.remove();
    state.overlay = null;
    state.active = false;
    state.landmarks = [];
    state.particleCount = 0;
    state.releaseScheduled = false;
    state.revealStarted = false;
    clearLandmarkState();
    root.dataset.bigBang = "complete";
    delete root.dataset.bigBangSkip;
    root.style.removeProperty("--big-bang-origin-x");
    root.style.removeProperty("--big-bang-origin-y");
    rememberSessionPlayback();
    emit("complete", reason);
    if (moveFocus) moveFocusToContent();
  }

  function primeForReveal() {
    if (!state.overlay) return;
    state.overlay.classList.add("is-igniting", "is-expanding", "is-forming");
    state.matterRenderer?.setPhase("structure", { settle: true });
  }

  function reveal(reason, options) {
    if (!state.active || state.revealStarted || !state.overlay) return;
    const settings = options || {};
    state.revealStarted = true;
    clearPhaseTimers();
    root.dataset.bigBang = "revealing";
    if (settings.immediate) root.dataset.bigBangSkip = "true";
    state.revealAt = performance.now();
    state.readyDelayMs = state.readyAt ? Math.max(0, Math.round(state.revealAt - state.readyAt)) : null;
    state.matterRenderer?.setPhase("reveal");
    state.overlay.classList.add("is-revealing");
    setTelemetry("DOM / LIVE", state.profile.label, "generated matter → live interface");
    emit("reveal", reason);
    schedule(function () {
      finish(reason, Boolean(settings.moveFocus));
    }, settings.immediate ? 80 : 220);
  }

  function advancePhase(className, phase, time, label, detail) {
    if (!state.active || !state.overlay || state.revealStarted) return;
    state.overlay.classList.add(className);
    state.matterRenderer?.setPhase(phase);
    setTelemetry(time, label, detail);
    emit(phase);
  }

  function releaseLoadedPage(reason) {
    if (!state.active || state.revealStarted || !state.overlay) return;
    state.pageReady = true;
    if (!state.readyAt) state.readyAt = performance.now();
    const remainingSequenceMs = Math.max(0, FULL_SEQUENCE_MS - (performance.now() - state.startedAt));
    if (remainingSequenceMs > 0) {
      if (state.releaseScheduled) return;
      state.releaseScheduled = true;
      schedule(function () {
        state.releaseScheduled = false;
        if (!state.active || !state.pageReady || state.revealStarted) return;
        primeForReveal();
        reveal(reason);
      }, remainingSequenceMs);
      return;
    }
    primeForReveal();
    reveal(reason);
  }

  function begin(reason) {
    if (state.active) return false;
    if (reducedMotion.matches || window.matchMedia("(forced-colors: active)").matches) {
      root.dataset.bigBang = "complete";
      emit("complete", "motion-preference");
      return false;
    }

    state.landmarkCount = 0;
    state.landmarks = [];
    state.markedLandmarks = [];
    state.active = true;
    state.pageReady = routeIsReady();
    state.particleCount = 0;
    state.readyAt = state.pageReady ? performance.now() : 0;
    state.readyDelayMs = null;
    state.releaseScheduled = false;
    state.revealAt = 0;
    state.revealStarted = false;
    state.startedAt = performance.now();
    state.overlay = createOverlay();
    root.dataset.bigBang = "running";
    root.append(state.overlay);
    emit("singularity", reason);

    window.requestAnimationFrame(function () {
      state.overlay?.classList.add("is-visible");
      if (state.pageReady) releaseLoadedPage("already-loaded");
    });

    schedule(function () {
      advancePhase("is-igniting", "ignition", "T + 10⁻⁴³ S", "CONTAINMENT LOST", "live page geometry released");
    }, 48);
    schedule(function () {
      advancePhase(
        "is-expanding",
        "expansion",
        "T + 10⁻³² S",
        "DOM TRAJECTORY SOLVER",
        `${state.landmarkCount} live coordinates acquired`
      );
    }, 88);
    schedule(function () {
      advancePhase("is-forming", "structure", "DOM / LOCK", state.profile.structure, "matter docking to interface");
    }, 250);
    schedule(function () {
      if (!state.revealStarted) {
        primeForReveal();
        reveal("load-cap");
      }
    }, MAX_SEQUENCE_MS);
    return true;
  }

  function onPageReady() {
    if (!routeIsReady()) return false;
    state.pageReady = true;
    if (!state.readyAt) state.readyAt = performance.now();
    if (state.active) releaseLoadedPage("loaded");
    return true;
  }

  document.addEventListener("DOMContentLoaded", onPageReady, { once: true });
  window.addEventListener("pageshow", function (event) {
    if (event.persisted && state.active) finish("bfcache", false);
  });
  reducedMotion.addEventListener?.("change", function (event) {
    if (state.active && event.matches) finish("motion-preference", false);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && state.active) {
      event.preventDefault();
      reveal("skipped", { immediate: true, moveFocus: true });
    }
  });

  window.BigBangLoader = Object.freeze({
    skip: function () { reveal("api-skip", { immediate: true, moveFocus: false }); },
    snapshot: function () {
      return {
        active: state.active,
        context: state.profile?.id || contextName(),
        activation: "portfolio-session",
        fullSequenceMs: FULL_SEQUENCE_MS,
        maxSequenceMs: MAX_SEQUENCE_MS,
        landmarkCount: state.landmarkCount,
        origin: state.origin ? {
          selector: state.origin.selector,
          x: Math.round(state.origin.x),
          y: Math.round(state.origin.y)
        } : null,
        particleCount: state.particleCount,
        phase: state.phase,
        readyDelayMs: state.readyDelayMs,
        revealElapsedMs: state.revealAt ? Math.round(state.revealAt - state.startedAt) : null,
        rootState: root.dataset.bigBang || "inactive"
      };
    }
  });

  if (root.dataset.bigBang === "pending") begin("page-load");
  if (document.readyState !== "loading") onPageReady();
})();
