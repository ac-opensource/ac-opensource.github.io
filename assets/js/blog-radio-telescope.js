(() => {
  "use strict";

  const BOOKMARKS_KEY = "ac_blog_bookmarks_v1";
  const MAX_RECEIPTS = 5;
  const MAX_SIGNALS = 4;

  function normalizedTopic(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  }

  function rawCategory(value) {
    return String(value || "log").trim() || "log";
  }

  function normalizedCategory(value) {
    return rawCategory(value).toLocaleLowerCase("en-US");
  }

  function visibleCategory(value) {
    const category = normalizedCategory(value);
    return category === "work" ? "portfolio" : category;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || "") : date.toISOString().slice(0, 10);
  }

  function articleUrl(post) {
    return `/blog/${encodeURIComponent(post.slug)}.html`;
  }

  function repeatedTopics(posts) {
    const occurrences = new Map();
    posts.forEach((post) => {
      const seen = new Set();
      (post.topics || []).forEach((topic) => {
        const normalized = normalizedTopic(topic);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        occurrences.set(normalized, (occurrences.get(normalized) || 0) + 1);
      });
    });
    return new Set([...occurrences].filter(([, count]) => count >= 2).map(([topic]) => topic));
  }

  function relationshipsFor(selected, posts) {
    if (!selected) return [];
    const repeated = repeatedTopics(posts);
    const selectedCategory = rawCategory(selected.category);
    const selectedTopics = [];
    const seenSelectedTopics = new Set();

    (selected.topics || []).forEach((topic) => {
      const normalized = normalizedTopic(topic);
      if (!normalized || seenSelectedTopics.has(normalized) || !repeated.has(normalized)) return;
      seenSelectedTopics.add(normalized);
      selectedTopics.push({ label: String(topic).trim(), normalized });
    });

    return posts
      .filter((candidate) => candidate.slug !== selected.slug)
      .map((candidate) => {
        const reasons = [];
        if (rawCategory(candidate.category) === selectedCategory) {
          reasons.push({ kind: "category", label: selectedCategory });
        }
        const candidateTopics = new Set((candidate.topics || []).map(normalizedTopic).filter(Boolean));
        selectedTopics.forEach((topic) => {
          if (candidateTopics.has(topic.normalized)) reasons.push({ kind: "topic", label: topic.label });
        });
        return { post: candidate, reasons };
      })
      .filter((relationship) => relationship.reasons.length > 0)
      .sort((left, right) =>
        String(right.post.date || "").localeCompare(String(left.post.date || ""))
        || String(left.post.slug || "").localeCompare(String(right.post.slug || ""))
      );
  }

  function resolvedSignals(posts, matchingSlugs, selectedSlug) {
    const matching = new Set(matchingSlugs || []);
    const selected = posts.find((post) => post.slug === selectedSlug) || null;
    const resolved = posts.filter((post) => matching.has(post.slug) && post.slug !== selected?.slug);
    if (selected) resolved.unshift(selected);
    return resolved.slice(0, MAX_SIGNALS);
  }

  function filterPosts(posts, query, category) {
    const needle = String(query || "").trim().toLocaleLowerCase("en-US");
    return posts.filter((post) => {
      if (category !== "all" && normalizedCategory(post.category) !== category) return false;
      if (!needle) return true;
      return [post.title, post.summary, post.category, ...(post.topics || [])]
        .join(" ")
        .toLocaleLowerCase("en-US")
        .includes(needle);
    });
  }

  const testApi = Object.freeze({
    MAX_RECEIPTS,
    MAX_SIGNALS,
    filterPosts,
    normalizedTopic,
    rawCategory,
    relationshipsFor,
    repeatedTopics,
    resolvedSignals,
    visibleCategory
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = testApi;
    return;
  }
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const elements = {
    categoryFilters: document.getElementById("category-filters"),
    clearTarget: document.getElementById("radio-clear-target"),
    dateSpectrum: document.getElementById("radio-date-spectrum"),
    endDate: document.getElementById("radio-end-date"),
    endStatus: document.getElementById("infinite-status"),
    feed: document.getElementById("blog-feed"),
    instrument: document.getElementById("radio-telescope"),
    instrumentCount: document.getElementById("radio-match-count"),
    instrumentSurface: document.querySelector(".radio-observatory__surface"),
    ledgerCount: document.getElementById("archive-total-count"),
    ledgerRange: document.getElementById("archive-date-range"),
    relationshipCount: document.getElementById("selected-relationship-count"),
    relationshipReceipts: document.getElementById("radio-relationship-receipts"),
    resultCount: document.getElementById("archive-result-count"),
    search: document.getElementById("search-posts"),
    selected: document.getElementById("radio-selected-transmission"),
    selectedLink: document.getElementById("selected-transmission-link"),
    selectedMeta: document.getElementById("selected-transmission-meta"),
    selectedSummary: document.getElementById("selected-transmission-summary"),
    selectedTitle: document.getElementById("selected-transmission-title"),
    selectedTopics: document.getElementById("selected-transmission-topics"),
    startDate: document.getElementById("radio-start-date"),
    traces: document.getElementById("radio-traces"),
    tuning: document.getElementById("logs-tuning")
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

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hashSeed(value) {
    const text = String(value || "signal");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function timestamp(value) {
    const result = new Date(value).getTime();
    return Number.isNaN(result) ? 0 : result;
  }

  function hasUsableHeroImage(value) {
    const url = String(value || "").trim();
    if (!url) return false;
    const lower = url.toLowerCase();
    if (lower.includes("aida-public")) return false;
    if (lower.includes("unsplash.com/photos/") && lower.includes("/download")) return false;
    return true;
  }

  function normalizePreviewImageUrl(value) {
    const raw = String(value || "").trim();
    if (raw.startsWith("https://ac-opensource.github.io/")) {
      return raw.replace("https://ac-opensource.github.io", "");
    }
    return raw;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
  }

  function loadBookmarks() {
    try {
      const stored = localStorage.getItem(BOOKMARKS_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.map((value) => String(value || "").trim()).filter(Boolean));
    } catch (_error) {
      return new Set();
    }
  }

  function saveBookmarks() {
    try {
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...state.bookmarks]));
    } catch (_error) {
      // The archive still works when storage is unavailable.
    }
  }

  function toggleBookmark(slug) {
    if (state.bookmarks.has(slug)) state.bookmarks.delete(slug);
    else state.bookmarks.add(slug);
    saveBookmarks();
  }

  async function sharePost(post) {
    const url = new URL(articleUrl(post), window.location.origin).href;
    if (navigator.share) {
      try {
        await navigator.share({ title: post.title || "Blog post", url });
        return "shared";
      } catch (_error) {
        // Continue to the non-native fallbacks.
      }
    }
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        return "copied";
      } catch (_error) {
        // Continue to the manual fallback.
      }
    }
    window.prompt("Copy post URL:", url);
    return "prompted";
  }

  function activateNavigation() {
    const path = window.location.pathname.replace(/\/index\.html$/, "/");
    document.querySelectorAll("#site-nav .site-nav-link, #site-nav-mobile .site-nav-link").forEach((link) => {
      const route = link.dataset.route;
      const active = route === "/blog/"
        ? path.startsWith("/blog/")
        : path === route || (route === "/" && path === "/");
      if (!active) return;
      link.classList.add("text-[#1F5CBA]", "border-b-2", "border-[#1F5CBA]", "pb-1");
      link.setAttribute("aria-current", "page");
    });
  }

  function categoryValues() {
    return new Set(state.posts.map((post) => normalizedCategory(post.category)));
  }

  function readUrlState() {
    const parameters = new URLSearchParams(window.location.search);
    const availableCategories = categoryValues();
    const requestedCategory = String(parameters.get("category") || "all").toLocaleLowerCase("en-US");
    const requestedTarget = String(parameters.get("target") || "").trim();
    return {
      category: requestedCategory === "all" || availableCategories.has(requestedCategory)
        ? requestedCategory
        : "all",
      query: String(parameters.get("q") || "").slice(0, 160),
      target: state.posts.some((post) => post.slug === requestedTarget) ? requestedTarget : ""
    };
  }

  function writeUrl(mode) {
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

  function dateBounds() {
    const times = state.posts.map((post) => timestamp(post.date)).filter(Boolean);
    return {
      maximum: times.length ? Math.max(...times) : 0,
      minimum: times.length ? Math.min(...times) : 0
    };
  }

  function datePosition(value, bounds) {
    if (!bounds.maximum || bounds.maximum === bounds.minimum) return 50;
    return ((timestamp(value) - bounds.minimum) / (bounds.maximum - bounds.minimum)) * 100;
  }

  function buildCategoryButtons() {
    const counts = new Map();
    state.posts.forEach((post) => {
      const category = normalizedCategory(post.category);
      counts.set(category, (counts.get(category) || 0) + 1);
    });
    const categories = [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    elements.categoryFilters.innerHTML = [
      ["all", state.posts.length],
      ...categories
    ].map(([category, count]) => {
      const label = category === "all" ? "all bands" : visibleCategory(category).replace(/_/g, " ");
      return `<button class="logs-tuning__band" type="button" data-category="${escapeHtml(category)}" aria-pressed="false"><span>[${escapeHtml(label)}]</span><span>${count}</span></button>`;
    }).join("");
  }

  function updateCategoryButtons() {
    elements.categoryFilters.querySelectorAll("button[data-category]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.category === state.category));
    });
  }

  function renderLedger() {
    const validDates = state.posts.map((post) => formatDate(post.date)).filter(Boolean).sort();
    const startYear = validDates[0]?.slice(0, 4) || "—";
    const endYear = validDates.at(-1)?.slice(0, 4) || "—";
    elements.ledgerCount.textContent = `${state.posts.length} published transmission${state.posts.length === 1 ? "" : "s"}`;
    elements.ledgerRange.textContent = startYear === endYear ? startYear : `${startYear}—${endYear}`;
  }

  function renderArchive() {
    if (!state.filteredPosts.length) {
      elements.feed.innerHTML = `
        <div class="transmission-empty">
          <h3>No signal received.</h3>
          <p>No published transmission matches this exact search and frequency band. Widen the tuner to return to the field.</p>
        </div>`;
      return;
    }

    let currentYear = "";
    elements.feed.innerHTML = state.filteredPosts.map((post, index) => {
      const formattedDate = formatDate(post.date);
      const year = formattedDate.slice(0, 4) || "undated";
      const yearChannel = year === currentYear
        ? ""
        : `<div class="transmission-year" aria-hidden="true"><span>${escapeHtml(year)}</span><span>year channel</span></div>`;
      currentYear = year;
      const url = articleUrl(post);
      const topics = (post.topics || [])
        .map((topic) => `<span>[${escapeHtml(topic)}]</span>`)
        .join("");
      const bookmarked = state.bookmarks.has(post.slug);
      const selected = post.slug === state.target;
      const hasMedia = hasUsableHeroImage(post.heroImage);
      const media = hasMedia
        ? `<a class="transmission__media" href="${url}" aria-label="Read ${escapeHtml(post.title)}">
            <img src="${escapeHtml(normalizePreviewImageUrl(post.heroImage))}" alt="${escapeHtml(post.heroAlt || `${post.title} preview`)}" loading="${index === 0 ? "eager" : "lazy"}" fetchpriority="${index === 0 ? "high" : "auto"}" decoding="async"/>
          </a>`
        : "";
      return `${yearChannel}
        <article class="transmission" data-blog-slug="${escapeHtml(post.slug)}" data-blog-selected="${selected}" data-has-media="${hasMedia}">
          <div class="transmission__time"><time datetime="${escapeHtml(formattedDate)}">${escapeHtml(formattedDate)}</time><span>${escapeHtml(post.readingTime || "reading time n/a")}</span></div>
          <div class="transmission__body">
            <p class="transmission__band">[${escapeHtml(visibleCategory(post.category))}]</p>
            <h3><a href="${url}">${escapeHtml(post.title)}</a></h3>
            <p>${escapeHtml(post.summary || "")}</p>
            ${topics ? `<div class="transmission__topics">${topics}</div>` : ""}
            <div class="transmission__actions">
              <a href="${url}">[read]</a>
              <button type="button" data-lock-slug="${escapeHtml(post.slug)}" aria-pressed="${selected}">${selected ? "[signal locked]" : "[lock signal]"}</button>
              <button type="button" data-share-slug="${escapeHtml(post.slug)}">[share]</button>
              <button type="button" data-bookmark-slug="${escapeHtml(post.slug)}" aria-pressed="${bookmarked}">${bookmarked ? "[bookmarked]" : "[bookmark]"}</button>
            </div>
          </div>
          ${media}
        </article>`;
    }).join("");

    elements.feed.querySelectorAll(".transmission__media img").forEach((image) => {
      image.addEventListener("error", () => image.closest(".transmission__media")?.remove(), { once: true });
    });
  }

  function renderReceiver() {
    const matches = new Set(state.filteredPosts.map((post) => post.slug));
    const bounds = dateBounds();
    const categories = [...categoryValues()].sort();
    const categoryIndex = new Map(categories.map((category, index) => [category, index]));

    elements.traces.replaceChildren(...state.posts.map((post) => {
      const trace = document.createElement("span");
      const category = normalizedCategory(post.category);
      const categoryOffset = categories.length < 2
        ? 50
        : 14 + ((categoryIndex.get(category) || 0) / (categories.length - 1)) * 72;
      const jitter = (hashSeed(post.slug) % 7) - 3;
      trace.className = "radio-observatory__trace";
      trace.style.left = `${8 + datePosition(post.date, bounds) * 0.84}%`;
      trace.style.top = `${Math.max(8, Math.min(92, categoryOffset + jitter))}%`;
      trace.dataset.match = String(matches.has(post.slug));
      trace.dataset.selected = String(post.slug === state.target);
      return trace;
    }));

    elements.dateSpectrum.innerHTML = state.filteredPosts.map((post) => {
      const selected = post.slug === state.target;
      return `<button class="radio-observatory__marker" type="button" data-spectrum-slug="${escapeHtml(post.slug)}" aria-label="Lock ${escapeHtml(post.title)}, published ${escapeHtml(formatDate(post.date))}" aria-pressed="${selected}" title="${escapeHtml(`${formatDate(post.date)} · ${post.title}`)}" style="--spectrum-position: ${datePosition(post.date, bounds).toFixed(3)}%"><span aria-hidden="true"></span></button>`;
    }).join("");

    const chronological = [...state.posts].sort((left, right) => timestamp(left.date) - timestamp(right.date));
    elements.startDate.textContent = chronological.length ? formatDate(chronological[0].date) : "earliest";
    elements.endDate.textContent = chronological.length ? formatDate(chronological.at(-1).date) : "latest";
    elements.instrumentCount.textContent = `${state.filteredPosts.length} / ${state.posts.length} received`;

    const targetKey = state.target || state.query.trim() || state.category || "all";
    const seed = hashSeed(targetKey);
    elements.instrumentSurface.style.setProperty("--radio-azimuth", `${-26 + (seed % 53)}deg`);
    elements.instrumentSurface.style.setProperty("--radio-elevation", `${-8 + (Math.floor(seed / 53) % 17)}px`);
  }

  function reasonText(reason) {
    return reason.kind === "category"
      ? `same raw category: ${reason.label}`
      : `same exact topic: ${reason.label}`;
  }

  function renderSelectedTransmission() {
    const selected = state.posts.find((post) => post.slug === state.target) || null;
    elements.selected.hidden = !selected;
    elements.clearTarget.disabled = !selected;
    if (!selected) return;

    const relationships = relationshipsFor(selected, state.posts);
    elements.selectedMeta.textContent = [
      formatDate(selected.date),
      selected.readingTime || "reading time n/a",
      visibleCategory(selected.category)
    ].join(" · ");
    elements.selectedTitle.textContent = selected.title;
    elements.selectedSummary.textContent = selected.summary || "";
    elements.selectedLink.href = articleUrl(selected);
    elements.selectedTopics.replaceChildren(...(selected.topics || []).map((topic) => {
      const tag = document.createElement("span");
      tag.textContent = `[${topic}]`;
      return tag;
    }));
    elements.relationshipCount.textContent = `${relationships.length} connected signal${relationships.length === 1 ? "" : "s"}`;

    if (!relationships.length) {
      elements.relationshipReceipts.innerHTML = '<li class="selected-transmission__empty">No other published entry shares this raw category or a repeated exact topic.</li>';
      return;
    }

    elements.relationshipReceipts.innerHTML = relationships.slice(0, MAX_RECEIPTS).map(({ post, reasons }) => `
      <li class="selected-transmission__receipt">
        <time datetime="${escapeHtml(formatDate(post.date))}">${escapeHtml(formatDate(post.date))}</time>
        <a href="${articleUrl(post)}">${escapeHtml(post.title)}</a>
        <span>${escapeHtml(reasons.map(reasonText).join("; "))}</span>
      </li>`).join("");
  }

  function renderCounts() {
    const count = state.filteredPosts.length;
    elements.resultCount.textContent = `${count} published entr${count === 1 ? "y" : "ies"}`;
    elements.endStatus.textContent = count
      ? `[${count} published entr${count === 1 ? "y" : "ies"} · engineering, systems, and life]`
      : "[no published entry matches that search]";
  }

  function render(options = {}) {
    state.filteredPosts = filterPosts(state.posts, state.query, state.category);
    updateCategoryButtons();
    renderCounts();
    renderArchive();
    renderReceiver();
    renderSelectedTransmission();

    if (options.focusBookmarkSlug) {
      requestAnimationFrame(() => {
        elements.feed
          .querySelector(`button[data-bookmark-slug="${cssEscape(options.focusBookmarkSlug)}"]`)
          ?.focus({ preventScroll: true });
      });
    }
  }

  function selectTarget(slug, options = {}) {
    if (!state.posts.some((post) => post.slug === slug)) return;
    state.target = slug;
    writeUrl("pushState");
    render();

    if (options.focusArchiveRow) {
      requestAnimationFrame(() => {
        const article = elements.feed.querySelector(`[data-blog-slug="${cssEscape(slug)}"]`);
        const link = article?.querySelector("h3 a");
        if (!link) return;
        article.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "center"
        });
        link.focus({ preventScroll: true });
      });
    }
  }

  function bindEvents() {
    elements.search.addEventListener("input", () => {
      state.query = elements.search.value.slice(0, 160);
      writeUrl("replaceState");
      render();
    });

    elements.categoryFilters.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-category]");
      if (!button || button.dataset.category === state.category) return;
      state.category = button.dataset.category;
      writeUrl("pushState");
      render();
    });

    elements.dateSpectrum.addEventListener("click", (event) => {
      const marker = event.target.closest("button[data-spectrum-slug]");
      if (!marker) return;
      selectTarget(marker.dataset.spectrumSlug, { focusArchiveRow: true });
    });

    elements.clearTarget.addEventListener("click", () => {
      state.target = "";
      writeUrl("pushState");
      render();
      document.getElementById("radio-telescope-title")?.focus({ preventScroll: true });
    });

    elements.feed.addEventListener("click", async (event) => {
      const lockButton = event.target.closest("button[data-lock-slug]");
      if (lockButton) {
        selectTarget(lockButton.dataset.lockSlug);
        return;
      }

      const shareButton = event.target.closest("button[data-share-slug]");
      if (shareButton) {
        const post = state.posts.find((candidate) => candidate.slug === shareButton.dataset.shareSlug);
        if (post) await sharePost(post);
        return;
      }

      const bookmarkButton = event.target.closest("button[data-bookmark-slug]");
      if (!bookmarkButton) return;
      const slug = bookmarkButton.dataset.bookmarkSlug;
      toggleBookmark(slug);
      render({ focusBookmarkSlug: slug });
    });

    window.addEventListener("popstate", () => {
      const next = readUrlState();
      state.category = next.category;
      state.query = next.query;
      state.target = next.target;
      elements.search.value = state.query;
      render();
    });
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
    renderLedger();

    const initial = readUrlState();
    state.category = initial.category;
    state.query = initial.query;
    state.target = initial.target;
    elements.search.value = state.query;
    elements.tuning.hidden = false;
    elements.instrument.hidden = false;
    elements.instrument.dataset.ready = "true";
    writeUrl("replaceState");
    bindEvents();
    render();
  }

  boot().catch((error) => {
    activateNavigation();
    console.error("Blog observatory enhancement unavailable", error);
    elements.endStatus.textContent = "[static archive mode · manifest unavailable]";
  });
})();
