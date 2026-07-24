(function () {
    const BLOG_DATA_URL = "/blog/posts.json";

    function formatDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric"
        }).format(date);
    }

    function createTopicBadge(topic) {
        const tag = document.createElement("span");
        tag.className = "badge";
        tag.textContent = topic;
        return tag;
    }

    function createPostCard(post) {
        const card = document.createElement("article");
        card.className = "card post-card";

        const meta = document.createElement("p");
        meta.className = "post-meta";
        meta.textContent = formatDate(post.date);
        if (post.readingTime) {
            meta.textContent += ` • ${post.readingTime}`;
        }

        const title = document.createElement("h3");
        title.className = "post-title";
        const titleLink = document.createElement("a");
        titleLink.href = `/blog/${post.slug}.html`;
        titleLink.textContent = post.title;
        titleLink.className = "post-title-link";
        title.appendChild(titleLink);

        const summary = document.createElement("p");
        summary.className = "post-summary";
        summary.textContent = post.summary || "No summary provided.";

        const tags = document.createElement("div");
        tags.className = "badges";
        (post.topics || []).forEach((topic) => {
            tags.appendChild(createTopicBadge(topic));
        });

        const cta = document.createElement("a");
        cta.className = "btn btn-subtle btn-sm";
        cta.href = `/blog/${post.slug}.html`;
        cta.textContent = "Read post";

        card.append(meta, title, summary);
        if ((post.topics || []).length) card.appendChild(tags);
        card.appendChild(cta);

        return card;
    }

    async function fetchPosts() {
        const response = await fetch(BLOG_DATA_URL, { cache: "no-store" });
        if (!response.ok) {
            throw new Error("Unable to fetch posts");
        }

        const posts = await response.json();
        return posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    function applyFilter(posts, category) {
        if (!category || category === "all") return posts;
        return posts.filter((post) => post.category === category);
    }

    function updateButtonStates(buttons, activeFilter) {
        buttons.forEach((button) => {
            const isActive = button.dataset.filter === activeFilter;
            button.classList.toggle("btn-primary", isActive);
            button.classList.toggle("btn-ghost", !isActive);
        });
    }

    async function renderFeed({ containerId, category = "all", limit, emptyMessage }) {
        const container = document.getElementById(containerId);
        if (!container) return [];

        container.innerHTML = "<p class=\"notice\">Loading posts...</p>";

        try {
            const posts = await fetchPosts();
            const filtered = applyFilter(posts, category);
            const sliced = typeof limit === "number" ? filtered.slice(0, limit) : filtered;

            if (!sliced.length) {
                container.innerHTML = `<p class=\"notice\">${emptyMessage || "No posts found."}</p>`;
                return posts;
            }

            container.innerHTML = "";
            sliced.forEach((post) => container.appendChild(createPostCard(post)));
            return posts;
        } catch (error) {
            container.innerHTML = `<p class=\"notice\">Failed to load posts. ${error.message}</p>`;
            return [];
        }
    }

    async function hydrateBlogIndex({ containerId, filterButtons = [] } = {}) {
        const buttons = Array.isArray(filterButtons) ? filterButtons : [];
        let activeFilter = "all";

        await renderFeed({ containerId, category: activeFilter });
        updateButtonStates(buttons, activeFilter);

        buttons.forEach((button) => {
            button.addEventListener("click", async () => {
                activeFilter = button.dataset.filter || "all";
                updateButtonStates(buttons, activeFilter);
                await renderFeed({ containerId, category: activeFilter });
            });
        });
    }

    async function loadBlogPosts({
        containerId,
        limit,
        category,
        emptyMessage
    } = {}) {
        const resolvedCategory = category || "all";
        await renderFeed({
            containerId,
            limit,
            category: resolvedCategory,
            emptyMessage
        });
    }

    window.blogFeed = {
        hydrateBlogIndex,
        loadBlogPosts
    };
})();
