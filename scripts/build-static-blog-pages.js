const fs = require("fs");
const path = require("path");
const {
  openDatabase,
  ensureSchema,
  getPostList,
  getPostWithTopics
} = require("./lib/blog-db");

const ROOT_DIR = path.join(__dirname, "..");
const BLOG_DIR = path.join(ROOT_DIR, "blog");
const SITE_ORIGIN = String(process.env.SITE_ORIGIN || "https://ac-opensource.github.io").replace(/\/+$/, "");
const FALLBACK_HERO_IMAGE = "/blog/images/new-zealand-aurora.png";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toAbsoluteUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return `${SITE_ORIGIN}${FALLBACK_HERO_IMAGE}`;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("/")) return `${SITE_ORIGIN}${value}`;
  return `${SITE_ORIGIN}/blog/${value.replace(/^\.?\//, "")}`;
}

function toAssetUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return FALLBACK_HERO_IMAGE;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    if (value.startsWith(`${SITE_ORIGIN}/`)) {
      return value.replace(SITE_ORIGIN, "");
    }
    return value;
  }
  if (value.startsWith("/")) return value;
  return `/blog/${value.replace(/^\.?\//, "")}`;
}

function postPath(slug) {
  return `/blog/${encodeURIComponent(slug)}.html`;
}

function formatDisplayDate(raw) {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw || "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
}

