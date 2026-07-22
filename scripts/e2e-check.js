const { chromium, request } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173';
const CHECK_EXTERNAL_LINKS = process.env.CHECK_EXTERNAL_LINKS === '1';
const siteRoot = path.resolve(__dirname, '..', process.env.SITE_ROOT || '.');
const postsManifestPath = path.join(siteRoot, 'blog', 'posts.json');
let STATIC_BLOG_POST_PATH = '/blog/post.html';
let GENERATED_BLOG_POST_PATHS = [];

try {
  const manifest = JSON.parse(fs.readFileSync(postsManifestPath, 'utf8'));
  if (Array.isArray(manifest) && manifest.length > 0 && manifest[0].slug) {
    GENERATED_BLOG_POST_PATHS = manifest
      .filter((post) => post && post.slug)
      .map((post) => `/blog/${encodeURIComponent(post.slug)}.html`);
    STATIC_BLOG_POST_PATH = GENERATED_BLOG_POST_PATHS[0];
  }
} catch (_error) {
  // Fall back to the dynamic route if manifest is unavailable.
}

const routes = [
  { path: '/', name: 'home' },
  { path: '/work.html', name: 'work' },
  { path: '/about.html', name: 'about' },
  { path: '/contact.html', name: 'contact' },
  { path: '/resume.html', name: 'resume' },
  { path: '/blog/', name: 'blog' },
  ...GENERATED_BLOG_POST_PATHS.map((postPath, index) => ({
    path: postPath,
    name: index === 0 ? 'blog-post' : `blog-post-${index + 1}`,
    kind: 'blog-post',
    screenshot: index === 0
  }))
];

const screenshotRoot = '/tmp/ac-site-e2e';
const desktopDir = path.join(screenshotRoot, 'desktop');
const mobileDir = path.join(screenshotRoot, 'mobile');

