(() => {
  "use strict";

  const BOOKMARKS_KEY = "ac.blog.bookmarks.v1";
  const elements = {
    categories: document.getElementById("category-filters"),
    chronologyStatus: document.getElementById("infinite-status"),
    count: document.getElementById("archive-result-count"),
    dateRange: document.getElementById("archive-date-range"),
    feed: document.getElementById("blog-feed"),
    field: document.getElementById("nebula-field"),
    focus: document.getElementById("nebula-focus"),
    focusLink: document.getElementById("nebula-focus-link"),
    focusMeta: document.getElementById("nebula-focus-meta"),
    focusSummary: document.getElementById("nebula-focus-summary"),
    focusTitle: document.getElementById("nebula-focus-title"),
    focusTopics: document.getElementById("nebula-focus-topics"),
    release: document.getElementById("nebula-release"),
    search: document.getElementById("search-posts"),
    totalCount: document.getElementById("archive-total-count"),
    tuner: document.getElementById("logs-tuning")
  };

  if (Object.values(elements).some((element) => !element)) return;

  const state = {
    bookmarks: new Set(),
    category: "all",
    filteredPosts: [],
    posts: [],
    query: "",
    target: ""
  };
  const nodeBySlug = new Map();
  let lastSelectedNode = null;
  let positionTimer = 0;
  let focusResizeObserver = null;

  const normalize = (value) => String(value || "").trim().toLocaleLowerCase("en-US");
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const cssEscape = (value) => window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  const articleUrl = (post) => `/blog/${encodeURIComponent(post.slug)}.html`;
  const visibleCategory = (value) => normalize(value) === "work" ? "portfolio" : String(value || "uncategorized");
  const timestamp = (value) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

  function activateNavigation() {
    const path = window.location.pathname.replace(/\/index\.html$/, "/");
    document.querySelectorAll("#site-nav .site-nav-link, #site-nav-mobile .site-nav-link").forEach((link) => {
      const route = link.dataset.route;
      const active = route === "/blog/" ? path.startsWith("/blog/") : path === route || (route === "/" && path === "/");
      if (!active) return;
      link.classList.add("text-[#1F5CBA]", "border-b-2", "border-[#1F5CBA]", "pb-1");
      link.setAttribute("aria-current", "page");
    });
  }

  function formatDate(value) {
    const date = new Date(`${String(value || "").slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return String(value || "");
    return date.toISOString().slice(0, 10);
  }

  function readingMinutes(post) {
    const minutes = Number.parseInt(String(post.readingTime || "").match(/\d+/)?.[0] || "1", 10);
    return Math.min(12, Math.max(1, minutes));
  }

  function basePosition(index) {
    const ratio = Math.sqrt((index + 1) / Math.max(state.posts.length, 1));
    const angle = -0.9 + index * 2.399963229728653;
    return {
      x: 53 + Math.cos(angle) * (43 * ratio),
      y: 55 + Math.sin(angle) * (39 * ratio)
    };
  }

  function condensedPosition(index, total) {
    const ratio = Math.sqrt((index + 1) / Math.max(total, 1));
    const angle = -1.2 + index * 2.399963229728653;
    return {
      x: 56 + Math.cos(angle) * (9 + 24 * ratio),
      y: 56 + Math.sin(angle) * (7 + 21 * ratio)
    };
  }

  function labelSide(position, index) {
    if (position.x > 82) return "left";
    if (position.x < 28) return "right";
    if (position.y < 19) return "below";
    if (position.y > 84) return "above";
    return ["right", "left", "below", "above"][index % 4];
  }

  function matches(post) {
    if (state.category !== "all" && normalize(post.category) !== state.category) return false;
    const needle = normalize(state.query);
    if (!needle) return true;
    return normalize([post.title, post.summary, post.category, ...(post.topics || [])].join(" ")).includes(needle);
  }

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
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...state.bookmarks]));
    } catch (_error) {
      // Bookmarks are a local convenience; the archive remains usable without storage.
    }
  }

  function usableHero(post) {
    const source = String(post.heroImage || "").trim();
    return source && !source.startsWith("data:") && !source.startsWith("javascript:");
  }

  function previewSource(post) {
    const source = String(post.heroImage || "").trim();
    if (!source) return "";
    try {
      const url = new URL(source, window.location.origin);
      return url.origin === window.location.origin ? `${url.pathname}${url.search}` : url.href;
    } catch (_error) {
      return source;
    }
  }

  function readUrlState() {
    const parameters = new URLSearchParams(window.location.search);
    const categories = new Set(["all", ...state.posts.map((post) => normalize(post.category))]);
    const requestedCategory = normalize(parameters.get("category") || "all");
    const target = String(parameters.get("target") || "").trim();
    return {
      category: categories.has(requestedCategory) ? requestedCategory : "all",
      query: String(parameters.get("q") || "").slice(0, 160),
      target: state.posts.some((post) => post.slug === target) ? target : ""
    };
  }

  function writeUrl(mode = "replaceState") {
    const url = new URL(window.location.href);
    const query = state.query.trim();
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    if (state.category !== "all") url.searchParams.set("category", state.category);
    else url.searchParams.delete("category");
    if (state.target) url.searchParams.set("target", state.target);
    else url.searchParams.delete("target");
    window.history[mode]({ archive: { category: state.category, query, target: state.target } }, "", url);
  }

  function buildCategoryButtons() {
    const counts = new Map();
    state.posts.forEach((post) => {
      const category = normalize(post.category);
      counts.set(category, (counts.get(category) || 0) + 1);
    });
    const categories = [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    elements.categories.innerHTML = [["all", state.posts.length], ...categories]
      .map(([category, count]) => `<button type="button" data-category="${escapeHtml(category)}" aria-pressed="false"><span>${escapeHtml(category === "all" ? "all bands" : visibleCategory(category))}</span><b>${count}</b></button>`)
      .join("");
  }

  function buildNodes() {
    elements.field.replaceChildren();
    nodeBySlug.clear();
    state.posts.forEach((post, index) => {
      const node = document.createElement("button");
      const position = basePosition(index);
      node.type = "button";
      node.className = "nebula-node";
      node.dataset.slug = post.slug;
      node.dataset.labelSide = labelSide(position, index);
      node.dataset.readingMinutes = String(readingMinutes(post));
      node.style.setProperty("--node-size", `${(1.5 + readingMinutes(post) * 0.2).toFixed(2)}rem`);
      node.style.setProperty("--node-x", `${position.x.toFixed(3)}%`);
      node.style.setProperty("--node-y", `${position.y.toFixed(3)}%`);
      node.setAttribute("aria-label", `${post.title}, ${formatDate(post.date)}, ${post.readingTime || "reading time unavailable"}`);
      node.setAttribute("aria-pressed", "false");
      node.innerHTML = '<span class="nebula-node__label" aria-hidden="true"></span>';
      node.firstElementChild.textContent = post.title;
      nodeBySlug.set(post.slug, node);
      elements.field.append(node);
    });
  }

  function positionFocus() {
    window.clearTimeout(positionTimer);
    const node = state.target ? nodeBySlug.get(state.target) : null;
    if (!node || elements.focus.hidden) return;

    const stage = elements.focus.offsetParent;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const popupWidth = elements.focus.offsetWidth;
    const popupHeight = elements.focus.offsetHeight;
    const gap = 18;
    const margin = 12;
    const anchorX = nodeRect.left - stageRect.left + nodeRect.width / 2;
    const anchorY = nodeRect.top - stageRect.top + nodeRect.height / 2;
    const spaces = {
      right: stageRect.width - anchorX - nodeRect.width / 2 - gap - margin,
      left: anchorX - nodeRect.width / 2 - gap - margin,
      below: stageRect.height - anchorY - nodeRect.height / 2 - gap - margin,
      above: anchorY - nodeRect.height / 2 - gap - margin
    };
    let placement = spaces.right >= popupWidth ? "right" : spaces.left >= popupWidth ? "left" : spaces.below >= popupHeight ? "below" : "above";
    if (placement === "above" && spaces.above < popupHeight && spaces.below > spaces.above) placement = "below";

    let left = anchorX + nodeRect.width / 2 + gap;
    let top = anchorY - Math.min(72, popupHeight * 0.3);
    if (placement === "left") left = anchorX - nodeRect.width / 2 - gap - popupWidth;
    if (placement === "below") {
      left = anchorX - popupWidth / 2;
      top = anchorY + nodeRect.height / 2 + gap;
    }
    if (placement === "above") {
      left = anchorX - popupWidth / 2;
      top = anchorY - nodeRect.height / 2 - gap - popupHeight;
    }
    left = Math.max(margin, Math.min(stageRect.width - popupWidth - margin, left));
    top = Math.max(margin, Math.min(stageRect.height - popupHeight - margin, top));
    elements.focus.style.setProperty("--focus-left", `${left}px`);
    elements.focus.style.setProperty("--focus-top", `${top}px`);
    elements.focus.style.setProperty("--focus-anchor-x", `${anchorX}px`);
    elements.focus.style.setProperty("--focus-anchor-y", `${anchorY}px`);
    elements.focus.dataset.placement = placement;
  }

  function renderFocus() {
    const post = state.posts.find((candidate) => candidate.slug === state.target);
    nodeBySlug.forEach((node, slug) => node.setAttribute("aria-pressed", String(slug === state.target)));
    if (!post) {
      elements.focus.hidden = true;
      return;
    }
    elements.focusMeta.textContent = `${formatDate(post.date)} · ${visibleCategory(post.category)} · ${post.readingTime || "reading time unavailable"}`;
    elements.focusTitle.textContent = post.title;
    elements.focusSummary.textContent = post.summary || "";
    elements.focusTopics.textContent = (post.topics || []).join(" · ");
    elements.focusTopics.hidden = !(post.topics || []).length;
    elements.focusLink.href = articleUrl(post);
    elements.focus.hidden = false;
    requestAnimationFrame(positionFocus);
    positionTimer = window.setTimeout(positionFocus, 580);
  }

  function renderArchive() {
    if (!state.filteredPosts.length) {
      elements.feed.innerHTML = '<div class="transmission-empty"><h3>No signal received.</h3><p>No published entry matches that search. Try a broader title, topic, or category.</p></div>';
      return;
    }
    elements.feed.innerHTML = state.filteredPosts.map((post, index) => {
      const url = articleUrl(post);
      const hasMedia = usableHero(post);
      const topics = (post.topics || []).map((topic) => `<span>[${escapeHtml(topic)}]</span>`).join("");
      const bookmarked = state.bookmarks.has(post.slug);
      const media = hasMedia ? `<a class="transmission__media" href="${url}" aria-label="Read ${escapeHtml(post.title)}"><img src="${escapeHtml(previewSource(post))}" alt="${escapeHtml(post.heroAlt || `${post.title} preview`)}" loading="${index === 0 ? "eager" : "lazy"}" decoding="async"/></a>` : "";
      return `<article class="transmission" data-blog-slug="${escapeHtml(post.slug)}" data-blog-selected="${post.slug === state.target}" data-has-media="${hasMedia}">
        <div class="transmission__time"><time datetime="${escapeHtml(formatDate(post.date))}">${escapeHtml(formatDate(post.date))}</time><span>${escapeHtml(post.readingTime || "reading time n/a")}</span></div>
        <div class="transmission__body"><p class="transmission__band">[${escapeHtml(visibleCategory(post.category))}]</p><h3><a href="${url}">${escapeHtml(post.title)}</a></h3><p>${escapeHtml(post.summary || "")}</p>${topics ? `<div class="transmission__topics">${topics}</div>` : ""}<div class="transmission__actions"><a href="${url}">[read]</a><button type="button" data-share-slug="${escapeHtml(post.slug)}">[share]</button><button type="button" data-bookmark-slug="${escapeHtml(post.slug)}" aria-pressed="${bookmarked}">${bookmarked ? "[bookmarked]" : "[bookmark]"}</button></div></div>
        ${media}
      </article>`;
    }).join("");
    elements.feed.querySelectorAll(".transmission__media img").forEach((image) => image.addEventListener("error", () => {
      const article = image.closest(".transmission");
      image.closest(".transmission__media")?.remove();
      article?.setAttribute("data-has-media", "false");
    }, { once: true }));
  }

  function render() {
    state.filteredPosts = state.posts.filter(matches);
    const filteredSlugs = new Set(state.filteredPosts.map((post) => post.slug));
    const activeFilter = Boolean(normalize(state.query)) || state.category !== "all";
    state.posts.forEach((post, index) => {
      const node = nodeBySlug.get(post.slug);
      const matchIndex = state.filteredPosts.findIndex((candidate) => candidate.slug === post.slug);
      const position = activeFilter && matchIndex >= 0 ? condensedPosition(matchIndex, state.filteredPosts.length) : basePosition(index);
      node.style.setProperty("--node-x", `${position.x.toFixed(3)}%`);
      node.style.setProperty("--node-y", `${position.y.toFixed(3)}%`);
      node.dataset.labelSide = labelSide(position, index);
      node.classList.toggle("is-muted", !filteredSlugs.has(post.slug));
      node.classList.toggle("is-match", activeFilter && filteredSlugs.has(post.slug));
      node.tabIndex = filteredSlugs.has(post.slug) ? 0 : -1;
    });
    elements.categories.querySelectorAll("button[data-category]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.category === state.category)));
    if (state.target && !filteredSlugs.has(state.target)) state.target = "";
    const count = state.filteredPosts.length;
    elements.count.textContent = `${count} published entr${count === 1 ? "y" : "ies"}`;
    elements.chronologyStatus.textContent = count ? `[${count} published entr${count === 1 ? "y" : "ies"} · engineering, systems, and life]` : "[no published entry matches that search]";
    renderArchive();
    renderFocus();
  }

  function selectPost(slug, { push = true } = {}) {
    if (!state.posts.some((post) => post.slug === slug)) return;
    if (state.target === slug) {
      releaseTarget({ push });
      return;
    }
    state.target = slug;
    lastSelectedNode = nodeBySlug.get(slug) || null;
    writeUrl(push ? "pushState" : "replaceState");
    render();
  }

  function releaseTarget({ push = true, restoreFocus = false } = {}) {
    if (!state.target) return;
    state.target = "";
    writeUrl(push ? "pushState" : "replaceState");
    renderFocus();
    if (restoreFocus) lastSelectedNode?.focus({ preventScroll: true });
  }

  async function sharePost(post) {
    const url = new URL(articleUrl(post), window.location.origin).href;
    if (navigator.share) {
      try {
        await navigator.share({ title: post.title, url });
        return;
      } catch (_error) {
        // Continue to the clipboard fallback when sharing is cancelled or unavailable.
      }
    }
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        return;
      } catch (_error) {
        // Continue to the manual fallback.
      }
    }
    window.prompt("Copy post URL:", url);
  }

  function bindEvents() {
    elements.search.addEventListener("input", () => {
      state.query = elements.search.value.slice(0, 160);
      writeUrl();
      render();
    });
    elements.categories.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-category]");
      if (!button || button.dataset.category === state.category) return;
      state.category = button.dataset.category;
      writeUrl("pushState");
      render();
    });
    elements.field.addEventListener("click", (event) => {
      const node = event.target.closest("button[data-slug]");
      if (node) selectPost(node.dataset.slug);
    });
    elements.field.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const visible = [...nodeBySlug.values()].filter((node) => node.tabIndex === 0);
      const current = visible.indexOf(document.activeElement);
      if (current < 0 || !visible.length) return;
      const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      visible[(current + delta + visible.length) % visible.length].focus();
      event.preventDefault();
    });
    elements.release.addEventListener("click", () => releaseTarget({ restoreFocus: true }));
    elements.field.addEventListener("transitionend", (event) => {
      if (event.target.matches(".nebula-node") && (event.propertyName === "left" || event.propertyName === "top")) positionFocus();
    });
    elements.feed.addEventListener("click", async (event) => {
      const share = event.target.closest("button[data-share-slug]");
      if (share) {
        const post = state.posts.find((candidate) => candidate.slug === share.dataset.shareSlug);
        if (post) await sharePost(post);
        return;
      }
      const bookmark = event.target.closest("button[data-bookmark-slug]");
      if (!bookmark) return;
      const slug = bookmark.dataset.bookmarkSlug;
      if (state.bookmarks.has(slug)) state.bookmarks.delete(slug);
      else state.bookmarks.add(slug);
      saveBookmarks();
      renderArchive();
      elements.feed.querySelector(`button[data-bookmark-slug="${cssEscape(slug)}"]`)?.focus({ preventScroll: true });
    });
    document.addEventListener("click", (event) => {
      if (!state.target || event.target.closest("#nebula-focus") || event.target.closest(".nebula-node")) return;
      releaseTarget({ push: true });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !state.target) return;
      releaseTarget({ restoreFocus: true });
      event.preventDefault();
    });
    window.addEventListener("resize", positionFocus, { passive: true });
    if ("ResizeObserver" in window) {
      focusResizeObserver = new ResizeObserver(positionFocus);
      focusResizeObserver.observe(elements.focus);
      focusResizeObserver.observe(elements.field);
    }
    window.addEventListener("popstate", () => {
      const next = readUrlState();
      state.category = next.category;
      state.query = next.query;
      state.target = next.target;
      elements.search.value = state.query;
      render();
    });
  }

  function renderLedger() {
    const years = state.posts.map((post) => formatDate(post.date).slice(0, 4)).filter((year) => /^\d{4}$/.test(year)).sort();
    elements.totalCount.textContent = `${state.posts.length} published transmission${state.posts.length === 1 ? "" : "s"}`;
    elements.dateRange.textContent = years.length ? (years[0] === years.at(-1) ? years[0] : `${years[0]}—${years.at(-1)}`) : "date range unavailable";
  }

  async function boot() {
    activateNavigation();
    const response = await fetch("/blog/posts.json", { cache: "default" });
    if (!response.ok) throw new Error(`Manifest request failed (${response.status})`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("Blog manifest has an invalid shape");
    state.posts = payload
      .filter((post) => post && typeof post === "object" && String(post.slug || "").trim() && String(post.title || "").trim())
      .map((post) => ({ ...post, slug: String(post.slug).trim(), topics: Array.isArray(post.topics) ? post.topics : [] }))
      .sort((left, right) => timestamp(right.date) - timestamp(left.date) || left.slug.localeCompare(right.slug));
    state.bookmarks = loadBookmarks();
    buildCategoryButtons();
    buildNodes();
    renderLedger();
    const initial = readUrlState();
    state.category = initial.category;
    state.query = initial.query;
    state.target = initial.target;
    elements.search.value = state.query;
    elements.tuner.hidden = false;
    elements.field.hidden = false;
    elements.field.dataset.ready = "true";
    writeUrl();
    bindEvents();
    render();
  }

  boot().catch((error) => {
    activateNavigation();
    console.error("Blog nebula enhancement unavailable", error);
    elements.chronologyStatus.textContent = "[static archive mode · manifest unavailable]";
  });
})();
