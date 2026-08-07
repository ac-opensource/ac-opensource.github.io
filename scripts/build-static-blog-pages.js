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
  "case-study-ocbc-banking-experience": "gallery",
  "case-study-openpay-bnpl-experience": "cover"
});
const WORK_HERO_GALLERY_BY_SLUG = Object.freeze({
  "case-study-ocbc-banking-experience": [
    {
      src: "/assets/images/work/img_ocbc_business_cashflow.webp",
      alt: "OCBC Business Android sales, expenses, and cashflow dashboard"
    },
    {
      src: "/assets/images/work/img_ocbc_business_transactions.webp",
      alt: "OCBC Business Android transaction history and inflow-outflow filters"
    },
    {
      src: "/assets/images/work/img_ocbc_business_card_controls.webp",
      alt: "OCBC Business Android digital business debit card controls"
    }
  ]
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

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function plainTextFromHtml(value) {
  return decodeHtmlEntities(stripHtml(value));
}

function articleMode(post, bodyHtml = "") {
  if (isWorkPost(post)) return "case-study";

  const category = String(post?.category || "").trim().toLowerCase();
  const topics = (post?.topics || []).map((topic) => String(topic).trim().toLowerCase());
  if (category === "technical") return "technical";
  if (topics.includes("travel")) return "travel";
  if (topics.includes("photography") || (category === "hobby" && (String(bodyHtml).match(/<figure\b/gi) || []).length >= 3)) {
    return "photography";
  }
  return "personal";
}

function trajectoryVariant(post) {
  return ["technical", "case-study"].includes(articleMode(post)) ? "mission" : "observation";
}

function trajectoryPhase(_title, mode) {
  const labels = {
    technical: "system",
    "case-study": "delivery record",
    travel: "field note",
    photography: "frame",
    personal: "observation",
    mission: "system",
    observation: "observation"
  };
  return labels[mode] || "section";
}

function trajectoryHeadingId(title, index, usedIds) {
  const stem = String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || `section-${index + 1}`;
  const base = `debrief-${stem}`;
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function decorateArticleBody(bodyHtml, post) {
  const source = String(bodyHtml || "");
  const headingPattern = /<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  const matches = [...source.matchAll(headingPattern)];
  const mode = articleMode(post, source);
  const variant = ["technical", "case-study"].includes(mode) ? "mission" : "observation";
  const usedIds = new Set();
  const headings = matches.map((match, index) => {
    const attributes = match[2] || "";
    const existingId = attributes.match(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const title = plainTextFromHtml(match[3]);
    const id = existingId
      ? existingId[1] || existingId[2] || existingId[3]
      : trajectoryHeadingId(title, index, usedIds);
    usedIds.add(id);
    return {
      id,
      level: Number(match[1]),
      title,
      phase: trajectoryPhase(title, mode),
      index: index + 1
    };
  });

  let headingIndex = 0;
  let decoratedBody = source.replace(headingPattern, (_match, level, attributes, innerHtml) => {
    const heading = headings[headingIndex];
    headingIndex += 1;
    const hasId = /\bid\s*=/i.test(attributes);
    return `<h${level}${attributes}${hasId ? "" : ` id="${escapeHtml(heading.id)}"`} data-debrief-heading data-debrief-phase="${escapeHtml(heading.phase)}">${innerHtml}</h${level}>`;
  });

  const figures = [];
  let figureIndex = 0;
  decoratedBody = decoratedBody.replace(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi, (_match, attributes, innerHtml) => {
    figureIndex += 1;
    const existingId = attributes.match(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const captionMatch = innerHtml.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
    const altMatch = innerHtml.match(/\balt\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    const id = existingId ? existingId[1] || existingId[2] || existingId[3] : `field-frame-${String(figureIndex).padStart(2, "0")}`;
    const title = plainTextFromHtml(captionMatch?.[1] || altMatch?.[1] || altMatch?.[2] || `Frame ${figureIndex}`);
    figures.push({ id, title, index: figureIndex, phase: "frame" });
    const hasId = /\bid\s*=/i.test(attributes);
    return `<figure${attributes}${hasId ? "" : ` id="${escapeHtml(id)}"`} data-article-figure>${innerHtml}</figure>`;
  });

  return { bodyHtml: decoratedBody, headings, figures, mode, variant };
}

function trajectoryLinks(headings) {
  return headings.map((heading) => `
    <li class="article-trajectory__item" data-trajectory-item>
      <a class="article-trajectory__link" href="#${escapeHtml(heading.id)}" data-trajectory-link data-section-id="${escapeHtml(heading.id)}">
        <span class="article-trajectory__index">${String(heading.index).padStart(2, "0")}</span>
        <span class="article-trajectory__phase">[${escapeHtml(heading.phase)}]</span>
        <span class="article-trajectory__title">${escapeHtml(heading.title)}</span>
      </a>
    </li>`).join("");
}

function buildTrajectoryHtml(headings, mode, figures = []) {
  const items = mode === "photography" && figures.length ? figures : headings;
  if (!items.length) {
    return {
      mobile: '<div class="article-debrief__quiet-marker" aria-label="Reading mode">[uninterrupted reading field]</div>',
      desktop: ""
    };
  }

  const names = {
    technical: ["systems debrief", "Systems debrief sections"],
    "case-study": ["delivery dossier", "Delivery dossier sections"],
    travel: ["field expedition", "Field expedition notes"],
    photography: ["image sequence", "Image sequence frames"],
    personal: ["reflection light cone", "Reflection observations"]
  };
  const [modeLabel, label] = names[mode] || ["reading field", "Article sections"];
  const eyebrow = `[${modeLabel}]`;
  const links = trajectoryLinks(items);
  return {
    mobile: `
<details class="article-trajectory article-trajectory--mobile" data-trajectory-details>
  <summary class="article-trajectory__summary">
    <span>${eyebrow}</span>
    <span>${items.length} ${mode === "photography" ? (items.length === 1 ? "frame" : "frames") : (items.length === 1 ? "section" : "sections")}</span>
  </summary>
  <nav aria-label="${label}">
    <ol class="article-trajectory__list">${links}
    </ol>
  </nav>
</details>`,
    desktop: `
<nav class="article-trajectory article-trajectory--desktop" aria-label="${label}" data-article-trajectory>
  <p class="article-trajectory__eyebrow">${eyebrow}</p>
  <ol class="article-trajectory__list">${links}
  </ol>
</nav>`
  };
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

function buildBlogIndexFallback(posts) {
  const articles = posts
    .map((post, index) => {
      const title = String(post.title || "").trim() || "Untitled";
      const summary = String(post.summary || "").trim() || stripHtml(post.body_html).slice(0, 180);
      const publishedDate = String(post.published_date || "").trim();
      const readingTime = String(post.reading_time || "").trim() || "n/a";
      const heroData = resolvePublicImage(toAssetUrl(post.hero_image));
      const heroImage = heroData.src || toAssetUrl(post.hero_image);
      const heroAlt = String(post.hero_alt || `${title} preview`).trim() || `${title} preview`;
      const heroResponsiveAttributes = heroData.srcset
        ? ` srcset="${escapeHtml(heroData.srcset)}" sizes="${escapeHtml(heroData.sizes)}"`
        : "";
      const topics = Array.isArray(post.topics) ? post.topics : [];
      const topicsHtml = topics.length
        ? `<p class="galaxy-entry__topics" aria-label="Topics">${topics
            .map((topic) => `<span>${escapeHtml(topic)}</span>`)
            .join("")}</p>`
        : "";
      const heroHtml = heroImage
        ? `<a class="galaxy-entry__media" href="${escapeHtml(postPath(post.slug))}" aria-label="Read ${escapeHtml(title)}"><img src="${escapeHtml(heroImage)}"${heroResponsiveAttributes} alt="${escapeHtml(heroAlt)}" loading="${index === 0 ? "eager" : "lazy"}" decoding="async"/></a>`
        : "";

      return `<article class="galaxy-entry${heroHtml ? " has-media" : ""}" data-slug="${escapeHtml(post.slug)}" data-blog-slug="${escapeHtml(post.slug)}" data-blog-selected="false" data-has-media="${Boolean(heroHtml)}">
  <p class="galaxy-entry__meta">${escapeHtml(visibleCategory(post.category))}<time datetime="${escapeHtml(publishedDate)}">${escapeHtml(publishedDate)}</time><span>${escapeHtml(readingTime)}</span></p>
  <div class="galaxy-entry__body">
    <h3><a href="${escapeHtml(postPath(post.slug))}">${escapeHtml(title)}</a></h3>
    <p class="galaxy-entry__summary">${escapeHtml(summary)}</p>
    ${topicsHtml}
  </div>
  ${heroHtml}
</article>`;
    })
    .join("\n");

  return `<section id="blog-feed" aria-label="Published writing">
<div id="galaxy-list" class="galaxy-list" aria-live="polite">
${articles}
</div>
</section>`;
}

function writeBlogIndexFallback(posts, outputBlogDir) {
  const indexPath = path.join(outputBlogDir, "index.html");
  if (!fs.existsSync(indexPath)) return false;

  const indexHtml = fs.readFileSync(indexPath, "utf8");
  const feedPattern = /<section id="blog-feed"[^>]*>[\s\S]*?<\/section>/;
  if (!feedPattern.test(indexHtml)) {
    throw new Error(`Cannot update the no-JavaScript blog feed in ${indexPath}.`);
  }

  const years = posts
    .map((post) => String(post.published_date || "").slice(0, 4))
    .filter((year) => /^\d{4}$/.test(year))
    .sort();
  const yearRange = !years.length
    ? "date range unavailable"
    : years[0] === years.at(-1) ? years[0] : `${years[0]} → ${years.at(-1)}`;
  const publishedCount = `${posts.length} published ${posts.length === 1 ? "entry" : "entries"}`;
  const updatedIndexHtml = indexHtml
    .replace(feedPattern, buildBlogIndexFallback(posts))
    .replace(/(<span id="(?:archive-total-count|galaxy-total)">)[^<]*(<\/span>)/, `$1${publishedCount}$2`)
    .replace(/(<span id="(?:archive-date-range|galaxy-range)">)[^<]*(<\/span>)/, `$1${yearRange}$2`)
    .replace(/(<span id="infinite-status">)[^<]*(<\/span>)/, `$1[${posts.length} published entries · engineering, systems, and life]$2`);

  fs.writeFileSync(
    indexPath,
    updatedIndexHtml,
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

  if (layout === "gallery") {
    const galleryImages = WORK_HERO_GALLERY_BY_SLUG[String(post?.slug || "")] || [];
    const galleryHtml = galleryImages.map((image, index) => `
  <span class="work-post-hero__screen">
    <img${index === 0 ? ' id="post-hero-image"' : ""} src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" loading="${index === 0 ? "eager" : "lazy"}" decoding="async"/>
  </span>`).join("");

    return `
<figure class="work-post-hero work-post-hero--gallery lg:col-span-5" data-work-hero-layout="gallery">
${galleryHtml}
  <figcaption class="sr-only">Official OCBC Business Android app screens from Google Play.</figcaption>
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

function buildArticleHeroPanel({ mode, post, heroImage, heroResponsiveAttributes, heroAlt, heroCaption }) {
  if (mode === "case-study") {
    return buildWorkHeroPanel({ post, heroImage, heroResponsiveAttributes, heroAlt, heroCaption });
  }

  return `
<figure class="article-region__hero article-region__hero--${escapeHtml(mode)}">
  <img id="post-hero-image" src="${escapeHtml(heroImage)}"${heroResponsiveAttributes} alt="${escapeHtml(heroAlt)}" loading="eager" decoding="async"/>
  ${heroCaption ? `<figcaption>${escapeHtml(heroCaption)}</figcaption>` : ""}
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
  const bodyWithImageDefaults =
    addImageDefaults(String(post.body_html || "").trim()) || `<p>${escapeHtml(summary)}</p>`;
  const debrief = decorateArticleBody(bodyWithImageDefaults, post);
  const bodyHtml = debrief.bodyHtml;
  const trajectoryHtml = buildTrajectoryHtml(debrief.headings, debrief.mode, debrief.figures);
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

  const heroPanelHtml = buildArticleHeroPanel({
    mode: debrief.mode,
    post,
    heroImage,
    heroResponsiveAttributes,
    heroAlt,
    heroCaption
  });
  const regionLabels = {
    technical: "SYSTEMS DEBRIEF",
    "case-study": "DELIVERY DOSSIER",
    travel: "FIELD EXPEDITION LOG",
    photography: "IMAGE SEQUENCE",
    personal: "REFLECTION LIGHT CONE"
  };
  const regionLabel = regionLabels[debrief.mode] || "READING FIELD";
  const contentCount = debrief.mode === "photography" ? debrief.figures.length : debrief.headings.length;
  const contentUnit = debrief.mode === "photography"
    ? (contentCount === 1 ? "real frame" : "real frames")
    : (contentCount === 1 ? "authored section" : "authored sections");

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
<link href="/assets/css/article-debrief.css?v=20260807-regions2" rel="stylesheet"/>
<link href="/assets/css/universe-field-map.css?v=20260807" rel="stylesheet"/>
<script src="/assets/js/universe-theme-transition.js?v=20260807-fast2"></script>
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
  .work-post-hero {
    position: relative;
    display: grid;
    aspect-ratio: 1;
    margin: 0;
    overflow: hidden;
    border: 1px solid rgba(175, 179, 170, 0.28);
    background: #edefe7;
  }
  .work-post-hero--gallery {
    aspect-ratio: 16 / 10;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background:
      radial-gradient(circle at 18% 12%, rgba(210, 47, 51, 0.12), transparent 13rem),
      linear-gradient(145deg, #f4f5f1, #e9eeec);
  }
  .work-post-hero__screen {
    display: block;
    flex: 0 0 auto;
    height: 92%;
    aspect-ratio: 608 / 1080;
    overflow: hidden;
    border-radius: 0.4rem;
    box-shadow: 0 14px 28px rgba(44, 55, 49, 0.16);
  }
  .work-post-hero__screen img,
  .work-post-hero--cover > img,
  .work-post-hero--contain > img {
    display: block;
    width: 100%;
    height: 100%;
  }
  .work-post-hero__screen img,
  .work-post-hero--cover > img {
    object-fit: cover;
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
  @media (max-width: 700px) {
    .work-post-hero--gallery {
      aspect-ratio: 4 / 3;
      justify-content: flex-start;
      overflow-x: auto;
      scroll-snap-type: x proximity;
    }
    .work-post-hero--gallery .work-post-hero__screen {
      height: 94%;
    }
    .work-post-hero__screen {
      scroll-snap-align: center;
    }
  }
</style>
<script type="application/ld+json">${structuredData}</script>
</head>
<body class="article-debrief-page bg-background text-on-surface font-body antialiased" data-universe-region="article" data-article-mode="${escapeHtml(debrief.mode)}">
<a href="#main-content" class="fixed left-4 top-4 z-[100] -translate-y-24 bg-surface-container-lowest border border-outline px-4 py-3 font-label text-xs uppercase tracking-widest text-on-surface focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-tertiary">Skip to content</a>
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
<main id="main-content" class="article-region-main">
<article class="article-debrief article-region" data-article-debrief data-debrief-variant="${escapeHtml(debrief.variant)}" data-article-mode="${escapeHtml(debrief.mode)}">
<header class="article-region__header">
  <div class="article-region__meta">
    <strong>${escapeHtml(regionLabel)}</strong>
    <span id="post-category">${escapeHtml(categoryLabel)}</span>
    <time id="post-date" datetime="${escapeHtml(publishedDate)}">${escapeHtml(publishedDate)}</time>
    <span id="post-reading">${escapeHtml(readingTime)}</span>
    <span>${contentCount} ${debrief.mode === "photography" ? "frames" : "sections"}</span>
  </div>
  <div class="article-region__title">
    <h1 id="post-title">${escapeHtml(title)}</h1>
    <p id="post-summary">${escapeHtml(summary)}</p>
    <div id="post-actions" class="article-region__actions">
      <button id="share-post-button" type="button">Share</button>
      <button id="bookmark-post-button" type="button">Bookmark</button>
      <a href="/blog/rss.xml">RSS</a>
      ${isWorkDeepDive ? '<a href="/work.html">Return to portfolio</a>' : ""}
    </div>
  </div>
  ${heroPanelHtml}
  <div class="article-region__topic-field">
    <span>Authored by <strong id="post-author-name">${escapeHtml(author)}</strong></span>
    <span id="post-author-role">${escapeHtml(regionLabel)}</span>
    <div id="post-tags">${tagChipsHtml}</div>
  </div>
</header>
${trajectoryHtml.mobile}
<div class="article-debrief__layout article-region__reading">
  <aside class="article-debrief__sidebar article-region__rail">
    ${trajectoryHtml.desktop}
    <p class="article-region__reading-signal">
      <span>${escapeHtml(regionLabel)}</span>
      <span>Published source</span>
      <span>${contentCount} ${contentUnit}</span>
    </p>
  </aside>
  <div id="post-body" class="article-debrief__body article-region__body" data-debrief-body>${bodyHtml}</div>
</div>
<nav class="article-region__adjacent" aria-label="Adjacent entries">
  <a id="prev-link" href="${escapeHtml(prevHref)}">
    <span>[previous entry]</span>
    <h2 id="prev-title">${escapeHtml(prevTitle)}</h2>
    <small>← read entry</small>
  </a>
  <a id="next-link" href="${escapeHtml(nextHref)}">
    <span>[next entry]</span>
    <h2 id="next-title">${escapeHtml(nextTitle)}</h2>
    <small>read entry →</small>
  </a>
</nav>
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
<script src="/assets/js/article-debrief.js?v=20260807-regions1"></script>
<script src="/assets/js/universe-field-map.js?v=20260807"></script>
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

      const html = buildStaticPostHtml({ post, previous, next }).replace(/[ \t]+$/gm, "");
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
  articleMode,
  buildBlogIndexFallback,
  buildTrajectoryHtml,
  buildStaticBlog,
  buildStaticPostHtml,
  decorateArticleBody,
  pruneStaleGeneratedPages,
  trajectoryPhase,
  trajectoryVariant,
  writeBlogIndexFallback
};
