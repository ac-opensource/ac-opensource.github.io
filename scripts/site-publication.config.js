const universeOptions = require("./universe-options-publication-manifest");

module.exports = Object.freeze({
  publicPages: [
    "index.html",
    "about.html",
    "work.html",
    "contact.html",
    "signals.html",
    "resume.html",
    "skills-graph.html"
  ],
  optionalPublicRootFiles: ["404.html", "favicon.ico", "llms.txt"],
  publicDownloads: ["resume_concepcion_andrew.pdf"],
  publicDataFiles: [
    "assets/data/about-snapshot.json",
    "assets/data/profile-map.json",
    "assets/data/resume-android.json",
    "assets/data/skills-interests.json"
  ],
  requiredPublicDataFiles: [
    "assets/data/contact-runtime.json",
    "assets/data/signals.json"
  ],
  publicExperimentFiles: universeOptions.files,
  publicExperimentAssets: universeOptions.assets,
  excludedAssetDirectories: new Set([
    "assets/experiments"
  ]),
  excludedAssetFiles: new Set([
    "assets/css/blog-post.css",
    "assets/css/graph.css",
    "assets/css/prd.css",
    "assets/css/site.css",
    "assets/js/blog-sqlite.js",
    "assets/js/blog-writer-app.js",
    "assets/js/prd-app.js",
    "assets/js/site-ui.js"
  ]),
  forbiddenPublishedPaths: [
    "applications",
    "assets/data/blog.sqlite",
    "assets/js/blog-sqlite.js",
    "blog/post.html",
    "blog/template.html",
    "blog/writer.html",
    "scripts/fixtures",
    "scripts/local-contact-signals-server.js",
    "project-detail.html"
  ],
  forbiddenPublishedNamePattern: /(?:fixtures?|mocks?|screen[-_]?shots?|private[-_]?data)/i
});
