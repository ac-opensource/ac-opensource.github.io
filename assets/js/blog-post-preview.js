(() => {
  "use strict";

  const BOOKMARKS_KEY = "ac_blog_bookmarks_v1";
  const ARTICLE_DEBRIEF_SCRIPT = "/assets/js/article-debrief.js?v=20260807-regions1";
  const REGION_LABELS = {
    technical: "SYSTEMS DEBRIEF",
    "case-study": "DELIVERY DOSSIER",
    travel: "FIELD EXPEDITION LOG",
    photography: "IMAGE SEQUENCE",
    personal: "REFLECTION LIGHT CONE"
  };
  const TRAJECTORY_NAMES = {
    technical: ["systems debrief", "Systems debrief sections"],
    "case-study": ["delivery dossier", "Delivery dossier sections"],
    travel: ["field expedition", "Field expedition notes"],
    photography: ["image sequence", "Image sequence frames"],
    personal: ["reflection light cone", "Reflection observations"]
  };

  const elements = {
    root: document.getElementById("post-preview"),
    regionLabel: document.getElementById("post-region-label"),
    category: document.getElementById("post-category"),
    date: document.getElementById("post-date"),
    reading: document.getElementById("post-reading"),
    contentCount: document.getElementById("post-content-count"),
    title: document.getElementById("post-title"),
    summary: document.getElementById("post-summary"),
    share: document.getElementById("share-post-button"),
    bookmark: document.getElementById("bookmark-post-button"),
    feedback: document.getElementById("post-feedback"),
    hero: document.getElementById("post-hero"),
    heroImage: document.getElementById("post-hero-image"),
    heroCaption: document.getElementById("post-hero-caption"),
    author: document.getElementById("post-author-name"),
    authorRole: document.getElementById("post-author-role"),
    tags: document.getElementById("post-tags"),
    trajectoryMobile: document.getElementById("post-trajectory-mobile"),
    trajectoryRail: document.getElementById("post-trajectory-rail"),
    readingRegion: document.getElementById("post-reading-region"),
    readingCount: document.getElementById("post-reading-count"),
    body: document.getElementById("post-body"),
    prevLink: document.getElementById("prev-link"),
    prevTitle: document.getElementById("prev-title"),
    nextLink: document.getElementById("next-link"),
    nextTitle: document.getElementById("next-title")
  };

  let currentPost = null;
  let feedbackTimer = 0;

  function text(value, fallback = "") {
    const normalized = String(value || "").trim();
    return normalized || fallback;
  }

  function visibleCategory(value) {
    const category = text(value, "log").toLowerCase();
    return category === "work" ? "portfolio" : category;
  }

  function assetUrl(value) {
    const source = text(value);
    if (!source || /^(?:https?:)?\/\//i.test(source) || source.startsWith("/")) return source;
    return `/blog/${source.replace(/^\.?\//, "")}`;
  }

  function staticPostUrl(slug) {
    return `/blog/${encodeURIComponent(text(slug))}.html`;
  }

  function slugifyHeading(value, fallback) {
    const stem = text(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    return `debrief-${stem || fallback}`;
  }

  function phaseForMode(mode) {
    return {
      technical: "system",
      "case-study": "delivery record",
      travel: "field note",
      photography: "frame",
      personal: "observation"
    }[mode] || "section";
  }

  function modeForPost(post, figureCount) {
    const category = text(post.category).toLowerCase();
    const slug = text(post.slug).toLowerCase();
    const topics = (post.topics || []).map((topic) => text(topic).toLowerCase());

    if (category === "work" || slug.startsWith("case-study-")) return "case-study";
    if (category === "technical") return "technical";
    if (topics.includes("travel")) return "travel";
    if (topics.includes("photography") || (category === "hobby" && figureCount >= 3)) return "photography";
    return "personal";
  }

  function decorateBody(post) {
    const template = document.createElement("template");
    template.innerHTML = text(post.bodyHtml) || `<p>${text(post.summary, "This entry has no authored body yet.")}</p>`;

    template.content.querySelectorAll("img").forEach((image) => {
      if (!image.hasAttribute("loading")) image.loading = "lazy";
      if (!image.hasAttribute("decoding")) image.decoding = "async";
      const source = image.getAttribute("src");
      if (source) image.setAttribute("src", assetUrl(source));
    });

    const figures = Array.from(template.content.querySelectorAll("figure"));
    const mode = modeForPost(post, figures.length);
    const usedIds = new Set(
      Array.from(template.content.querySelectorAll("[id]"))
        .map((node) => node.id)
        .filter(Boolean)
    );
    const headings = Array.from(template.content.querySelectorAll("h2, h3")).map((heading, index) => {
      let id = text(heading.id);
      if (!id) {
        const base = slugifyHeading(heading.textContent, `section-${index + 1}`);
        id = base;
        let suffix = 2;
        while (usedIds.has(id)) {
          id = `${base}-${suffix}`;
          suffix += 1;
        }
        heading.id = id;
      }
      usedIds.add(id);
      heading.dataset.debriefHeading = "";
      heading.dataset.debriefPhase = phaseForMode(mode);
      return {
        id,
        index: index + 1,
        phase: phaseForMode(mode),
        title: text(heading.textContent, `Section ${index + 1}`)
      };
    });

    const frames = figures.map((figure, index) => {
      let id = text(figure.id);
      if (!id) {
        const base = `field-frame-${String(index + 1).padStart(2, "0")}`;
        id = base;
        let suffix = 2;
        while (usedIds.has(id)) {
          id = `${base}-${suffix}`;
          suffix += 1;
        }
        figure.id = id;
      }
      usedIds.add(id);
      figure.dataset.articleFigure = "";
      const caption = figure.querySelector("figcaption");
      const image = figure.querySelector("img");
      return {
        id,
        index: index + 1,
        phase: "frame",
        title: text(caption?.textContent || image?.alt, `Frame ${index + 1}`)
      };
    });

    return { content: template.content, headings, frames, mode };
  }

  function trajectoryLink(item) {
    const listItem = document.createElement("li");
    listItem.className = "article-trajectory__item";
    listItem.dataset.trajectoryItem = "";

    const link = document.createElement("a");
    link.className = "article-trajectory__link";
    link.href = `#${encodeURIComponent(item.id)}`;
    link.dataset.trajectoryLink = "";
    link.dataset.sectionId = item.id;

    const index = document.createElement("span");
    index.className = "article-trajectory__index";
    index.textContent = String(item.index).padStart(2, "0");

    const phase = document.createElement("span");
    phase.className = "article-trajectory__phase";
    phase.textContent = `[${item.phase}]`;

    const title = document.createElement("span");
    title.className = "article-trajectory__title";
    title.textContent = item.title;

    link.append(index, phase, title);
    listItem.append(link);
    return listItem;
  }

  function trajectoryList(items) {
    const list = document.createElement("ol");
    list.className = "article-trajectory__list";
    items.forEach((item) => list.append(trajectoryLink(item)));
    return list;
  }

  function renderTrajectory(mode, headings, frames) {
    const items = mode === "photography" && frames.length ? frames : headings;
    elements.trajectoryMobile.replaceChildren();
    elements.trajectoryRail.replaceChildren();

    if (!items.length) {
      elements.trajectoryMobile.className = "article-debrief__quiet-marker";
      elements.trajectoryMobile.setAttribute("aria-label", "Reading mode");
      elements.trajectoryMobile.textContent = "[uninterrupted reading field]";
      return items;
    }

    const [modeLabel, ariaLabel] = TRAJECTORY_NAMES[mode] || ["reading field", "Article sections"];
    const unit = mode === "photography" ? (items.length === 1 ? "frame" : "frames") : (items.length === 1 ? "section" : "sections");

    const details = document.createElement("details");
    details.className = "article-trajectory article-trajectory--mobile";
    details.dataset.trajectoryDetails = "";
    const summary = document.createElement("summary");
    summary.className = "article-trajectory__summary";
    const summaryMode = document.createElement("span");
    summaryMode.textContent = `[${modeLabel}]`;
    const summaryCount = document.createElement("span");
    summaryCount.textContent = `${items.length} ${unit}`;
    summary.append(summaryMode, summaryCount);
    const mobileNav = document.createElement("nav");
    mobileNav.setAttribute("aria-label", ariaLabel);
    mobileNav.append(trajectoryList(items));
    details.append(summary, mobileNav);
    elements.trajectoryMobile.className = "";
    elements.trajectoryMobile.removeAttribute("aria-label");
    elements.trajectoryMobile.append(details);

    const desktopNav = document.createElement("nav");
    desktopNav.className = "article-trajectory article-trajectory--desktop";
    desktopNav.setAttribute("aria-label", ariaLabel);
    desktopNav.dataset.articleTrajectory = "";
    const eyebrow = document.createElement("p");
    eyebrow.className = "article-trajectory__eyebrow";
    eyebrow.textContent = `[${modeLabel}]`;
    desktopNav.append(eyebrow, trajectoryList(items));
    elements.trajectoryRail.append(desktopNav);
    return items;
  }

  function setMode(mode) {
    const regionLabel = REGION_LABELS[mode] || "READING FIELD";
    document.body.dataset.articleMode = mode;
    elements.root.dataset.articleMode = mode;
    elements.root.dataset.debriefVariant = ["technical", "case-study"].includes(mode) ? "mission" : "observation";
    elements.regionLabel.textContent = regionLabel;
    elements.authorRole.textContent = regionLabel;
    elements.readingRegion.textContent = regionLabel;
    elements.hero.className = `article-region__hero article-region__hero--${mode}`;
    return regionLabel;
  }

  function renderTags(post) {
    const tags = [...new Set([...(post.topics || []), post.category].map((tag) => text(tag)).filter(Boolean))];
    elements.tags.replaceChildren();
    (tags.length ? tags : ["log"]).forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "text-[10px] font-label border border-outline-variant/30 px-2 py-1";
      chip.textContent = `#${tag.replace(/\s+/g, "_").toLowerCase()}`;
      elements.tags.append(chip);
    });
  }

  function renderHero(post, mode) {
    const source = assetUrl(post.heroImage);
    elements.hero.hidden = true;
    elements.heroImage.removeAttribute("src");
    elements.heroImage.alt = "";
    elements.heroCaption.hidden = true;
    elements.heroCaption.textContent = "";
    elements.hero.className = `article-region__hero article-region__hero--${mode}`;

    if (!source) return;
    elements.heroImage.src = source;
    elements.heroImage.alt = text(post.heroAlt, `${text(post.title, "Published log")} cover`);
    const caption = text(post.heroCaption);
    if (caption) {
      elements.heroCaption.textContent = caption;
      elements.heroCaption.hidden = false;
    }
    elements.hero.hidden = false;
  }

  function loadBookmarks() {
    try {
      const parsed = JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]");
      return new Set(Array.isArray(parsed) ? parsed.map((value) => text(value)).filter(Boolean) : []);
    } catch (_error) {
      return new Set();
    }
  }

  function saveBookmarks(bookmarks) {
    try {
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(Array.from(bookmarks)));
    } catch (_error) {
      announce("Bookmark storage is unavailable in this browser.");
    }
  }

  function setBookmarkState(active) {
    elements.bookmark.textContent = active ? "[BOOKMARKED]" : "[BOOKMARK]";
    elements.bookmark.setAttribute("aria-pressed", String(active));
  }

  function announce(message) {
    window.clearTimeout(feedbackTimer);
    elements.feedback.textContent = message;
    feedbackTimer = window.setTimeout(() => {
      elements.feedback.textContent = "";
    }, 4000);
  }

  async function shareCurrentPost() {
    if (!currentPost) return;
    const url = new URL(staticPostUrl(currentPost.slug), window.location.origin).href;
    const payload = { title: text(currentPost.title, "Published log"), url };

    if (navigator.share) {
      try {
        await navigator.share(payload);
        announce("Share sheet opened for the static published entry.");
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        announce("Static published-entry link copied.");
        return;
      } catch (_error) {
        // Continue to the prompt fallback.
      }
    }

    window.prompt("Copy the static published-entry link:", url);
  }

  function toggleBookmark() {
    if (!currentPost) return;
    const bookmarks = loadBookmarks();
    if (bookmarks.has(currentPost.slug)) bookmarks.delete(currentPost.slug);
    else bookmarks.add(currentPost.slug);
    saveBookmarks(bookmarks);
    const active = bookmarks.has(currentPost.slug);
    setBookmarkState(active);
    announce(active ? "Entry bookmarked in this browser." : "Bookmark removed.");
  }

  function setAdjacentLink(link, titleNode, post, fallbackDirection) {
    if (post) {
      link.href = staticPostUrl(post.slug);
      titleNode.textContent = text(post.title, "Untitled entry");
      return;
    }
    link.href = "/blog/";
    titleNode.textContent = fallbackDirection === "previous" ? "Beginning of static Logs" : "Latest point in static Logs";
  }

  function loadDebriefBehavior() {
    if (document.querySelector(`script[src="${ARTICLE_DEBRIEF_SCRIPT}"]`)) return;
    const script = document.createElement("script");
    script.src = ARTICLE_DEBRIEF_SCRIPT;
    script.addEventListener("error", () => announce("The reading trajectory could not be activated."), { once: true });
    document.body.append(script);
  }

  async function renderPost(post) {
    const decorated = decorateBody(post);
    const regionLabel = setMode(decorated.mode);
    const trajectoryItems = renderTrajectory(decorated.mode, decorated.headings, decorated.frames);
    const contentCount = trajectoryItems.length;
    const unit = decorated.mode === "photography"
      ? (contentCount === 1 ? "frame" : "frames")
      : (contentCount === 1 ? "section" : "sections");
    const authoredUnit = decorated.mode === "photography"
      ? (contentCount === 1 ? "real frame" : "real frames")
      : (contentCount === 1 ? "authored section" : "authored sections");

    currentPost = post;
    elements.category.textContent = visibleCategory(post.category);
    elements.date.dateTime = text(post.date);
    elements.date.textContent = text(post.date, "Undated");
    elements.reading.textContent = text(post.readingTime, "Reading time unavailable");
    elements.contentCount.textContent = `${contentCount} ${unit}`;
    elements.title.textContent = text(post.title, "Untitled entry");
    elements.summary.textContent = text(post.summary, "A published entry from the SQLite source.");
    elements.author.textContent = text(post.author, "Andrew Concepcion");
    elements.readingCount.textContent = `${contentCount} ${authoredUnit}`;
    elements.body.replaceChildren(decorated.content.cloneNode(true));
    renderHero(post, decorated.mode);
    renderTags(post);

    const adjacent = await window.blogSqlite.getAdjacentPosts(post.slug);
    setAdjacentLink(elements.prevLink, elements.prevTitle, adjacent.previous, "previous");
    setAdjacentLink(elements.nextLink, elements.nextTitle, adjacent.next, "next");

    document.title = `${text(post.title, "Published log")} — Authoring Preview`;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = text(post.summary, "Noindex authoring preview of a published log entry.");

    elements.share.disabled = false;
    elements.bookmark.disabled = false;
    setBookmarkState(loadBookmarks().has(post.slug));
    elements.root.setAttribute("aria-label", `${regionLabel}: ${text(post.title, "Untitled entry")}`);
    elements.root.setAttribute("aria-busy", "false");
    loadDebriefBehavior();
  }

  function appendErrorContent(message) {
    const heading = document.createElement("h2");
    heading.textContent = "The published source did not resolve.";
    const explanation = document.createElement("p");
    explanation.textContent = message;
    const recovery = document.createElement("p");
    const link = document.createElement("a");
    link.href = "/blog/";
    link.textContent = "Open complete static Logs";
    recovery.append(link, " to continue reading without this authoring route.");
    elements.body.replaceChildren(heading, explanation, recovery);
  }

  function renderError(message) {
    currentPost = null;
    document.body.dataset.articleMode = "personal";
    elements.root.dataset.articleMode = "personal";
    elements.root.dataset.debriefVariant = "observation";
    elements.regionLabel.textContent = "AUTHORING PREVIEW ERROR";
    elements.category.textContent = "PUBLISHED SOURCE UNAVAILABLE";
    elements.date.removeAttribute("datetime");
    elements.date.textContent = "NOT RESOLVED";
    elements.reading.textContent = "STATIC LOGS AVAILABLE";
    elements.contentCount.textContent = "0 SECTIONS";
    elements.title.textContent = "Preview unavailable.";
    elements.summary.textContent = "This noindex route could not open the requested published entry. The complete static archive remains available.";
    elements.authorRole.textContent = "AUTHORING PREVIEW ERROR";
    elements.readingRegion.textContent = "AUTHORING PREVIEW ERROR";
    elements.readingCount.textContent = "0 authored sections";
    elements.hero.hidden = true;
    elements.trajectoryRail.replaceChildren();
    elements.trajectoryMobile.className = "article-debrief__quiet-marker";
    elements.trajectoryMobile.setAttribute("aria-label", "Preview error");
    elements.trajectoryMobile.textContent = "[static reading paths remain available]";
    elements.share.disabled = true;
    elements.bookmark.disabled = true;
    setAdjacentLink(elements.prevLink, elements.prevTitle, null, "previous");
    setAdjacentLink(elements.nextLink, elements.nextTitle, null, "next");
    appendErrorContent(message);
    document.title = "Preview unavailable — Authoring Preview";
    elements.root.setAttribute("aria-busy", "false");
  }

  async function initialize() {
    if (!elements.root || !elements.body) return;
    elements.root.hidden = false;
    elements.share.addEventListener("click", shareCurrentPost);
    elements.bookmark.addEventListener("click", toggleBookmark);
    elements.heroImage.addEventListener("error", () => {
      elements.hero.hidden = true;
      announce("The published hero image could not be displayed.");
    });

    if (!window.blogSqlite) {
      renderError("The SQLite preview loader is unavailable in this browser session.");
      return;
    }

    const requestedSlug = text(new URLSearchParams(window.location.search).get("slug"));
    try {
      const post = requestedSlug
        ? await window.blogSqlite.getPostBySlug(requestedSlug)
        : await window.blogSqlite.getLatestPost();

      if (!post) {
        renderError(
          requestedSlug
            ? `No published entry matches “${requestedSlug}”.`
            : "There are no published entries in the SQLite source."
        );
        return;
      }

      await renderPost(post);
    } catch (_error) {
      renderError("The published SQLite source could not be loaded. This does not affect the complete static Logs.");
    }
  }

  initialize();
})();
