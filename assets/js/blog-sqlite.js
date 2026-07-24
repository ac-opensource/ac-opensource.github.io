(function (global) {
  const SQL_JS_SCRIPT_URL = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.min.js";
  const SQL_JS_WASM_URL = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm";
  const BLOG_DB_URL = "/assets/data/blog.sqlite";

  let dbPromise;
  let allPostsPromise;

  function normalizeTopics(encoded) {
    if (!encoded) return [];
    return String(encoded)
      .split("|||")
      .map((topic) => topic.trim())
      .filter(Boolean);
  }

  function normalizePost(row) {
    return {
      slug: row.slug,
      title: row.title,
      author: row.author,
      summary: row.summary,
      category: row.category,
      date: row.published_date,
      readingTime: row.reading_time,
      heroImage: row.hero_image,
      heroAlt: row.hero_alt,
      heroCaption: row.hero_caption,
      bodyHtml: row.body_html,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
      topics: normalizeTopics(row.topics)
    };
  }

  function parseDateValue(value) {
    const ts = Date.parse(String(value || ""));
    return Number.isFinite(ts) ? ts : 0;
  }

  function sortPostsDescending(posts) {
    return posts.slice().sort((a, b) => parseDateValue(b.date) - parseDateValue(a.date));
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-src="${url}"]`);
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error(`Failed to load ${url}`)), { once: true });
        if (existing.dataset.loaded === "1") resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.dataset.src = url;
      script.addEventListener("load", () => {
        script.dataset.loaded = "1";
        resolve();
      });
      script.addEventListener("error", () => reject(new Error(`Failed to load ${url}`)));
      document.head.appendChild(script);
    });
  }

  async function ensureSqlJs() {
    if (!global.initSqlJs) {
      await loadScript(SQL_JS_SCRIPT_URL);
    }

    if (!global.initSqlJs) {
      throw new Error("sql.js failed to initialize.");
    }

    return global.initSqlJs;
  }

  async function queryRows(sql, params) {
    const db = await getDb();
    const statement = db.prepare(sql);

    if (Array.isArray(params) && params.length) {
      statement.bind(params);
    }

    const rows = [];
    while (statement.step()) {
      rows.push(statement.getAsObject());
    }

    statement.free();
    return rows;
  }

  async function getDb() {
    if (!dbPromise) {
      dbPromise = (async () => {
        const initSqlJs = await ensureSqlJs();
        const SQL = await initSqlJs({
          locateFile: () => SQL_JS_WASM_URL
        });

        const response = await fetch(BLOG_DB_URL, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Unable to load SQLite database (${response.status}).`);
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        return new SQL.Database(bytes);
      })();
    }

    return dbPromise;
  }

  async function getAllPosts() {
    if (!allPostsPromise) {
      allPostsPromise = (async () => {
        const rows = await queryRows(
          `
          SELECT
            p.slug,
            p.title,
            p.author,
            p.summary,
            p.category,
            p.published_date,
            p.reading_time,
            p.hero_image,
            p.hero_alt,
            p.hero_caption,
            p.body_html,
            p.updated_at,
            p.created_at,
            COALESCE(
              (
                SELECT GROUP_CONCAT(topic, '|||')
                FROM (
                  SELECT topic
                  FROM post_topics
                  WHERE post_slug = p.slug
                  ORDER BY position ASC, topic ASC
                )
              ),
              ''
            ) AS topics
          FROM posts p
          WHERE p.status = 'published'
          ORDER BY p.published_date DESC, p.created_at DESC
          `
        );

        return sortPostsDescending(rows.map(normalizePost));
      })();
    }

    return allPostsPromise;
  }

  function filterPosts(posts, options) {
    const search = String((options && options.search) || "").trim().toLowerCase();
    const category = String((options && options.category) || "").trim().toLowerCase();

    let output = posts;

    if (category && category !== "all") {
      output = output.filter((post) => String(post.category || "").toLowerCase() === category);
    }

    if (search) {
      output = output.filter((post) => {
        const bag = [
          post.title,
          post.author,
          post.summary,
          post.category,
          ...(post.topics || [])
        ]
          .join(" ")
          .toLowerCase();
        return bag.includes(search);
      });
    }

    if (options && Number.isFinite(options.limit)) {
      output = output.slice(0, options.limit);
    }

    return output;
  }

  async function getPosts(options) {
    const posts = await getAllPosts();
    return filterPosts(posts, options || {});
  }

  async function getPostBySlug(slug) {
    const key = String(slug || "").trim();
    if (!key) return null;

    const rows = await queryRows(
      `
      SELECT
        p.slug,
        p.title,
        p.author,
        p.summary,
        p.category,
        p.published_date,
        p.reading_time,
        p.hero_image,
        p.hero_alt,
        p.hero_caption,
        p.body_html,
        p.updated_at,
        p.created_at,
        COALESCE(
          (
            SELECT GROUP_CONCAT(topic, '|||')
            FROM (
              SELECT topic
              FROM post_topics
              WHERE post_slug = p.slug
              ORDER BY position ASC, topic ASC
            )
          ),
          ''
        ) AS topics
      FROM posts p
      WHERE p.slug = ?
      LIMIT 1
      `,
      [key]
    );

    return rows.length ? normalizePost(rows[0]) : null;
  }

  async function getCategoryCounts() {
    const posts = await getAllPosts();
    const counts = new Map();

    for (const post of posts) {
      const key = post.category || "uncategorized";
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  }

  async function getAdjacentPosts(slug) {
    const posts = await getAllPosts();
    const index = posts.findIndex((post) => post.slug === slug);

    if (index < 0) {
      return {
        previous: null,
        next: null
      };
    }

    return {
      previous: posts[index + 1] || null,
      next: posts[index - 1] || null
    };
  }

  async function getLatestPost() {
    const posts = await getAllPosts();
    return posts.length ? posts[0] : null;
  }

  global.blogSqlite = {
    getDb,
    getPosts,
    getPostBySlug,
    getCategoryCounts,
    getAdjacentPosts,
    getLatestPost
  };
})(window);
