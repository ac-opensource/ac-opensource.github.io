const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { buildStaticBlog } = require("./build-static-blog-pages");
const { syncBlogManifest } = require("./sync-blog-from-db");
const { rewritePublicImageUrls, shouldExcludeOriginal } = require("./lib/public-images");
const { renderPublication, syncSignalsSitemap } = require("./render-signals-page");
const publication = require("./site-publication.config");

const ROOT_DIR = path.join(__dirname, "..");
const DEFAULT_OUTPUT_ROOT = path.join(ROOT_DIR, "dist");
const GENERATED_MANIFEST_NAME = ".generated-blog-pages.json";
const TAILWIND_CLI = require.resolve("tailwindcss/lib/cli.js");
const TAILWIND_CONFIG = path.join(__dirname, "tailwind.config.js");
const TAILWIND_INPUT = path.join(__dirname, "styles", "tailwind-input.css");

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertReplaceableOutput(outputRoot) {
  const resolved = path.resolve(outputRoot);
  const temporaryRoot = path.resolve(os.tmpdir());
  const temporaryRelative = path.relative(temporaryRoot, resolved);
  const temporaryNamespace = temporaryRelative.split(path.sep)[0];
  const allowedDist = resolved === DEFAULT_OUTPUT_ROOT;
  const allowedTemporary =
    resolved !== temporaryRoot &&
    isWithin(temporaryRoot, resolved) &&
    temporaryNamespace.startsWith("ac-site-");

  if (!allowedDist && !allowedTemporary) {
    throw new Error("Build output must be the repository dist directory or an ac-site-* OS temp directory.");
  }
  if (resolved === ROOT_DIR || isWithin(resolved, ROOT_DIR)) {
    throw new Error("Refusing to use the repository or one of its parents as build output.");
  }
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error("Refusing to replace a symlinked build output directory.");
  }

  return resolved;
}

function copyFile(relativePath, stagingRoot, { optional = false } = {}) {
  const source = path.join(ROOT_DIR, relativePath);
  if (!fs.existsSync(source)) {
    if (optional) return false;
    throw new Error(`Required public file is missing: ${relativePath}`);
  }

  const destination = path.join(stagingRoot, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return true;
}

function copyPublicAssetDirectory(relativeDirectory, stagingRoot) {
  const sourceDirectory = path.join(ROOT_DIR, relativeDirectory);
  if (!fs.existsSync(sourceDirectory)) return;

  const entries = fs.readdirSync(sourceDirectory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory.replaceAll(path.sep, "/"), entry.name);
    if (entry.isDirectory() && publication.excludedAssetDirectories.has(relativePath)) continue;
    if (publication.excludedAssetFiles.has(relativePath)) continue;

    if (entry.isDirectory()) {
      copyPublicAssetDirectory(relativePath, stagingRoot);
    } else if (entry.isFile()) {
      if (shouldExcludeOriginal(relativePath)) continue;
      copyFile(relativePath, stagingRoot);
    }
  }
}

