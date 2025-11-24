(function () {
    const BLOG_DATA_URL = "/blog/posts.json";

    function formatDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }
        return new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        }).format(date);
    }

    function createTagPill(text) {
        const pill = document.createElement("span");
        pill.className = "chip text-xs bg-slate-50 text-slate-600";
        pill.textContent = text;
        return pill;
    }

    function createArticle(post) {
        const article = document.createElement("article");
        article.className = "card p-6 flex flex-col gap-4 h-full";

        const header = document.createElement("div");

        const meta = document.createElement("p");
        meta.className = "text-xs font-semibold uppercase tracking-wide text-slate-500";
        meta.textContent = formatDate(post.date);
        if (post.readingTime) {
            const separator = document.createElement("span");
            separator.textContent = " · ";
            meta.appendChild(separator);
            const read = document.createElement("span");
            read.textContent = post.readingTime;
            meta.appendChild(read);
        }
        header.appendChild(meta);

        const title = document.createElement("h3");
        title.className = "text-xl font-semibold mt-2";
        const link = document.createElement("a");
        link.className = "hover:underline";
        link.href = `/blog/${post.slug}.html`;
        link.textContent = post.title;
        title.appendChild(link);
        header.appendChild(title);

        if (post.summary) {
            const summary = document.createElement("p");
            summary.className = "text-sm text-slate-700 mt-3";
            summary.textContent = post.summary;
            header.appendChild(summary);
        }

        article.appendChild(header);

        if (Array.isArray(post.topics) && post.topics.length) {
            const tagList = document.createElement("div");
            tagList.className = "flex flex-wrap gap-2";
            post.topics.forEach((topic) => {
                tagList.appendChild(createTagPill(topic));
            });
            article.appendChild(tagList);
        }

        const cta = document.createElement("a");
        cta.className = "mt-auto inline-flex items-center gap-2 text-sm font-semibold text-slate-900";
        cta.href = `/blog/${post.slug}.html`;
        cta.innerHTML = 'Read post <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>';
        article.appendChild(cta);

        return article;
    }

    function filterByCategory(posts, category) {
        if (!category) return posts;
        return posts.filter((post) => post.category === category);
    }

    function createReadMoreCard({ href, label }) {
        const article = document.createElement("article");
        article.className = "card p-6 flex flex-col gap-3 h-full justify-center";

        const title = document.createElement("h3");
        title.className = "text-lg font-semibold";
        title.textContent = label || "Read more";
        article.appendChild(title);

        const description = document.createElement("p");
        description.className = "text-sm text-slate-700";
        description.textContent = "Browse the latest notes and essays.";
        article.appendChild(description);

        const cta = document.createElement("a");
        cta.className = "inline-flex items-center gap-2 text-sm font-semibold text-slate-900";
        cta.href = href;
        cta.innerHTML = 'Visit the blog <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>';
        article.appendChild(cta);

        return article;
    }

    async function loadBlogPosts({
        containerId,
        limit,
        category,
        emptyMessage,
        readMoreUrl,
        readMoreLabel,
    } = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-sm text-slate-500">Loading posts…</p>';
        try {
            const response = await fetch(BLOG_DATA_URL);
            if (!response.ok) throw new Error("Unable to fetch posts");
            const posts = await response.json();
            const sorted = posts.sort(
                (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
            );
            const filtered = filterByCategory(sorted, category);
            const items = typeof limit === "number" ? filtered.slice(0, limit) : filtered;
            if (items.length === 0) {
                container.innerHTML = `
                    <p class="text-sm text-slate-700">
                        ${emptyMessage || "No posts yet."}
                    </p>
                `;
                return;
            }
            container.innerHTML = "";
            items.forEach((post) => container.appendChild(createArticle(post)));
            if (readMoreUrl) {
                container.appendChild(
                    createReadMoreCard({ href: readMoreUrl, label: readMoreLabel })
                );
            }
        } catch (error) {
            container.innerHTML = '<p class="text-sm text-slate-700">Failed to load blog posts.</p>';
        }
    }

    window.blogFeed = { loadBlogPosts };
})();
