(() => {
  "use strict";

  const posts = Array.isArray(window.AC_LOG_POSTS) ? window.AC_LOG_POSTS : [];
  if (!posts.length) return;

  const elements = {
    categories: document.getElementById("nebula-categories"),
    chronology: document.getElementById("nebula-chronology-list"),
    chronologyStatus: document.getElementById("nebula-chronology-status"),
    count: document.getElementById("nebula-result-count"),
    field: document.getElementById("nebula-field"),
    focus: document.getElementById("nebula-focus"),
    focusLink: document.getElementById("nebula-focus-link"),
    focusMeta: document.getElementById("nebula-focus-meta"),
    focusSummary: document.getElementById("nebula-focus-summary"),
    focusTitle: document.getElementById("nebula-focus-title"),
    focusTopics: document.getElementById("nebula-focus-topics"),
    release: document.getElementById("nebula-release"),
    search: document.getElementById("nebula-search"),
    tuner: document.getElementById("nebula-tuner")
  };

  if (Object.values(elements).some((element) => !element)) return;

  const displayCategory = (category) => category === "work" ? "portfolio" : category;
  const normalize = (value) => String(value || "").trim().toLocaleLowerCase("en-US");
  const articleUrl = (post) => `/blog/${encodeURIComponent(post.slug)}.html`;
  const state = { category: "all", query: "", target: "" };
  const nodeBySlug = new Map();
  let lastSelectedNode = null;
  let focusPositionTimer = 0;

  function matches(post) {
    if (state.category !== "all" && post.category !== state.category) return false;
    const needle = normalize(state.query);
    if (!needle) return true;
    return normalize([post.title, post.summary, post.category, ...post.topics].join(" ")).includes(needle);
  }

  function basePosition(index) {
    const ratio = Math.sqrt((index + 1) / posts.length);
    const angle = -0.9 + index * 2.399963229728653;
    return {
      x: 52 + Math.cos(angle) * (44 * ratio),
      y: 54 + Math.sin(angle) * (40 * ratio)
    };
  }

  function condensedPosition(index, total) {
    const ratio = Math.sqrt((index + 1) / Math.max(total, 1));
    const angle = -1.2 + index * 2.399963229728653;
    return {
      x: 57 + Math.cos(angle) * (10 + 25 * ratio),
      y: 56 + Math.sin(angle) * (7 + 20 * ratio)
    };
  }

  function readingMinutes(post) {
    const minutes = Number.parseInt(String(post.readingTime || "").match(/\d+/)?.[0] || "1", 10);
    return Math.min(12, Math.max(1, minutes));
  }

  function labelSide(position, index) {
    if (position.x > 82) return "left";
    if (position.x < 30) return "right";
    if (position.y < 20) return "below";
    if (position.y > 84) return "above";
    return ["right", "left", "below", "above"][index % 4];
  }

  function setHistory(mode = "replace") {
    const url = new URL(window.location.href);
    if (state.query) url.searchParams.set("q", state.query);
    else url.searchParams.delete("q");
    if (state.category !== "all") url.searchParams.set("category", state.category);
    else url.searchParams.delete("category");
    if (state.target) url.searchParams.set("target", state.target);
    else url.searchParams.delete("target");
    window.history[mode === "push" ? "pushState" : "replaceState"]({ ...state }, "", url);
  }

  function renderFocus() {
    const post = posts.find((candidate) => candidate.slug === state.target);
    nodeBySlug.forEach((node, slug) => node.setAttribute("aria-pressed", String(slug === state.target)));
    if (!post) {
      elements.focus.hidden = true;
      return;
    }

    elements.focusMeta.textContent = `${post.date} · ${displayCategory(post.category)} · ${post.readingTime}`;
    elements.focusTitle.textContent = post.title;
    elements.focusSummary.textContent = post.summary;
    elements.focusTopics.textContent = post.topics.length ? post.topics.join(" · ") : "No topic labels";
    elements.focusLink.href = articleUrl(post);
    elements.focus.hidden = false;
    requestAnimationFrame(positionFocus);
    window.clearTimeout(focusPositionTimer);
    focusPositionTimer = window.setTimeout(positionFocus, 580);
  }

  function positionFocus() {
    const node = state.target ? nodeBySlug.get(state.target) : null;
    const stage = document.querySelector(".nebula-stage");
    if (!node || !stage || elements.focus.hidden) return;
    const stageRect = stage.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const focusWidth = elements.focus.offsetWidth;
    const focusHeight = elements.focus.offsetHeight;
    const gap = 16;
    const margin = 12;
    const anchorX = nodeRect.left - stageRect.left + nodeRect.width / 2;
    const anchorY = nodeRect.top - stageRect.top + nodeRect.height / 2;
    const rightSpace = stageRect.width - anchorX - nodeRect.width / 2 - gap - margin;
    const leftSpace = anchorX - nodeRect.width / 2 - gap - margin;
    const belowSpace = stageRect.height - anchorY - nodeRect.height / 2 - gap - margin;
    let placement = rightSpace >= focusWidth ? "right" : leftSpace >= focusWidth ? "left" : belowSpace >= focusHeight ? "below" : "above";
    let left = anchorX + nodeRect.width / 2 + gap;
    let top = anchorY - Math.min(60, focusHeight * .25);
    if (placement === "left") left = anchorX - nodeRect.width / 2 - gap - focusWidth;
    if (placement === "below") { left = anchorX - focusWidth / 2; top = anchorY + nodeRect.height / 2 + gap; }
    if (placement === "above") { left = anchorX - focusWidth / 2; top = anchorY - nodeRect.height / 2 - gap - focusHeight; }
    left = Math.max(margin, Math.min(stageRect.width - focusWidth - margin, left));
    top = Math.max(margin, Math.min(stageRect.height - focusHeight - margin, top));
    elements.focus.style.setProperty("--focus-left", `${left}px`);
    elements.focus.style.setProperty("--focus-top", `${top}px`);
    elements.focus.dataset.placement = placement;
  }

  function render() {
    const filtered = posts.filter(matches);
    const filteredSlugs = new Set(filtered.map((post) => post.slug));
    const activeFilter = Boolean(normalize(state.query)) || state.category !== "all";

    posts.forEach((post, index) => {
      const node = nodeBySlug.get(post.slug);
      const matchIndex = filtered.findIndex((candidate) => candidate.slug === post.slug);
      const position = activeFilter && matchIndex >= 0
        ? condensedPosition(matchIndex, filtered.length)
        : basePosition(index);

      node.style.setProperty("--node-x", `${position.x.toFixed(3)}%`);
      node.style.setProperty("--node-y", `${position.y.toFixed(3)}%`);
      node.dataset.labelSide = labelSide(position, index);
      node.classList.toggle("is-muted", !filteredSlugs.has(post.slug));
      node.classList.toggle("is-match", activeFilter && filteredSlugs.has(post.slug));
      node.tabIndex = filteredSlugs.has(post.slug) ? 0 : -1;
    });

    elements.chronology.querySelectorAll("[data-post]").forEach((entry) => {
      entry.hidden = !filteredSlugs.has(entry.dataset.post);
    });

    elements.categories.querySelectorAll("button[data-category]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.category === state.category));
    });

    if (state.target && !filteredSlugs.has(state.target)) state.target = "";
    elements.count.textContent = `${filtered.length} ${filtered.length === 1 ? "signal" : "signals"} visible`;
    elements.chronologyStatus.textContent = activeFilter
      ? `${filtered.length} of ${posts.length} published entries match.`
      : "Engineering systems, delivery notes, reflective essays, and field observations from 2022 to the present.";
    renderFocus();
  }

  function selectPost(slug, mode = "push") {
    if (!posts.some((post) => post.slug === slug)) return;
    state.target = slug;
    lastSelectedNode = nodeBySlug.get(slug) || null;
    renderFocus();
    setHistory(mode);
  }

  function releaseTarget(mode = "push", restoreFocus = false) {
    state.target = "";
    renderFocus();
    setHistory(mode);
    if (restoreFocus) lastSelectedNode?.focus({ preventScroll: true });
  }

  function makeCategories() {
    const categories = ["all", ...new Set(posts.map((post) => post.category))];
    categories.forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.category = category;
      button.textContent = category === "all" ? "all bands" : displayCategory(category);
      button.setAttribute("aria-pressed", String(category === state.category));
      button.addEventListener("click", () => {
        state.category = category;
        render();
        setHistory();
      });
      elements.categories.append(button);
    });
  }

  function makeNodes() {
    posts.forEach((post, index) => {
      const node = document.createElement("button");
      node.type = "button";
      node.className = "nebula-node";
      node.dataset.slug = post.slug;
      const minutes = readingMinutes(post);
      node.dataset.readingMinutes = String(minutes);
      node.style.setProperty("--node-size", `${(1.5 + minutes * 0.2).toFixed(2)}rem`);
      node.setAttribute("aria-label", `${post.title}, ${post.date}, ${post.readingTime}`);
      node.setAttribute("aria-pressed", "false");
      node.innerHTML = '<span class="nebula-node__label" aria-hidden="true"></span>';
      node.querySelector("span").textContent = post.title;
      const position = basePosition(index);
      node.style.setProperty("--node-x", `${position.x.toFixed(3)}%`);
      node.style.setProperty("--node-y", `${position.y.toFixed(3)}%`);
      node.dataset.labelSide = labelSide(position, index);
      node.addEventListener("click", () => selectPost(post.slug));
      nodeBySlug.set(post.slug, node);
      elements.field.append(node);
    });

    elements.field.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      const visible = [...nodeBySlug.values()].filter((node) => node.tabIndex === 0);
      const current = visible.indexOf(document.activeElement);
      if (current < 0 || !visible.length) return;
      const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      visible[(current + delta + visible.length) % visible.length].focus();
      event.preventDefault();
    });
  }

  function restoreFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const categories = new Set(["all", ...posts.map((post) => post.category)]);
    state.query = String(params.get("q") || "").slice(0, 160);
    state.category = categories.has(params.get("category")) ? params.get("category") : "all";
    state.target = posts.some((post) => post.slug === params.get("target")) ? params.get("target") : "";
    elements.search.value = state.query;
    render();
  }

  function correctUniverseMap() {
    const nav = document.querySelector("[data-universe-route-map]");
    if (!nav) return;
    nav.querySelectorAll("[data-map-id]").forEach((link) => link.removeAttribute("aria-current"));
    nav.querySelector('[data-map-id="threads"]')?.setAttribute("aria-current", "location");
  }

  async function hydrateChronologyMedia() {
    try {
      const response = await fetch("/blog/posts.json", { cache: "default" });
      if (!response.ok) return;
      const published = await response.json();
      if (!Array.isArray(published)) return;
      published.forEach((post) => {
        if (!post?.slug || !post.heroImage) return;
        const entry = elements.chronology.querySelector(`[data-post="${CSS.escape(String(post.slug))}"]`);
        const signal = entry?.querySelector(".chronology-entry__signal");
        if (!entry || !signal || entry.querySelector(".chronology-entry__media")) return;
        const link = document.createElement("a");
        link.className = "chronology-entry__media";
        link.href = articleUrl(post);
        link.setAttribute("aria-label", `Read ${post.title}`);
        const image = document.createElement("img");
        image.src = String(post.heroImage);
        image.alt = String(post.heroAlt || `${post.title} preview`);
        image.loading = "lazy";
        image.decoding = "async";
        image.addEventListener("error", () => { link.remove(); entry.removeAttribute("data-has-media"); }, { once: true });
        link.append(image);
        entry.insertBefore(link, signal);
        entry.dataset.hasMedia = "true";
      });
    } catch (_error) {
      // The text archive remains complete when imagery cannot be enhanced.
    }
  }

  makeCategories();
  makeNodes();
  elements.tuner.hidden = false;
  elements.field.hidden = false;
  restoreFromUrl();
  correctUniverseMap();
  hydrateChronologyMedia();

  elements.search.addEventListener("input", () => {
    state.query = elements.search.value.slice(0, 160);
    render();
    setHistory();
  });

  elements.tuner.addEventListener("reset", (event) => {
    event.preventDefault();
    state.query = "";
    state.category = "all";
    state.target = "";
    elements.search.value = "";
    render();
    setHistory();
  });

  elements.release.addEventListener("click", () => releaseTarget("push", true));
  document.addEventListener("click", (event) => {
    if (!state.target || event.target.closest("#nebula-focus") || event.target.closest(".nebula-node")) return;
    releaseTarget();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.target) return;
    releaseTarget("push", true);
    event.preventDefault();
  });
  window.addEventListener("resize", positionFocus, { passive: true });
  window.addEventListener("popstate", restoreFromUrl);
})();
