const fs = require("fs");
const path = require("path");
const {
  openDatabase,
  assertSchema,
  getPostList,
  getPostWithTopics
} = require("./lib/blog-db");
const { resolvePublicImage } = require("./lib/public-images");

const ROOT_DIR = path.join(__dirname, "..");
const SITE_ORIGIN = String(process.env.SITE_ORIGIN || "https://ac-opensource.github.io").replace(/\/+$/, "");
const FALLBACK_HERO_IMAGE = "/blog/images/new-zealand-aurora.png";
const GENERATED_PAGE_MARKER = "<!-- generated: scripts/build-static-blog-pages.js -->";
const GENERATED_MANIFEST_NAME = path.join(".site-build", "generated-blog-pages.json");
const GENERATOR_ID = "ac-opensource-static-blog-v1";
const WORK_HERO_LAYOUT_BY_SLUG = Object.freeze({
  "case-study-ocbc-banking-experience": "split-vertical",
  "case-study-openpay-bnpl-experience": "cover"
});

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function visibleCategory(value) {
  const category = String(value || "log").trim().toLowerCase() || "log";
  return category === "work" ? "portfolio" : category;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addImageDefaults(html) {
  return String(html || "").replace(/<img\b([^>]*)>/gi, (match, attributes) => {
    const selfClosing = /\/\s*$/.test(attributes);
    const normalizedAttributes = attributes.replace(/\/\s*$/, "");
    const srcMatch = normalizedAttributes.match(/\bsrc\s*=\s*(["'])([^"']+)\1/i);
    const responsive = srcMatch ? resolvePublicImage(srcMatch[2]) : null;
    let updatedAttributes = normalizedAttributes;

    if (responsive && responsive.src && responsive.src !== srcMatch[2]) {
      updatedAttributes = updatedAttributes.replace(srcMatch[0], `src=${srcMatch[1]}${responsive.src}${srcMatch[1]}`);
    }

    let defaults = "";
    if (!/\bloading\s*=/i.test(updatedAttributes)) defaults += ' loading="lazy"';
    if (!/\bdecoding\s*=/i.test(updatedAttributes)) defaults += ' decoding="async"';
    if (responsive && responsive.srcset && !/\bsrcset\s*=/i.test(updatedAttributes)) {
      defaults += ` srcset="${escapeHtml(responsive.srcset)}"`;
    }
    if (responsive && responsive.sizes && !/\bsizes\s*=/i.test(updatedAttributes)) {
      defaults += ` sizes="${escapeHtml(responsive.sizes)}"`;
    }
    return `<img${updatedAttributes}${defaults}${selfClosing ? " /" : ""}>`;
  });
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

function buildBlogIndexFallback(posts, limit = 4) {
  const articles = posts
    .slice(0, limit)
    .map((post) => {
      const title = String(post.title || "").trim() || "Untitled";
      const summary = String(post.summary || "").trim() || stripHtml(post.body_html).slice(0, 180);
      const publishedDate = String(post.published_date || "").trim();
      const readingTime = String(post.reading_time || "").trim() || "n/a";

      return `  <article class="py-8 border-t border-outline-variant/20">
    <time class="font-label text-xs text-outline" datetime="${escapeHtml(publishedDate)}">${escapeHtml(publishedDate)} · ${escapeHtml(readingTime)}</time>
    <h2 class="font-headline text-3xl md:text-4xl font-bold leading-tight mt-3"><a class="hover:text-tertiary" href="${escapeHtml(postPath(post.slug))}">${escapeHtml(title)}</a></h2>
    <p class="text-secondary text-lg leading-relaxed mt-3">${escapeHtml(summary)}</p>
  </article>`;
    })
    .join("\n");

  return `<section id="blog-feed" class="space-y-12" aria-label="Latest blog posts">
${articles}
</section>`;
}

function writeBlogIndexFallback(posts, outputBlogDir) {
  const indexPath = path.join(outputBlogDir, "index.html");
  if (!fs.existsSync(indexPath)) return false;

  const indexHtml = fs.readFileSync(indexPath, "utf8");
  const feedPattern =
    /<section id="blog-feed" class="space-y-12" aria-label="Latest blog posts">[\s\S]*?<\/section>/;
  if (!feedPattern.test(indexHtml)) {
    throw new Error(`Cannot update the no-JavaScript blog feed in ${indexPath}.`);
  }

  fs.writeFileSync(
    indexPath,
    indexHtml.replace(feedPattern, buildBlogIndexFallback(posts)),
    "utf8"
  );
  return true;
}

function parseDeterministicDate(raw) {
  const value = String(raw || "").trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return new Date(normalized);
}

function formatDisplayDate(raw) {
  const date = parseDeterministicDate(raw);
  if (Number.isNaN(date.getTime())) return raw || "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function dateForSitemap(raw) {
  const date = parseDeterministicDate(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function dateForStructuredData(raw, fallback) {
  const date = parseDeterministicDate(raw);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  return String(fallback || "").trim();
}

function isWorkPost(post) {
  const category = String(post?.category || "")
    .trim()
    .toLowerCase();
  const slug = String(post?.slug || "").trim().toLowerCase();
  return category === "work" || slug.startsWith("case-study-");
}

function buildWorkHeroPanel({ post, heroImage, heroResponsiveAttributes, heroAlt, heroCaption }) {
  const layout = WORK_HERO_LAYOUT_BY_SLUG[String(post?.slug || "")] || "contain";
  const caption = heroCaption || heroAlt;

  if (layout === "split-vertical") {
    return `
<figure class="work-post-hero work-post-hero--split lg:col-span-5" data-work-hero-layout="split-vertical">
  <span class="work-post-hero__crop work-post-hero__crop--top">
    <img id="post-hero-image" src="${escapeHtml(heroImage)}"${heroResponsiveAttributes} alt="${escapeHtml(heroAlt)}" loading="eager" decoding="async"/>
  </span>
  <span class="work-post-hero__crop work-post-hero__crop--bottom" aria-hidden="true">
    <img src="${escapeHtml(heroImage)}"${heroResponsiveAttributes} alt="" loading="eager" decoding="async"/>
  </span>
  <figcaption class="sr-only">${escapeHtml(caption)} shown as upper and lower crops side by side.</figcaption>
</figure>
`;
  }

  if (layout === "cover") {
    return `
<figure class="work-post-hero work-post-hero--cover lg:col-span-5" data-work-hero-layout="cover">
  <img id="post-hero-image" src="${escapeHtml(heroImage)}"${heroResponsiveAttributes} alt="${escapeHtml(heroAlt)}" loading="eager" decoding="async"/>
  <figcaption class="sr-only">${escapeHtml(caption)}</figcaption>
</figure>
`;
  }

  return `
<figure class="work-post-hero work-post-hero--contain lg:col-span-5" data-work-hero-layout="contain">
  <img id="post-hero-image" src="${escapeHtml(heroImage)}"${heroResponsiveAttributes} alt="${escapeHtml(heroAlt)}" loading="eager" decoding="async"/>
  <figcaption class="sr-only">${escapeHtml(caption)}</figcaption>
</figure>
`;
}

function buildStaticPostHtml({ post, previous, next }) {
  const title = String(post.title || "").trim() || "Untitled";
  const author = String(post.author || "Andrew Concepcion").trim() || "Andrew Concepcion";
  const summary = String(post.summary || "").trim() || stripHtml(post.body_html).slice(0, 180);
  const category = String(post.category || "log").trim() || "log";
  const categoryLabel = visibleCategory(category);
  const isWorkDeepDive = isWorkPost(post);
  const isReflection = category.toLowerCase() === "reflection";
  const publishedDate = String(post.published_date || "").trim();
  const readingTime = String(post.reading_time || "").trim() || "n/a";
  const heroImageData = resolvePublicImage(toAssetUrl(post.hero_image));
  const heroImage = heroImageData.src || toAssetUrl(post.hero_image);
  const heroImageAbs = toAbsoluteUrl(heroImage);
  const heroResponsiveAttributes = heroImageData.srcset
    ? ` srcset="${escapeHtml(heroImageData.srcset)}" sizes="${escapeHtml(heroImageData.sizes)}"`
    : "";
  const heroAlt = String(post.hero_alt || `${title} cover`).trim() || `${title} cover`;
  const heroCaption = String(post.hero_caption || "").trim();
  const canonicalPath = postPath(post.slug);
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPath}`;
  const bodyHtml =
    addImageDefaults(String(post.body_html || "").trim()) || `<p>${escapeHtml(summary)}</p>`;
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

  const fallbackNavPath = isWorkDeepDive ? "/work.html" : "/blog/";
  const prevHref = previous ? postPath(previous.slug) : fallbackNavPath;
  const prevTitle = previous ? previous.title : isWorkDeepDive ? "Return to Source" : "No previous post";
  const nextHref = next ? postPath(next.slug) : fallbackNavPath;
  const nextTitle = next ? next.title : isWorkDeepDive ? "Return to Source" : "No next post";
  const navForceRoute = isWorkDeepDive ? "/work.html" : "/blog/";
  const sourceCurrent = isWorkDeepDive ? ' aria-current="page"' : "";
  const blogCurrent = isWorkDeepDive ? "" : ' aria-current="page"';

  const heroPanelHtml = isWorkDeepDive
    ? buildWorkHeroPanel({ post, heroImage, heroResponsiveAttributes, heroAlt, heroCaption })
    : isReflection
      ? `
<figure class="lg:col-span-5 relative aspect-square bg-surface-container-low border border-outline-variant/20 p-3 overflow-hidden">
<img id="post-hero-image" class="w-full h-full object-contain bg-surface-container-lowest" src="${escapeHtml(heroImage)}"${heroResponsiveAttributes} alt="${escapeHtml(heroAlt)}" loading="eager" decoding="async"/>
${heroCaption ? `<figcaption class="sr-only">${escapeHtml(heroCaption)}</figcaption>` : ""}
</figure>
`
    : `
<div class="lg:col-span-5 relative aspect-square bg-surface-container-low p-8 overflow-hidden group">
<div class="absolute inset-0 pointer-events-none hero-overlay-alpha">
<img id="post-hero-image" class="w-full h-full object-contain grayscale bg-surface-container-lowest" src="${escapeHtml(heroImage)}"${heroResponsiveAttributes} alt="${escapeHtml(heroAlt)}" loading="eager" decoding="async"/>
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
`;

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
      dateModified: dateForStructuredData(post.updated_at, publishedDate),
      image: heroImageAbs,
      mainEntityOfPage: canonicalUrl
    },
    null,
    2
  ).replace(/</g, "\\u003c");

  return `${GENERATED_PAGE_MARKER}
<!DOCTYPE html>
<html class="light" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<link rel="icon" type="image/svg+xml" href="/assets/images/favicon.svg"/>
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
  .hero-overlay-alpha {
    opacity: 0;
    animation: overlayAlphaPulse 4.8s ease-in-out infinite;
    will-change: opacity;
  }
  .work-post-hero {
    position: relative;
    display: grid;
    aspect-ratio: 1;
    margin: 0;
    overflow: hidden;
    border: 1px solid rgba(175, 179, 170, 0.28);
    background: #edefe7;
  }
  .work-post-hero--split {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
  }
  .work-post-hero__crop {
    display: block;
    min-width: 0;
    overflow: hidden;
    background: #fff;
  }
  .work-post-hero__crop img,
  .work-post-hero--cover > img,
  .work-post-hero--contain > img {
    display: block;
    width: 100%;
    height: 100%;
  }
  .work-post-hero__crop img,
  .work-post-hero--cover > img {
    object-fit: cover;
  }
  .work-post-hero__crop--top img {
    object-position: top center;
  }
  .work-post-hero__crop--bottom img {
    object-position: bottom center;
  }
  .work-post-hero--cover > img {
    object-position: 62% center;
  }
  .work-post-hero--contain {
    aspect-ratio: 4 / 5;
  }
  .work-post-hero--contain > img {
    object-fit: contain;
    background: #fff;
  }
  @keyframes overlayAlphaPulse {
    0% { opacity: 0; }
    15% { opacity: 0; }
    35% { opacity: 1; }
    80% { opacity: 1; }
    100% { opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .hero-overlay-alpha {
      animation: none;
      opacity: 1;
    }
  }
</style>
<script type="application/ld+json">${structuredData}</script>
</head>
<body class="bg-background text-on-surface font-body antialiased overflow-x-hidden">
<a href="#main-content" class="fixed left-4 top-4 z-[100] -translate-y-24 bg-surface-container-lowest border border-outline px-4 py-3 font-label text-xs uppercase tracking-widest text-on-surface focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-tertiary">Skip to content</a>
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
      <a data-route="/work.html" href="/work.html"${sourceCurrent} class="site-nav-link text-[#5A5F65] hover:text-[#2F342D] transition-colors duration-150">[portfolio]</a>
      <a data-route="/blog/" href="/blog/"${blogCurrent} class="site-nav-link text-[#5A5F65] hover:text-[#2F342D] transition-colors duration-150">[logs]</a>
      <a data-route="/about.html" href="/about.html" class="site-nav-link text-[#5A5F65] hover:text-[#2F342D] transition-colors duration-150">[about]</a>
      <a data-route="/contact.html" href="/contact.html" class="site-nav-link text-[#5A5F65] hover:text-[#2F342D] transition-colors duration-150">[contact]</a>
    </nav>
    <div class="justify-self-end font-['Space_Grotesk'] text-[10px] tracking-widest uppercase text-[#5A5F65]">[status: online]</div>
  </div>
  <nav id="site-nav-mobile" class="md:hidden px-6 py-2 border-t border-stone-200/40 flex items-center gap-4 overflow-x-auto whitespace-nowrap font-['Space_Grotesk'] font-medium tracking-tight uppercase text-[10px]">
    <a data-route="/" href="/" class="site-nav-link text-[#5A5F65] hover:text-[#2F342D] transition-colors duration-150">[dashboard]</a>
    <a data-route="/work.html" href="/work.html"${sourceCurrent} class="site-nav-link text-[#5A5F65] hover:text-[#2F342D] transition-colors duration-150">[portfolio]</a>
    <a data-route="/blog/" href="/blog/"${blogCurrent} class="site-nav-link text-[#5A5F65] hover:text-[#2F342D] transition-colors duration-150">[logs]</a>
    <a data-route="/about.html" href="/about.html" class="site-nav-link text-[#5A5F65] hover:text-[#2F342D] transition-colors duration-150">[about]</a>
    <a data-route="/contact.html" href="/contact.html" class="site-nav-link text-[#5A5F65] hover:text-[#2F342D] transition-colors duration-150">[contact]</a>
  </nav>
</header>
<main id="main-content" class="pt-32 md:pt-24 pb-32">
<article class="max-w-screen-xl mx-auto px-6">
<div class="flex flex-wrap gap-4 mb-8 font-label text-[10px] tracking-widest uppercase text-outline">
<span id="post-category" class="bg-surface-container-low px-2 py-1">[${escapeHtml(categoryLabel)}]</span>
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
${heroPanelHtml}
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
<p id="post-author-role" class="text-xs text-secondary">[${escapeHtml(categoryLabel)}]</p>
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
    <a class="hover:text-[#1F5CBA] transition-colors" href="/work.html">[portfolio]</a>
    <a class="hover:text-[#1F5CBA] transition-colors" href="/blog/">[logs]</a>
    <a class="hover:text-[#1F5CBA] transition-colors" href="/about.html">[about]</a>
    <a class="hover:text-[#1F5CBA] transition-colors" href="/contact.html">[contact]</a>
    <a class="hover:text-[#1F5CBA] transition-colors" href="https://github.com/ac-opensource" target="_blank" rel="noreferrer">[github]</a>
  </div>
</footer>
<script>
  (() => {
    const FORCE_ACTIVE_ROUTE = ${JSON.stringify(navForceRoute)};
    const path = window.location.pathname.replace(/\\/index\\.html$/, "/");
    document.querySelectorAll("#site-nav .site-nav-link, #site-nav-mobile .site-nav-link").forEach((link) => {
      const route = link.dataset.route;
      let active = false;
      if (route === FORCE_ACTIVE_ROUTE) {
        active = true;
      } else if (FORCE_ACTIVE_ROUTE === "/work.html" && route === "/blog/") {
        active = false;
      } else {
        active = route === "/blog/" ? path.startsWith("/blog/") : path === route || (route === "/" && path === "/");
      }
      if (active) {
        link.classList.add("text-[#1F5CBA]", "border-b-2", "border-[#1F5CBA]", "pb-1");
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
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

function writeSitemap(posts, outputRoot) {
  const latestPostDate = posts
    .map((post) => dateForSitemap(post.updated_at || post.published_date))
    .filter(Boolean)
    .sort()
    .at(-1);
  const urls = [
    { path: "/" },
    { path: "/work.html" },
    { path: "/about.html" },
    { path: "/contact.html" },
    { path: "/resume.html" },
    { path: "/blog/", lastmod: latestPostDate },
    ...posts.map((post) => ({
      path: postPath(post.slug),
      lastmod: dateForSitemap(post.updated_at || post.published_date)
    }))
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (entry) => `  <url>
    <loc>${escapeXml(`${SITE_ORIGIN}${entry.path}`)}</loc>${
      entry.lastmod ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : ""
    }
  </url>`
  )
  .join("\n")}
</urlset>
`;

  fs.writeFileSync(path.join(outputRoot, "sitemap.xml"), xml, "utf8");
}

function writeRobots(outputRoot) {
  const robots = `User-agent: *
Allow: /

# Public guide for AI and language-model discovery:
# ${SITE_ORIGIN}/llms.txt

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;
  fs.writeFileSync(path.join(outputRoot, "robots.txt"), robots, "utf8");
}

function deterministicFeedDate(posts) {
  const timestamps = posts
    .flatMap((post) => [post.updated_at, post.published_date])
    .map(parseDeterministicDate)
    .filter((date) => !Number.isNaN(date.getTime()))
    .map((date) => date.getTime());

  return new Date(timestamps.length ? Math.max(...timestamps) : 0).toUTCString();
}

function writeRssFeed(posts, outputBlogDir) {
  const feedDate = deterministicFeedDate(posts);
  const items = posts
    .map((post) => {
      const title = String(post.title || "").trim() || "Untitled";
      const summary = String(post.summary || "").trim() || stripHtml(post.body_html || "").slice(0, 220);
      const link = `${SITE_ORIGIN}${postPath(post.slug)}`;
      const pubDateRaw = parseDeterministicDate(post.published_date);
      const pubDate = Number.isNaN(pubDateRaw.getTime()) ? feedDate : pubDateRaw.toUTCString();
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
  <lastBuildDate>${escapeXml(feedDate)}</lastBuildDate>
  <atom:link href="${escapeXml(`${SITE_ORIGIN}/blog/rss.xml`)}" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>
`;

  fs.writeFileSync(path.join(outputBlogDir, "rss.xml"), xml, "utf8");
}

function isSafeGeneratedPostPath(relativePath) {
  return /^blog\/[a-z0-9][a-z0-9-]*\.html$/.test(String(relativePath || ""));
}

function readGeneratedManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return [];

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.generator !== GENERATOR_ID || !Array.isArray(manifest.files)) return [];
    return manifest.files.filter(isSafeGeneratedPostPath);
  } catch (_error) {
    return [];
  }
}

function pruneStaleGeneratedPages({ outputRoot, manifestPath, expectedFiles }) {
  const expected = new Set(expectedFiles);
  const previous = readGeneratedManifest(manifestPath);
  const removed = [];

  for (const relativePath of previous) {
    if (expected.has(relativePath)) continue;

    const absolutePath = path.resolve(outputRoot, relativePath);
    const blogRoot = `${path.resolve(outputRoot, "blog")}${path.sep}`;
    if (!absolutePath.startsWith(blogRoot) || !fs.existsSync(absolutePath)) continue;

    const prefix = fs.readFileSync(absolutePath, "utf8").slice(0, GENERATED_PAGE_MARKER.length);
    if (prefix !== GENERATED_PAGE_MARKER) continue;

    fs.unlinkSync(absolutePath);
    removed.push(relativePath);
  }

  return removed;
}

function writeGeneratedManifest(manifestPath, files) {
  const manifest = {
    generator: GENERATOR_ID,
    version: 1,
    files: [...files].sort()
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function buildStaticBlog({ dbPath, outputRoot = ROOT_DIR, manifestPath } = {}) {
  const resolvedOutputRoot = path.resolve(outputRoot);
  const outputBlogDir = path.join(resolvedOutputRoot, "blog");
  const resolvedManifestPath = manifestPath
    ? path.resolve(manifestPath)
    : path.join(resolvedOutputRoot, GENERATED_MANIFEST_NAME);
  const { db } = openDatabase(dbPath, { readonly: true });

  try {
    assertSchema(db);
    fs.mkdirSync(outputBlogDir, { recursive: true });

    const list = getPostList(db)
      .filter((post) => post.status === "published")
      .sort(
        (a, b) =>
          String(b.published_date).localeCompare(String(a.published_date)) ||
          String(a.slug).localeCompare(String(b.slug))
      );

    const fullPosts = list.map((post) => getPostWithTopics(db, post.slug)).filter(Boolean);
    const workPosts = fullPosts.filter(isWorkPost);
    const workPostIndices = new Map(workPosts.map((post, index) => [post.slug, index]));

    for (let i = 0; i < fullPosts.length; i += 1) {
      const post = fullPosts[i];
      let previous = fullPosts[i + 1] || null;
      let next = fullPosts[i - 1] || null;

      if (isWorkPost(post)) {
        const workIndex = workPostIndices.get(post.slug);
        previous = typeof workIndex === "number" ? workPosts[workIndex + 1] || null : null;
        next = typeof workIndex === "number" ? workPosts[workIndex - 1] || null : null;
      }

      const html = buildStaticPostHtml({ post, previous, next });
      const outputPath = path.join(outputBlogDir, `${post.slug}.html`);
      fs.writeFileSync(outputPath, html, "utf8");
    }

    const generatedFiles = fullPosts.map((post) => `blog/${post.slug}.html`);
    const removed = pruneStaleGeneratedPages({
      outputRoot: resolvedOutputRoot,
      manifestPath: resolvedManifestPath,
      expectedFiles: generatedFiles
    });
    writeGeneratedManifest(resolvedManifestPath, generatedFiles);
    writeBlogIndexFallback(fullPosts, outputBlogDir);
    writeSitemap(fullPosts, resolvedOutputRoot);
    writeRobots(resolvedOutputRoot);
    writeRssFeed(fullPosts, outputBlogDir);

    return {
      posts: fullPosts,
      generatedFiles,
      removedFiles: removed,
      manifestPath: resolvedManifestPath
    };
  } finally {
    db.close();
  }
}

function getArgValue(name) {
  const argument = process.argv.find((value) => value.startsWith(`--${name}=`));
  return argument ? argument.slice(name.length + 3) : undefined;
}

function main() {
  const result = buildStaticBlog({
    dbPath: getArgValue("db"),
    outputRoot: getArgValue("output-root") || ROOT_DIR,
    manifestPath: getArgValue("manifest-path")
  });
  console.log(
    `Generated ${result.posts.length} published blog pages${
      result.removedFiles.length ? ` and pruned ${result.removedFiles.length} stale generated page(s)` : ""
    }.`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  GENERATED_PAGE_MARKER,
  GENERATOR_ID,
  buildBlogIndexFallback,
  buildStaticBlog,
  buildStaticPostHtml,
  pruneStaleGeneratedPages,
  writeBlogIndexFallback
};
