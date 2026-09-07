(() => {
  "use strict";

  const BOOKMARKS_KEY = "ac.blog.bookmarks.v1";
  const LEGACY_BOOKMARKS_KEYS = Object.freeze(["ac_blog_bookmarks_v1"]);

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
  const state = { category: "all", query: "", savedOnly: false, selected: "" };
  const nodeElements = new Map();
  const entryElements = new Map();
  const observedEntryImages = new WeakSet();
  let bookmarks = new Set();
  let posts = [];
  let lastSelectedNode = null;
  let choreographyTimer = 0;
  let focusFrame = 0;
  let focusTimer = 0;
  let focusFrameGeneration = 0;
  let hasRendered = false;
  let layoutFrame = 0;
  let layoutTimer = 0;
  let searchTimer = 0;

  const canvasState = {
    animationFrame: 0,
    budget: null,
    context: elements.canvas.getContext("2d", { alpha: true }),
    companionParticles: [],
    dpr: 1,
    field: { centerX: 0, centerY: 0, radiusX: 0, radiusY: 0 },
    frameInterval: 1000 / 45,
    height: 0,
    intersectsViewport: true,
    lastFrame: 0,
    merger: { progress: 0, target: 0, signature: "", encounter: null, sprites: [] },
    lastDraw: 0,
    elapsed: 0,
    paused: false,
    mergerOffset: { x: 0, y: 0 },
    parallax: { x: 0, y: 0, targetX: 0, targetY: 0 },
    particles: [],
    remnantParticles: [],
    startedAt: 0,
    stars: [],
    starSprites: [],
    nucleusSprite: null,
    gpu: null,
    rendererInitialized: false,
    width: 0
  };

  const normalize = (value) => String(value || "").trim().toLocaleLowerCase("en-US");
  const articleUrl = (post) => `/blog/${encodeURIComponent(post.slug)}.html`;
  const displayCategory = (category) => category === "work" ? "portfolio" : String(category || "writing");
  const timestamp = (value) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

  function bindBrowseHandoff() {
    const link = document.querySelector('.galaxy-ledger__browse[href="#blog-feed"]');
    const target = document.getElementById("blog-feed");
    if (!link || !target) return;
    target.tabIndex = -1;
    link.addEventListener("click", () => {
      requestAnimationFrame(() => target.focus({ preventScroll: true }));
    });
  }

  function loadBookmarks() {
    const merged = new Set();
    let shouldMigrate = false;
    try {
      [BOOKMARKS_KEY, ...LEGACY_BOOKMARKS_KEYS].forEach((key) => {
        const raw = localStorage.getItem(key);
        if (!raw) return;
        if (key !== BOOKMARKS_KEY) shouldMigrate = true;
        let value;
        try {
          value = JSON.parse(raw);
        } catch (_error) {
          return;
        }
        if (Array.isArray(value)) {
          value
            .map((slug) => String(slug || "").trim())
            .filter(Boolean)
            .forEach((slug) => merged.add(slug));
        }
      });
      if (shouldMigrate) {
        localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...merged].sort()));
        LEGACY_BOOKMARKS_KEYS.forEach((key) => localStorage.removeItem(key));
      }
    } catch (_error) {
      // Valid bookmark values collected before storage became unavailable remain usable.
    }
    return merged;
  }

  function saveBookmarks() {
    try {
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...bookmarks].sort()));
      LEGACY_BOOKMARKS_KEYS.forEach((key) => localStorage.removeItem(key));
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
    if (state.savedOnly && !bookmarks.has(post.slug)) return false;
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
      savedOnly: parameters.get("saved") === "1",
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
    if (state.savedOnly) url.searchParams.set("saved", "1");
    else url.searchParams.delete("saved");
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
    const radius = Math.pow(random(), remnant ? 0.88 : 0.82);
    const brightness = random();
    const particle = {
      alpha: 0.42 + random() * 0.52,
      // Narrow, irregular strands leave dark lanes between the luminous arms.
      angleJitter: (random() - 0.5) * (0.12 + radius * 0.22)
        + Math.sin(radius * 24 + index % arms) * 0.025,
      arm: index % arms,
      phase: random() * Math.PI * 2,
      radialJitter: (random() - 0.5) * (0.015 + radius * 0.025),
      radius,
      size: (compact ? 0.8 : 1) * (0.6 + Math.pow(brightness, 4) * 4.2),
      tone: random(),
      variant: index % 3
    };
    particle.fade = Math.min(1, (1.06 - radius) * 6);
    particle.spriteIndex = (particle.tone < 0.12 ? 2 : particle.tone < 0.42 ? 1 : 0) * 3 + particle.variant;
    particle.spriteSize = 8 + particle.size * 11;
    particle.frequency = 1 / Math.pow(radius * radius + 0.25 * 0.25, 0.75);
    return particle;
  }

  function buildStarSprites() {
    // Rasterize bloom and neighboring dust once, rather than blurring every star every frame.
    return ["224, 237, 255", "150, 201, 255", "255, 205, 165"].map((tone, toneIndex) =>
      Array.from({ length: 3 }, (_, variant) => {
        const sprite = document.createElement("canvas");
        sprite.width = 64;
        sprite.height = 64;
        const context = sprite.getContext("2d");
        const glow = context.createRadialGradient(32, 32, 0, 32, 32, 28);
        glow.addColorStop(0, "rgba(255, 255, 255, 1)");
        glow.addColorStop(0.065, `rgba(${tone}, 0.96)`);
        glow.addColorStop(0.16, `rgba(${tone}, 0.28)`);
        glow.addColorStop(0.42, `rgba(${tone}, 0.045)`);
        glow.addColorStop(1, `rgba(${tone}, 0)`);
        context.fillStyle = glow;
        context.fillRect(0, 0, 64, 64);
        const random = seededRandom(0x57A2 + toneIndex * 31 + variant);
        for (let index = 0; index < 9; index += 1) {
          const x = 8 + random() * 48;
          const y = 8 + random() * 48;
          context.fillStyle = `rgba(${tone}, ${0.25 + random() * 0.6})`;
          const size = 0.65 + random() * 1.3;
          context.fillRect(x, y, size, size);
        }
        return sprite;
      })
    );
  }

  function createGpuRenderer() {
    const canvas = document.createElement("canvas");
    let gl;
    const shaders = [];
    let program;
    let buffer;
    let texture;
    let staticBuffer;
    try {
      gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: false,
        stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
      if (!gl) return null;
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("Galaxy shader compilation failed");
        return shader;
      };
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, `
        attribute vec2 position;
        attribute vec2 uv;
        attribute float opacity;
        attribute vec4 orbit;
        attribute vec3 anchor;
        uniform vec2 viewport;
        uniform vec4 field;
        uniform float elapsed;
        uniform float reduced;
        uniform float orbital;
        varying vec2 textureUv;
        varying float alpha;
        void main() {
          vec2 point = position;
          alpha = opacity;
          if (orbital > 0.5) {
            point += anchor.xy;
            if (anchor.z > 0.5) point += field.xy;
            if (anchor.z > 1.5) {
              float angle = orbit.x - elapsed * 0.012 * orbit.z;
              point += vec2(cos(angle), sin(angle)) * orbit.y * field.zw;
              alpha *= mix(0.9 + sin(elapsed * 0.45 + orbit.w) * 0.1, 1.0, reduced);
            } else if (anchor.z < 0.5) {
              alpha *= mix(0.85 + sin(elapsed * 0.7 + orbit.w) * 0.15, 1.0, reduced);
            }
          }
          gl_Position = vec4(point / viewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
          textureUv = uv;
        }`));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `
        precision mediump float;
        uniform sampler2D atlas;
        varying vec2 textureUv;
        varying float alpha;
        void main() {
          vec4 color = texture2D(atlas, textureUv);
          gl_FragColor = vec4(color.rgb, color.a * alpha);
        }`));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Galaxy shader linking failed");
      gl.useProgram(program);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      // 1,600 sprites includes all wide-screen stars, both galaxies and their nuclei.
      const vertices = new Float32Array(1600 * 6 * 5);
      gl.bufferData(gl.ARRAY_BUFFER, vertices.byteLength, gl.DYNAMIC_DRAW);
      for (const [name, size, offset] of [["position", 2, 0], ["uv", 2, 8], ["opacity", 1, 16]]) {
        const location = gl.getAttribLocation(program, name);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 20, offset);
      }
      const atlas = document.createElement("canvas");
      atlas.width = atlas.height = 512;
      const ctx = atlas.getContext("2d");
      canvasState.starSprites.flat().forEach((sprite, index) => {
        ctx.drawImage(sprite, index % 4 * 128, Math.floor(index / 4) * 128, 128, 128);
      });
      ctx.drawImage(canvasState.nucleusSprite, 256, 256, 128, 128);
      // Cell 9 is an antialiased background star; cell 10 is the nucleus glow.
      ctx.fillStyle = "rgb(195, 216, 239)";
      ctx.beginPath();
      ctx.arc(192, 320, 60, 0, Math.PI * 2);
      ctx.fill();
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
      const viewport = gl.getUniformLocation(program, "viewport");
      const orbital = gl.getUniformLocation(program, "orbital");
      const field = gl.getUniformLocation(program, "field");
      const elapsed = gl.getUniformLocation(program, "elapsed");
      const reduced = gl.getUniformLocation(program, "reduced");
      const orbitLocation = gl.getAttribLocation(program, "orbit");
      const anchorLocation = gl.getAttribLocation(program, "anchor");
      staticBuffer = gl.createBuffer();
      let staticKey = "";
      let staticCount = 0;
      let orbitalFrame = false;
      const bindAttributes = (stride) => {
        for (const [name, size, offset] of [["position", 2, 0], ["uv", 2, 8], ["opacity", 1, 16]]) {
          gl.vertexAttribPointer(gl.getAttribLocation(program, name), size, gl.FLOAT, false, stride, offset);
        }
      };
      let count = 0;
      const corners = [0, 1, 2, 2, 1, 3];
      const renderer = {
        begin() {
          count = 0;
          orbitalFrame = false;
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          bindAttributes(20);
          gl.disableVertexAttribArray(orbitLocation);
          gl.disableVertexAttribArray(anchorLocation);
          gl.uniform1f(orbital, 0);
          if (canvas.width !== elements.canvas.width || canvas.height !== elements.canvas.height) {
            canvas.width = elements.canvas.width;
            canvas.height = elements.canvas.height;
            gl.viewport(0, 0, canvas.width, canvas.height);
          }
          gl.uniform2f(viewport, canvasState.width, canvasState.height);
          gl.clear(gl.COLOR_BUFFER_BIT);
        },
        sprite(index, x, y, size, alpha) {
          if (alpha <= 0 || x + size / 2 < 0 || y + size / 2 < 0
            || x - size / 2 > canvasState.width || y - size / 2 > canvasState.height) return;
          const left = x - size / 2, top = y - size / 2;
          const u = index % 4 / 4, v = Math.floor(index / 4) / 4;
          // Triangle vertices share the original sprite geometry and UVs.
          for (const corner of corners) {
            const right = corner & 1, bottom = corner >> 1;
            vertices[count++] = left + right * size;
            vertices[count++] = top + bottom * size;
            vertices[count++] = u + right / 4;
            vertices[count++] = v + bottom / 4;
            vertices[count++] = alpha;
          }
        },
        orbit(companion, centerX, centerY, radiusX, radiusY) {
          orbitalFrame = true;
          const key = [canvasState.width, canvasState.height, radiusX, radiusY, companion, canvasState.budget.tier].join(":");
          gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer);
          if (key !== staticKey) {
            const data = [];
            const append = (index, size, alpha, angle, radius, frequency, phase, x, y, kind) => {
              const u = index % 4 / 4, v = Math.floor(index / 4) / 4;
              for (const corner of corners) {
                const right = corner & 1, bottom = corner >> 1;
                data.push((right - 0.5) * size, (bottom - 0.5) * size,
                  u + right / 4, v + bottom / 4, alpha,
                  angle, radius, frequency, phase, x, y, kind);
              }
            };
            for (const star of canvasState.stars) {
              append(9, star.radius * 128 / 60, star.alpha * 0.48, 0, 0, 0, star.phase,
                star.x * canvasState.width, star.y * canvasState.height, 0);
            }
            const particles = companion ? canvasState.remnantParticles : canvasState.particles;
            for (const particle of particles) {
              const angle = companion ? particle.arm * Math.PI + particle.radius * 7.3 - 1.08
                : particle.arm * Math.PI * 2 / geometry.arms + particle.radius * geometry.twist + geometry.phase;
              append(particle.spriteIndex, particle.spriteSize, particle.alpha * particle.fade,
                angle + particle.angleJitter, particle.radius + particle.radialJitter,
                particle.frequency, particle.phase, 0, 0, 2);
            }
            const radius = Math.min(radiusX, radiusY) * 0.4;
            append(10, radius * 2, 1, 0, 0, 0, 0, 0, 0, 1);
            append(0, radius * 0.65, 1, 0, 0, 0, 0, 0, 0, 1);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
            staticCount = data.length / 12;
            staticKey = key;
          }
          bindAttributes(48);
          gl.enableVertexAttribArray(orbitLocation);
          gl.vertexAttribPointer(orbitLocation, 4, gl.FLOAT, false, 48, 20);
          gl.enableVertexAttribArray(anchorLocation);
          gl.vertexAttribPointer(anchorLocation, 3, gl.FLOAT, false, 48, 36);
          gl.uniform1f(orbital, 1);
          gl.uniform1f(elapsed, canvasState.elapsed);
          gl.uniform1f(reduced, reducedMotion.matches ? 1 : 0);
          gl.uniform4f(field, centerX, centerY, radiusX, radiusY * (companion ? 0.78 : 1));
          gl.drawArrays(gl.TRIANGLES, 0, staticCount);
        },
        flush() {
          if (orbitalFrame) return;
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices.subarray(0, count));
          gl.drawArrays(gl.TRIANGLES, 0, count / 5);
        }
      };
      canvas.className = "galaxy-sky";
      canvas.setAttribute("aria-hidden", "true");
      canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        // Fall back immediately, including when paused or showing a settled search.
        canvasState.gpu = null;
        canvas.remove();
        elements.hero.dataset.galaxyRenderer = "canvas";
        drawGalaxyIfVisible();
      }, { once: true });
      elements.canvas.after(canvas);
      shaders.forEach((shader) => gl.deleteShader(shader));
      elements.hero.dataset.galaxyRenderer = "webgl";
      return renderer;
    } catch (_error) {
      if (!gl) return null;
      shaders.forEach((shader) => gl.deleteShader(shader));
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      if (staticBuffer) gl.deleteBuffer(staticBuffer);
      if (texture) gl.deleteTexture(texture);
      return null;
    }
  }

  function buildNucleusSprite() {
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 256;
    const context = sprite.getContext("2d");
    const glow = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    glow.addColorStop(0, "rgba(248, 251, 255, 0.8)");
    glow.addColorStop(0.09, "rgba(226, 239, 255, 0.38)");
    glow.addColorStop(0.3, "rgba(163, 195, 235, 0.12)");
    glow.addColorStop(1, "rgba(122, 166, 214, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, 256, 256);
    return sprite;
  }

  function performanceBudgetFor(width) {
    if (width <= 480) {
      return { companion: 80, dpr: 1, fps: 24, impact: 28, particles: 300, remnant: 180, stars: 90, tier: "phone" };
    }
    if (width < 760) {
      return { companion: 130, dpr: 1, fps: 30, impact: 48, particles: 430, remnant: 260, stars: 140, tier: "compact" };
    }
    if (width < 1200) {
      return { companion: 160, dpr: 1.25, fps: 30, impact: 72, particles: 500, remnant: 350, stars: 220, tier: "medium" };
    }
    return { companion: 200, dpr: 1.25, fps: 30, impact: 96, particles: 600, remnant: 400, stars: 280, tier: "wide" };
  }

  function buildCanvasScene() {
    const random = seededRandom(0xAC202608);
    const compact = canvasState.width < 760;
    const budget = canvasState.budget || performanceBudgetFor(canvasState.width);
    if (!canvasState.starSprites.length) canvasState.starSprites = buildStarSprites();
    if (!canvasState.nucleusSprite) canvasState.nucleusSprite = buildNucleusSprite();
    if (!canvasState.rendererInitialized) {
      canvasState.rendererInitialized = true;
      canvasState.gpu = createGpuRenderer();
      if (!canvasState.gpu) elements.hero.dataset.galaxyRenderer = "canvas";
    }
    canvasState.stars = Array.from({ length: budget.stars }, () => ({
      alpha: 0.16 + random() * 0.7,
      phase: random() * Math.PI * 2,
      radius: 0.25 + random() * 1.25,
      x: random(),
      y: random()
    }));
    canvasState.particles = Array.from({ length: budget.particles }, (_, index) => createParticle(random, index, geometry.arms, { compact }));
    canvasState.companionParticles = Array.from({ length: budget.companion }, (_, index) => createParticle(random, index, 2, { compact, remnant: true }));
    canvasState.remnantParticles = Array.from({ length: budget.remnant }, (_, index) => createParticle(random, index, 2, { compact, remnant: true }));

  }

  function resizeCanvas() {
    const heroRect = elements.hero.getBoundingClientRect();
    const fieldRect = elements.field.getBoundingClientRect();
    const coreRect = elements.core.getBoundingClientRect();
    canvasState.width = Math.max(1, Math.round(heroRect.width));
    canvasState.height = Math.max(1, Math.round(heroRect.height));
    const previousTier = canvasState.budget?.tier;
    canvasState.budget = performanceBudgetFor(canvasState.width);
    canvasState.dpr = Math.min(window.devicePixelRatio || 1, canvasState.budget.dpr);
    canvasState.frameInterval = 1000 / canvasState.budget.fps;
    elements.hero.dataset.galaxyBudget = canvasState.budget.tier;
    elements.hero.dataset.galaxyDpr = canvasState.dpr.toFixed(2);
    elements.hero.dataset.galaxyFps = String(canvasState.budget.fps);
    elements.hero.dataset.galaxyParticleBudget = String(
      canvasState.budget.particles + canvasState.budget.companion + canvasState.budget.remnant
    );
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
    if (canvasState.merger.encounter && previousTier !== canvasState.budget.tier) startEncounter();
    drawGalaxyIfVisible();
    scheduleLabelCollisions({ updateFocus: true });
    positionFocus();
  }

  function drawSelectedArm(context, centerX, centerY, radiusX, radiusY, mergerProgress) {
    const selectedNode = state.selected ? nodeElements.get(state.selected) : null;
    if (!selectedNode) return;
    const arm = Number.parseInt(selectedNode.dataset.arm || "0", 10);
    context.save();
    context.beginPath();
    for (let step = 0; step <= 84; step += 1) {
      const progress = 0.04 + step / 84 * 0.94;
      const point = mergerProgress > 0.5
        ? remnantPoint(progress, arm, centerX, centerY, radiusX * 0.92, radiusY * 0.78)
        : spiralPoint(progress, arm, centerX, centerY, radiusX, radiusY);
      if (step === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.strokeStyle = "rgba(176, 214, 255, 0.18)";
    context.lineWidth = 0.65;
    context.stroke();
    context.restore();
  }

  function drawParticleSet(context, particles, pointFor, time, alphaMultiplier = 1, distortion = 0) {
    context.save();
    context.globalCompositeOperation = "lighter";
    particles.forEach((particle) => {
      const point = pointFor(particle);
      const fade = particle.fade;
      const shimmer = reducedMotion.matches ? 1 : 0.9 + Math.sin(time * 0.00045 + particle.phase) * 0.1;
      const tidalX = distortion * Math.sin(particle.phase + particle.radius * 9) * (0.2 + particle.radius) * 20;
      const tidalY = distortion * Math.cos(particle.phase * 0.7 + particle.radius * 7) * (0.2 + particle.radius) * 11;
      const tone = particle.tone < 0.12 ? 2 : particle.tone < 0.42 ? 1 : 0;
      const size = particle.spriteSize;
      const alpha = particle.alpha * fade * shimmer * alphaMultiplier;
      if (canvasState.gpu) {
        canvasState.gpu.sprite(particle.spriteIndex, point.x + tidalX, point.y + tidalY, size, alpha);
        return;
      }
      context.globalAlpha = alpha;
      context.drawImage(canvasState.starSprites[tone][particle.variant],
        point.x + tidalX - size / 2, point.y + tidalY - size / 2, size, size);
    });
    context.restore();
  }

  function orbitalAngle(particle, companion = false) {
    const base = companion
      ? particle.arm * Math.PI + particle.radius * 7.3 - 1.08
      : particle.arm * Math.PI * 2 / geometry.arms + particle.radius * geometry.twist + geometry.phase;
    // The arms wind toward increasing angles outward, so orbit toward decreasing
    // angles to keep the arms trailing. The time scale is slow at rest.
    const frequency = particle.frequency ?? 1 / Math.pow(particle.radius * particle.radius + 0.25 * 0.25, 0.75);
    return base + particle.angleJitter - canvasState.elapsed * 0.012 * frequency;
  }

  function startEncounter() {
    const merger = canvasState.merger;
    if (!window.GalaxyDynamics || !canvasState.particles.length) return;
    const seeds = (particles, companion) => particles.map((particle) => ({
      radius: Math.max(0.06, particle.radius + particle.radialJitter),
      angle: orbitalAngle(particle, companion),
      spin: -1
    }));
    merger.encounter = new window.GalaxyDynamics.Encounter(
      seeds(canvasState.particles, false), seeds(canvasState.companionParticles, true)
    );
    merger.sprites = [...canvasState.particles, ...canvasState.companionParticles];
    canvasState.lastDraw = 0;
    merger.progress = 0;
    merger.settled = false;
    if (elements.motion) {
      elements.motion.disabled = false;
      elements.motion.textContent = canvasState.paused ? "Resume motion" : "Pause motion";
    }
    const field = elements.field.getBoundingClientRect();
    const hero = elements.hero.getBoundingClientRect();
    merger.nodeFrame = { width: field.width, height: field.height, x: field.left - hero.left, y: field.top - hero.top };
    merger.nodes = posts.map((post, index) => {
      const node = nodeElements.get(post.slug);
      const initial = nodePosition(index, posts.length);
      const x = (initial.x / 100 - geometry.centerX) / geometry.radiusX;
      const y = (initial.y / 100 - geometry.centerY) / geometry.radiusY;
      let closest = 0;
      let distance = Infinity;
      merger.encounter.particles.slice(0, canvasState.particles.length).forEach((star, i) => {
        const d = (star.x + 1.4 - x) ** 2 + (star.y + 0.25 - y) ** 2;
        if (d < distance) { distance = d; closest = i; }
      });
      node.getAnimations().forEach((animation) => animation.cancel());
      node.style.visibility = "";
      return { node, particle: closest, match: matches(post),
        targetX: parseFloat(node.style.getPropertyValue("--node-x")) / 100 * field.width,
        targetY: parseFloat(node.style.getPropertyValue("--node-y")) / 100 * field.height };
    });
    elements.hero.classList.add("is-encounter-choreography");
    elements.hero.dataset.encounterPhase = "approach";
    elements.hero.classList.add("is-merging");
    if (shouldAnimateGalaxy()) elements.hero.dataset.galaxyActivity = "running";
    if (!canvasState.animationFrame && shouldAnimateGalaxy()) {
      canvasState.animationFrame = requestAnimationFrame(animateGalaxy);
    }
  }

  function setMergerTarget(target, { replay = false } = {}) {
    const merger = canvasState.merger;
    const signature = JSON.stringify([state.category, state.query.trim(), state.savedOnly]);
    const changed = target !== merger.target || signature !== merger.signature;
    merger.target = target;
    merger.signature = signature;
    if (elements.replay) elements.replay.hidden = !target;
    if (!target || reducedMotion.matches) {
      merger.encounter = null;
      if (elements.motion) {
        elements.motion.disabled = reducedMotion.matches;
        elements.motion.textContent = canvasState.paused ? "Resume motion" : "Pause motion";
      }
      elements.hero.classList.remove("is-encounter-choreography");
      nodeElements.forEach((node) => {
        node.style.translate = "";
        node.style.opacity = "";
        node.style.visibility = target && !node.classList.contains("is-match") ? "hidden" : "";
      });
      merger.progress = target;
      elements.hero.dataset.encounterPhase = target ? "remnant" : "archive";
      elements.hero.classList.remove("is-merging");
    } else if (changed || replay || !merger.encounter) {
      startEncounter();
    }
    if (shouldAnimateGalaxy()) elements.hero.dataset.galaxyActivity = "running";
    if (!canvasState.animationFrame && shouldAnimateGalaxy()) {
      canvasState.lastDraw = 0;
      canvasState.animationFrame = requestAnimationFrame(animateGalaxy);
    }
  }

  function drawNucleus(context, x, y, radius, alpha = 1) {
    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = alpha;
    if (canvasState.gpu) {
      canvasState.gpu.sprite(10, x, y, radius * 2, alpha);
      canvasState.gpu.sprite(0, x, y, radius * 0.65, alpha);
      context.restore();
      return;
    }
    context.drawImage(canvasState.nucleusSprite, x - radius, y - radius, radius * 2, radius * 2);
    const size = radius * 0.65;
    context.drawImage(canvasState.starSprites[0][0], x - size / 2, y - size / 2, size, size);
    context.restore();
  }

  function drawEncounter(context, delta, centerX, centerY, radiusX, radiusY) {
    const merger = canvasState.merger;
    const encounter = merger.encounter;
    // Twelve simulation units in four wall-clock seconds. Keep each physics advance bounded.
    let remaining = Math.min(delta, 0.1) * 3;
    while (remaining > 0 && encounter.time < window.GalaxyDynamics.duration) {
      const step = Math.min(remaining, 0.1);
      encounter.advance(step);
      remaining -= step;
    }
    const phase = encounter.phase;
    const reveal = Math.min(1, encounter.time / 1.5);
    const ease = reveal * reveal * (3 - 2 * reveal);
    const zoom = 1 - ease * 0.52;
    const cameraX = -1.4 * (1 - ease);
    const cameraY = -0.25 * (1 - ease);
    const project = (star) => ({
      x: centerX + (star.x - cameraX) * radiusX * zoom,
      y: centerY + ((star.y - cameraY) * radiusY + star.z * radiusX * 0.28) * zoom
    });
    merger.progress = Math.min(1, encounter.time / window.GalaxyDynamics.duration);
    // Finish the physical encounter with an authored two-arm reading constellation.
    // This visual relaxation keeps the search endpoint legible, rather than claiming
    // that a collisionless gravitational remnant spontaneously forms a spiral disk.
    const settle = Math.max(0, (merger.progress - 0.58) / 0.42);
    const blend = settle * settle * (3 - 2 * settle);
    const stellarPoint = (star, particle) => {
      const physical = project(star);
      const spiral = remnantPoint(particle.radius, particle.arm % 2, centerX, centerY,
        radiusX * 0.92, radiusY * 0.78, particle.angleJitter * 0.45, particle.radialJitter * 0.5);
      return { x: physical.x + (spiral.x - physical.x) * blend,
        y: physical.y + (spiral.y - physical.y) * blend };
    };
    elements.hero.dataset.encounterPhase = phase;
    elements.hero.dataset.encounterTime = encounter.time.toFixed(2);
    elements.hero.dataset.encounterSeparation = encounter.separation.toFixed(3);
    elements.hero.classList.toggle("is-merging", phase !== "remnant");
    elements.hero.classList.add("has-stellar-encounter");
    context.save();
    context.globalCompositeOperation = "lighter";
    encounter.particles.forEach((star, index) => {
      const particle = merger.sprites[index];
      const point = stellarPoint(star, particle);
      // Escaped stars continue on their trajectories; only distant light fades from view.
      const distance = Math.hypot(star.x, star.y, star.z);
      const visibility = Math.min(1, Math.max(0, (7 - distance) / 3)) * (1 - blend) + blend;
      const tone = particle.tone < 0.12 ? 2 : particle.tone < 0.42 ? 1 : 0;
      const size = particle.spriteSize * (0.72 + zoom * 0.28);
      const alpha = particle.alpha * visibility * (star.galaxy === 1 ? Math.min(1, reveal * 3) : 1);
      if (canvasState.gpu) {
        canvasState.gpu.sprite(particle.spriteIndex, point.x, point.y, size, alpha);
        return;
      }
      context.globalAlpha = alpha;
      context.drawImage(canvasState.starSprites[tone][particle.variant], point.x - size / 2, point.y - size / 2, size, size);
    });
    context.restore();
    const frame = merger.nodeFrame;
    merger.nodes.forEach(({ node, particle, match, targetX, targetY }) => {
      const point = stellarPoint(encounter.particles[particle], merger.sprites[particle]);
      const dx = (point.x - frame.x - targetX) * (1 - blend);
      const dy = (point.y - frame.y - targetY) * (1 - blend);
      node.style.translate = `${dx.toFixed(2)}px ${dy.toFixed(2)}px`;
      node.style.opacity = match ? "1" : String(Math.max(0, 1 - merger.progress * 1.5));
      node.style.visibility = !match && merger.progress >= 2 / 3 ? "hidden" : "";
    });
    if (merger.progress >= 1) {
      elements.hero.classList.remove("is-encounter-choreography");
      elements.hero.dataset.galaxyActivity = "settled";
      if (!merger.settled) {
        merger.settled = true;
        if (elements.motion) { elements.motion.disabled = true; elements.motion.textContent = "Merge complete"; }
        scheduleLabelCollisions({ updateFocus: true });
      }
    }
    encounter.cores.forEach((core, index) => {
      const point = project(core);
      point.x += (centerX - point.x) * blend;
      point.y += (centerY - point.y) * blend;
      drawNucleus(context, point.x, point.y, Math.min(radiusX, radiusY) * 0.3,
        index === 1 ? Math.min(1, reveal * 3) : 1);
    });
  }

  function drawGalaxy(time) {
    const context = canvasState.context;
    if (!context || !canvasState.width || !canvasState.height) return;
    const delta = canvasState.lastDraw && shouldAnimateGalaxy()
      ? Math.min(0.1, Math.max(0, (time - canvasState.lastDraw) / 1000)) : 0;
    canvasState.lastDraw = time;
    canvasState.elapsed += delta;
    const parallax = canvasState.parallax;
    if (!reducedMotion.matches && !canvasState.paused) {
      parallax.x += (parallax.targetX - parallax.x) * 0.075;
      parallax.y += (parallax.targetY - parallax.y) * 0.075;
    } else if (reducedMotion.matches) {
      parallax.x = 0;
      parallax.y = 0;
    }
    for (const axis of ["x", "y"]) {
      const value = `${parallax[axis].toFixed(2)}px`;
      if (elements.hero.style.getPropertyValue(`--parallax-${axis}`) !== value) {
        elements.hero.style.setProperty(`--parallax-${axis}`, value);
      }
    }
    canvasState.gpu?.begin();
    context.setTransform(canvasState.dpr, 0, 0, canvasState.dpr, 0, 0);
    if (!canvasState.gpu || state.selected || canvasState.hadSelection) {
      context.clearRect(0, 0, canvasState.width, canvasState.height);
    }
    canvasState.hadSelection = Boolean(state.selected);
    const clock = canvasState.elapsed * 1000;
    const gpuOrbit = canvasState.gpu && !(canvasState.merger.target && canvasState.merger.encounter && !reducedMotion.matches);
    if (!gpuOrbit) canvasState.stars.forEach((star) => {
      const pulse = reducedMotion.matches ? 1 : 0.85 + Math.sin(clock * 0.0007 + star.phase) * 0.15;
      if (canvasState.gpu) {
        canvasState.gpu.sprite(9, star.x * canvasState.width, star.y * canvasState.height,
          star.radius * 128 / 60, star.alpha * pulse * 0.48);
        return;
      }
      context.beginPath();
      context.fillStyle = `rgba(195, 216, 239, ${star.alpha * pulse * 0.48})`;
      context.arc(star.x * canvasState.width, star.y * canvasState.height, star.radius, 0, Math.PI * 2);
      context.fill();
    });
    const { radiusX, radiusY } = canvasState.field;
    const centerX = canvasState.field.centerX + parallax.x;
    const centerY = canvasState.field.centerY + parallax.y;
    const merger = canvasState.merger;
    if (merger.target && merger.encounter && !reducedMotion.matches) {
      drawEncounter(context, delta, centerX, centerY, radiusX, radiusY);
    } else {
      if (elements.hero.classList.contains("has-stellar-encounter")) elements.hero.classList.remove("has-stellar-encounter");
      const phase = merger.target ? "remnant" : "archive";
      if (elements.hero.dataset.encounterPhase !== phase) elements.hero.dataset.encounterPhase = phase;
      drawSelectedArm(context, centerX, centerY, radiusX, radiusY, merger.target);
      if (gpuOrbit) {
        canvasState.gpu.orbit(Boolean(merger.target), centerX, centerY, radiusX, radiusY);
      } else {
        const particles = merger.target ? canvasState.remnantParticles : canvasState.particles;
        drawParticleSet(context, particles, (particle) => {
          const angle = orbitalAngle(particle, Boolean(merger.target));
          const radius = particle.radius + particle.radialJitter;
          return { x: centerX + Math.cos(angle) * radius * radiusX,
            y: centerY + Math.sin(angle) * radius * radiusY * (merger.target ? 0.78 : 1) };
        }, clock);
        drawNucleus(context, centerX, centerY, Math.min(radiusX, radiusY) * 0.4);
      }
    }
    canvasState.gpu?.flush();
    if (elements.phase) {
      const labels = { archive: "Stars in orbit", approach: "Two galaxies approaching", "first-passage": "First passage",
        "tidal-tails": "Tidal tails", coalescence: "Cores coalescing", remnant: "A shared galaxy" };
      const label = reducedMotion.matches ? "Motion reduced" : canvasState.paused ? "Motion paused" : labels[elements.hero.dataset.encounterPhase];
      if (elements.phase.textContent !== label) elements.phase.textContent = label;
    }
  }

  function drawGalaxyIfVisible(time = performance.now()) {
    if (!canvasState.intersectsViewport || document.hidden) return;
    drawGalaxy(time);
  }

  function animateGalaxy(time) {
    canvasState.animationFrame = 0;
    if (!shouldAnimateGalaxy()) return;
    if (time - canvasState.lastFrame >= canvasState.frameInterval) {
      canvasState.lastFrame = time;
      drawGalaxy(time);
    }
    canvasState.animationFrame = window.requestAnimationFrame(animateGalaxy);
  }

  function shouldAnimateGalaxy() {
    return canvasState.intersectsViewport && !document.hidden && !reducedMotion.matches && !canvasState.paused
      && !(canvasState.merger.encounter && canvasState.merger.progress >= 1);
  }

  function stopGalaxy() {
    window.cancelAnimationFrame(canvasState.animationFrame);
    canvasState.animationFrame = 0;
  }

  function syncGalaxyActivity({ drawStaticFrame = true } = {}) {
    stopGalaxy();
    canvasState.lastDraw = 0;
    if (reducedMotion.matches) {
      setMergerTarget(canvasState.merger.target);
      elements.hero.classList.remove("is-merging");
    }
    if (elements.motion) {
      elements.motion.disabled = reducedMotion.matches || Boolean(canvasState.merger.encounter && canvasState.merger.settled);
      elements.motion.textContent = canvasState.merger.encounter && canvasState.merger.settled ? "Merge complete" : canvasState.paused ? "Resume motion" : "Pause motion";
      elements.motion.setAttribute("aria-pressed", String(canvasState.paused));
    }
    if (elements.replay) elements.replay.disabled = reducedMotion.matches;
    const active = shouldAnimateGalaxy();
    elements.hero.dataset.galaxyActivity = active ? "running" : "paused";
    if (drawStaticFrame) drawGalaxyIfVisible();
    if (active) canvasState.animationFrame = window.requestAnimationFrame(animateGalaxy);
  }

  function startGalaxy() {
    stopGalaxy();
    canvasState.startedAt = performance.now();
    canvasState.lastFrame = 0;
    resizeCanvas();
    syncGalaxyActivity({ drawStaticFrame: false });
  }

  function observeGalaxyVisibility() {
    const heroRect = elements.hero.getBoundingClientRect();
    canvasState.intersectsViewport = heroRect.bottom > 0 && heroRect.top < window.innerHeight;
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      const intersectsViewport = Boolean(entries[0]?.isIntersecting);
      if (intersectsViewport === canvasState.intersectsViewport) return;
      canvasState.intersectsViewport = intersectsViewport;
      syncGalaxyActivity();
    });
    observer.observe(elements.hero);
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
      duration = 1050;
    } else {
      first = orbitalNodePosition(from, direction * -0.72, wasFiltered ? 0.88 : 0.98);
      second = orbitalNodePosition(to, direction * 0.34, 1.08);
      opacityStops = [from.opacity, Math.max(0.34, from.opacity), 0.82, 1];
      duration = 900;
    }

    const delay = Math.min(180, index * 10);
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
    const startedAt = performance.now();
    elements.field.dataset.labelLayoutState = "running";
    const fieldRect = elements.field.getBoundingClientRect();
    const narrow = fieldRect.width <= 480;
    const nudges = narrow
      ? [0, -14, 14, -28, 28, -42, 42, -56, 56, -70, 70, -84, 84, -98, 98, -112, 112, -126, 126, -140, 140, -154, 154, -168, 168, -182, 182]
      : [0, -16, 16, -30, 30, -46, 46, -62, 62];
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize || "16");
    const descriptors = [...nodeElements.values()]
      .filter((node) => !node.classList.contains("is-muted"))
      .map((node) => {
      const label = node.querySelector(".galaxy-node__label");
      if (!label) return null;
      const nodeRect = node.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      const nodeStyle = getComputedStyle(node);
      const nodeSize = Number.parseFloat(nodeStyle.getPropertyValue("--node-size"))
        * rootFontSize;
      const centerX = nodeRect.left + nodeRect.width / 2;
      const centerY = nodeRect.top + nodeRect.height / 2;
      const labelWidth = labelRect.width;
      const labelHeight = labelRect.height;
      const current = node.dataset.labelSide || "right";
      const alternatives = [current, "right", "left", "above", "below"].filter((side, index, values) => values.indexOf(side) === index);
      const candidates = [];

      alternatives.forEach((side) => {
        nudges.forEach((nudge) => {
          const vertical = side === "left" || side === "right";
          const nudgeX = vertical ? 0 : nudge;
          const nudgeY = vertical ? nudge : 0;
          const horizontalGap = nodeSize * 0.52;
          const verticalGap = nodeSize * 0.45;
          let left = centerX + horizontalGap;
          let top = centerY - labelHeight / 2 + nudgeY;
          if (side === "left") left = centerX - horizontalGap - labelWidth;
          if (side === "above") {
            left = centerX - labelWidth / 2 + nudgeX;
            top = centerY - verticalGap - labelHeight;
          }
          if (side === "below") {
            left = centerX - labelWidth / 2 + nudgeX;
            top = centerY + verticalGap;
          }
          const rect = {
            bottom: top + labelHeight,
            height: labelHeight,
            left,
            right: left + labelWidth,
            top,
            width: labelWidth
          };
          const inBounds = rect.left >= fieldRect.left + 3
            && rect.right <= fieldRect.right - 3
            && rect.top >= fieldRect.top + 3
            && rect.bottom <= fieldRect.bottom - 3;
          if (!inBounds) return;
          const sideCost = side === current ? 0 : (side === "left" || side === "right") === (current === "left" || current === "right") ? 1.2 : 2.4;
          candidates.push({
            cost: sideCost + Math.abs(nudge) * 0.012,
            nudgeX,
            nudgeY,
            rect,
            side
          });
        });
      });

      candidates.sort((left, right) => left.cost - right.cost);
      return {
        candidates,
        label,
        minutes: Number(node.dataset.readingMinutes),
        node
      };
    })
      .filter(Boolean)
      .sort((left, right) => left.candidates.length - right.candidates.length || right.minutes - left.minutes);

    const placements = [];
    descriptors.forEach((descriptor) => {
      const best = descriptor.candidates.reduce((choice, candidate) => {
        const collisions = placements.reduce((total, placement) => total + overlapArea(candidate.rect, placement.candidate.rect, 2), 0);
        const score = collisions * 1000 + candidate.cost;
        return !choice || score < choice.score ? { candidate, score } : choice;
      }, null);
      if (best) placements.push({ ...descriptor, candidate: best.candidate });
    });

    const collisionScore = (candidate, index, ceiling = Number.POSITIVE_INFINITY) => {
      let total = 0;
      for (let candidateIndex = 0; candidateIndex < placements.length; candidateIndex += 1) {
        if (candidateIndex === index) continue;
        total += overlapArea(candidate.rect, placements[candidateIndex].candidate.rect, 2);
        if (total >= ceiling) break;
      }
      return total;
    };

    for (let pass = 0; pass < placements.length; pass += 1) {
      let moved = false;
      placements.forEach((placement, index) => {
        const currentCollision = collisionScore(placement.candidate, index);
        if (currentCollision <= 0) return;
        let bestCandidate = placement.candidate;
        let bestCollision = currentCollision;
        let bestScore = currentCollision * 1000 + placement.candidate.cost;
        for (const candidate of placement.candidates) {
          const collision = collisionScore(candidate, index, bestCollision || Number.POSITIVE_INFINITY);
          const score = collision * 1000 + candidate.cost;
          if (score >= bestScore) continue;
          bestCandidate = candidate;
          bestCollision = collision;
          bestScore = score;
          if (collision === 0) break;
        }
        if (bestCandidate === placement.candidate) return;
        placement.candidate = bestCandidate;
        moved = true;
      });
      if (!moved) break;
    }

    placements.forEach(({ candidate, label, node }) => {
      node.dataset.labelSide = candidate.side;
      label.style.setProperty("--label-nudge-x", `${candidate.nudgeX}px`);
      label.style.setProperty("--label-nudge-y", `${candidate.nudgeY}px`);
    });

    let overlapCount = 0;
    let clippedCount = descriptors.length - placements.length;
    const accepted = placements.map((placement) => placement.candidate.rect);
    accepted.forEach((rect, index) => {
      if (rect.left < fieldRect.left + 2 || rect.right > fieldRect.right - 2
        || rect.top < fieldRect.top + 2 || rect.bottom > fieldRect.bottom - 2) clippedCount += 1;
      for (let candidate = index + 1; candidate < accepted.length; candidate += 1) {
        if (overlapArea(rect, accepted[candidate], 2) > 0) overlapCount += 1;
      }
    });
    elements.field.dataset.labelOverlapCount = String(overlapCount);
    elements.field.dataset.labelClippedCount = String(clippedCount);
    elements.field.dataset.labelLayoutMs = (performance.now() - startedAt).toFixed(2);
    elements.field.dataset.labelPlacementCount = String(placements.length);
    elements.field.dataset.labelLayoutRuns = String(Number(elements.field.dataset.labelLayoutRuns || "0") + 1);
    elements.field.dataset.labelLayoutState = "settled";
  }

  function scheduleLabelCollisions({ delay = 0, updateFocus = false } = {}) {
    window.clearTimeout(layoutTimer);
    window.cancelAnimationFrame(layoutFrame);
    layoutTimer = 0;
    layoutFrame = 0;
    elements.field.dataset.labelLayoutState = "scheduled";
    // Measure once the particle-bound nodes reach their readable result positions.
    if (canvasState.merger.encounter && !canvasState.merger.settled) return;
    const queueFrame = () => {
      layoutTimer = 0;
      layoutFrame = window.requestAnimationFrame(() => {
        layoutFrame = 0;
        resolveLabelCollisions();
        if (updateFocus) positionFocus();
      });
    };
    if (delay > 0) layoutTimer = window.setTimeout(queueFrame, delay);
    else queueFrame();
  }

  function syncCategoryRailAffordance() {
    const rail = elements.categories;
    const overflow = rail.scrollWidth - rail.clientWidth;
    if (overflow <= 2) {
      rail.dataset.railState = "fit";
      elements.tuner.dataset.categoryRailState = "fit";
      return;
    }
    const atStart = rail.scrollLeft <= 2;
    const atEnd = rail.scrollLeft >= overflow - 2;
    rail.dataset.railState = atStart ? "start" : atEnd ? "end" : "middle";
    elements.tuner.dataset.categoryRailState = rail.dataset.railState;
  }

  function revealActiveCategory() {
    if (!mobileLayout.matches) return;
    const active = state.savedOnly
      ? elements.savedFilter
      : elements.categories.querySelector(`button[data-category="${CSS.escape(state.category)}"]`);
    if (!active) return;
    window.requestAnimationFrame(() => {
      const railRect = elements.categories.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      const centeredLeft = elements.categories.scrollLeft
        + activeRect.left - railRect.left
        - (railRect.width - activeRect.width) / 2;
      elements.categories.scrollLeft = Math.max(0, centeredLeft);
      syncCategoryRailAffordance();
    });
  }

  function createNode(post, index) {
    const position = nodePosition(index, posts.length);
    const minutes = minutesFor(post);
    const visibleLabel = nodeLabel(post);
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
    node.setAttribute("aria-label", `${visibleLabel}. ${post.title}. ${post.date}, ${displayCategory(post.category)}, ${post.readingTime || "reading time unavailable"}.`);
    node.setAttribute("aria-pressed", "false");
    node.title = post.title;
    node.append(text("span", "galaxy-node__label", visibleLabel));
    nodeElements.set(post.slug, node);
    elements.nodes.append(node);
  }

  function createEntryActions(post) {
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
    return actions;
  }

  function enhanceEntry(entry, post) {
    entry.dataset.slug = post.slug;
    entry.dataset.blogSlug = post.slug;
    entry.dataset.blogSelected = "false";
    entry.style.setProperty("--entry-color", categoryColors[post.category] || categoryColors.technical);

    const body = entry.querySelector(".galaxy-entry__body");
    if (body && !body.querySelector(".galaxy-entry__actions")) body.append(createEntryActions(post));

    const media = entry.querySelector(".galaxy-entry__media");
    const image = media?.querySelector("img");
    entry.classList.toggle("has-media", Boolean(image));
    entry.dataset.hasMedia = String(Boolean(image));
    if (image && !observedEntryImages.has(image)) {
      const removeBrokenMedia = () => {
        media.remove();
        entry.classList.remove("has-media");
        entry.dataset.hasMedia = "false";
      };
      image.addEventListener("error", removeBrokenMedia, { once: true });
      observedEntryImages.add(image);
      if (image.complete && image.currentSrc && image.naturalWidth === 0) removeBrokenMedia();
    }

    entryElements.set(post.slug, entry);
    return entry;
  }

  function createEntry(post) {
    const entry = document.createElement("article");
    const source = heroSource(post);
    entry.className = "galaxy-entry";

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
      const topics = document.createElement("ul");
      topics.className = "galaxy-entry__topics";
      topics.setAttribute("aria-label", "Topics");
      post.topics.forEach((topic) => topics.append(text("li", "", topic)));
      body.append(topics);
    }
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
      media.append(image);
      entry.append(media);
    }

    return enhanceEntry(entry, post);
  }

  function syncEntries() {
    entryElements.clear();
    const existingEntries = new Map();
    [...elements.list.querySelectorAll(":scope > article")].forEach((entry) => {
      const slug = String(entry.dataset.blogSlug || entry.dataset.slug || "").trim();
      if (slug && !existingEntries.has(slug)) existingEntries.set(slug, entry);
    });

    const orderedEntries = posts.map((post) => {
      const existing = existingEntries.get(post.slug);
      return existing ? enhanceEntry(existing, post) : createEntry(post);
    });
    const expectedEntries = new Set(orderedEntries);
    [...elements.list.children].forEach((child) => {
      if (!expectedEntries.has(child)) child.remove();
    });
    orderedEntries.forEach((entry, index) => {
      const current = elements.list.children[index];
      if (current !== entry) elements.list.insertBefore(entry, current || null);
    });
  }

  function createCategories() {
    const counts = new Map();
    posts.forEach((post) => counts.set(post.category, (counts.get(post.category) || 0) + 1));
    const categories = [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    const appendCategory = ([category, count]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.category = category;
      button.style.setProperty("--node-color", categoryColors[category] || categoryColors.technical);
      button.textContent = `${category === "all" ? "all writing" : displayCategory(category)} ${count}`;
      button.setAttribute("aria-pressed", String(category === state.category));
      elements.categories.append(button);
    };

    appendCategory(["all", posts.length]);

    const savedButton = document.createElement("button");
    savedButton.type = "button";
    savedButton.dataset.savedFilter = "";
    savedButton.style.setProperty("--node-color", categoryColors.technical);
    savedButton.append(
      text("span", "galaxy-saved-filter__label", "saved reading"),
      text("span", "galaxy-saved-filter__count", "0")
    );
    elements.categories.append(savedButton);
    categories.forEach(appendCategory);
    elements.categories.setAttribute("aria-label", "Filter writing by category or saved status");
    elements.savedFilter = savedButton;

    const savedStatus = text("output", "galaxy-saved-status", "0 saved entries");
    savedStatus.id = "galaxy-saved-count";
    savedStatus.setAttribute("aria-live", "polite");
    elements.categories.after(savedStatus);
    elements.savedStatus = savedStatus;
  }

  function updateBookmarkControls() {
    elements.list.querySelectorAll("button[data-bookmark-slug]").forEach((button) => {
      const bookmarked = bookmarks.has(button.dataset.bookmarkSlug);
      button.setAttribute("aria-pressed", String(bookmarked));
      button.textContent = bookmarked ? "Bookmarked" : "Bookmark";
    });
  }

  function updateSavedFilter() {
    const savedCount = posts.filter((post) => bookmarks.has(post.slug)).length;
    const noun = savedCount === 1 ? "entry" : "entries";
    elements.savedFilter?.setAttribute("aria-pressed", String(state.savedOnly));
    elements.savedFilter?.removeAttribute("aria-label");
    const visibleCount = elements.savedFilter?.querySelector(".galaxy-saved-filter__count");
    if (visibleCount) visibleCount.textContent = String(savedCount);
    if (elements.savedStatus) elements.savedStatus.textContent = `${savedCount} saved ${noun}`;
  }

  function positionFocus() {
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
    const headerBottom = document.querySelector("#site-topbar")?.getBoundingClientRect().bottom || 0;
    const safeViewportTop = headerBottom + 8;
    const minimumTop = Math.max(margin, safeViewportTop - fieldRect.top);
    const maximumTop = Math.min(
      fieldRect.height - popupHeight - margin,
      window.innerHeight - fieldRect.top - popupHeight - 8
    );
    left = Math.max(margin, Math.min(fieldRect.width - popupWidth - margin, left));
    top = Math.max(minimumTop, Math.min(Math.max(minimumTop, maximumTop), top));
    elements.focus.style.setProperty("--focus-left", `${left}px`);
    elements.focus.style.setProperty("--focus-top", `${top}px`);
    elements.focus.dataset.placement = placement;
  }

  function cancelFocusFraming() {
    window.cancelAnimationFrame(focusFrame);
    window.clearTimeout(focusTimer);
    focusFrame = 0;
    focusTimer = 0;
    focusFrameGeneration += 1;
    document.documentElement.removeAttribute("data-galaxy-focus-framing");
  }

  function scheduleFocusFraming() {
    cancelFocusFraming();
    if (elements.focus.hidden || !state.selected) return;
    const generation = focusFrameGeneration;
    const root = document.documentElement;
    root.dataset.galaxyFocusFraming = "true";
    elements.focus.dataset.frameState = "framing";
    let attempts = 0;
    let previousTop = null;
    let stableFrames = 0;

    const settle = () => {
      if (generation !== focusFrameGeneration || elements.focus.hidden || !state.selected) return;
      attempts += 1;
      positionFocus();
      const headerBottom = document.querySelector("#site-topbar")?.getBoundingClientRect().bottom || 0;
      let bounds = elements.focus.getBoundingClientRect();
      const safeTop = headerBottom + 8;
      const safeBottom = window.innerHeight - 8;
      const delta = bounds.top < safeTop
        ? bounds.top - safeTop
        : bounds.bottom > safeBottom
          ? bounds.bottom - safeBottom
          : 0;
      if (Math.abs(delta) > 1) {
        window.scrollTo({ left: window.scrollX, top: window.scrollY + delta, behavior: "auto" });
        positionFocus();
        bounds = elements.focus.getBoundingClientRect();
      }
      const fieldBounds = elements.field.getBoundingClientRect();
      const safelyFramed = bounds.top >= safeTop - 1
        && bounds.bottom <= safeBottom + 1
        && bounds.top >= fieldBounds.top - 1
        && bounds.bottom <= fieldBounds.bottom + 1;
      const stable = previousTop !== null && Math.abs(bounds.top - previousTop) <= 0.5;
      stableFrames = safelyFramed && stable ? stableFrames + 1 : 0;
      previousTop = bounds.top;
      elements.focus.dataset.frameAttempts = String(attempts);
      if (stableFrames >= 2 || attempts >= 10) {
        elements.focus.dataset.frameState = safelyFramed ? "settled" : "unframed";
        root.removeAttribute("data-galaxy-focus-framing");
        window.clearTimeout(focusTimer);
        focusFrame = 0;
        focusTimer = 0;
        return;
      }
      focusFrame = window.requestAnimationFrame(settle);
    };

    focusFrame = window.requestAnimationFrame(settle);
    focusTimer = window.setTimeout(() => {
      if (generation !== focusFrameGeneration || elements.focus.dataset.frameState === "settled") return;
      window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(settle);
    }, 240);
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
      cancelFocusFraming();
      elements.focus.hidden = true;
      drawGalaxyIfVisible();
      return;
    }
    elements.focusMeta.textContent = `${post.date} · ${displayCategory(post.category)} · ${post.readingTime || "reading time unavailable"}`;
    elements.focusTitle.textContent = post.title;
    elements.focusSummary.textContent = post.summary || "";
    elements.focusTopics.textContent = (post.topics || []).join(" · ");
    elements.focusTopics.hidden = !(post.topics || []).length;
    elements.focusLink.href = articleUrl(post);
    elements.focus.hidden = false;
    drawGalaxyIfVisible();
    positionFocus();
    scheduleFocusFraming();
  }

  function render() {
    const visible = posts.filter(matches);
    const visibleSlugs = new Set(visible.map((post) => post.slug));
    const activeEntry = document.activeElement instanceof Element
      ? document.activeElement.closest(".galaxy-entry")
      : null;
    const activeSlug = String(activeEntry?.dataset.slug || "");
    const previouslyVisibleSlugs = posts
      .map((post) => post.slug)
      .filter((slug) => !entryElements.get(slug)?.hidden);
    const activeVisibleIndex = previouslyVisibleSlugs.indexOf(activeSlug);
    const needsSavedFocusHandoff = state.savedOnly
      && activeVisibleIndex >= 0
      && !visibleSlugs.has(activeSlug);
    if (state.selected && !visibleSlugs.has(state.selected)) {
      state.selected = "";
      writeUrl("replaceState");
    }
    const filtered = state.category !== "all" || state.savedOnly || Boolean(normalize(state.query));
    const wasFiltered = elements.hero.dataset.merger === "remnant";
    const canChoreograph = !filtered && hasRendered && !reducedMotion.matches && !canvasState.paused && typeof Element.prototype.animate === "function";
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
      node.style.translate = "";
      node.style.opacity = "";
      node.style.visibility = filtered && !isVisible && reducedMotion.matches ? "hidden" : "";
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
    let savedFocusTarget = null;
    if (needsSavedFocusHandoff) {
      const nextSlug = visible[activeVisibleIndex]?.slug || visible[activeVisibleIndex - 1]?.slug || "";
      savedFocusTarget = nextSlug
        ? entryElements.get(nextSlug)?.querySelector("button[data-bookmark-slug]")
        : null;
      if (!savedFocusTarget) savedFocusTarget = elements.savedFilter;
    }
    elements.categories.querySelectorAll("button[data-category]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.category === state.category));
    });
    updateSavedFilter();
    elements.count.textContent = `${visible.length} ${visible.length === 1 ? "entry" : "entries"}`;
    elements.status.textContent = visible.length
      ? `[${visible.length} ${state.savedOnly ? "saved " : ""}published ${visible.length === 1 ? "entry" : "entries"} · engineering, systems, and life]`
      : `[no ${state.savedOnly ? "saved " : ""}published entry matches these filters]`;
    elements.empty.textContent = state.savedOnly
      ? (posts.some((post) => bookmarks.has(post.slug)) ? "No saved reading matches these filters." : "No saved reading yet. Bookmark an entry to add it to this constellation.")
      : "No writing matches that subject yet.";
    elements.empty.hidden = visible.length !== 0;
    savedFocusTarget?.focus({ preventScroll: true });
    revealActiveCategory();
    elements.hero.dataset.merger = filtered ? "remnant" : "archive";
    setMergerTarget(filtered ? 1 : 0);
    if (reducedMotion.matches) drawGalaxyIfVisible();
    renderFocus();
    window.clearTimeout(choreographyTimer);
    if (canChoreograph) {
      choreographyTimer = window.setTimeout(() => {
        elements.hero.classList.remove("is-node-choreography");
      }, longestChoreography + 80);
    } else {
      elements.hero.classList.remove("is-node-choreography");
    }
    scheduleLabelCollisions({
      delay: canChoreograph && !reducedMotion.matches ? longestChoreography + 60 : 0,
      updateFocus: true
    });
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

  function toggleBookmark(slug) {
    if (!posts.some((post) => post.slug === slug)) return;
    if (bookmarks.has(slug)) bookmarks.delete(slug);
    else bookmarks.add(slug);
    saveBookmarks();
    updateBookmarkControls();
    updateSavedFilter();
    if (state.savedOnly) render();
  }

  function bindEvents() {
    elements.motion = document.getElementById("galaxy-motion");
    elements.replay = document.getElementById("galaxy-replay");
    elements.phase = document.getElementById("galaxy-phase");
    document.querySelector(".galaxy-playback")?.removeAttribute("hidden");
    elements.motion?.addEventListener("click", () => {
      canvasState.paused = !canvasState.paused;
      syncGalaxyActivity();
    });
    elements.replay?.addEventListener("click", () => {
      canvasState.paused = false;
      setMergerTarget(1, { replay: true });
      syncGalaxyActivity();
      elements.core.scrollIntoView({ behavior: "smooth", block: "center" });
    });
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
      searchTimer = window.setTimeout(render, reducedMotion.matches ? 0 : (mobileLayout.matches ? 120 : 260));
    });
    elements.tuner.addEventListener("submit", (event) => {
      event.preventDefault();
      window.clearTimeout(searchTimer);
      state.query = elements.search.value.slice(0, 160);
      writeUrl();
      render();
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
      render();
      elements.search.focus();
    }));
    elements.categories.addEventListener("click", (event) => {
      const savedFilter = event.target.closest("button[data-saved-filter]");
      if (savedFilter) {
        state.savedOnly = !state.savedOnly;
        writeUrl("pushState");
        render();
        return;
      }
      const button = event.target.closest("button[data-category]");
      if (!button || button.dataset.category === state.category) return;
      state.category = button.dataset.category;
      writeUrl("pushState");
      render();
    });
    elements.categories.addEventListener("scroll", syncCategoryRailAffordance, { passive: true });
    elements.list.addEventListener("click", (event) => {
      const share = event.target.closest("button[data-share-slug]");
      if (share) {
        sharePost(share.dataset.shareSlug, share);
        return;
      }
      const bookmark = event.target.closest("button[data-bookmark-slug]");
      if (bookmark) toggleBookmark(bookmark.dataset.bookmarkSlug);
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
    window.addEventListener("resize", () => {
      resizeCanvas();
      syncCategoryRailAffordance();
    }, { passive: true });
    document.addEventListener("visibilitychange", syncGalaxyActivity);
    window.addEventListener("popstate", () => {
      const next = readUrlState();
      state.category = next.category;
      state.query = next.query;
      state.savedOnly = next.savedOnly;
      state.selected = next.selected;
      elements.search.value = state.query;
      render();
    });
    window.addEventListener("storage", (event) => {
      if (event.key !== BOOKMARKS_KEY && !LEGACY_BOOKMARKS_KEYS.includes(event.key)) return;
      bookmarks = loadBookmarks();
      updateBookmarkControls();
      render();
    });
    reducedMotion.addEventListener?.("change", syncGalaxyActivity);
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

    bookmarks = loadBookmarks();
    posts.forEach((post, index) => {
      createNode(post, index);
    });
    syncEntries();
    createCategories();
    syncCategoryRailAffordance();

    const years = posts.map((post) => Number(String(post.date).slice(0, 4))).filter(Number.isFinite);
    elements.total.textContent = `${posts.length} published entries`;
    elements.range.textContent = `${Math.min(...years)} → ${Math.max(...years)}`;
    elements.tuner.hidden = false;
    elements.field.hidden = false;
    elements.field.dataset.ready = "true";

    const initial = readUrlState();
    state.category = initial.category;
    state.query = initial.query;
    state.savedOnly = initial.savedOnly;
    state.selected = initial.selected;
    elements.search.value = state.query;
    writeUrl();
    bindBrowseHandoff();
    bindEvents();
    resizeCanvas();
    render();
    observeGalaxyVisibility();
    startGalaxy();
    requestAnimationFrame(syncCategoryRailAffordance);
    document.fonts?.ready.then(() => scheduleLabelCollisions({ updateFocus: true }));
  }

  init().catch((error) => {
    console.error("Spiral galaxy archive unavailable", error);
    elements.list.innerHTML = '<p class="galaxy-empty">The archive could not be loaded here. <a href="/blog/">Open the current Logs page.</a></p>';
  });
})();
