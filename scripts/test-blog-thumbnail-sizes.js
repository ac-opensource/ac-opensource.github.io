const assert = require("node:assert/strict");
const { buildBlogIndexFallback, buildStaticPostHtml } = require("./build-static-blog-pages");
const { resolvePublicImage, rewritePublicImageUrls } = require("./lib/public-images");

const THUMBNAIL_SIZES = "(max-width: 767px) 19rem, 12rem";

function postFor(heroImage) {
  return {
    slug: "thumbnail-sizing-regression",
    title: "Thumbnail sizing regression",
    summary: "Published image variants should match the rendered thumbnail size.",
    author: "A-Ar Andrew Vigo Concepcion",
    category: "hobby",
    published_date: "2026-10-31",
    reading_time: "1 min read",
    topics: [],
    hero_image: heroImage,
    hero_alt: "Landscape photograph",
    body_html: "<p>Published content.</p>"
  };
}

function imageAttributes(html, selector = /<img\b[^>]*>/) {
  const image = html.match(selector)?.[0];
  assert.ok(image, "Expected a rendered image.");
  return Object.fromEntries([...image.matchAll(/\b([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

function thumbnailAttributes(source) {
  // Exercise the same final URL rewrite that runs after the Logs generator.
  return imageAttributes(rewritePublicImageUrls(buildBlogIndexFallback([postFor(source)])));
}

for (const [source, base] of [
  ["/blog/images/new-zealand-aurora.png", "/blog/images/new-zealand-aurora"],
  ["/blog/images/photography-misty-mountains.jpg", "/blog/images/photography-misty-mountains"]
]) {
  const image = thumbnailAttributes(source);
  assert.equal(image.src, `${base}-1600.jpg`);
  assert.equal(image.srcset, `${base}-800.jpg 800w, ${base}-1600.jpg 1600w`,
    "Logs must expose existing responsive variants when dedicated thumbnails are unavailable.");
  assert.equal(image.sizes, THUMBNAIL_SIZES);
  assert.equal(image.loading, "lazy");
  assert.equal(image.decoding, "async");
  assert.equal(image.alt, "Landscape photograph");

  // Article heroes keep their existing, larger display-size contract.
  const article = imageAttributes(buildStaticPostHtml({ post: postFor(source) }), /<img\b[^>]*\bid="post-hero-image"[^>]*>/);
  assert.equal(article.srcset, image.srcset);
  assert.equal(article.sizes, "(min-width: 1024px) 50vw, 100vw");
  assert.equal(article.loading, "eager");
}

const dedicated = thumbnailAttributes("/blog/images/agent-fleet-phone-lights.jpg");
assert.equal(dedicated.src, "/blog/images/agent-fleet-phone-lights-640.avif");
assert.equal(dedicated.srcset, "/blog/images/agent-fleet-phone-lights-320.avif 320w, /blog/images/agent-fleet-phone-lights-640.avif 640w");
assert.equal(dedicated.sizes, THUMBNAIL_SIZES);

for (const [source, expected] of [
  ["/blog/images/cross-platform-rust-core-hero.svg", "/blog/images/cross-platform-rust-core-hero.svg"],
  ["/assets/images/work/img_openpay_app.webp", "/assets/images/work/img_openpay_app-optimized.webp"],
  ["https://example.com/photo.jpg", "https://example.com/photo.jpg"]
]) {
  const image = thumbnailAttributes(source);
  assert.equal(image.src, expected);
  assert.equal(image.srcset, undefined);
  assert.equal(image.sizes, undefined);
}

// Only the Logs renderer changes. The general resolver still honors requested widths.
const resolver = resolvePublicImage("/blog/images/new-zealand-aurora.png", { widths: [320, 640] });
assert.equal(resolver.srcset, "");
assert.equal(resolver.src, "/blog/images/new-zealand-aurora.png");

console.log("Logs thumbnail sizing passed: responsive fallback, dedicated variants, originals, optimized alternatives, external URLs, publication rewriting, and article hero sizing.");
