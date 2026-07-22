const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..", "..");
const SITE_ORIGIN = "https://ac-opensource.github.io";
const RESPONSIVE_WIDTHS = [800, 1600];
const VARIANT_EXTENSIONS = [".avif", ".webp", ".jpg", ".jpeg", ".png"];

function normalizePublicUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^\.?\/?images\//i.test(value)) {
    return `/blog/${value.replace(/^\.?\/?/, "")}`;
  }

  try {
    const url = new URL(value, SITE_ORIGIN);
    if (url.origin !== SITE_ORIGIN) return value;
    return url.pathname;
  } catch (_error) {
    return value;
  }
}

function localPathForPublicUrl(publicUrl) {
  const normalized = normalizePublicUrl(publicUrl);
  if (!normalized.startsWith("/")) return null;
  const resolved = path.resolve(ROOT_DIR, normalized.slice(1));
  const relative = path.relative(ROOT_DIR, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function variantForWidth(sourcePath, width) {
  const extension = path.extname(sourcePath);
  if (!extension) return null;
  const base = sourcePath.slice(0, -extension.length);

  for (const variantExtension of VARIANT_EXTENSIONS) {
    const candidate = `${base}-${width}${variantExtension}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function publicUrlForLocalPath(localPath) {
  return `/${path.relative(ROOT_DIR, localPath).split(path.sep).join("/")}`;
}

function resolvePublicImage(raw) {
  const original = normalizePublicUrl(raw);
  const sourcePath = localPathForPublicUrl(original);
  if (!sourcePath) {
    return {
      src: original,
      srcset: "",
      sizes: "",
      hasCompleteVariants: false,
      hasOptimizedAlternative: false,
      hasReplacement: false
    };
  }

  const variants = RESPONSIVE_WIDTHS.map((width) => ({
    width,
    path: variantForWidth(sourcePath, width)
  })).filter((variant) => variant.path);
  const largest = variants.at(-1);
  const extension = path.extname(sourcePath);
  const optimizedAlternative = extension
    ? `${sourcePath.slice(0, -extension.length)}-optimized.webp`
    : null;
  const hasOptimizedAlternative = Boolean(
    optimizedAlternative &&
    fs.existsSync(optimizedAlternative) &&
    fs.statSync(optimizedAlternative).isFile()
  );
  const preferredPath = largest?.path || (hasOptimizedAlternative ? optimizedAlternative : null);

  return {
    src: preferredPath ? publicUrlForLocalPath(preferredPath) : original,
    srcset: variants
      .map((variant) => `${publicUrlForLocalPath(variant.path)} ${variant.width}w`)
      .join(", "),
    sizes: variants.length ? "(min-width: 1024px) 50vw, 100vw" : "",
    hasCompleteVariants: variants.length === RESPONSIVE_WIDTHS.length,
    hasOptimizedAlternative,
    hasReplacement: Boolean(preferredPath),
    original
  };
}

function shouldExcludeOriginal(relativePath) {
  const publicUrl = `/${String(relativePath || "").replace(/^\/+/, "")}`;
  const resolved = resolvePublicImage(publicUrl);
  return resolved.hasReplacement && resolved.src !== publicUrl;
}

function rewritePublicImageUrls(contents) {
  let output = String(contents || "");
  const publicImagePattern = /(?:https:\/\/ac-opensource\.github\.io)?\/(?:blog\/images|assets\/images)\/[a-zA-Z0-9._/-]+\.(?:png|jpe?g|webp|avif)/g;
  const matches = [...new Set(output.match(publicImagePattern) || [])];

  for (const match of matches) {
    const absolute = match.startsWith("http");
    const resolved = resolvePublicImage(match);
    if (!resolved.hasReplacement || resolved.src === resolved.original) continue;
    const replacement = absolute ? `${SITE_ORIGIN}${resolved.src}` : resolved.src;
    output = output.split(match).join(replacement);
  }

  return output;
}

module.exports = {
  RESPONSIVE_WIDTHS,
  normalizePublicUrl,
  resolvePublicImage,
  rewritePublicImageUrls,
  shouldExcludeOriginal
};
