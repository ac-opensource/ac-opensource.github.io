# Andrew Concepcion Site

Static multi-page portfolio/blog with SQLite-backed blog content.

## What this includes

- Digital Workbench-style homepage/about/blog views
- SQLite-backed blog index (`/blog/index.html`) with static, SEO-ready blog post pages (`/blog/<slug>.html`)
- Local WYSIWYG writer that saves posts directly into SQLite (`npm run blog:writer`)
- Static asset references for blog images under `blog/images/`

## SQLite Blog Architecture

- `assets/data/blog.sqlite`: source of truth for all blog post data
- `assets/js/blog-sqlite.js`: browser client that loads and queries SQLite via `sql.js`
- `scripts/lib/blog-db.js`: shared schema + upsert/query helpers for Node scripts
- `scripts/init-blog-db.js`: creates schema
- `scripts/import-blog-into-db.js`: imports existing `blog/posts.json` + post HTML into SQLite
- `scripts/sync-blog-from-db.js`: exports DB metadata back to `blog/posts.json`
- `scripts/build-static-blog-pages.js`: builds static blog post pages, `sitemap.xml`, and `robots.txt` from SQLite
- `scripts/blog-writer-server.js`: local writer API + static writer page host
- `blog/writer.html` + `assets/js/blog-writer-app.js`: WYSIWYG writer UI (Quill)

## Setup

Install dependencies:

```bash
npm install
```

Initialize and seed SQLite from existing content:

```bash
npm run blog:db:init
npm run blog:db:import
```

Optional: sync DB metadata back to `blog/posts.json`:

```bash
npm run blog:db:sync
```

Build static blog post pages for GitHub Pages deployment:

```bash
npm run blog:build
```

Or run the full build pipeline (`posts.json` sync + static page generation):

```bash
npm run build
```

## Writing workflow

Run the local writer:

```bash
npm run blog:writer
```

Open `http://localhost:4310`, write/edit in the WYSIWYG editor, and save. Entries are written into `assets/data/blog.sqlite`.
For production/GitHub Pages, run `npm run blog:build` to generate static post pages and SEO artifacts.

## Public Site Preview

Serve with any static server from repository root. Example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.