function dateForSitemap(raw) {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function buildStaticPostHtml({ post, previous, next }) {
  const title = String(post.title || "").trim() || "Untitled";
  const author = String(post.author || "Andrew Concepcion").trim() || "Andrew Concepcion";
  const summary = String(post.summary || "").trim() || stripHtml(post.body_html).slice(0, 180);
  const category = String(post.category || "log").trim() || "log";
  const publishedDate = String(post.published_date || "").trim();
  const readingTime = String(post.reading_time || "").trim() || "n/a";
  const heroImage = toAssetUrl(post.hero_image);
  const heroImageAbs = toAbsoluteUrl(post.hero_image);
  const heroAlt = String(post.hero_alt || `${title} cover`).trim() || `${title} cover`;
  const canonicalPath = postPath(post.slug);
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPath}`;
  const bodyHtml = String(post.body_html || "").trim() || `<p>${escapeHtml(summary)}</p>`;
  const tags = [...new Set([...(post.topics || []), category].filter(Boolean))];
  const articleTagsMeta = tags
    .map((tag) => `<meta property="article:tag" content="${escapeHtml(tag)}">`)
    .join("\n");
  const tagChipsHtml = tags.length
    ? tags
        .map(
          (tag) =>
            `<span class="text-[10px] font-label border border-outline-variant/30 px-2 py-1">#${escapeHtml(
              String(tag).trim().replace(/\s+/g, "_").toLowerCase()
            )}</span>`
        )
        .join("")
    : '<span class="text-[10px] font-label border border-outline-variant/30 px-2 py-1">#log</span>';

  const prevHref = previous ? postPath(previous.slug) : "/blog/";
  const prevTitle = previous ? previous.title : "No previous post";
  const nextHref = next ? postPath(next.slug) : "/blog/";
  const nextTitle = next ? next.title : "No next post";

  const structuredData = JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: title,
      description: summary,
      author: {
        "@type": "Person",
        name: author
      },
      publisher: {
        "@type": "Person",
        name: "Andrew Concepcion",
        url: SITE_ORIGIN
      },
      datePublished: publishedDate,
      dateModified: publishedDate,
      image: heroImageAbs,
      mainEntityOfPage: canonicalUrl
    },
    null,
    2
  ).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html class="light" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<link rel="icon" type="image/png" href="https://avatars.githubusercontent.com/u/7637791?v=4"/>
<title>${escapeHtml(title)} | Andrew Concepcion</title>
<meta name="description" content="${escapeHtml(summary)}"/>
<link rel="canonical" href="${escapeHtml(canonicalUrl)}"/>
<meta name="robots" content="index,follow"/>
<meta property="og:site_name" content="Andrew Concepcion"/>
<meta property="og:type" content="article"/>
<meta property="og:url" content="${escapeHtml(canonicalUrl)}"/>
<meta property="og:title" content="${escapeHtml(title)} | Andrew Concepcion"/>
<meta property="og:description" content="${escapeHtml(summary)}"/>
<meta property="og:image" content="${escapeHtml(heroImageAbs)}"/>
<meta property="og:image:alt" content="${escapeHtml(heroAlt)}"/>
<meta property="article:published_time" content="${escapeHtml(publishedDate)}"/>
<meta property="article:author" content="${escapeHtml(author)}"/>
${articleTagsMeta}
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(title)} | Andrew Concepcion"/>
<meta name="twitter:description" content="${escapeHtml(summary)}"/>
<meta name="twitter:image" content="${escapeHtml(heroImageAbs)}"/>
<meta name="twitter:image:alt" content="${escapeHtml(heroAlt)}"/>
<link rel="alternate" type="application/rss+xml" title="Andrew Concepcion Blog RSS" href="/blog/rss.xml"/>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Manrope:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
<link href="/assets/css/neural-background.css" rel="stylesheet"/>
<script id="tailwind-config">
  tailwind.config = {
    darkMode: "class",
    theme: {
      extend: {
        colors: {
          "background": "#faf9f4",
          "tertiary": "#1f5cba",
          "surface-container-lowest": "#ffffff",
          "surface-container-low": "#f4f4ee",
          "surface-container": "#edefe7",
          "surface-container-highest": "#e0e4d9",
          "secondary": "#57606a",
          "on-surface": "#2f342d",
          "outline": "#787c73",
          "outline-variant": "#afb3aa",
          "primary": "#5a5f65",
          "on-primary": "#f4f8ff"
        },
        fontFamily: {
          "headline": ["Space Grotesk"],
          "body": ["Manrope"],
          "label": ["Space Grotesk"]
        },
        borderRadius: {"DEFAULT": "0px", "lg": "0px", "xl": "0px", "full": "9999px"}
      }
    }
  }
</script>
<style>
  body {
    background-color: #faf9f4;
  }
  .material-symbols-outlined {
    font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  }
  .code-block {
    background: #1A1C1E;
    color: #DEE3E9;
    font-family: 'Space Grotesk', monospace;
    padding: 1.5rem;
    border-left: 4px solid #1F5CBA;
  }
  .code-keyword { color: #6799FB; }
  .code-type { color: #FE8983; }
  .code-func { color: #E0E4D9; }
</style>
<script type="application/ld+json">${structuredData}</script>
</head>
<body class="bg-background text-on-surface font-body antialiased">
<div class="neural-global-bg" aria-hidden="true">
  <div class="neural-mesh-container">
    <div class="neural-mesh"></div>
    <div class="neural-node" style="top: 20%; left: 30%; animation-delay: 0s;"></div>
    <div class="neural-node" style="top: 50%; left: 70%; animation-delay: 1.2s;"></div>
    <div class="neural-node" style="top: 80%; left: 40%; animation-delay: 0.5s;"></div>
    <div class="neural-node" style="top: 30%; left: 80%; animation-delay: 2s;"></div>
    <div class="neural-node" style="top: 60%; left: 20%; animation-delay: 1.5s;"></div>
    <div class="neural-node" style="top: 15%; left: 60%; animation-delay: 0.8s;"></div>
    <div class="mesh-line" style="top: 20%; left: 30%; width: 400px; transform: rotate(45deg);"></div>
    <div class="mesh-line" style="top: 50%; left: 70%; width: 500px; transform: rotate(200deg);"></div>
    <div class="mesh-line" style="top: 80%; left: 40%; width: 300px; transform: rotate(-30deg);"></div>
  </div>
  <div class="bust-gradient"></div>
  <div class="canvas-grid"></div>
</div>
<header id="site-topbar" class="fixed top-0 left-0 w-full z-50 bg-[#FAF9F4]/85 backdrop-blur-xl border-b border-stone-200/40">
  <div class="max-w-7xl mx-auto px-6 py-3 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
    <a href="/" class="justify-self-start font-['Space_Grotesk'] font-bold text-lg tracking-tighter text-[#2F342D] uppercase">Andrew Concepcion</a>
    <nav id="site-nav" class="hidden md:flex items-center gap-6 justify-self-center font-['Space_Grotesk'] font-medium tracking-tight uppercase text-xs">
      <a data-route="/" href="/" class="site-nav-link text-[#5A5F65] hover:text-[#2F342D] transition-colors duration-150">[dashboard]</a>
      <a data-route="/work.html" href="/work.html" class="site-nav-link text-[#5A5F65] hover:text-[#2F342D] transition-colors duration-150">[source]</a>
      <a data-route="/blog/" href="/blog/" class="site-nav-link text-[#5A5F65] hover:text-[#2F342D] transition-colors duration-150">[logs]</a>
      <a data-route="/about.html" href="/about.html" class="site-nav-link text-[#5A5F65] hover:text-[#2F342D] transition-colors duration-150">[about]</a>
      <a data-route="/contact.html" href="/contact.html" class="site-nav-link text-[#5A5F65] hover:text-[#2F342D] transition-colors duration-150">[contact]</a>
    </nav>
    <div class="justify-self-end font-['Space_Grotesk'] text-[10px] tracking-widest uppercase text-[#5A5F65]">[status: online]</div>
  </div>
</header>
<main class="pt-24 pb-32">
<article class="max-w-screen-xl mx-auto px-6">
<div class="flex flex-wrap gap-4 mb-8 font-label text-[10px] tracking-widest uppercase text-outline">
<span id="post-category" class="bg-surface-container-low px-2 py-1">[${escapeHtml(category.toLowerCase())}]</span>
<span id="post-date" class="bg-surface-container-low px-2 py-1">${escapeHtml(publishedDate)}</span>
<span id="post-reading" class="bg-surface-container-highest text-tertiary font-bold px-2 py-1">[${escapeHtml(readingTime)}]</span>
</div>
<div class="grid grid-cols-1 lg:grid-cols-12 gap-12 mb-20 items-end">
<div class="lg:col-span-7">
<h1 id="post-title" class="font-headline text-5xl md:text-7xl font-bold leading-[0.9] text-on-background tracking-tighter mb-8">${escapeHtml(title)}</h1>
<p id="post-summary" class="text-xl text-secondary max-w-xl font-light leading-relaxed">${escapeHtml(summary)}</p>
<div class="mt-5 flex flex-wrap items-center gap-2" id="post-actions">
<button id="share-post-button" type="button" class="font-label text-[10px] px-3 py-1.5 border border-outline-variant/20 uppercase tracking-widest text-secondary hover:bg-surface-container-low transition-colors">[SHARE]</button>
<button id="bookmark-post-button" type="button" class="font-label text-[10px] px-3 py-1.5 border border-outline-variant/20 uppercase tracking-widest text-secondary hover:bg-surface-container-low transition-colors">[BOOKMARK]</button>
<a href="/blog/rss.xml" class="font-label text-[10px] px-3 py-1.5 border border-outline-variant/20 uppercase tracking-widest text-secondary hover:bg-surface-container-low transition-colors">[RSS]</a>
</div>
</div>
<div class="lg:col-span-5 relative aspect-square bg-surface-container-low p-8 overflow-hidden group">
<div class="absolute inset-0 opacity-10 pointer-events-none">
<img id="post-hero-image" class="w-full h-full object-cover grayscale" src="${escapeHtml(heroImage)}" alt="${escapeHtml(heroAlt)}" loading="eager" decoding="async"/>
</div>
<div class="relative h-full flex flex-col justify-between border border-outline-variant/30 p-6 z-10">
<div class="flex justify-between items-start">
<span class="font-label text-xs">[state_machine_v4.svg]</span>
<span class="material-symbols-outlined text-tertiary">schema</span>
</div>
<div class="space-y-4">
<div class="h-1 w-2/3 bg-tertiary/20"></div>
<div class="flex gap-2">
<div class="w-4 h-4 border border-tertiary"></div>
<div class="w-4 h-4 bg-tertiary"></div>
<div class="w-4 h-4 border border-tertiary"></div>
</div>
<div class="h-px w-full bg-outline-variant/50"></div>
<div class="flex justify-end">
<span class="font-label text-[10px] uppercase">λ.dispatch(Action.Initialize)</span>
</div>
</div>
</div>
</div>
</div>
<div class="grid grid-cols-1 lg:grid-cols-12 gap-12">
<aside class="lg:col-span-3 hidden lg:block space-y-12">
<div class="pt-4 border-t border-outline-variant/20">
<h4 class="font-label text-xs font-bold uppercase mb-4 text-primary">[author_identity]</h4>
<div class="flex items-center gap-4">
<div class="w-12 h-12 bg-surface-container-highest flex items-center justify-center">
<span class="material-symbols-outlined text-on-surface">account_tree</span>
</div>
<div>
<p id="post-author-name" class="text-sm font-bold">${escapeHtml(author)}</p>
<p id="post-author-role" class="text-xs text-secondary">[${escapeHtml(category.toLowerCase())}]</p>
</div>
</div>
</div>
<div class="pt-4 border-t border-outline-variant/20">
<h4 class="font-label text-xs font-bold uppercase mb-4 text-primary">[tags]</h4>
<div id="post-tags" class="flex flex-wrap gap-2">${tagChipsHtml}</div>
</div>
<section class="p-6 bg-surface-container-low space-y-4">
<h4 class="font-label text-xs uppercase tracking-widest text-outline">Abstract</h4>
<p id="sidebar-abstract" class="text-sm leading-relaxed text-on-surface-variant">${escapeHtml(summary)}</p>
</section>
</aside>
<div id="post-body" class="lg:col-span-7 space-y-10 text-lg text-on-surface leading-loose font-body">${bodyHtml}</div>
</div>
<div class="mt-24 pt-12 border-t border-outline-variant/30 grid grid-cols-1 md:grid-cols-2 gap-px bg-outline-variant/20">
<a id="prev-link" class="bg-background p-10 group hover:bg-surface-container-low transition-colors" href="${escapeHtml(prevHref)}">
<span class="font-label text-[10px] text-outline uppercase tracking-widest mb-4 block">[prev_entry]</span>
<h5 id="prev-title" class="font-headline text-2xl font-bold group-hover:text-tertiary transition-colors">${escapeHtml(prevTitle)}</h5>
<div class="mt-6 flex items-center gap-2 text-tertiary">
<span class="material-symbols-outlined">arrow_back</span>
<span class="font-label text-xs">read_entry</span>
</div>
</a>
<a id="next-link" class="bg-background p-10 text-right group hover:bg-surface-container-low transition-colors" href="${escapeHtml(nextHref)}">
<span class="font-label text-[10px] text-outline uppercase tracking-widest mb-4 block">[next_entry]</span>
<h5 id="next-title" class="font-headline text-2xl font-bold group-hover:text-tertiary transition-colors">${escapeHtml(nextTitle)}</h5>
<div class="mt-6 flex items-center justify-end gap-2 text-tertiary">
<span class="font-label text-xs">read_entry</span>
<span class="material-symbols-outlined">arrow_forward</span>
</div>
</a>
</div>
</article>
</main>
<footer id="site-footer" class="w-full bg-[#F4F4EE] border-t border-stone-200/30 mt-24">
  <div class="max-w-7xl mx-auto px-6 py-4 flex flex-col md:flex-row justify-center items-center gap-6 font-['Space_Grotesk'] text-[10px] tracking-widest uppercase text-[#5A5F65]">
    <span>© 2026 Andrew Concepcion</span>
    <a class="hover:text-[#1F5CBA] transition-colors" href="/">[dashboard]</a>
    <a class="hover:text-[#1F5CBA] transition-colors" href="/work.html">[source]</a>
    <a class="hover:text-[#1F5CBA] transition-colors" href="/blog/">[logs]</a>
    <a class="hover:text-[#1F5CBA] transition-colors" href="/about.html">[about]</a>
    <a class="hover:text-[#1F5CBA] transition-colors" href="/contact.html">[contact]</a>
    <a class="hover:text-[#1F5CBA] transition-colors" href="https://github.com/ac-opensource" target="_blank" rel="noreferrer">[github]</a>
  </div>
</footer>
<script>
  (() => {
    const path = window.location.pathname.replace(/\\/index\\.html$/, "/");
    document.querySelectorAll("#site-nav .site-nav-link").forEach((link) => {
      const route = link.dataset.route;
      const active = route === "/blog/" ? path.startsWith("/blog/") : path === route || (route === "/" && path === "/");
      if (active) {
        link.classList.add("text-[#1F5CBA]", "border-b-2", "border-[#1F5CBA]", "pb-1");
      }
    });

    const BOOKMARKS_KEY = "ac_blog_bookmarks_v1";
    const CURRENT_POST_SLUG = ${JSON.stringify(String(post.slug || ""))};
    const CURRENT_POST_TITLE = ${JSON.stringify(title)};
    const CURRENT_POST_URL = ${JSON.stringify(canonicalPath)};
    const sharePostButton = document.getElementById("share-post-button");
    const bookmarkPostButton = document.getElementById("bookmark-post-button");

    function loadBookmarks() {
      try {
        const raw = localStorage.getItem(BOOKMARKS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.map((value) => String(value || "").trim()).filter(Boolean));
      } catch (_error) {
        return new Set();
      }
    }

    function saveBookmarks(set) {
      try {
        localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(Array.from(set)));
      } catch (_error) {
        // Ignore write failures.
      }
    }

    function setBookmarkButtonState(active) {
      if (!bookmarkPostButton) return;
      bookmarkPostButton.textContent = active ? "[BOOKMARKED]" : "[BOOKMARK]";
      bookmarkPostButton.classList.toggle("border-tertiary/40", active);
      bookmarkPostButton.classList.toggle("text-tertiary", active);
      bookmarkPostButton.classList.toggle("bg-surface-container-highest", active);
      bookmarkPostButton.classList.toggle("border-outline-variant/20", !active);
      bookmarkPostButton.classList.toggle("text-secondary", !active);
    }

    async function shareCurrentPost() {
      const absoluteUrl = new URL(CURRENT_POST_URL, window.location.origin).href;
      if (navigator.share) {
        try {
          await navigator.share({
            title: CURRENT_POST_TITLE || "Blog post",
            url: absoluteUrl
          });
          return;
        } catch (_error) {
          // Continue to fallback.
        }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(absoluteUrl);
          return;
        } catch (_error) {
          // Continue to prompt fallback.
        }
      }
      window.prompt("Copy post URL:", absoluteUrl);
    }

    if (sharePostButton) {
      sharePostButton.addEventListener("click", () => {
        shareCurrentPost();
      });
    }

    if (bookmarkPostButton && CURRENT_POST_SLUG) {
      const bookmarks = loadBookmarks();
      setBookmarkButtonState(bookmarks.has(CURRENT_POST_SLUG));
      bookmarkPostButton.addEventListener("click", () => {
        if (bookmarks.has(CURRENT_POST_SLUG)) {
          bookmarks.delete(CURRENT_POST_SLUG);
        } else {
          bookmarks.add(CURRENT_POST_SLUG);
        }
        saveBookmarks(bookmarks);
        setBookmarkButtonState(bookmarks.has(CURRENT_POST_SLUG));
      });
    }
  })();
</script>
</body></html>`;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function writeSitemap(posts) {
  const urls = [
    { path: "/", lastmod: new Date().toISOString().slice(0, 10) },
    { path: "/work.html", lastmod: new Date().toISOString().slice(0, 10) },
    { path: "/about.html", lastmod: new Date().toISOString().slice(0, 10) },
    { path: "/contact.html", lastmod: new Date().toISOString().slice(0, 10) },
    { path: "/blog/", lastmod: new Date().toISOString().slice(0, 10) },
    ...posts.map((post) => ({
      path: postPath(post.slug),
      lastmod: dateForSitemap(post.published_date)
    }))
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (entry) => `  <url>
    <loc>${escapeXml(`${SITE_ORIGIN}${entry.path}`)}</loc>
    <lastmod>${escapeXml(entry.lastmod)}</lastmod>
  </url>`
  )
  .join("\n")}
