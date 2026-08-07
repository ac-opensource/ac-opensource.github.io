(() => {
  "use strict";

  const posts = Array.isArray(window.AC_LOG_POSTS) ? window.AC_LOG_POSTS : [];
  if (!posts.length) return;

  const elements = {
    categories: document.getElementById("thread-categories"),
    count: document.getElementById("thread-count"),
    focus: document.getElementById("thread-focus"),
    focusLink: document.getElementById("thread-focus-link"),
    focusMeta: document.getElementById("thread-focus-meta"),
    focusReasons: document.getElementById("thread-focus-reasons"),
    focusSummary: document.getElementById("thread-focus-summary"),
    focusTitle: document.getElementById("thread-focus-title"),
    junctions: document.getElementById("thread-junctions"),
    lines: document.getElementById("thread-lines"),
    map: document.getElementById("constellation-map"),
    release: document.getElementById("thread-release"),
    search: document.getElementById("thread-search"),
    sequence: document.getElementById("thread-sequence"),
    sequenceStatus: document.getElementById("thread-sequence-status"),
    stars: document.getElementById("thread-stars"),
    tuner: document.getElementById("thread-tuner")
  };

  if (Object.values(elements).some((element) => !element)) return;

  const displayCategory = (category) => category === "work" ? "portfolio" : category;
  const normalize = (value) => String(value || "").trim().toLocaleLowerCase("en-US");
  const articleUrl = (post) => `/blog/${encodeURIComponent(post.slug)}.html`;
  const state = { category: "all", query: "", target: "" };
  const stars = new Map();
  const junctionElements = new Map();
  const edges = [];

  const topicCounts = new Map();
  const topicLabels = new Map();
  posts.forEach((post) => {
    new Set(post.topics.map(normalize).filter(Boolean)).forEach((topic) => {
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
      if (!topicLabels.has(topic)) topicLabels.set(topic, post.topics.find((item) => normalize(item) === topic));
    });
  });
  const repeatedTopics = [...topicCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([topic]) => topic);

  const categories = [...new Set(posts.map((post) => post.category))];
  const junctions = [
    ...categories.map((category) => ({ id: `category:${category}`, kind: "category", key: category, label: displayCategory(category) })),
    ...repeatedTopics.map((topic) => ({ id: `topic:${topic}`, kind: "topic", key: topic, label: topicLabels.get(topic) || topic }))
  ];

  function connectionsFor(post) {
    const connections = [`category:${post.category}`];
    const topics = new Set(post.topics.map(normalize));
    repeatedTopics.forEach((topic) => {
      if (topics.has(topic)) connections.push(`topic:${topic}`);
    });
    return connections;
  }

  function postPosition(index) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / posts.length;
    return {
      x: 62 + Math.cos(angle) * 34,
      y: 52 + Math.sin(angle) * 43
    };
  }

  function junctionPosition(junction, index) {
    if (junction.kind === "category") {
      const categoryPositions = [
        { x: 52, y: 38 },
        { x: 70, y: 43 },
        { x: 68, y: 66 },
        { x: 48, y: 65 }
      ];
      return categoryPositions[index];
    }
    const topicIndex = index - categories.length;
    const angle = -1.35 + (Math.PI * 2 * topicIndex) / repeatedTopics.length;
    return {
      x: 60 + Math.cos(angle) * 23,
      y: 53 + Math.sin(angle) * 20
    };
  }

  const positions = new Map();
  posts.forEach((post, index) => positions.set(`post:${post.slug}`, postPosition(index)));
  junctions.forEach((junction, index) => positions.set(junction.id, junctionPosition(junction, index)));

  function matches(post) {
    if (state.category !== "all" && post.category !== state.category) return false;
    const needle = normalize(state.query);
    if (!needle) return true;
    return normalize([post.title, post.summary, post.category, ...post.topics].join(" ")).includes(needle);
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

  function makeJunctions() {
    junctions.forEach((junction) => {
      const element = document.createElement("span");
      const position = positions.get(junction.id);
      element.className = "thread-junction";
      element.dataset.junction = junction.id;
      element.dataset.kind = junction.kind;
      element.style.setProperty("--x", `${position.x}%`);
      element.style.setProperty("--y", `${position.y}%`);
      element.textContent = junction.label;
      junctionElements.set(junction.id, element);
      elements.junctions.append(element);
    });
  }

  function makeStars() {
    posts.forEach((post, index) => {
      const star = document.createElement("button");
      const position = positions.get(`post:${post.slug}`);
      star.type = "button";
      star.className = "thread-star";
      star.dataset.slug = post.slug;
      star.style.setProperty("--x", `${position.x}%`);
      star.style.setProperty("--y", `${position.y}%`);
      star.setAttribute("aria-label", `${String(index + 1).padStart(2, "0")}: ${post.title}, ${post.date}`);
      star.setAttribute("aria-pressed", "false");
      star.innerHTML = `<b aria-hidden="true">${String(index + 1).padStart(2, "0")}</b><span aria-hidden="true"></span>`;
      star.querySelector("span").textContent = post.title;
      star.addEventListener("click", () => selectPost(post.slug));
      stars.set(post.slug, star);
      elements.stars.append(star);
    });

    elements.stars.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      const visible = [...stars.values()].filter((star) => star.tabIndex === 0);
      const current = visible.indexOf(document.activeElement);
      if (current < 0 || !visible.length) return;
      const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      visible[(current + delta + visible.length) % visible.length].focus();
      event.preventDefault();
    });
  }

  function makeEdges() {
    const svgNamespace = "http://www.w3.org/2000/svg";
    posts.forEach((post) => {
      const start = positions.get(`post:${post.slug}`);
      connectionsFor(post).forEach((junctionId) => {
        const end = positions.get(junctionId);
        const line = document.createElementNS(svgNamespace, "line");
        const kind = junctionId.startsWith("topic:") ? "topic" : "category";
        line.setAttribute("x1", String(start.x));
        line.setAttribute("y1", String(start.y));
        line.setAttribute("x2", String(end.x));
        line.setAttribute("y2", String(end.y));
        line.setAttribute("class", "thread-line");
        line.dataset.post = post.slug;
        line.dataset.junction = junctionId;
        line.dataset.kind = kind;
        elements.lines.append(line);
        edges.push({ junctionId, line, slug: post.slug });
      });
    });
  }

  function makeCategories() {
    ["all", ...categories].forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.category = category;
      button.textContent = category === "all" ? "all threads" : displayCategory(category);
      button.setAttribute("aria-pressed", String(category === state.category));
      button.addEventListener("click", () => {
        state.category = category;
        render();
        setHistory();
      });
      elements.categories.append(button);
    });
  }

  function renderFocus() {
    const selected = posts.find((post) => post.slug === state.target);
    const selectedJunctions = new Set(selected ? connectionsFor(selected) : []);
    const relatedSlugs = new Set();

    if (selected) {
      posts.forEach((post) => {
        if (post.slug === selected.slug) return;
        if (connectionsFor(post).some((junction) => selectedJunctions.has(junction))) relatedSlugs.add(post.slug);
      });
    }

    stars.forEach((star, slug) => {
      star.setAttribute("aria-pressed", String(slug === state.target));
      star.classList.toggle("is-related", relatedSlugs.has(slug));
    });
    junctionElements.forEach((element, junctionId) => element.classList.toggle("is-active", selectedJunctions.has(junctionId)));
    edges.forEach((edge) => edge.line.classList.toggle("is-active", selectedJunctions.has(edge.junctionId)));

    if (!selected) {
      elements.focus.hidden = true;
      return;
    }

    const labels = connectionsFor(selected).map((id) => junctions.find((junction) => junction.id === id)?.label).filter(Boolean);
    elements.focusMeta.textContent = `${selected.date} · ${displayCategory(selected.category)} · ${selected.readingTime}`;
    elements.focusTitle.textContent = selected.title;
    elements.focusSummary.textContent = selected.summary;
    elements.focusReasons.textContent = `${labels.length} exact junctions · ${relatedSlugs.size} neighboring posts · ${labels.join(" · ")}`;
    elements.focusLink.href = articleUrl(selected);
    elements.focus.hidden = false;
  }

  function render() {
    const filtered = posts.filter(matches);
    const filteredSlugs = new Set(filtered.map((post) => post.slug));
    const visibleJunctions = new Set();
    filtered.forEach((post) => connectionsFor(post).forEach((junction) => visibleJunctions.add(junction)));

    if (state.target && !filteredSlugs.has(state.target)) state.target = "";

    stars.forEach((star, slug) => {
      const visible = filteredSlugs.has(slug);
      star.classList.toggle("is-muted", !visible);
      star.tabIndex = visible ? 0 : -1;
    });

    edges.forEach((edge) => edge.line.classList.toggle("is-muted", !filteredSlugs.has(edge.slug)));
    junctionElements.forEach((element, junctionId) => element.classList.toggle("is-muted", !visibleJunctions.has(junctionId)));
    elements.sequence.querySelectorAll("[data-post]").forEach((entry) => {
      entry.hidden = !filteredSlugs.has(entry.dataset.post);
    });
    elements.categories.querySelectorAll("button[data-category]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.category === state.category));
    });

    elements.count.textContent = `${filtered.length} ${filtered.length === 1 ? "star" : "stars"} visible`;
    elements.sequenceStatus.textContent = `${filtered.length} published ${filtered.length === 1 ? "transmission" : "transmissions"} · newest first`;
    renderFocus();
  }

  function selectPost(slug, mode = "push") {
    if (!posts.some((post) => post.slug === slug)) return;
    state.target = slug;
    renderFocus();
    setHistory(mode);
  }

  function restoreFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const validCategories = new Set(["all", ...categories]);
    state.query = String(params.get("q") || "").slice(0, 160);
    state.category = validCategories.has(params.get("category")) ? params.get("category") : "all";
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

  makeJunctions();
  makeStars();
  makeEdges();
  makeCategories();
  elements.tuner.hidden = false;
  elements.map.hidden = false;
  restoreFromUrl();
  correctUniverseMap();

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

  elements.release.addEventListener("click", () => {
    state.target = "";
    renderFocus();
    setHistory("push");
  });

  window.addEventListener("popstate", restoreFromUrl);
})();
