(() => {
  "use strict";

  const BOOKMARKS_KEY = "ac.blog.bookmarks.v1";

  const elements = {
    canvas: document.getElementById("galaxy-sky"),
    categories: document.getElementById("galaxy-categories"),
    core: document.querySelector(".galaxy-core__horizon"),
    count: document.getElementById("galaxy-count"),
    empty: document.getElementById("galaxy-empty"),
    field: document.getElementById("galaxy-field"),
    focus: document.getElementById("galaxy-focus"),
    focusLink: document.getElementById("galaxy-focus-link"),
    focusMeta: document.getElementById("galaxy-focus-meta"),
    focusSummary: document.getElementById("galaxy-focus-summary"),
    focusTitle: document.getElementById("galaxy-focus-title"),
    focusTopics: document.getElementById("galaxy-focus-topics"),
    hero: document.querySelector(".galaxy-hero"),
    list: document.getElementById("galaxy-list"),
    nodes: document.getElementById("galaxy-nodes"),
    range: document.getElementById("galaxy-range"),
    release: document.getElementById("galaxy-release"),
    search: document.getElementById("galaxy-search"),
    status: document.getElementById("infinite-status"),
    total: document.getElementById("galaxy-total"),
    tuner: document.getElementById("galaxy-tuner")
  };

  if (Object.values(elements).some((element) => !element)) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobileLayout = window.matchMedia("(max-width: 760px)");
  const categoryColors = Object.freeze({
    hobby: "#5887c9",
    reflection: "#7187b2",
    technical: "#2864c7",
    work: "#385f92"
  });
  const geometry = Object.freeze({
    arms: 4,
    centerX: 0.5,
    centerY: 0.52,
    phase: -0.78,
    radiusX: 0.49,
    radiusY: 0.43,
    twist: 5.65
  });
  const state = { category: "all", query: "", selected: "" };
  const nodeElements = new Map();
  const entryElements = new Map();
  let bookmarks = new Set();
  let posts = [];
  let lastSelectedNode = null;
  let choreographyTimer = 0;
  let focusTimer = 0;
  let hasRendered = false;
  let layoutTimer = 0;
  let searchTimer = 0;

  const canvasState = {
    animationFrame: 0,
    context: elements.canvas.getContext("2d", { alpha: true }),
    companionParticles: [],
    dpr: 1,
    field: { centerX: 0, centerY: 0, radiusX: 0, radiusY: 0 },
    height: 0,
    impactParticles: [],
    lastFrame: 0,
    merger: {
      duration: 0,
      from: 0,
      progress: 0,
      soundCue: "",
      soundThreshold: 0,
      startedAt: 0,
      target: 0
    },
    mergerOffset: { x: 0, y: 0 },
    parallax: { x: 0, y: 0, targetX: 0, targetY: 0 },
    particles: [],
    remnantParticles: [],
    startedAt: 0,
    stars: [],
    width: 0
  };

  const normalize = (value) => String(value || "").trim().toLocaleLowerCase("en-US");
  const articleUrl = (post) => `/blog/${encodeURIComponent(post.slug)}.html`;
  const displayCategory = (category) => category === "work" ? "portfolio" : String(category || "writing");
  const timestamp = (value) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

  function loadBookmarks() {
    try {
      const value = JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]");
      return new Set(Array.isArray(value) ? value.map(String) : []);
    } catch (_error) {
      return new Set();
    }
  }

  function saveBookmarks() {
    try {
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...bookmarks]));
    } catch (_error) {
      // Bookmark state remains available for this tab when storage is unavailable.
    }
  }

  function text(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
  }

  function minutesFor(post) {
    const minutes = Number.parseInt(String(post.readingTime || "").match(/\d+/)?.[0] || "1", 10);
    return Math.min(12, Math.max(1, minutes));
  }

  function nodeLabel(post) {
    const authoredLabels = {
      "2026-08-06-how-i-rebuilt-my-homepage-as-an-interactive-orbital-system": "Interactive orbital homepage",
      "2026-07-21-what-building-persons-finder-taught-me": "Small backend · AI-ready engineering",
      "2026-04-09-how-i-use-mempalace-with-local-agents": "MemPalace for local agents",
      "2026-04-07-one-rust-core-across-android-and-ios": "One Rust core · Android + iOS",
      "2026-03-26-career-trajectory-platform-ownership": "Career growth as ownership",
      "2026-03-26-cognitive-profile-deep-dive": "Assessments as calibration",
      "2026-03-26-e2e-and-visual-qa-for-personal-websites": "End-to-end + visual QA",
      "2026-03-26-editable-blog-system-on-github-pages": "Editable blog · GitHub Pages",
      "2026-03-26-from-mobile-developer-to-ai-accelerated-engineer": "AI-accelerated engineer",
      "2026-03-26-prompt-patterns-for-production-ready-code": "Production-ready prompt patterns",
      "2024-10-08-running-ai-fleet-learnings": "Running an agent fleet",
      "2024-11-02-sunrise-trail-runs": "A month in New Zealand",
      "2024-09-14-film-photography-gallery": "Photography experiments",
      "2024-05-22-building-with-kotlin-and-swift": "Kotlin + Swift boundaries"
    };
    if (authoredLabels[post.slug]) return authoredLabels[post.slug];
    const value = String(post.title || "Untitled").replace(/^Deep Dive:\s*/i, "").trim();
    const colon = value.indexOf(":");
    if (colon >= 3 && colon <= 28) return value.slice(0, colon);
    if (value.length <= 32) return value;
    const shortened = value.slice(0, 32).replace(/\s+\S*$/, "").trim();
    return `${shortened || value.slice(0, 29)}…`;
  }

  function heroSource(post) {
    const source = String(post.heroImage || "").trim();
    if (!source || source.startsWith("data:") || source.startsWith("javascript:")) return "";
    try {
      const url = new URL(source, window.location.origin);
      return url.origin === window.location.origin ? `${url.pathname}${url.search}` : url.href;
    } catch (_error) {
      return source;
    }
  }

  function matches(post) {
    if (state.category !== "all" && post.category !== state.category) return false;
    const needle = normalize(state.query);
    if (!needle) return true;
    return normalize([post.title, post.summary, post.category, ...(post.topics || [])].join(" ")).includes(needle);
  }

  function readUrlState() {
    const parameters = new URLSearchParams(window.location.search);
    const availableCategories = new Set(["all", ...posts.map((post) => post.category)]);
    const category = normalize(parameters.get("category") || "all");
    const selected = String(parameters.get("target") || "").trim();
    return {
      category: availableCategories.has(category) ? category : "all",
      query: String(parameters.get("q") || "").slice(0, 160),
      selected: posts.some((post) => post.slug === selected) ? selected : ""
    };
  }

  function writeUrl(mode = "replaceState") {
    const url = new URL(window.location.href);
    const query = state.query.trim();
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    if (state.category !== "all") url.searchParams.set("category", state.category);
    else url.searchParams.delete("category");
    if (state.selected) url.searchParams.set("target", state.selected);
    else url.searchParams.delete("target");
    window.history[mode]({ galaxy: { ...state } }, "", url);
  }

  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function spiralPoint(progress, arm, centerX, centerY, radiusX, radiusY, angleJitter = 0, radialJitter = 0) {
    const angle = arm * Math.PI * 2 / geometry.arms + progress * geometry.twist + geometry.phase + angleJitter;
    const radius = Math.max(0, progress + radialJitter);
    return {
      angle,
      x: centerX + Math.cos(angle) * radius * radiusX,
      y: centerY + Math.sin(angle) * radius * radiusY
    };
  }

  function remnantPoint(progress, arm, centerX, centerY, radiusX, radiusY, angleJitter = 0, radialJitter = 0) {
    const angle = arm * Math.PI + progress * 7.3 - 1.08 + angleJitter;
    const radius = Math.max(0, progress + radialJitter);
    return {
      angle,
      x: centerX + Math.cos(angle) * radius * radiusX,
      y: centerY + Math.sin(angle) * radius * radiusY
    };
  }

  function createParticle(random, index, arms, { compact = false, remnant = false } = {}) {
    const radius = Math.pow(random(), remnant ? 0.74 : 0.68);
    return {
      alpha: 0.08 + (1 - radius) * 0.24 + random() * 0.3,
      angleJitter: (random() - 0.5) * (remnant ? 0.2 + radius * 0.34 : 0.26 + radius * 0.42),
      arm: index % arms,
      phase: random() * Math.PI * 2,
      radialJitter: (random() - 0.5) * (0.02 + radius * (remnant ? 0.025 : 0.035)),
      radius,
      size: 0.35 + random() * (radius < 0.25 ? (compact ? 1.65 : 2.1) : 1.25),
      tone: random()
    };
  }

  function buildCanvasScene() {
    const random = seededRandom(0xAC202608);
    const compact = canvasState.width < 760;
    const starCount = compact ? 230 : 430;
    const particleCount = compact ? 620 : 1180;
    canvasState.stars = Array.from({ length: starCount }, () => ({
      alpha: 0.16 + random() * 0.7,
      phase: random() * Math.PI * 2,
      radius: 0.25 + random() * 1.25,
      x: random(),
      y: random()
    }));
    canvasState.particles = Array.from({ length: particleCount }, (_, index) => createParticle(random, index, geometry.arms, { compact }));
    canvasState.companionParticles = Array.from({ length: compact ? 250 : 430 }, (_, index) => createParticle(random, index, 2, { compact, remnant: true }));
    canvasState.remnantParticles = Array.from({ length: compact ? 470 : 840 }, (_, index) => createParticle(random, index, 2, { compact, remnant: true }));
    canvasState.impactParticles = Array.from({ length: compact ? 72 : 128 }, () => ({
      angle: random() * Math.PI * 2,
      drift: (random() - 0.5) * 0.46,
      length: 0.012 + random() * 0.034,
      radius: 0.08 + random() * 0.9,
      size: 0.35 + random() * 1.2,
      speed: 0.68 + random() * 0.72,
      tone: random()
    }));
  }

  function resizeCanvas() {
    const heroRect = elements.hero.getBoundingClientRect();
    const fieldRect = elements.field.getBoundingClientRect();
    const coreRect = elements.core.getBoundingClientRect();
    canvasState.width = Math.max(1, Math.round(heroRect.width));
    canvasState.height = Math.max(1, Math.round(heroRect.height));
    canvasState.dpr = Math.min(window.devicePixelRatio || 1, 2);
    elements.canvas.width = Math.round(canvasState.width * canvasState.dpr);
    elements.canvas.height = Math.round(canvasState.height * canvasState.dpr);
    elements.canvas.style.width = `${canvasState.width}px`;
    elements.canvas.style.height = `${canvasState.height}px`;
    canvasState.field = {
      centerX: coreRect.left - heroRect.left + coreRect.width / 2 - canvasState.parallax.x - canvasState.mergerOffset.x,
      centerY: coreRect.top - heroRect.top + coreRect.height / 2 - canvasState.parallax.y - canvasState.mergerOffset.y,
      radiusX: fieldRect.width * geometry.radiusX,
      radiusY: fieldRect.height * geometry.radiusY
    };
    buildCanvasScene();
    drawGalaxy(performance.now());
    resolveLabelCollisions();
    positionFocus();
  }

  function particleColor(particle, alpha) {
    if (particle.tone < 0.18) return `rgba(41, 47, 41, ${alpha * 0.62})`;
    if (particle.tone < 0.46) return `rgba(40, 100, 199, ${alpha})`;
    if (particle.tone < 0.78) return `rgba(102, 139, 191, ${alpha * 0.9})`;
    return `rgba(174, 193, 215, ${alpha * 0.92})`;
  }

  function drawGeometricField(context, time, centerX, centerY, radiusX, radiusY, mergerProgress) {
    const selectedNode = state.selected ? nodeElements.get(state.selected) : null;
    const selectedArm = Number.parseInt(selectedNode?.dataset.arm || "-1", 10);
    context.save();
    context.lineWidth = 0.75;

    [0.24, 0.48, 0.72, 0.96].forEach((scale, index) => {
      context.beginPath();
      context.setLineDash(index % 2 ? [2, 8] : []);
      context.lineDashOffset = reducedMotion.matches ? 0 : -time * (index % 2 ? 0.002 : 0);
      context.strokeStyle = index === 2 ? "rgba(40, 100, 199, 0.19)" : "rgba(78, 101, 94, 0.13)";
      context.ellipse(centerX, centerY, radiusX * scale, radiusY * scale, (index - 1.5) * 0.035, 0, Math.PI * 2);
      context.stroke();
    });

    for (let arm = 0; arm < geometry.arms; arm += 1) {
      context.beginPath();
      for (let step = 0; step <= 84; step += 1) {
        const progress = 0.04 + step / 84 * 0.94;
        const point = spiralPoint(progress, arm, centerX, centerY, radiusX, radiusY);
        if (step === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.setLineDash(arm % 2 ? [3, 8] : []);
      context.lineDashOffset = reducedMotion.matches ? 0 : -time * 0.003;
      const baseAlpha = 1 - mergerProgress * 0.74;
      context.strokeStyle = arm === selectedArm
        ? `rgba(40, 100, 199, ${0.46 * baseAlpha})`
        : `rgba(40, 100, 199, ${0.14 * baseAlpha})`;
      context.lineWidth = arm === selectedArm ? 1.35 : 0.8;
      context.stroke();

      if (!reducedMotion.matches) {
        const progress = 0.14 + ((time * 0.000018 + arm * 0.217) % 0.78);
        const tracer = spiralPoint(progress, arm, centerX, centerY, radiusX, radiusY);
        context.beginPath();
        context.fillStyle = arm === selectedArm ? "rgba(40, 100, 199, 0.9)" : "rgba(40, 100, 199, 0.54)";
        context.arc(tracer.x, tracer.y, arm === selectedArm ? 2.4 : 1.55, 0, Math.PI * 2);
        context.fill();
      }
    }

    if (mergerProgress > 0.015) {
      for (let arm = 0; arm < 2; arm += 1) {
        context.beginPath();
        for (let step = 0; step <= 92; step += 1) {
          const progress = 0.04 + step / 92 * 0.92;
          const point = remnantPoint(progress, arm, centerX, centerY, radiusX * 0.92, radiusY * 0.78);
          if (step === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }
        context.setLineDash(arm ? [3, 7] : []);
        context.lineDashOffset = reducedMotion.matches ? 0 : -time * 0.004;
        context.strokeStyle = `rgba(40, 100, 199, ${0.32 * mergerProgress})`;
        context.lineWidth = 0.9 + mergerProgress * 0.45;
        context.stroke();

        if (!reducedMotion.matches) {
          const progress = 0.12 + ((time * 0.000024 + arm * 0.39) % 0.8);
          const tracer = remnantPoint(progress, arm, centerX, centerY, radiusX * 0.92, radiusY * 0.78);
          context.beginPath();
          context.fillStyle = `rgba(40, 100, 199, ${0.76 * mergerProgress})`;
          context.arc(tracer.x, tracer.y, 1.7 + mergerProgress * 0.5, 0, Math.PI * 2);
          context.fill();
        }
      }
    }

    context.setLineDash([]);
    context.strokeStyle = "rgba(78, 101, 94, 0.13)";
    context.lineWidth = 0.75;
    context.beginPath();
    context.moveTo(centerX - radiusX * 1.04, centerY);
    context.lineTo(centerX + radiusX * 1.04, centerY);
    context.moveTo(centerX, centerY - radiusY * 1.04);
    context.lineTo(centerX, centerY + radiusY * 1.04);
    context.stroke();
    context.restore();
  }

  function drawParticleSet(context, particles, pointFor, time, alphaMultiplier = 1, distortion = 0) {
    particles.forEach((particle) => {
      const point = pointFor(particle);
      const fade = Math.min(1, particle.radius * 5.2) * Math.min(1, (1.05 - particle.radius) * 5.6);
      const shimmer = reducedMotion.matches ? 1 : 0.84 + Math.sin(time * 0.00072 + particle.phase) * 0.16;
      const tidalX = distortion * Math.sin(particle.phase + particle.radius * 9) * (0.2 + particle.radius) * 20;
      const tidalY = distortion * Math.cos(particle.phase * 0.7 + particle.radius * 7) * (0.2 + particle.radius) * 11;
      context.beginPath();
      context.fillStyle = particleColor(particle, particle.alpha * fade * shimmer * alphaMultiplier);
      context.arc(point.x + tidalX, point.y + tidalY, particle.size, 0, Math.PI * 2);
      context.fill();
    });
  }

  function drawMergerEvent(context, centerX, centerY, radiusX, radiusY, mergerProgress) {
    if (reducedMotion.matches || mergerProgress < 0.69 || mergerProgress >= 0.995) return;
    const waveAge = Math.min(1, Math.max(0, (mergerProgress - 0.69) / 0.305));
    const burstAge = Math.min(1, Math.max(0, (mergerProgress - 0.72) / 0.23));
    const flash = Math.exp(-Math.pow((mergerProgress - 0.775) / 0.052, 2));
    const baseRadius = Math.min(radiusX, radiusY);

    context.save();
    context.lineCap = "round";
    canvasState.impactParticles.forEach((particle) => {
      if (burstAge <= 0 || burstAge >= 1) return;
      const travel = baseRadius * particle.radius * particle.speed * (0.08 + Math.pow(burstAge, 0.72));
      const angle = particle.angle + particle.drift * burstAge;
      const trail = baseRadius * particle.length * (0.4 + burstAge);
      const alpha = Math.sin(burstAge * Math.PI) * (0.12 + particle.size * 0.16);
      const x = centerX + Math.cos(angle) * travel;
      const y = centerY + Math.sin(angle) * travel * 0.72;
      context.beginPath();
      context.moveTo(x - Math.cos(angle) * trail, y - Math.sin(angle) * trail * 0.72);
      context.lineTo(x, y);
      context.strokeStyle = particle.tone > 0.72
        ? `rgba(52, 65, 59, ${alpha * 0.62})`
        : `rgba(40, 100, 199, ${alpha})`;
      context.lineWidth = particle.size;
      context.stroke();
    });

    if (flash > 0.01) {
      const glow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, baseRadius * (0.1 + flash * 0.42));
      glow.addColorStop(0, `rgba(255, 255, 255, ${flash * 0.96})`);
      glow.addColorStop(0.12, `rgba(112, 161, 230, ${flash * 0.72})`);
      glow.addColorStop(0.45, `rgba(40, 100, 199, ${flash * 0.2})`);
      glow.addColorStop(1, "rgba(40, 100, 199, 0)");
      context.fillStyle = glow;
      context.fillRect(centerX - baseRadius, centerY - baseRadius, baseRadius * 2, baseRadius * 2);
    }

    [0, 0.08, 0.16].forEach((delay, index) => {
      const localAge = waveAge - delay;
      if (localAge <= 0 || localAge >= 0.74) return;
      const normalizedAge = localAge / 0.74;
      const waveRadius = 0.1 + (1 - Math.pow(1 - normalizedAge, 2.4)) * (0.72 + index * 0.1);
      const alpha = Math.sin(normalizedAge * Math.PI) * (0.44 - index * 0.065);
      context.beginPath();
      context.setLineDash(index === 1 ? [3, 7] : []);
      context.strokeStyle = `rgba(40, 100, 199, ${alpha})`;
      context.lineWidth = 0.9 + (1 - normalizedAge) * 1.35;
      context.ellipse(
        centerX,
        centerY,
        radiusX * waveRadius,
        radiusY * waveRadius * (0.72 + index * 0.055),
        -0.13 + index * 0.13,
        0,
        Math.PI * 2
      );
      context.stroke();
    });
    context.restore();
  }

  function setMergerTarget(target, { sound = false } = {}) {
    const merger = canvasState.merger;
    if (reducedMotion.matches) {
      merger.from = target;
      merger.progress = target;
      merger.soundCue = "";
      merger.startedAt = 0;
      merger.target = target;
      elements.hero.classList.remove("is-merging");
      return;
    }
    if (target === merger.target) return;
    merger.from = merger.progress;
    merger.target = target;
    merger.startedAt = performance.now();
    merger.duration = (target > merger.from ? 3200 : 2200) * Math.max(0.42, Math.abs(target - merger.from));
    merger.soundCue = sound
      ? (target > merger.from ? "galaxy-collision" : "galaxy-release")
      : "";
    merger.soundThreshold = target > merger.from ? 0.775 : 0.58;
    elements.hero.classList.add("is-merging");
  }

  function updateMerger(time) {
    const merger = canvasState.merger;
    if (reducedMotion.matches) {
      merger.progress = merger.target;
      merger.startedAt = 0;
      elements.hero.classList.remove("is-merging");
      return merger.progress;
    }
    if (!merger.startedAt || !merger.duration) return merger.progress;
    const previousProgress = merger.progress;
    const elapsed = Math.max(0, time - merger.startedAt);
    const raw = Math.min(1, elapsed / merger.duration);
    const eased = (1 - Math.cos(raw * Math.PI)) / 2;
    merger.progress = merger.from + (merger.target - merger.from) * eased;
    const crossedSoundThreshold = merger.soundCue && (
      merger.target > merger.from
        ? previousProgress < merger.soundThreshold && merger.progress >= merger.soundThreshold
        : previousProgress > merger.soundThreshold && merger.progress <= merger.soundThreshold
    );
    if (crossedSoundThreshold) {
      document.dispatchEvent(new CustomEvent("galaxy:animation-cue", {
        detail: {
          cue: merger.soundCue,
          direction: merger.target > merger.from ? "collision" : "release",
          progress: merger.progress
        }
      }));
      merger.soundCue = "";
    }
    elements.hero.classList.toggle("is-merging", raw < 1);
    if (raw >= 1) {
      merger.progress = merger.target;
      merger.soundCue = "";
      merger.startedAt = 0;
    }
    return merger.progress;
  }

  function mergerOrbit(progress) {
    const approach = Math.min(1, Math.max(0, progress / 0.78));
    const angle = -0.58 + approach * Math.PI * 3.6;
    const separation = Math.pow(1 - approach, 1.18);
    return { angle, approach, separation };
  }

  function drawGalaxy(time) {
    const context = canvasState.context;
    if (!context || !canvasState.width || !canvasState.height) return;
    const parallax = canvasState.parallax;
    const mergerProgress = updateMerger(time);
    if (!reducedMotion.matches) {
      parallax.x += (parallax.targetX - parallax.x) * 0.075;
      parallax.y += (parallax.targetY - parallax.y) * 0.075;
    } else {
      parallax.x = 0;
      parallax.y = 0;
    }
    elements.hero.style.setProperty("--parallax-x", `${parallax.x.toFixed(2)}px`);
    elements.hero.style.setProperty("--parallax-y", `${parallax.y.toFixed(2)}px`);
    context.setTransform(canvasState.dpr, 0, 0, canvasState.dpr, 0, 0);
    context.clearRect(0, 0, canvasState.width, canvasState.height);

    canvasState.stars.forEach((star) => {
      const pulse = reducedMotion.matches ? 1 : 0.78 + Math.sin(time * 0.0007 + star.phase) * 0.22;
      context.beginPath();
      context.fillStyle = `rgba(62, 91, 80, ${star.alpha * pulse * 0.34})`;
      context.arc(star.x * canvasState.width, star.y * canvasState.height, star.radius, 0, Math.PI * 2);
      context.fill();
    });

    const { radiusX, radiusY } = canvasState.field;
    const systemX = canvasState.field.centerX + parallax.x;
    const systemY = canvasState.field.centerY + parallax.y;
    const orbit = mergerOrbit(mergerProgress);
    const barycentricEnvelope = Math.sin(Math.PI * orbit.approach) * orbit.separation;
    const mergerOffsetX = -Math.cos(orbit.angle) * radiusX * 0.1 * barycentricEnvelope;
    const mergerOffsetY = -Math.sin(orbit.angle) * radiusY * 0.1 * barycentricEnvelope;
    canvasState.mergerOffset.x = mergerOffsetX;
    canvasState.mergerOffset.y = mergerOffsetY;
    elements.hero.style.setProperty("--merger-x", `${mergerOffsetX.toFixed(2)}px`);
    elements.hero.style.setProperty("--merger-y", `${mergerOffsetY.toFixed(2)}px`);
    const centerX = systemX + mergerOffsetX;
    const centerY = systemY + mergerOffsetY;
    drawGeometricField(context, time, centerX, centerY, radiusX, radiusY, mergerProgress);
    const coreGlow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.min(radiusX, radiusY) * 0.52);
    coreGlow.addColorStop(0, "rgba(40, 100, 199, 0.16)");
    coreGlow.addColorStop(0.3, "rgba(40, 100, 199, 0.075)");
    coreGlow.addColorStop(1, "rgba(250, 249, 244, 0)");
    context.fillStyle = coreGlow;
    context.fillRect(centerX - radiusX, centerY - radiusY, radiusX * 2, radiusY * 2);

    const impact = Math.exp(-Math.pow((mergerProgress - 0.78) / 0.13, 2));
    drawParticleSet(
      context,
      canvasState.particles,
      (particle) => spiralPoint(
        particle.radius,
        particle.arm,
        centerX,
        centerY,
        radiusX,
        radiusY,
        particle.angleJitter,
        particle.radialJitter
      ),
      time,
      1 - mergerProgress * 0.72,
      impact
    );

    if (mergerProgress > 0.005) {
      const { angle, approach, separation } = orbit;
      const dissolve = 1 - Math.max(0, (mergerProgress - 0.78) / 0.22);
      const companionX = systemX + Math.cos(angle) * radiusX * 0.92 * separation;
      const companionY = systemY + Math.sin(angle) * radiusY * 0.92 * separation;
      const companionScale = 0.55 - approach * 0.09;
      context.save();
      for (let arm = 0; arm < 2; arm += 1) {
        context.beginPath();
        for (let step = 0; step <= 58; step += 1) {
          const progress = 0.06 + step / 58 * 0.88;
          const point = remnantPoint(
            progress,
            arm,
            companionX,
            companionY,
            radiusX * companionScale,
            radiusY * companionScale,
            approach * Math.PI * 1.25
          );
          if (step === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }
        context.setLineDash(arm ? [2, 7] : []);
        context.lineDashOffset = reducedMotion.matches ? 0 : time * -0.004;
        context.strokeStyle = `rgba(40, 100, 199, ${0.36 * Math.max(0, dissolve)})`;
        context.lineWidth = 0.9;
        context.stroke();
      }
      context.restore();
      drawParticleSet(
        context,
        canvasState.companionParticles,
        (particle) => remnantPoint(
          particle.radius,
          particle.arm,
          companionX,
          companionY,
          radiusX * companionScale,
          radiusY * companionScale,
          particle.angleJitter + approach * Math.PI * 1.25,
          particle.radialJitter
        ),
        time,
        Math.max(0, dissolve) * 0.86,
        impact * 0.7
      );
      if (dissolve > 0.04) {
        context.beginPath();
        context.strokeStyle = `rgba(40, 100, 199, ${0.72 * dissolve})`;
        context.lineWidth = 1.2;
        context.ellipse(companionX, companionY, 18 + dissolve * 13, 4 + dissolve * 4, -0.18 + approach * 0.36, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.fillStyle = `rgba(10, 15, 15, ${0.76 * dissolve})`;
        context.strokeStyle = `rgba(40, 100, 199, ${0.72 * dissolve})`;
        context.lineWidth = 1.4;
        context.arc(companionX, companionY, 3.8 + dissolve * 2.2, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
    }

    if (mergerProgress > 0.01) {
      drawParticleSet(
        context,
        canvasState.remnantParticles,
        (particle) => remnantPoint(
          particle.radius,
          particle.arm,
          centerX,
          centerY,
          radiusX * 0.92,
          radiusY * 0.78,
          particle.angleJitter,
          particle.radialJitter
        ),
        time,
        mergerProgress * 0.92,
        impact * 0.4
      );
    }

    drawMergerEvent(context, centerX, centerY, radiusX, radiusY, mergerProgress);
  }

  function animateGalaxy(time) {
    canvasState.animationFrame = window.requestAnimationFrame(animateGalaxy);
    if (document.hidden || time - canvasState.lastFrame < 15) return;
    canvasState.lastFrame = time;
    drawGalaxy(time);
  }

  function startGalaxy() {
    window.cancelAnimationFrame(canvasState.animationFrame);
    canvasState.startedAt = performance.now();
    resizeCanvas();
    if (!reducedMotion.matches) canvasState.animationFrame = window.requestAnimationFrame(animateGalaxy);
  }

  function nodePosition(index, total) {
    const rings = Math.ceil(total / geometry.arms);
    const arm = index % geometry.arms;
    const ring = Math.floor(index / geometry.arms);
    const progress = rings <= 1 ? 0.5 : (ring + 0.32) / (rings - 0.2);
    const radius = 0.3 + progress * 0.65;
    const point = spiralPoint(radius, arm, geometry.centerX * 100, geometry.centerY * 100, geometry.radiusX * 100, geometry.radiusY * 100);
    return {
      angle: point.angle,
      arm,
      progress: radius,
      x: Math.max(6, Math.min(94, point.x)),
      y: Math.max(6, Math.min(94, point.y))
    };
  }

  function remnantNodePosition(index, total) {
    const arms = 2;
    const rings = Math.max(1, Math.ceil(total / arms));
    const arm = index % arms;
    const ring = Math.floor(index / arms);
    const progress = rings <= 1 ? 0.22 + index * 0.18 : (ring + 0.38) / (rings + 0.05);
    const radius = Math.min(0.92, 0.22 + progress * 0.7);
    const point = remnantPoint(
      radius,
      arm,
      geometry.centerX * 100,
      geometry.centerY * 100,
      geometry.radiusX * 92,
      geometry.radiusY * 78
    );
    return {
      angle: point.angle,
      arm,
      progress: radius,
      x: Math.max(7, Math.min(93, point.x)),
      y: Math.max(7, Math.min(93, point.y))
    };
  }

  function ejectedNodePosition(index, total) {
    const base = nodePosition(index, total);
    return {
      ...base,
      x: Math.max(1, Math.min(99, geometry.centerX * 100 + (base.x - geometry.centerX * 100) * 1.42)),
      y: Math.max(1, Math.min(99, geometry.centerY * 100 + (base.y - geometry.centerY * 100) * 1.42))
    };
  }

  function orbitalNodePosition(position, radians, scale) {
    const normalizedX = (position.x - geometry.centerX * 100) / (geometry.radiusX * 100);
    const normalizedY = (position.y - geometry.centerY * 100) / (geometry.radiusY * 100);
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return {
      x: geometry.centerX * 100 + (normalizedX * cosine - normalizedY * sine) * geometry.radiusX * 100 * scale,
      y: geometry.centerY * 100 + (normalizedX * sine + normalizedY * cosine) * geometry.radiusY * 100 * scale
    };
  }

  function currentNodePosition(node, fieldRect) {
    const rect = node.getBoundingClientRect();
    return {
      opacity: Number.parseFloat(getComputedStyle(node).opacity) || 0.075,
      x: (rect.left - fieldRect.left + rect.width / 2) / fieldRect.width * 100,
      y: (rect.top - fieldRect.top + rect.height / 2) / fieldRect.height * 100
    };
  }

  function animateNodePath(node, from, to, { filtered, index, isVisible, wasFiltered }) {
    if (typeof node.animate !== "function") return 0;
    const direction = index % 2 ? -1 : 1;
    let first;
    let second;
    let opacityStops;
    let duration;

    if (filtered) {
      first = orbitalNodePosition(from, direction * (isVisible ? 0.68 : 0.54), isVisible ? 0.96 : 1.08);
      second = orbitalNodePosition(from, direction * (isVisible ? 1.72 : 1.34), isVisible ? 0.64 : 1.46);
      opacityStops = isVisible
        ? [from.opacity, Math.max(0.48, from.opacity), 0.92, 1]
        : [from.opacity, Math.max(0.16, from.opacity * 0.82), Math.max(0.1, from.opacity * 0.3), 0.075];
      duration = 2700;
    } else {
      first = orbitalNodePosition(from, direction * -0.72, wasFiltered ? 0.88 : 0.98);
      second = orbitalNodePosition(to, direction * 0.34, 1.08);
      opacityStops = [from.opacity, Math.max(0.34, from.opacity), 0.82, 1];
      duration = 2050;
    }

    const delay = Math.min(390, index * 22);
    node.animate([
      { left: `${from.x}%`, opacity: opacityStops[0], top: `${from.y}%` },
      { easing: "cubic-bezier(.42, 0, .58, 1)", left: `${first.x}%`, opacity: opacityStops[1], offset: 0.32, top: `${first.y}%` },
      { easing: "cubic-bezier(.22, .68, .28, 1)", left: `${second.x}%`, opacity: opacityStops[2], offset: 0.72, top: `${second.y}%` },
      { left: `${to.x}%`, opacity: opacityStops[3], top: `${to.y}%` }
    ], {
      delay,
      duration,
      easing: "linear",
      fill: "backwards"
    });
    return duration + delay;
  }

  function labelSide(position, index) {
    const horizontal = Math.cos(position.angle);
    const vertical = Math.sin(position.angle);
    if (Math.abs(horizontal) > Math.abs(vertical) * 0.9) return horizontal >= 0 ? "right" : "left";
    if (Math.abs(vertical) > 0.58) return vertical >= 0 ? "below" : "above";
    return ["right", "below", "left", "above"][index % 4];
  }

  function overlapArea(left, right, padding = 3) {
    const overlapX = Math.min(left.right + padding, right.right + padding) - Math.max(left.left - padding, right.left - padding);
    const overlapY = Math.min(left.bottom + padding, right.bottom + padding) - Math.max(left.top - padding, right.top - padding);
    return overlapX > 0 && overlapY > 0 ? overlapX * overlapY : 0;
  }

  function resolveLabelCollisions() {
    if (elements.field.hidden) return;
    const fieldRect = elements.field.getBoundingClientRect();
    const accepted = [];
    const nodes = [...nodeElements.values()]
      .filter((node) => !node.classList.contains("is-muted"))
      .sort((left, right) => Number(right.dataset.readingMinutes) - Number(left.dataset.readingMinutes));

    nodes.forEach((node) => {
      const label = node.querySelector(".galaxy-node__label");
      if (!label) return;
      const current = node.dataset.labelSide || "right";
      const alternatives = [current, "right", "left", "above", "below"].filter((side, index, values) => values.indexOf(side) === index);
      const nudges = [0, -16, 16, -30, 30];
      let best = { nudgeX: 0, nudgeY: 0, side: current, score: Number.POSITIVE_INFINITY, rect: null };

      alternatives.forEach((side) => {
        nudges.forEach((nudge) => {
          const vertical = side === "left" || side === "right";
          const nudgeX = vertical ? 0 : nudge;
          const nudgeY = vertical ? nudge : 0;
          node.dataset.labelSide = side;
          label.style.setProperty("--label-nudge-x", `${nudgeX}px`);
          label.style.setProperty("--label-nudge-y", `${nudgeY}px`);
          const rect = label.getBoundingClientRect();
          const overflow = Math.max(0, fieldRect.left + 3 - rect.left)
            + Math.max(0, rect.right - fieldRect.right + 3)
            + Math.max(0, fieldRect.top + 3 - rect.top)
            + Math.max(0, rect.bottom - fieldRect.bottom + 3);
          const collisions = accepted.reduce((total, acceptedRect) => total + overlapArea(rect, acceptedRect), 0);
          const score = overflow * 120 + collisions + Math.abs(nudge) * 0.04;
          if (score < best.score) best = { nudgeX, nudgeY, side, score, rect };
        });
      });

      node.dataset.labelSide = best.side;
      label.style.setProperty("--label-nudge-x", `${best.nudgeX}px`);
      label.style.setProperty("--label-nudge-y", `${best.nudgeY}px`);
      accepted.push(label.getBoundingClientRect());
    });
  }

  function createNode(post, index) {
    const position = nodePosition(index, posts.length);
    const minutes = minutesFor(post);
    const node = document.createElement("button");
    node.type = "button";
    node.className = "galaxy-node";
    node.dataset.slug = post.slug;
    node.dataset.arm = String(position.arm);
    node.dataset.progress = position.progress.toFixed(4);
    node.dataset.labelSide = labelSide(position, index);
    node.dataset.readingMinutes = String(minutes);
    node.style.setProperty("--node-color", categoryColors[post.category] || categoryColors.technical);
    node.style.setProperty("--node-size", `${(1.03 + minutes * 0.105).toFixed(3)}rem`);
    node.style.setProperty("--node-x", `${position.x.toFixed(3)}%`);
    node.style.setProperty("--node-y", `${position.y.toFixed(3)}%`);
    node.setAttribute("aria-label", `${post.title}. ${post.date}, ${displayCategory(post.category)}, ${post.readingTime || "reading time unavailable"}.`);
    node.setAttribute("aria-pressed", "false");
    node.title = post.title;
    node.append(text("span", "galaxy-node__label", nodeLabel(post)));
    nodeElements.set(post.slug, node);
    elements.nodes.append(node);
  }

  function createEntry(post) {
    const entry = document.createElement("article");
    const source = heroSource(post);
    entry.className = `galaxy-entry${source ? " has-media" : ""}`;
    entry.dataset.slug = post.slug;
    entry.dataset.blogSlug = post.slug;
    entry.dataset.blogSelected = "false";
    entry.style.setProperty("--entry-color", categoryColors[post.category] || categoryColors.technical);

    const meta = text("p", "galaxy-entry__meta", displayCategory(post.category));
    const date = text("time", "", post.date);
    date.dateTime = post.date;
    meta.append(date, text("span", "", post.readingTime || ""));

    const body = document.createElement("div");
    body.className = "galaxy-entry__body";
    const heading = document.createElement("h3");
    const headingLink = text("a", "", post.title);
    headingLink.href = articleUrl(post);
    heading.append(headingLink);
    body.append(heading, text("p", "galaxy-entry__summary", post.summary || ""));

    if (post.topics?.length) {
      const topics = document.createElement("p");
      topics.className = "galaxy-entry__topics";
      topics.setAttribute("aria-label", "Topics");
      post.topics.slice(0, 7).forEach((topic) => topics.append(text("span", "", topic)));
      body.append(topics);
    }
    const actions = document.createElement("p");
    actions.className = "galaxy-entry__actions";
    const read = text("a", "", "Read entry");
    read.href = articleUrl(post);
    const share = text("button", "", "Share");
    share.type = "button";
    share.dataset.shareSlug = post.slug;
    const bookmark = text("button", "", bookmarks.has(post.slug) ? "Bookmarked" : "Bookmark");
    bookmark.type = "button";
    bookmark.dataset.bookmarkSlug = post.slug;
    bookmark.setAttribute("aria-pressed", String(bookmarks.has(post.slug)));
    actions.append(read, share, bookmark);
    body.append(actions);
    entry.append(meta, body);

    if (source) {
      const media = document.createElement("a");
      media.className = "galaxy-entry__media";
      media.href = articleUrl(post);
      media.setAttribute("aria-label", `Read ${post.title}`);
      const image = document.createElement("img");
      image.src = source;
      image.alt = post.heroAlt || "";
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => {
        media.remove();
        entry.classList.remove("has-media");
      }, { once: true });
      media.append(image);
      entry.append(media);
    }

    entryElements.set(post.slug, entry);
    elements.list.append(entry);
  }

  function createCategories() {
    const counts = new Map();
    posts.forEach((post) => counts.set(post.category, (counts.get(post.category) || 0) + 1));
    const categories = [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    [["all", posts.length], ...categories].forEach(([category, count]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.category = category;
      button.style.setProperty("--node-color", categoryColors[category] || categoryColors.technical);
      button.textContent = `${category === "all" ? "all writing" : displayCategory(category)} ${count}`;
      button.setAttribute("aria-pressed", String(category === state.category));
      elements.categories.append(button);
    });
  }

  function positionFocus() {
    window.clearTimeout(focusTimer);
    const node = state.selected ? nodeElements.get(state.selected) : null;
    if (!node || elements.focus.hidden) return;
    const fieldRect = elements.field.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const popupWidth = elements.focus.offsetWidth;
    const popupHeight = elements.focus.offsetHeight;
    const gap = 18;
    const margin = 10;
    const anchorX = nodeRect.left - fieldRect.left + nodeRect.width / 2;
    const anchorY = nodeRect.top - fieldRect.top + nodeRect.height / 2;
    const nodeLeft = nodeRect.left - fieldRect.left;
    const nodeRight = nodeRect.right - fieldRect.left;
    const nodeTop = nodeRect.top - fieldRect.top;
    const nodeBottom = nodeRect.bottom - fieldRect.top;
    const spaceRight = fieldRect.width - nodeRight - gap;
    const spaceLeft = nodeLeft - gap;
    const spaceBelow = fieldRect.height - nodeBottom - gap;
    const spaceAbove = nodeTop - gap;
    let placement = spaceRight >= popupWidth ? "right" : spaceLeft >= popupWidth ? "left" : spaceBelow >= popupHeight ? "below" : "above";
    if (placement === "above" && spaceAbove < popupHeight && spaceBelow > spaceAbove) placement = "below";

    let left = nodeRight + gap;
    let top = anchorY - Math.min(68, popupHeight * 0.28);
    if (placement === "left") left = nodeLeft - gap - popupWidth;
    if (placement === "below") {
      left = anchorX - popupWidth / 2;
      top = nodeBottom + gap;
    }
    if (placement === "above") {
      left = anchorX - popupWidth / 2;
      top = nodeTop - gap - popupHeight;
    }
    left = Math.max(margin, Math.min(fieldRect.width - popupWidth - margin, left));
    top = Math.max(margin, Math.min(fieldRect.height - popupHeight - margin, top));
    elements.focus.style.setProperty("--focus-left", `${left}px`);
    elements.focus.style.setProperty("--focus-top", `${top}px`);
    elements.focus.dataset.placement = placement;
  }

  function renderFocus() {
    const post = posts.find((candidate) => candidate.slug === state.selected);
    nodeElements.forEach((node, slug) => node.setAttribute("aria-pressed", String(slug === state.selected)));
    entryElements.forEach((entry, slug) => {
      const selected = slug === state.selected;
      entry.classList.toggle("is-selected", selected);
      entry.dataset.blogSelected = String(selected);
    });
    if (!post) {
      elements.focus.hidden = true;
      drawGalaxy(performance.now());
      return;
    }
    elements.focusMeta.textContent = `${post.date} · ${displayCategory(post.category)} · ${post.readingTime || "reading time unavailable"}`;
    elements.focusTitle.textContent = post.title;
    elements.focusSummary.textContent = post.summary || "";
    elements.focusTopics.textContent = (post.topics || []).join(" · ");
    elements.focusTopics.hidden = !(post.topics || []).length;
    elements.focusLink.href = articleUrl(post);
    elements.focus.hidden = false;
    drawGalaxy(performance.now());
    positionFocus();
    requestAnimationFrame(positionFocus);
    focusTimer = window.setTimeout(positionFocus, 180);
  }

  function render({ soundMerger = false } = {}) {
    const visible = posts.filter(matches);
    const visibleSlugs = new Set(visible.map((post) => post.slug));
    if (state.selected && !visibleSlugs.has(state.selected)) state.selected = "";
    const filtered = state.category !== "all" || Boolean(normalize(state.query));
    const wasFiltered = elements.hero.dataset.merger === "remnant";
    const canChoreograph = hasRendered && !reducedMotion.matches && typeof Element.prototype.animate === "function";
    const fieldRect = canChoreograph ? elements.field.getBoundingClientRect() : null;
    const startingPositions = new Map();
    if (canChoreograph) {
      nodeElements.forEach((node, slug) => startingPositions.set(slug, currentNodePosition(node, fieldRect)));
      nodeElements.forEach((node) => node.getAnimations().forEach((animation) => animation.cancel()));
      elements.hero.classList.add("is-node-choreography");
    }
    let longestChoreography = 0;
    posts.forEach((post, index) => {
      const node = nodeElements.get(post.slug);
      const matchIndex = visible.findIndex((candidate) => candidate.slug === post.slug);
      const position = filtered
        ? (matchIndex >= 0 ? remnantNodePosition(matchIndex, visible.length) : ejectedNodePosition(index, posts.length))
        : nodePosition(index, posts.length);
      const slug = post.slug;
      const isVisible = visibleSlugs.has(slug);
      node.style.setProperty("--node-x", `${position.x.toFixed(3)}%`);
      node.style.setProperty("--node-y", `${position.y.toFixed(3)}%`);
      node.style.setProperty("--node-delay", "0ms");
      node.dataset.arm = String(position.arm);
      node.dataset.progress = position.progress.toFixed(4);
      node.dataset.labelSide = labelSide(position, index);
      node.classList.toggle("is-muted", !isVisible);
      node.classList.toggle("is-ejected", filtered && !isVisible);
      node.classList.toggle("is-match", filtered && isVisible);
      node.tabIndex = isVisible ? 0 : -1;
      if (canChoreograph) {
        longestChoreography = Math.max(longestChoreography, animateNodePath(
          node,
          startingPositions.get(slug),
          position,
          { filtered, index, isVisible, wasFiltered }
        ));
      }
    });
    entryElements.forEach((entry, slug) => { entry.hidden = !visibleSlugs.has(slug); });
    elements.categories.querySelectorAll("button[data-category]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.category === state.category));
    });
    elements.count.textContent = `${visible.length} ${visible.length === 1 ? "entry" : "entries"}`;
    elements.status.textContent = visible.length
      ? `[${visible.length} published ${visible.length === 1 ? "entry" : "entries"} · engineering, systems, and life]`
      : "[no published entry matches that subject]";
    elements.empty.hidden = visible.length !== 0;
    elements.hero.dataset.merger = filtered ? "remnant" : "archive";
    setMergerTarget(filtered ? 1 : 0, { sound: soundMerger });
    if (reducedMotion.matches) drawGalaxy(performance.now());
    renderFocus();
    window.clearTimeout(choreographyTimer);
    if (canChoreograph) {
      choreographyTimer = window.setTimeout(() => {
        elements.hero.classList.remove("is-node-choreography");
      }, longestChoreography + 80);
    } else {
      elements.hero.classList.remove("is-node-choreography");
    }
    window.clearTimeout(layoutTimer);
    if (!canChoreograph) requestAnimationFrame(resolveLabelCollisions);
    layoutTimer = window.setTimeout(() => {
      resolveLabelCollisions();
      positionFocus();
    }, reducedMotion.matches ? 0 : Math.max(1400, longestChoreography + 90));
    hasRendered = true;
  }

  function selectPost(slug, { push = true } = {}) {
    if (!posts.some((post) => post.slug === slug)) return;
    if (state.selected === slug) {
      releasePost({ push });
      return;
    }
    state.selected = slug;
    lastSelectedNode = nodeElements.get(slug) || null;
    writeUrl(push ? "pushState" : "replaceState");
    renderFocus();
  }

  function releasePost({ push = true, restoreFocus = false } = {}) {
    if (!state.selected) return;
    state.selected = "";
    writeUrl(push ? "pushState" : "replaceState");
    renderFocus();
    if (restoreFocus) lastSelectedNode?.focus({ preventScroll: true });
  }

  async function sharePost(slug, button) {
    const post = posts.find((candidate) => candidate.slug === slug);
    if (!post) return;
    const url = new URL(articleUrl(post), window.location.origin).href;
    const original = button.textContent;
    try {
      if (navigator.share) {
        await navigator.share({ title: post.title, url });
        button.textContent = "Shared";
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        button.textContent = "Link copied";
      } else {
        throw new Error("Sharing is unavailable");
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      button.textContent = "Copy unavailable";
    }
    window.setTimeout(() => { button.textContent = original; }, 1800);
  }

  function toggleBookmark(slug, button) {
    if (!posts.some((post) => post.slug === slug)) return;
    if (bookmarks.has(slug)) bookmarks.delete(slug);
    else bookmarks.add(slug);
    const bookmarked = bookmarks.has(slug);
    saveBookmarks();
    button.setAttribute("aria-pressed", String(bookmarked));
    button.textContent = bookmarked ? "Bookmarked" : "Bookmark";
  }

  function bindEvents() {
    elements.hero.addEventListener("pointermove", (event) => {
      if (reducedMotion.matches || event.pointerType === "touch") return;
      const rect = elements.hero.getBoundingClientRect();
      canvasState.parallax.targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 14;
      canvasState.parallax.targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 10;
    }, { passive: true });
    elements.hero.addEventListener("pointerleave", () => {
      canvasState.parallax.targetX = 0;
      canvasState.parallax.targetY = 0;
    }, { passive: true });
    elements.search.addEventListener("input", () => {
      state.query = elements.search.value.slice(0, 160);
      writeUrl();
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => render({ soundMerger: true }), reducedMotion.matches ? 0 : 420);
    });
    elements.tuner.addEventListener("submit", (event) => {
      event.preventDefault();
      window.clearTimeout(searchTimer);
      state.query = elements.search.value.slice(0, 160);
      writeUrl();
      render({ soundMerger: true });
      if (!mobileLayout.matches) return;
      elements.search.blur();
      window.setTimeout(() => {
        elements.core.scrollIntoView({
          behavior: reducedMotion.matches ? "auto" : "smooth",
          block: "center"
        });
      }, reducedMotion.matches ? 0 : 40);
    });
    elements.tuner.addEventListener("reset", () => window.setTimeout(() => {
      window.clearTimeout(searchTimer);
      state.query = "";
      writeUrl();
      render({ soundMerger: true });
      elements.search.focus();
    }));
    elements.categories.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-category]");
      if (!button || button.dataset.category === state.category) return;
      state.category = button.dataset.category;
      writeUrl("pushState");
      render({ soundMerger: true });
    });
    elements.list.addEventListener("click", (event) => {
      const share = event.target.closest("button[data-share-slug]");
      if (share) {
        sharePost(share.dataset.shareSlug, share);
        return;
      }
      const bookmark = event.target.closest("button[data-bookmark-slug]");
      if (bookmark) toggleBookmark(bookmark.dataset.bookmarkSlug, bookmark);
    });
    elements.nodes.addEventListener("click", (event) => {
      const node = event.target.closest("button[data-slug]");
      if (!node) return;
      event.stopPropagation();
      selectPost(node.dataset.slug);
    });
    elements.nodes.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      const visible = [...nodeElements.values()].filter((node) => node.tabIndex === 0);
      const current = visible.indexOf(document.activeElement);
      if (current < 0 || !visible.length) return;
      const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      visible[(current + delta + visible.length) % visible.length].focus();
      event.preventDefault();
    });
    elements.release.addEventListener("click", (event) => {
      event.stopPropagation();
      releasePost({ restoreFocus: true });
    });
    elements.focus.addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("click", (event) => {
      if (!state.selected || event.target.closest(".galaxy-node") || event.target.closest("#galaxy-focus")) return;
      releasePost();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !state.selected) return;
      releasePost({ restoreFocus: true });
      event.preventDefault();
    });
    window.addEventListener("resize", resizeCanvas, { passive: true });
    window.addEventListener("popstate", () => {
      const next = readUrlState();
      state.category = next.category;
      state.query = next.query;
      state.selected = next.selected;
      elements.search.value = state.query;
      render();
    });
    reducedMotion.addEventListener?.("change", startGalaxy);
  }

  async function loadPosts() {
    try {
      const response = await fetch("/blog/posts.json", { headers: { Accept: "application/json" }, cache: "default" });
      if (!response.ok) throw new Error(`Archive manifest returned ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload) || !payload.length) throw new Error("Archive manifest is empty");
      return payload;
    } catch (error) {
      console.warn("Using the embedded archive snapshot", error);
      return Array.isArray(window.AC_LOG_POSTS) ? window.AC_LOG_POSTS : [];
    }
  }

  async function init() {
    const payload = await loadPosts();
    posts = payload
      .filter((post) => post && String(post.slug || "").trim() && String(post.title || "").trim())
      .map((post) => ({
        ...post,
        category: normalize(post.category || "technical"),
        slug: String(post.slug).trim(),
        topics: Array.isArray(post.topics) ? post.topics : []
      }))
      .sort((left, right) => timestamp(right.date) - timestamp(left.date) || left.slug.localeCompare(right.slug));

    if (!posts.length) {
      elements.list.innerHTML = '<p class="galaxy-empty">The archive could not be loaded here. <a href="/blog/">Open the current Logs page.</a></p>';
      return;
    }

    elements.list.replaceChildren();
    bookmarks = loadBookmarks();
    posts.forEach((post, index) => {
      createNode(post, index);
      createEntry(post);
    });
    createCategories();

    const years = posts.map((post) => Number(String(post.date).slice(0, 4))).filter(Number.isFinite);
    elements.total.textContent = `${posts.length} published entries`;
    elements.range.textContent = `${Math.min(...years)} → ${Math.max(...years)}`;
    elements.tuner.hidden = false;
    elements.field.hidden = false;
    elements.field.dataset.ready = "true";

    const initial = readUrlState();
    state.category = initial.category;
    state.query = initial.query;
    state.selected = initial.selected;
    elements.search.value = state.query;
    writeUrl();
    bindEvents();
    render();
    startGalaxy();
    requestAnimationFrame(resolveLabelCollisions);
  }

  init().catch((error) => {
    console.error("Spiral galaxy archive unavailable", error);
    elements.list.innerHTML = '<p class="galaxy-empty">The archive could not be loaded here. <a href="/blog/">Open the current Logs page.</a></p>';
  });
})();