</urlset>
`;

  fs.writeFileSync(path.join(ROOT_DIR, "sitemap.xml"), xml, "utf8");
}

function writeRobots() {
  const robots = `User-agent: *
Allow: /

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;
  fs.writeFileSync(path.join(ROOT_DIR, "robots.txt"), robots, "utf8");
}

function writeRssFeed(posts) {
  const now = new Date().toUTCString();
  const items = posts
    .map((post) => {
      const title = String(post.title || "").trim() || "Untitled";
      const summary = String(post.summary || "").trim() || stripHtml(post.body_html || "").slice(0, 220);
      const link = `${SITE_ORIGIN}${postPath(post.slug)}`;
      const pubDateRaw = new Date(String(post.published_date || ""));
      const pubDate = Number.isNaN(pubDateRaw.getTime()) ? now : pubDateRaw.toUTCString();
      const categories = [...new Set([...(post.topics || []), post.category].filter(Boolean))]
        .map((topic) => `<category>${escapeXml(topic)}</category>`)
        .join("");

      return `  <item>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(link)}</link>
    <guid isPermaLink="true">${escapeXml(link)}</guid>
    <pubDate>${escapeXml(pubDate)}</pubDate>
    <description>${escapeXml(summary)}</description>
${categories}
  </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Andrew Concepcion Blog</title>
  <link>${escapeXml(`${SITE_ORIGIN}/blog/`)}</link>
  <description>Engineering logs, essays, and field notes by Andrew Concepcion.</description>
  <language>en-us</language>
  <lastBuildDate>${escapeXml(now)}</lastBuildDate>
  <atom:link href="${escapeXml(`${SITE_ORIGIN}/blog/rss.xml`)}" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>
`;

  fs.writeFileSync(path.join(BLOG_DIR, "rss.xml"), xml, "utf8");
}

function main() {
  const requestedPath = process.argv.find((arg) => arg.startsWith("--db="));
  const dbPath = requestedPath ? requestedPath.split("=")[1] : undefined;
  const { db } = openDatabase(dbPath);

  try {
    ensureSchema(db);

    const list = getPostList(db)
      .filter((post) => post.status === "published")
      .sort((a, b) => String(b.published_date).localeCompare(String(a.published_date)));

    const fullPosts = list.map((post) => getPostWithTopics(db, post.slug)).filter(Boolean);

    for (let i = 0; i < fullPosts.length; i += 1) {
      const post = fullPosts[i];
      const previous = fullPosts[i + 1] || null;
      const next = fullPosts[i - 1] || null;
      const html = buildStaticPostHtml({ post, previous, next });
      const outputPath = path.join(BLOG_DIR, `${post.slug}.html`);
      fs.writeFileSync(outputPath, html, "utf8");
    }

    writeSitemap(fullPosts);
    writeRobots();
    writeRssFeed(fullPosts);
    db.pragma("wal_checkpoint(TRUNCATE)");
    console.log(`Generated ${fullPosts.length} static blog pages from SQLite.`);
  } finally {
    db.close();
  }
}

main();
