const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const postcss = require("postcss");
const { lazyCssnano } = require("tailwindcss/peers/index.js");
const { buildStaticBlog } = require("./build-static-blog-pages");
const { syncBlogManifest } = require("./sync-blog-from-db");
const { rewritePublicImageUrls, shouldExcludeOriginal } = require("./lib/public-images");
const {
  buildPublishedSearchIndex,
  injectSharedSiteTools,
  renderCurrentWorkRadar
} = require("./lib/public-discovery");
const { renderPublication, syncSignalsSitemap } = require("./render-signals-page");
const publication = require("./site-publication.config");

const ROOT_DIR = path.join(__dirname, "..");
const DEFAULT_OUTPUT_ROOT = path.join(ROOT_DIR, "dist");
const GENERATED_MANIFEST_NAME = ".generated-blog-pages.json";
const TAILWIND_CLI = require.resolve("tailwindcss/lib/cli.js");
const TAILWIND_CONFIG = path.join(__dirname, "tailwind.config.js");
const TAILWIND_INPUT = path.join(__dirname, "styles", "tailwind-input.css");
const SITE_FONT_STYLESHEET = "/assets/css/site-fonts.css?v=20260819-local1";
const SITE_FONT_PRELOADS = Object.freeze([
  "/assets/fonts/manrope-latin-variable.woff2",
  "/assets/fonts/space-grotesk-latin-variable.woff2"
]);
const MINIFIED_ROUTE_STYLESHEETS = Object.freeze([
  "assets/css/about-spectrograph.css",
  "assets/css/orbital-option-8.css",
  "assets/css/work-portfolio.css"
]);

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

function localizeProductionFonts(html, relativePath) {
  const withoutRemoteFonts = String(html).replace(
    /\s*<link\b[^>]*\bhref=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"']*["'][^>]*\/?\s*>/gi,
    ""
  );
  if (/https:\/\/fonts\.(?:googleapis|gstatic)\.com/i.test(withoutRemoteFonts)) {
    throw new Error(`Could not remove a remote Google font reference from ${relativePath}.`);
  }
  if (withoutRemoteFonts.includes(`href="${SITE_FONT_STYLESHEET}"`)) return withoutRemoteFonts;
  if (!withoutRemoteFonts.includes("</head>")) {
    throw new Error(`Cannot add the local font stylesheet to ${relativePath}: missing </head>.`);
  }

  const preloadMarkup = SITE_FONT_PRELOADS
    .map((fontPath) => `<link rel="preload" href="${fontPath}" as="font" type="font/woff2" crossorigin/>`)
    .join("\n");
  return withoutRemoteFonts.replace(
    "</head>",
    `${preloadMarkup}\n<link href="${SITE_FONT_STYLESHEET}" rel="stylesheet"/>\n</head>`
  );
}

function injectBigBangLoader(html, relativePath) {
  const normalizedPath = relativePath.split(path.sep).join("/");
  if (normalizedPath !== "work.html") return html;
  if (!html.includes("</head>")) {
    throw new Error(`Cannot add the Big Bang page loader to ${relativePath}: missing </head>.`);
  }
  if (html.includes("data-big-bang-bootstrap")) return html;

  const bootstrap = [
    '<link href="/assets/css/big-bang-loader.css?v=20260819-performance2" rel="stylesheet"/>',
    '<script data-big-bang-bootstrap>(function(){',
    'var root=document.documentElement;',
    'if(window.matchMedia&&(',
    'window.matchMedia("(prefers-reduced-motion: reduce)").matches||',
    'window.matchMedia("(forced-colors: active)").matches||',
    'window.matchMedia("(max-width: 700px)").matches))return;',
    'var connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;',
    'var slowConnection=connection&&(connection.saveData||/^(?:slow-)?2g$/.test(connection.effectiveType||""));',
    'var constrainedMemory=Number(navigator.deviceMemory)>0&&Number(navigator.deviceMemory)<=2;',
    'var constrainedCpu=Number(navigator.hardwareConcurrency)>0&&Number(navigator.hardwareConcurrency)<=2;',
    'if(slowConnection||constrainedMemory||constrainedCpu)return;',
    'var integrated=root.dataset.universeMotion==="arrive"&&root.dataset.universePerspectiveTo==="work";',
    'if(integrated){try{window.sessionStorage.setItem("ac.bigBangPortfolioPlayed.v1","1");}catch(error){}return;}',
    'var seen=false;try{seen=window.sessionStorage.getItem("ac.bigBangPortfolioPlayed.v1")==="1";}catch(error){}',
    'if(seen)return;',
    'root.dataset.bigBang="pending";',
    'window.__bigBangLoaderGuard=window.setTimeout(function(){',
    'if(root.dataset.bigBang==="pending")delete root.dataset.bigBang;',
    '},900);',
    'var loader=document.createElement("script");',
    'loader.src="/assets/js/big-bang-loader.js?v=20260819-performance2";',
    'loader.async=false;loader.dataset.bigBangRuntime="";document.head.append(loader);',
    '}());</script>'
  ].join("");

  return html.replace("</head>", `${bootstrap}\n</head>`);
}