fs.rmSync(screenshotRoot, { recursive: true, force: true });
for (const dir of [screenshotRoot, desktopDir, mobileDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

(async () => {
  const failures = [];
  const warnings = [];
  const checkedExternalLinks = new Set();

  const api = await request.newContext({
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    timeout: 20000,
  });

  const browser = await chromium.launch({ headless: true });
  const desktop = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const mobile = await browser.newContext({ viewport: { width: 430, height: 932 } });

  const page = await desktop.newPage();
  const mobilePage = await mobile.newPage();

  const consoleIssues = [];
  page.on('pageerror', (err) => consoleIssues.push(`desktop pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleIssues.push(`desktop console error: ${msg.text()}`);
    }
  });
  mobilePage.on('pageerror', (err) => consoleIssues.push(`mobile pageerror: ${err.message}`));
  mobilePage.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleIssues.push(`mobile console error: ${msg.text()}`);
    }
  });

  async function assert(condition, message) {
    if (!condition) failures.push(message);
  }

  async function checkInternalLinksOnPage(currentPath) {
    const links = await page.$$eval('a[href]', (anchors) => anchors.map((a) => a.getAttribute('href')).filter(Boolean));
    const unique = [...new Set(links)];

    for (const href of unique) {
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
        continue;
      }

      if (href.startsWith('http://') || href.startsWith('https://')) {
        if (!CHECK_EXTERNAL_LINKS) continue;
        if (checkedExternalLinks.has(href)) continue;
        checkedExternalLinks.add(href);
        try {
          const resp = await api.get(href);
          const ok = resp.status() >= 200 && resp.status() < 400;
          if (!ok) {
            warnings.push(`[${currentPath}] external link ${href} returned ${resp.status()}`);
          }
        } catch (err) {
          warnings.push(`[${currentPath}] external link ${href} request failed: ${err.message}`);
        }
        continue;
      }

      let normalized = href;
      if (!normalized.startsWith('/')) {
        const base = currentPath.endsWith('/') ? currentPath : currentPath.replace(/\/[^/]*$/, '/');
        normalized = base + normalized;
      }

      const clean = normalized.split('#')[0];
      const resp = await api.get(clean);
      if (!(resp.status() >= 200 && resp.status() < 400)) {
        failures.push(`[${currentPath}] internal link ${href} -> ${clean} returned ${resp.status()}`);
      }
    }
  }

  for (const route of routes) {
    const url = BASE_URL + route.path;
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    await assert(resp && resp.status() >= 200 && resp.status() < 400, `Route ${route.path} did not load successfully`);

    const hasTopbar = await page.locator('#site-topbar').count();
    const hasFooter = await page.locator('#site-footer').count();
    await assert(hasTopbar > 0, `${route.path}: missing #site-topbar`);
    await assert(hasFooter > 0, `${route.path}: missing #site-footer`);

    if (route.path === '/blog/') {
      await page.waitForSelector('#blog-feed article', { timeout: 15000 });
    }
    if (route.kind === 'blog-post') {
      await page.waitForSelector('#post-title', { timeout: 15000 });
      const titleText = await page.locator('#post-title').textContent();
      await assert(Boolean((titleText || '').trim()), `${route.path}: #post-title is empty`);
    }

    await checkInternalLinksOnPage(route.path);

    if (route.screenshot !== false) {
      await page.screenshot({ path: path.join(desktopDir, `${route.name}.png`), fullPage: true });
    }

    const mobResp = await mobilePage.goto(url, { waitUntil: 'domcontentloaded' });
    await mobilePage.waitForTimeout(200);
    await assert(mobResp && mobResp.status() >= 200 && mobResp.status() < 400, `Mobile route ${route.path} failed`);
    if (route.path === '/blog/') {
      await mobilePage.waitForSelector('#blog-feed article', { timeout: 15000 });
    }
    if (route.kind === 'blog-post') {
      await mobilePage.waitForSelector('#post-title', { timeout: 15000 });
      const titleText = await mobilePage.locator('#post-title').textContent();
      await assert(Boolean((titleText || '').trim()), `${route.path} mobile: #post-title is empty`);
    }
    if (route.screenshot !== false) {
      await mobilePage.screenshot({ path: path.join(mobileDir, `${route.name}.png`), fullPage: true });
    }
  }

  // Nav clickthrough from home
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  const navMap = [
    ['/work.html', '[portfolio]'],
    ['/blog/', '[logs]'],
    ['/about.html', '[about]'],
    ['/contact.html', '[contact]'],
    ['/', '[dashboard]']
  ];

  for (const [expected, label] of navMap) {
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await page.locator(`#site-nav a[href='${expected}']`).first().click();
    await page.waitForTimeout(200);
    const current = new URL(page.url()).pathname;
    if (!(expected === '/' ? current === '/' : current === expected)) {
      failures.push(`Nav link ${label} expected ${expected} but landed on ${current}`);
    }
  }

  // Blog list behavior
  await page.goto(BASE_URL + '/blog/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#blog-feed article', { timeout: 15000 });

  const rssResp = await api.get('/blog/rss.xml');
  await assert(rssResp.status() >= 200 && rssResp.status() < 400, 'RSS feed endpoint /blog/rss.xml failed');
  const rssBody = await rssResp.text();
  await assert(rssBody.includes('<rss') && rssBody.includes('<item>'), 'RSS feed content is invalid');

  const initialCount = await page.locator('#blog-feed article').count();
  await assert(initialCount > 0, 'Blog feed did not render any posts from the public manifest');

  const rssLinkHref = await page.locator('a[href="/blog/rss.xml"]').first().getAttribute('href');
  await assert(rssLinkHref === '/blog/rss.xml', 'Blog RSS link is missing');
  const shareButtonsCount = await page.locator('.share-post-btn').count();
  const bookmarkButtonsCount = await page.locator('.bookmark-post-btn').count();
  await assert(shareButtonsCount > 0, 'Share buttons are missing on blog index');
  await assert(bookmarkButtonsCount > 0, 'Bookmark buttons are missing on blog index');

  // Infinite scroll should automatically load additional posts when near bottom.
  let afterScrollCount = initialCount;
  for (let i = 0; i < 4; i += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(450);
    afterScrollCount = await page.locator('#blog-feed article').count();
    if (afterScrollCount > initialCount) break;
  }
  await assert(afterScrollCount > initialCount, 'Infinite scroll did not load more posts');

  const categoryButtons = page.locator('#category-filters button[data-category]');
  const categoryCount = await categoryButtons.count();
  await assert(categoryCount > 1, 'Category filters were not rendered from SQLite categories');
  if (categoryCount > 1) {
    await categoryButtons.nth(1).click();
    await page.waitForTimeout(250);
    const filteredCount = await page.locator('#blog-feed article').count();
    await assert(filteredCount > 0, 'Category filter returned zero posts unexpectedly');
  }

  const firstTitle = await page.locator('#blog-feed article h2').first().textContent();
  const searchToken = (firstTitle || '').split(/\s+/).find((word) => word.length > 4) || 'mobile';
  await page.fill('#search-posts', searchToken);
  await page.waitForTimeout(250);
  const searchCount = await page.locator('#blog-feed article').count();
  await assert(searchCount > 0, `Search returned zero results for token: ${searchToken}`);

  await page.fill('#search-posts', '___unlikely___term___');
  await page.waitForTimeout(250);
  const zeroStateVisible = await page.locator('#blog-feed p').filter({ hasText: /No entries found/ }).count();
  await assert(zeroStateVisible > 0, 'Search zero-state message did not render');
  await page.fill('#search-posts', '');
  await page.locator('#category-filters button[data-category="all"]').click();
  await page.waitForTimeout(250);

  // Blog post behavior
  await page.locator('#blog-feed article a').first().click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(250);
  const blogPostPathname = new URL(page.url()).pathname;
  await assert(
    blogPostPathname.startsWith('/blog/') && blogPostPathname.endsWith('.html') && blogPostPathname !== '/blog/index.html',
    `Blog feed item did not open a static blog post page (landed on ${blogPostPathname})`
  );

  const loadedTitle = ((await page.locator('#post-title').textContent()) || '').trim();
  await assert(loadedTitle.length > 0, 'Blog post title is empty');
  await assert((await page.locator('#share-post-button').count()) > 0, 'Blog post share button is missing');
  await assert((await page.locator('#bookmark-post-button').count()) > 0, 'Blog post bookmark button is missing');

  const bodyText = ((await page.locator('#post-body').textContent()) || '').trim();
  const bodyLooksLoaded = bodyText.length > 20 && !bodyText.includes('No body content available');
  await assert(bodyLooksLoaded, 'Blog post body content did not render as expected');

  const prevHref = await page.locator('#prev-link').getAttribute('href');
  const nextHref = await page.locator('#next-link').getAttribute('href');
  await assert(Boolean(prevHref), 'Previous post link missing href');
  await assert(Boolean(nextHref), 'Next post link missing href');

  // Contact form behavior
  await page.goto(BASE_URL + '/contact.html', { waitUntil: 'domcontentloaded' });
  const action = await page.locator('form').first().getAttribute('action');
  await assert(Boolean(action && action.startsWith('mailto:')), 'Contact form action is not mailto');
  await page.fill('input[name="name"]', 'QA Runner');
  await page.fill('input[name="email"]', 'qa@example.com');
  await page.fill('textarea[name="message"]', 'Checking cross-page contact flow.');
  const nameVal = await page.locator('input[name="name"]').inputValue();
  const emailVal = await page.locator('input[name="email"]').inputValue();
  await assert(nameVal === 'QA Runner' && emailVal === 'qa@example.com', 'Contact form fields did not accept input');

  // Work page specific CTA check
  await page.goto(BASE_URL + '/work.html', { waitUntil: 'domcontentloaded' });
  const portfolioAppLink = await page.locator('a:has-text("Open Portfolio App")').first().getAttribute('href');
  await assert(
    Boolean(portfolioAppLink && portfolioAppLink.includes('play.google.com/store/apps/details?id=com.aconcepcion.portfolio')),
    'Work page portfolio app CTA is missing or incorrect'
  );
  const deepDiveLinks = await page.locator('a[data-work-deep-dive]').count();
  await assert(deepDiveLinks >= 3, 'Work page deep-dive links are missing');

  if (consoleIssues.length) {
    warnings.push(...consoleIssues);
  }

  await desktop.close();
  await mobile.close();
  await browser.close();
  await api.dispose();

  const report = {
    baseUrl: BASE_URL,
    screenshots: screenshotRoot,
    failures,
    warnings,
    checkedRoutes: routes.map((r) => r.path),
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(path.join(screenshotRoot, 'report.json'), JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));

  if (failures.length) {
    process.exit(1);
  }
})();
