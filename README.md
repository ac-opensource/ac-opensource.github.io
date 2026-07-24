# Andrew Concepcion Site

Static multi-page portfolio and technical blog. SQLite is the authoring-only source; the deployed website is a clean, published-only `dist/` artifact.

## Architecture

- `index.html`, `about.html`, `work.html`, `contact.html`, and `resume.html`: source pages for the public portfolio.
- `assets/data/blog.sqlite`: authoring source of truth committed for reproducible builds. It is never copied to `dist/`.
- `scripts/build-static-blog-pages.js`: generates published post pages, RSS, robots, and sitemap artifacts.
- `scripts/build-site.js`: assembles a fresh allowlisted `dist/`, generates responsive image references, and compiles Tailwind locally.
- `blog/posts.json`: published-only metadata used for progressive enhancement; article bodies stay in static HTML.
- `assets/data/profile-map.json`: public evidence model for the interactive Engineering and Interests profile tree.
- `scripts/blog-writer-server.js`: loopback-only writer API with a per-run session check.
- `.github/workflows/pages.yml`: verifies and deploys only `dist/` from the default `master` branch.

Authoring files, hidden posts, preview routes, templates, databases, application materials, and stale generated pages are rejected from the publication artifact.

## Setup

Use the pinned Node version and install exactly the locked dependencies:

```bash
nvm use
npm ci
```

Initialize/import the blog database only when creating a fresh authoring store:

```bash
npm run blog:db:init
npm run blog:db:import
```

## Build and verify

Build the clean public site:

```bash
npm run build
```

Run publication-boundary, deterministic-build, and writer-security checks:

```bash
npm run verify
```

Preview the artifact, never the repository root:

```bash
python3 -m http.server 4173 --directory dist
```

Then open `http://127.0.0.1:4173`.

## Writing workflow

Run the local writer:

```bash
npm run blog:writer
```

Open `http://127.0.0.1:4310`. Saved entries remain in `assets/data/blog.sqlite`; the public manifest and pages are produced only by the build.

## Search and AI discovery

- `sitemap.xml` contains every indexable canonical route in `dist/` and only published posts.
- `robots.txt` allows crawling and points to the sitemap.
- `llms.txt`, RSS, JSON-LD, semantic static fallbacks, and the published post manifest provide machine-readable discovery paths.
- Google indexing still requires deploying this artifact, completing URL-prefix ownership verification in Search Console, submitting `https://ac-opensource.github.io/sitemap.xml`, and requesting indexing for the homepage.

Google decides when and whether eligible pages appear in results; submission requests discovery and crawling but cannot guarantee ranking or inclusion.