function assertNoForbiddenOutput(stagingRoot) {
  for (const relativePath of publication.forbiddenPublishedPaths) {
    if (fs.existsSync(path.join(stagingRoot, relativePath))) {
      throw new Error(`Forbidden path reached the publication output: ${relativePath}`);
    }
  }

  const pending = [stagingRoot];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = path.relative(stagingRoot, absolutePath).split(path.sep).join("/");
      if (publication.forbiddenPublishedNamePattern.test(relativePath)) {
        throw new Error(`Local-only artifact name reached the publication output: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (/\.(?:sqlite(?:-(?:shm|wal))?|db)$/i.test(entry.name)) {
        throw new Error(`Database file reached the publication output: ${relativePath}`);
      }
    }
  }
}

function walkHtmlFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolutePath);
      else if (entry.isFile() && entry.name.endsWith(".html")) files.push(absolutePath);
    }
  }
  return files.sort();
}

function replaceTailwindRuntime(html, relativePath) {
  const usesTailwind = /cdn\.tailwindcss\.com/i.test(html)
    || /\bid=["']tailwind-config["']/i.test(html)
    || /href=["']\/assets\/css\/tailwind\.css["']/i.test(html);
  const withoutCdn = rewritePublicImageUrls(html)
    .replace(
      /\s*<script\b[^>]*\bsrc=["']https:\/\/cdn\.tailwindcss\.com[^"']*["'][^>]*><\/script>/gi,
      ""
    )
    .replace(/\s*<script\b[^>]*\bid=["']tailwind-config["'][^>]*>[\s\S]*?<\/script>/gi, "");

  if (withoutCdn.includes("cdn.tailwindcss.com") || withoutCdn.includes('id="tailwind-config"')) {
    throw new Error(`Could not remove the Tailwind browser runtime from ${relativePath}.`);
  }
  if (!usesTailwind) return withoutCdn;
  if (withoutCdn.includes('href="/assets/css/tailwind.css"')) return withoutCdn;
  if (!withoutCdn.includes("</head>")) {
    throw new Error(`Cannot add the compiled Tailwind stylesheet to ${relativePath}: missing </head>.`);
  }

  return withoutCdn.replace(
    "</head>",
    '<link href="/assets/css/tailwind.css" rel="stylesheet"/>\n</head>'
  );
}

function injectUniverseSoundscape(html, relativePath) {
  const normalizedPath = relativePath.split(path.sep).join("/");
  if (normalizedPath.startsWith("experiments/")) return html;
  if (!html.includes("</head>")) {
    throw new Error(`Cannot add the universe soundscape to ${relativePath}: missing </head>.`);
  }

  let enhanced = html;
  if (!enhanced.includes('href="/assets/css/universe-soundscape.css')) {
    enhanced = enhanced.replace(
      "</head>",
      '<link href="/assets/css/universe-soundscape.css?v=20260808-2" rel="stylesheet"/>\n</head>'
    );
  }
  if (!enhanced.includes('src="/assets/js/universe-soundscape.js')) {
    enhanced = enhanced.replace(
      "</head>",
      '<script src="/assets/js/universe-soundscape.js?v=20260808-2" defer></script>\n</head>'
    );
  }
  return enhanced;
}

function injectBigBangLoader(html, relativePath) {
  const normalizedPath = relativePath.split(path.sep).join("/");
  if (normalizedPath !== "work.html") return html;
  if (!html.includes("</head>")) {
    throw new Error(`Cannot add the Big Bang page loader to ${relativePath}: missing </head>.`);
  }
  if (html.includes("data-big-bang-bootstrap")) return html;

  const bootstrap = [
    '<link href="/assets/css/big-bang-loader.css?v=20260808-7" rel="stylesheet"/>',
    '<script data-big-bang-bootstrap>(function(){',
    'if(window.matchMedia&&(',
    'window.matchMedia("(prefers-reduced-motion: reduce)").matches||',
    'window.matchMedia("(forced-colors: active)").matches))return;',
    'var seen=false;try{seen=window.sessionStorage.getItem("ac.bigBangPortfolioPlayed.v1")==="1";}catch(error){}',
    'if(seen)return;',
    'var root=document.documentElement;root.dataset.bigBang="pending";',
    'window.__bigBangLoaderGuard=window.setTimeout(function(){',
    'if(root.dataset.bigBang==="pending")delete root.dataset.bigBang;',
    '},4000);',
    '}());</script>',
    '<script src="/assets/js/big-bang-loader.js?v=20260808-7" defer></script>'
  ].join("");

  return html.replace("</head>", `${bootstrap}\n</head>`);
}

function compileTailwind(stagingRoot) {
  for (const htmlPath of walkHtmlFiles(stagingRoot)) {
    const relativePath = path.relative(stagingRoot, htmlPath);
    const transformed = injectBigBangLoader(
      injectUniverseSoundscape(
        replaceTailwindRuntime(fs.readFileSync(htmlPath, "utf8"), relativePath),
        relativePath
      ),
      relativePath
    );
    fs.writeFileSync(htmlPath, transformed, "utf8");
  }

  const outputPath = path.join(stagingRoot, "assets", "css", "tailwind.css");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const result = spawnSync(
    process.execPath,
    [TAILWIND_CLI, "--config", TAILWIND_CONFIG, "--input", TAILWIND_INPUT, "--output", outputPath, "--minify"],
    {
      cwd: ROOT_DIR,
      encoding: "utf8",
      env: {
        ...process.env,
        TAILWIND_CONTENT: path.join(stagingRoot, "**", "*.html")
      }
    }
  );

  if (result.status !== 0) {
    throw new Error(`Tailwind compilation failed:\n${result.stderr || result.stdout || "Unknown error"}`);
  }
}

function populateStagingDirectory(stagingRoot, { dbPath } = {}) {
  fs.mkdirSync(stagingRoot, { recursive: true });

  for (const publicPage of publication.publicPages) {
    copyFile(publicPage, stagingRoot);
  }
  for (const publicFile of publication.optionalPublicRootFiles) {
    copyFile(publicFile, stagingRoot, { optional: true });
  }
  for (const publicDownload of publication.publicDownloads) {
    copyFile(publicDownload, stagingRoot);
  }
  for (const publicExperimentFile of publication.publicExperimentFiles) {
    copyFile(publicExperimentFile, stagingRoot);
  }
  for (const publicExperimentAsset of publication.publicExperimentAssets) {
    copyFile(publicExperimentAsset, stagingRoot);
  }

  copyFile("blog/index.html", stagingRoot);
  copyPublicAssetDirectory("assets/css", stagingRoot);
  copyPublicAssetDirectory("assets/js", stagingRoot);
  copyPublicAssetDirectory("assets/images", stagingRoot);
  copyPublicAssetDirectory("blog/images", stagingRoot);

  for (const publicDataFile of publication.publicDataFiles) {
    copyFile(publicDataFile, stagingRoot, { optional: true });
  }
  for (const publicDataFile of publication.requiredPublicDataFiles) {
    copyFile(publicDataFile, stagingRoot);
  }

  const signalsPublication = renderPublication({ stagingRoot });

  const manifestPath = path.join(stagingRoot, GENERATED_MANIFEST_NAME);
  const buildResult = buildStaticBlog({
    dbPath,
    outputRoot: stagingRoot,
    manifestPath
  });
  syncBlogManifest({
    dbPath,
    outputPath: path.join(stagingRoot, "blog", "posts.json")
  });
  syncSignalsSitemap(stagingRoot, signalsPublication);

  fs.unlinkSync(manifestPath);
  compileTailwind(stagingRoot);
  fs.writeFileSync(path.join(stagingRoot, ".nojekyll"), "", "utf8");
  assertNoForbiddenOutput(stagingRoot);

  return buildResult;
}

function buildSite({ outputRoot = DEFAULT_OUTPUT_ROOT, dbPath } = {}) {
  const resolvedOutputRoot = assertReplaceableOutput(outputRoot);
  const stagingRoot = `${resolvedOutputRoot}.building-${process.pid}`;

  if (fs.existsSync(stagingRoot)) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }

  try {
    const result = populateStagingDirectory(stagingRoot, { dbPath });

    if (fs.existsSync(resolvedOutputRoot)) {
      fs.rmSync(resolvedOutputRoot, { recursive: true, force: true });
    }
    fs.renameSync(stagingRoot, resolvedOutputRoot);

    return {
      outputRoot: resolvedOutputRoot,
      posts: result.posts,
      generatedFiles: result.generatedFiles
    };
  } catch (error) {
    if (fs.existsSync(stagingRoot)) {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
    throw error;
  }
}

function getArgValue(name) {
  const argument = process.argv.find((value) => value.startsWith(`--${name}=`));
  return argument ? argument.slice(name.length + 3) : undefined;
}

function main() {
  const outputRoot = getArgValue("output");
  const result = buildSite({
    outputRoot: outputRoot ? path.resolve(outputRoot) : DEFAULT_OUTPUT_ROOT,
    dbPath: getArgValue("db")
  });
  console.log(`Built ${result.generatedFiles.length} published posts into ${path.relative(ROOT_DIR, result.outputRoot) || "dist"}.`);
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_OUTPUT_ROOT,
  assertNoForbiddenOutput,
  assertReplaceableOutput,
  buildSite,
  compileTailwind,
  injectBigBangLoader,
  injectUniverseSoundscape,
  populateStagingDirectory
};
