const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildPublishedSearchIndex,
  injectSharedSiteTools,
  parseCurrentWork,
  renderCurrentWorkRadar
} = require("./lib/public-discovery");

const ROOT_DIR = path.join(__dirname, "..");

function fixturePage(title, body, options = {}) {
  const header = options.status
    ? `<header><span class="fixture-status">${options.status}</span></header>`
    : "";
  return `<!doctype html><html><head><title>${title}</title><meta name="description" content="${options.description || "Public description"}"></head><body>${header}<main><h1 id="top">${title}</h1>${body}</main></body></html>`;
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac-public-discovery-test-"));
  try {
    fs.mkdirSync(path.join(tempRoot, "blog"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, "work.html"),
      fixturePage("Public work", '<aside data-search-exclude><p>private@example.com +64 21 555 0199</p></aside><section><h2 id="reliability">Release reliability</h2><p>Verified Android and iOS delivery evidence.</p></section>'),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempRoot, "blog", "hidden-authoring.html"),
      fixturePage("Hidden draft", "<p>HIDDEN_SQLITE_SECRET unpublished roadmap.</p>"),
      "utf8"
    );

    const outputPath = path.join(tempRoot, "assets", "data", "search-index.json");
    const firstIndex = buildPublishedSearchIndex({
      stagingRoot: tempRoot,
      htmlFiles: ["work.html"],
      outputPath
    });
    const serialized = fs.readFileSync(outputPath, "utf8");
    assert.equal(firstIndex.documents.length, 1);
    assert.equal(firstIndex.documents[0].url, "/work.html");
    assert.equal(firstIndex.documents[0].type, "Portfolio");
    assert.equal(firstIndex.documents[0].sections.find((section) => section.id === "reliability")?.title, "Release reliability");
    assert(!serialized.includes("HIDDEN_SQLITE_SECRET"), "Unlisted staging HTML leaked into the search index.");
    assert(!serialized.includes("private@example.com") && !serialized.includes("+64 21 555 0199"),
      "Explicitly excluded contact data leaked into the search index.");
    assert.throws(() => buildPublishedSearchIndex({
      stagingRoot: tempRoot,
      htmlFiles: ["../outside.html"],
      outputPath
    }), /unsafe|escaped/);

    const currentWork = {
      version: 1,
      updated: "2026-08-12",
      items: [
        { date: "2026-08-06", label: "ONE", title: "First", description: "First public signal.", href: "/blog/first.html" },
        { date: "2026-08-05", label: "TWO", title: "Second", description: "Second public signal.", href: "/blog/second.html" },
        { date: "2026-08-04", label: "THREE", title: "Third", description: "Third public signal.", href: "/blog/third.html" }
      ]
    };
    const radarFixture = [
      "<p><!-- current-work:updated:start -->stale<!-- current-work:updated:end --></p>",
      '<div aria-label="Current work radar">',
      "<!-- current-work:list:start -->stale<!-- current-work:list:end -->",
      "</div>"
    ].join("\n");
    const radar = renderCurrentWorkRadar(radarFixture, currentWork);
    assert(radar.includes('<time datetime="2026-08-12">AUG 12 2026</time>'));
    assert.equal((radar.match(/<a style=/g) || []).length, 3);
    assert.equal(renderCurrentWorkRadar(radar, currentWork), radar, "Current-work rendering is not deterministic/idempotent.");
    assert.throws(() => parseCurrentWork({
      ...currentWork,
      items: currentWork.items.map((item, index) => index ? item : { ...item, href: "https://example.com/private" })
    }), /root-relative public link/);

    const shared = injectSharedSiteTools(fixturePage("Fixture", "<p>Ready.</p>"), "fixture.html");
    assert.equal((shared.match(/data-shared-site-search/g) || []).length, 2);
    assert(shared.includes('/assets/css/site-search.css'));
    assert(shared.includes('/assets/js/site-search.js'));
    assert.equal((shared.match(/data-site-search-link/g) || []).length, 0,
      "Shared discovery must not invent a Search slot.");
    assert(!shared.includes("<aside"), "Search must replace the header status rather than create an overlay.");
    assert(!/calm[- ]sky|data-calm|motion-preference/i.test(shared), "Shared discovery still injects Calm Sky runtime or UI.");
    assert.equal(injectSharedSiteTools(shared, "fixture.html"), shared, "Shared-tool injection is not idempotent.");

    const experimentShared = injectSharedSiteTools(
      fixturePage("Experiment", "<p>Ready.</p>"),
      "experiments/universe-options/work-round-04/flagship-deck.html"
    );
    assert.equal((experimentShared.match(/data-shared-site-search/g) || []).length, 2);
    assert(experimentShared.includes('/assets/css/site-search.css'));
    assert(experimentShared.includes('/assets/js/site-search.js'));
    assert.equal((experimentShared.match(/data-site-search-link/g) || []).length, 0,
      "An experiment without a status slot received an invented Search overlay.");
    assert(!experimentShared.includes("data-site-search-slot"));
    assert(!experimentShared.includes("<aside"));
    assert(!/calm[- ]sky|data-calm|motion-preference/i.test(experimentShared));
    assert.equal(
      injectSharedSiteTools(experimentShared, "experiments/universe-options/work-round-04/flagship-deck.html"),
      experimentShared,
      "Experiment Search injection is not idempotent."
    );

    const adoptedExperiment = fs.readFileSync(
      path.join(ROOT_DIR, "experiments", "universe-options", "work-round-05", "supernova-portfolio.html"),
      "utf8"
    );
    assert.equal((adoptedExperiment.match(/data-site-search-link/g) || []).length, 1);
    assert(adoptedExperiment.includes("data-site-search-slot"));
    assert(!adoptedExperiment.includes("[site: online]"));
    ["index.html", "about.html", "work.html", "contact.html", "resume.html", "blog/index.html", "search.html"]
      .forEach((relativePath) => {
        const source = fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8");
        const injected = injectSharedSiteTools(source, relativePath);
        assert.equal((injected.match(/data-site-search-link/g) || []).length, 1,
          `${relativePath} lost its explicit Search slot.`);
        assert(injected.includes('/assets/css/site-search.css') && injected.includes('/assets/js/site-search.js'),
          `${relativePath} explicit Search marker prevented shared asset injection.`);
      });

    const siteSearchScript = fs.readFileSync(path.join(ROOT_DIR, "assets", "js", "site-search.js"), "utf8");
    const siteSearchStyles = fs.readFileSync(path.join(ROOT_DIR, "assets", "css", "site-search.css"), "utf8");
    const searchHtml = fs.readFileSync(path.join(ROOT_DIR, "search.html"), "utf8");
    const searchScript = fs.readFileSync(path.join(ROOT_DIR, "assets", "js", "evidence-search.js"), "utf8");
    const searchStyles = fs.readFileSync(path.join(ROOT_DIR, "assets", "css", "evidence-search.css"), "utf8");
    const logsStyles = fs.readFileSync(path.join(
      ROOT_DIR,
      "assets",
      "experiments",
      "universe-options",
      "logs",
      "spiral-galaxy-archive.css"
    ), "utf8");
    const resumeHtml = fs.readFileSync(path.join(ROOT_DIR, "resume.html"), "utf8");
    assert(!fs.existsSync(path.join(ROOT_DIR, "assets", "js", "calm-sky.js")));
    assert(!fs.existsSync(path.join(ROOT_DIR, "assets", "css", "calm-sky.css")));
    assert(siteSearchScript.includes('event.key === "/"'));
    assert(siteSearchScript.includes('event.key.toLowerCase() === "k"'));
    assert(!/localStorage|motionMode|calm[- ]sky|data-calm/i.test(siteSearchScript));
    assert(siteSearchStyles.includes("[data-site-search-slot]"));
    assert(siteSearchStyles.includes(".site-search-link"));
    assert(siteSearchStyles.includes("min-width: 44px"));
    assert(siteSearchStyles.includes("min-height: 44px"));
    assert(!/position:\s*fixed|\.site-tools/.test(siteSearchStyles),
      "Shared Search styling still creates a floating overlay.");
    assert(!/data-motion-mode|calm[- ]sky|data-calm/i.test(siteSearchStyles));

    const nativeReducedMotionFiles = [
      "assets/js/work-trajectories.js",
      "assets/js/about-spectrograph.js",
      "assets/js/contact-payload-integration.js",
      "assets/js/route-signal-handoff.js",
      "assets/js/resume-dossier.js",
      "assets/js/universe-theme-transition.js",
      "assets/js/orbital-option-8.js",
      "assets/js/big-bang-loader.js",
      "assets/experiments/universe-options/logs/spiral-galaxy-archive.js",
      "assets/experiments/universe-options/work-round-05/supernova-portfolio.js",
      "scripts/build-site.js"
    ];
    nativeReducedMotionFiles.forEach((relativePath) => {
      const source = fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8");
      assert(source.includes("prefers-reduced-motion: reduce"), `${relativePath} lost native reduced-motion support.`);
      assert(!/calm-sky:change|dataset\.motionMode|data-motion-mode/i.test(source),
        `${relativePath} still contains a removed manual motion-mode hook.`);
    });
    ["index.html", "work.html", "contact.html", "about.html", "resume.html", "experiments/universe-options/work-round-05/supernova-portfolio.html"]
      .forEach((relativePath) => {
        const source = fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8");
        assert(!source.includes("20260812-calm1"), `${relativePath} still uses the retired Calm cache key.`);
      });
    assert(searchHtml.includes('maxlength="160"'));
    assert(searchHtml.includes("<noscript>"));
    const searchEnhancementBootstrap = '<script>document.documentElement.classList.replace("no-js", "has-js");</script>';
    assert(searchHtml.includes(searchEnhancementBootstrap));
    assert(searchHtml.indexOf(searchEnhancementBootstrap) < searchHtml.indexOf('assets/css/evidence-search.css'),
      "Evidence Search must select its enhanced layout before the first stylesheet paint.");
    assert(searchHtml.includes("data-search-navigation") && searchHtml.includes("data-search-phase=\"loading\""));
    assert(searchHtml.includes("data-search-field aria-hidden=\"true\""));
    assert(searchHtml.includes("Search the work,<br><em>not the noise.</em>"));
    assert(!/warp factor|hyperspace|launch sequence|engage/i.test(searchHtml),
      "Evidence Search copy slipped into novelty spaceship language.");
    assert(!searchScript.includes("innerHTML"), "Search results must not render index text through innerHTML.");
    assert(searchScript.includes('searchParams.delete("q")'));
    assert(searchScript.includes("pendingQuery"));
    assert(searchScript.includes('setPhase("loading")') && searchScript.includes('setPhase("error")'));
    assert(searchScript.includes('navigation.dataset.searchMotion = "routing"'));
    assert(searchStyles.includes("--search-muted: #626a67"));
    assert(searchStyles.includes("input::placeholder { color: var(--search-muted);"));
    assert(searchStyles.includes(".evidence-search__field-rail"));
    assert(searchStyles.includes("@keyframes search-route-rail"));
    assert(searchStyles.includes("min-height: 44px"));
    assert(/\.js \.galaxy-tuner\[hidden\][\s\S]*?display:\s*block\s*!important/.test(logsStyles),
      "Logs must override the user-agent hidden rule while reserving its mobile tuner height.");
    assert(resumeHtml.includes("data-search-exclude"), "Resume contact details are not excluded from search extraction.");

    const sitemapSource = fs.readFileSync(path.join(ROOT_DIR, "scripts", "build-static-blog-pages.js"), "utf8");
    assert(sitemapSource.includes('{ path: "/search.html" }'));
    console.log("Verified public-only indexing, deterministic current-work rendering, header-slot Search replacement, and native-only reduced motion.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
