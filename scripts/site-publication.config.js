module.exports = Object.freeze({
  publicPages: [
    "index.html",
    "about.html",
    "work.html",
    "contact.html",
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
    "project-detail.html"
  ]
});
