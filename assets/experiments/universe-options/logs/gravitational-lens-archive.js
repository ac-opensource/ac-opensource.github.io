(() => {
  "use strict";

  const elements = {
    categories: document.getElementById("gravity-categories"),
    count: document.getElementById("gravity-count"),
    empty: document.getElementById("gravity-empty"),
    field: document.getElementById("gravity-field"),
    focus: document.getElementById("gravity-focus"),
    focusLink: document.getElementById("gravity-focus-link"),
    focusMeta: document.getElementById("gravity-focus-meta"),
    focusSummary: document.getElementById("gravity-focus-summary"),
    focusTitle: document.getElementById("gravity-focus-title"),
    list: document.getElementById("gravity-list"),
    nodes: document.getElementById("gravity-nodes"),
    range: document.getElementById("gravity-range"),
    release: document.getElementById("gravity-release"),
    search: document.getElementById("gravity-search"),
    total: document.getElementById("gravity-total"),
    tuner: document.getElementById("gravity-tuner")
  };

  if (Object.values(elements).some((element) => !element)) return;

  const categoryColors = {
    hobby: "#298f86",
    portfolio: "#a06b26",
    reflection: "#7655aa",
    technical: "#1f5cba",
    work: "#a06b26"
  };

  const state = { category: "all", query: "", selected: "" };
  const nodeElements = new Map();
  const entryElements = new Map();
  let posts = [];

  const normalize = (value) => String(value || "").trim().toLocaleLowerCase("en-US");
  const articleUrl = (post) => `/blog/${encodeURIComponent(post.slug)}.html`;
  const displayCategory = (category) => category === "work" ? "portfolio" : category;
  const text = (tag, className, value) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
  };

  function matches(post) {
    if (state.category !== "all" && post.category !== state.category) return false;
    const needle = normalize(state.query);
    if (!needle) return true;
    return normalize([post.title, post.summary, post.category, ...(post.topics || [])].join(" ")).includes(needle);
  }

  function nodePosition(index) {
    const side = index % 2 === 0 ? "left" : "right";
    const row = Math.floor(index / 2);
    const rows = Math.ceil(posts.length / 2);
    const progress = rows <= 1 ? 0.5 : row / (rows - 1);
    const bow = Math.sin(progress * Math.PI);
    const x = side === "left" ? 4 + bow * 8 : 96 - bow * 8;
    const y = 5 + progress * 90;
    return { side, x, y };
  }

  function createNode(post, index) {
    const position = nodePosition(index);
    const node = document.createElement("button");
    node.type = "button";
    node.className = `gravity-node${position.side === "right" ? " is-right" : ""}`;
    node.dataset.slug = post.slug;
    node.style.setProperty("--node-x", `${position.x}%`);
    node.style.setProperty("--node-y", `${position.y}%`);
    node.style.setProperty("--node-color", categoryColors[post.category] || categoryColors.technical);
    node.setAttribute("aria-label", `${post.title}. ${post.date}, ${displayCategory(post.category)}, ${post.readingTime}.`);
    node.setAttribute("aria-pressed", "false");
    node.append(text("b", "", post.title));
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      selectPost(post.slug, true);
    });
    nodeElements.set(post.slug, node);
    elements.nodes.append(node);
  }

  function createEntry(post) {
    const entry = document.createElement("article");
    entry.className = `gravity-entry${post.heroImage ? " has-media" : ""}`;
    entry.dataset.slug = post.slug;

    const meta = text("p", "gravity-entry__meta", displayCategory(post.category));
    const date = text("time", "", post.date);
    date.dateTime = post.date;
    meta.append(date, text("span", "", post.readingTime || ""));

    const body = document.createElement("div");
    body.className = "gravity-entry__body";
    const title = text("h3", "", "");
    const titleLink = text("a", "", post.title);
    titleLink.href = articleUrl(post);
    title.append(titleLink);
    body.append(title, text("p", "gravity-entry__summary", post.summary));

    if (Array.isArray(post.topics) && post.topics.length) {
      const topics = document.createElement("p");
      topics.className = "gravity-entry__topics";
      topics.setAttribute("aria-label", "Topics");
      post.topics.slice(0, 6).forEach((topic) => topics.append(text("span", "", topic)));
      body.append(topics);
    }

    entry.append(meta, body);
    if (post.heroImage) {
      const media = document.createElement("a");
      media.className = "gravity-entry__media";
      media.href = articleUrl(post);
      media.setAttribute("aria-label", `Read ${post.title}`);
      const image = document.createElement("img");
      image.src = post.heroImage;
      image.alt = post.heroAlt || "";
      image.loading = "lazy";
      image.decoding = "async";
      media.append(image);
      entry.append(media);
    }

    entryElements.set(post.slug, entry);
    elements.list.append(entry);
  }

  function createCategories() {
    const categories = [...new Set(posts.map((post) => post.category))];
    ["all", ...categories].forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.category = category;
      button.textContent = category === "all" ? "all entries" : displayCategory(category);
      button.setAttribute("aria-pressed", String(category === state.category));
      button.addEventListener("click", () => {
        state.category = category;
        render();
      });
      elements.categories.append(button);
    });
  }

  function renderFocus() {
    const post = posts.find((candidate) => candidate.slug === state.selected);
    nodeElements.forEach((node, slug) => node.setAttribute("aria-pressed", String(slug === state.selected)));
    entryElements.forEach((entry, slug) => entry.classList.toggle("is-selected", slug === state.selected));

    if (!post) {
      elements.focus.hidden = true;
      return;
    }

    elements.focusMeta.textContent = `${post.date} · ${displayCategory(post.category)} · ${post.readingTime}`;
    elements.focusTitle.textContent = post.title;
    elements.focusSummary.textContent = post.summary;
    elements.focusLink.href = articleUrl(post);
    elements.focus.hidden = false;
  }

  function selectPost(slug, updateAddress = false) {
    state.selected = posts.some((post) => post.slug === slug) ? slug : "";
    renderFocus();
    if (!updateAddress) return;
    const url = new URL(window.location.href);
    if (state.selected) url.searchParams.set("target", state.selected);
    else url.searchParams.delete("target");
    window.history.replaceState(null, "", url);
  }

  function render() {
    const visible = posts.filter(matches);
    const visibleSlugs = new Set(visible.map((post) => post.slug));
    if (state.selected && !visibleSlugs.has(state.selected)) state.selected = "";

    nodeElements.forEach((node, slug) => node.classList.toggle("is-muted", !visibleSlugs.has(slug)));
    entryElements.forEach((entry, slug) => { entry.hidden = !visibleSlugs.has(slug); });
    elements.categories.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.category === state.category));
    });
    elements.count.textContent = `${visible.length} ${visible.length === 1 ? "entry" : "entries"}`;
    elements.empty.hidden = visible.length !== 0;
    renderFocus();
  }

  function bindEvents() {
    elements.search.addEventListener("input", () => {
      state.query = elements.search.value;
      render();
    });
    elements.tuner.addEventListener("reset", () => {
      window.setTimeout(() => {
        state.query = "";
        render();
        elements.search.focus();
      });
    });
    elements.release.addEventListener("click", (event) => {
      event.stopPropagation();
      selectPost("", true);
    });
    elements.focus.addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("click", () => {
      if (state.selected) selectPost("", true);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !state.selected) return;
      const selectedNode = nodeElements.get(state.selected);
      selectPost("", true);
      selectedNode?.focus();
    });
  }

  async function init() {
    try {
      const response = await fetch("/blog/posts.json", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Archive manifest returned ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload) || !payload.length) throw new Error("Archive manifest is empty");
      posts = payload;
    } catch (error) {
      elements.list.innerHTML = "";
      const message = text("p", "gravity-empty", "The archive could not be loaded here. Open the current Logs archive instead.");
      const link = text("a", "", "Current Logs");
      link.href = "/blog/";
      message.append(" ", link);
      elements.list.append(message);
      return;
    }

    elements.list.innerHTML = "";
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

    const params = new URL(window.location.href).searchParams;
    state.query = params.get("q") || "";
    state.category = params.get("category") || "all";
    state.selected = params.get("target") || "";
    elements.search.value = state.query;
    bindEvents();
    render();
  }

  init();
})();
