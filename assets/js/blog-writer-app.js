(function () {
  const state = {
    posts: [],
    currentSlug: "",
    slugLocked: false,
    quill: null
  };

  const elements = {
    form: document.getElementById("writer-form"),
    list: document.getElementById("posts-list"),
    search: document.getElementById("search-posts"),
    status: document.getElementById("status-text"),
    newBtn: document.getElementById("new-post-btn"),
    deleteBtn: document.getElementById("delete-post-btn"),
    previewLink: document.getElementById("preview-link"),
    title: document.getElementById("title-input"),
    slug: document.getElementById("slug-input"),
    date: document.getElementById("date-input"),
    author: document.getElementById("author-input"),
    category: document.getElementById("category-input"),
    readingTime: document.getElementById("reading-time-input"),
    topics: document.getElementById("topics-input"),
    summary: document.getElementById("summary-input"),
    heroImage: document.getElementById("hero-image-input"),
    heroAlt: document.getElementById("hero-alt-input"),
    heroCaption: document.getElementById("hero-caption-input")
  };

  function setStatus(text, isError) {
    elements.status.textContent = text;
    elements.status.classList.toggle("text-red-600", Boolean(isError));
    elements.status.classList.toggle("text-muted", !isError);
  }

  function todayIso() {
    const now = new Date();
    const y = now.getFullYear();
    const m = `${now.getMonth() + 1}`.padStart(2, "0");
    const d = `${now.getDate()}`.padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(date);
  }

  async function request(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `Request failed (${response.status})`);
    }

    return payload;
  }

  function buildPostRow(post) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "w-full text-left border border-stroke bg-surface px-3 py-3 hover:bg-panel transition-colors";
    item.dataset.slug = post.slug;

    if (post.slug === state.currentSlug) {
      item.classList.add("ring-1", "ring-accent");
    }

    item.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <p class="font-mono text-[10px] uppercase tracking-widest text-muted">${post.published_date || ""}</p>
        <p class="font-mono text-[10px] uppercase tracking-widest text-muted">${post.category || ""}</p>
      </div>
      <p class="mt-2 text-sm font-semibold leading-tight">${post.title || post.slug}</p>
      <p class="mt-1 text-[11px] font-mono text-muted uppercase tracking-wider">${post.slug}</p>
    `;

    item.addEventListener("click", () => loadPost(post.slug));
    return item;
  }

  function renderList(query) {
    const q = String(query || "").trim().toLowerCase();
    const filtered = state.posts.filter((post) => {
      if (!q) return true;
      const bag = [
        post.slug,
        post.title,
        post.summary,
        post.category,
        ...(post.topics || [])
      ]
        .join(" ")
        .toLowerCase();
      return bag.includes(q);
    });

    elements.list.innerHTML = "";

    if (!filtered.length) {
      const empty = document.createElement("p");
      empty.className = "text-xs font-mono uppercase tracking-wider text-muted";
      empty.textContent = "No entries";
      elements.list.appendChild(empty);
      return;
    }

    filtered.forEach((post) => elements.list.appendChild(buildPostRow(post)));
  }

  async function fetchPosts() {
    state.posts = await request("/api/posts");
    renderList(elements.search.value);
  }

  function clearForm() {
    state.currentSlug = "";
    state.slugLocked = false;

    elements.title.value = "";
    elements.slug.value = "";
    elements.date.value = todayIso();
    elements.author.value = "Andrew Concepcion";
    elements.category.value = "technical";
    elements.readingTime.value = "6 min read";
    elements.topics.value = "";
    elements.summary.value = "";
    elements.heroImage.value = "";
    elements.heroAlt.value = "";
    elements.heroCaption.value = "";
    elements.previewLink.href = "/blog/";

    state.quill.setText("\n");
    renderList(elements.search.value);
  }

  function applyPost(post) {
    state.currentSlug = post.slug;
    state.slugLocked = true;

    elements.title.value = post.title || "";
    elements.slug.value = post.slug || "";
    elements.date.value = post.published_date || todayIso();
    elements.author.value = post.author || "Andrew Concepcion";
    elements.category.value = post.category || "technical";
    elements.readingTime.value = post.reading_time || "6 min read";
    elements.topics.value = (post.topics || []).join(", ");
    elements.summary.value = post.summary || "";
    elements.heroImage.value = post.hero_image || "";
    elements.heroAlt.value = post.hero_alt || "";
    elements.heroCaption.value = post.hero_caption || "";

    state.quill.root.innerHTML = post.body_html || "<p><br></p>";

    elements.previewLink.href = `/blog/post.html?slug=${encodeURIComponent(post.slug)}`;
    renderList(elements.search.value);
  }

  async function loadPost(slug) {
    try {
      setStatus(`Loading ${slug}...`);
      const post = await request(`/api/posts/${encodeURIComponent(slug)}`);
      applyPost(post);
      setStatus(`Loaded ${post.title}`);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function buildPayload() {
    const title = elements.title.value.trim();
    const date = elements.date.value || todayIso();

    let slug = elements.slug.value.trim();
    if (!slug) {
      slug = `${date}-${slugify(title)}`;
      elements.slug.value = slug;
    }

    return {
      title,
      slug,
      published_date: date,
      author: elements.author.value.trim() || "Andrew Concepcion",
      category: elements.category.value.trim() || "technical",
      reading_time: elements.readingTime.value.trim() || "6 min read",
      topics: elements.topics.value
        .split(",")
        .map((topic) => topic.trim())
        .filter(Boolean),
      summary: elements.summary.value.trim(),
      hero_image: elements.heroImage.value.trim(),
      hero_alt: elements.heroAlt.value.trim(),
      hero_caption: elements.heroCaption.value.trim(),
      body_html: state.quill.root.innerHTML
    };
  }

  async function savePost(event) {
    event.preventDefault();

    try {
      const payload = buildPayload();
      if (!payload.title) {
        setStatus("Title is required.", true);
        return;
      }

      setStatus("Saving...");
      const result = await request("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      applyPost(result.post);
      await fetchPosts();
      setStatus(`Saved ${result.post.slug}`);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function deletePost() {
    if (!state.currentSlug) {
      setStatus("Load a post before deleting.", true);
      return;
    }

    if (!window.confirm(`Delete post "${state.currentSlug}"?`)) {
      return;
    }

    try {
      setStatus(`Deleting ${state.currentSlug}...`);
      await request(`/api/posts/${encodeURIComponent(state.currentSlug)}`, {
        method: "DELETE"
      });
      clearForm();
      await fetchPosts();
      setStatus("Post deleted.");
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function setupEditor() {
    state.quill = new Quill("#editor", {
      theme: "snow",
      modules: {
        toolbar: [
          [{ header: [2, 3, 4, false] }],
          ["bold", "italic", "underline", "blockquote"],
          [{ list: "ordered" }, { list: "bullet" }],
          ["code-block", "link"],
          ["clean"]
        ]
      }
    });
  }

  function wireEvents() {
    elements.form.addEventListener("submit", savePost);
    elements.newBtn.addEventListener("click", () => {
      clearForm();
      setStatus("New entry draft started.");
    });
    elements.deleteBtn.addEventListener("click", deletePost);

    elements.search.addEventListener("input", (event) => {
      renderList(event.target.value);
    });

    elements.title.addEventListener("input", () => {
      if (state.slugLocked) return;
      const date = elements.date.value || todayIso();
      const autoSlug = slugify(elements.title.value);
      elements.slug.value = autoSlug ? `${date}-${autoSlug}` : "";
    });

    elements.slug.addEventListener("input", () => {
      state.slugLocked = elements.slug.value.trim().length > 0;
    });

    elements.date.addEventListener("change", () => {
      if (state.slugLocked) return;
      const autoSlug = slugify(elements.title.value);
      elements.slug.value = autoSlug ? `${elements.date.value || todayIso()}-${autoSlug}` : "";
    });
  }

  async function boot() {
    setupEditor();
    wireEvents();
    clearForm();

    try {
      await fetchPosts();
      setStatus(`Loaded ${state.posts.length} posts (${formatDate(todayIso())}).`);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  boot();
})();