function compileTailwind(stagingRoot) {
  for (const htmlPath of walkHtmlFiles(stagingRoot)) {
    const relativePath = path.relative(stagingRoot, htmlPath);
    const transformed = localizeProductionFonts(
      injectSharedSiteTools(
        injectBigBangLoader(
          replaceTailwindRuntime(fs.readFileSync(htmlPath, "utf8"), relativePath),
          relativePath
        ),
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

function minifyPublishedRouteStyles(stagingRoot) {
  for (const relativePath of MINIFIED_ROUTE_STYLESHEETS) {
    const inputPath = path.join(stagingRoot, relativePath);
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Cannot optimize missing published stylesheet: ${relativePath}`);
    }

    const outputPath = `${inputPath}.minifying-${process.pid}`;
    try {
      const optimized = postcss([
        lazyCssnano()({
          preset: [
            "default",
            {
              colormin: false,
              cssDeclarationSorter: false
            }
          ]
        })
      ]).process(fs.readFileSync(inputPath, "utf8"), {
        from: inputPath,
        map: false,
        to: outputPath
      }).css;
      fs.writeFileSync(outputPath, optimized, "utf8");
    } catch (error) {
      if (fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });
      throw new Error(
        `Published stylesheet optimization failed for ${relativePath}:\n` +
        (error?.stack || error?.message || String(error))
      );
    }
    fs.renameSync(outputPath, inputPath);
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
  copyPublicAssetDirectory("assets/fonts", stagingRoot);
  copyPublicAssetDirectory("assets/js", stagingRoot);
  copyPublicAssetDirectory("assets/images", stagingRoot);
  copyPublicAssetDirectory("blog/images", stagingRoot);

  for (const publicDataFile of publication.publicDataFiles) {
    copyFile(publicDataFile, stagingRoot, { optional: true });
  }
  for (const publicDataFile of publication.requiredPublicDataFiles) {
    copyFile(publicDataFile, stagingRoot);
  }

  const currentWorkPath = path.join(ROOT_DIR, "assets", "data", "current-work.json");
  const homepagePath = path.join(stagingRoot, "index.html");
  const currentWork = JSON.parse(fs.readFileSync(currentWorkPath, "utf8"));
  fs.writeFileSync(
    homepagePath,
    renderCurrentWorkRadar(fs.readFileSync(homepagePath, "utf8"), currentWork),
    "utf8"
  );

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
  buildPublishedSearchIndex({
    stagingRoot,
    htmlFiles: [
      ...publication.searchablePages,
      "blog/index.html",
      ...buildResult.generatedFiles
    ],
    outputPath: path.join(stagingRoot, "assets", "data", "search-index.json")
  });

  fs.unlinkSync(manifestPath);
  compileTailwind(stagingRoot);
  minifyPublishedRouteStyles(stagingRoot);
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
  minifyPublishedRouteStyles,
  injectBigBangLoader,
  injectSharedSiteTools,
  localizeProductionFonts,
  populateStagingDirectory
};
