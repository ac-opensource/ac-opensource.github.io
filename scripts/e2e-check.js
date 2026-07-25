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
  let mobileChromeFontSizes = null;

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

  async function prepareForScreenshot(targetPage) {
    await targetPage.evaluate(async () => {
      const images = Array.from(document.images);
      images.forEach((image) => {
        image.loading = 'eager';
      });

      await Promise.race([
        Promise.all(images.map(async (image) => {
          if (!image.complete) {
            await new Promise((resolve) => {
              image.addEventListener('load', resolve, { once: true });
              image.addEventListener('error', resolve, { once: true });
            });
          }
          if (typeof image.decode === 'function') {
            await image.decode().catch(() => {});
          }
        })),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    });
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
    const desktopPortfolioLabels = await page.locator(
      '#site-nav a[href="/work.html"], #site-footer a[href="/work.html"]'
    ).allTextContents();
    await assert(
      desktopPortfolioLabels.length === 2
        && desktopPortfolioLabels.every((label) => label.trim() === '[portfolio]'),
      `${route.path}: desktop navigation must label /work.html as [portfolio]`
    );

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
      await prepareForScreenshot(page);
      await page.screenshot({ path: path.join(desktopDir, `${route.name}.png`), fullPage: true });
    }

    const mobResp = await mobilePage.goto(url, { waitUntil: 'domcontentloaded' });
    await mobilePage.waitForTimeout(200);
    await assert(mobResp && mobResp.status() >= 200 && mobResp.status() < 400, `Mobile route ${route.path} failed`);
    const mobilePortfolioLabels = await mobilePage.locator(
      '#site-nav-mobile a[href="/work.html"], #site-footer a[href="/work.html"]'
    ).allTextContents();
    await assert(
      mobilePortfolioLabels.length === 2
        && mobilePortfolioLabels.every((label) => label.trim() === '[portfolio]'),
      `${route.path}: mobile navigation must label /work.html as [portfolio]`
    );
    const routeMobileChromeFontSizes = await mobilePage.evaluate(() => {
      const selectors = {
        status: '#site-topbar > div > div:last-child',
        navigation: '#site-nav-mobile',
        footer: '#site-footer > div'
      };
      return Object.fromEntries(
        Object.entries(selectors).map(([name, selector]) => {
          const element = document.querySelector(selector);
          return [name, element ? getComputedStyle(element).fontSize : null];
        })
      );
    });
    await assert(
      Object.values(routeMobileChromeFontSizes).every(Boolean),
      `${route.path}: mobile site chrome is missing a typography target`
    );
    if (!mobileChromeFontSizes) {
      mobileChromeFontSizes = routeMobileChromeFontSizes;
    } else {
      await assert(
        JSON.stringify(routeMobileChromeFontSizes) === JSON.stringify(mobileChromeFontSizes),
        `${route.path}: mobile site chrome font sizes ${JSON.stringify(routeMobileChromeFontSizes)} differ from ${JSON.stringify(mobileChromeFontSizes)}`
      );
    }
    if (route.path === '/blog/') {
      await mobilePage.waitForSelector('#blog-feed article', { timeout: 15000 });
    }
    if (route.kind === 'blog-post') {
      await mobilePage.waitForSelector('#post-title', { timeout: 15000 });
      const titleText = await mobilePage.locator('#post-title').textContent();
      await assert(Boolean((titleText || '').trim()), `${route.path} mobile: #post-title is empty`);
    }
    if (route.screenshot !== false) {
      await prepareForScreenshot(mobilePage);
      await mobilePage.screenshot({ path: path.join(mobileDir, `${route.name}.png`), fullPage: true });
    }
  }

  // Career timeline and resume stay aligned on the current employer sequence.
  await page.goto(BASE_URL + '/about.html', { waitUntil: 'domcontentloaded' });
  const careerSection = page.getByRole('heading', { name: 'Career Trajectory', exact: true }).locator('xpath=ancestor::section[1]');
  const careerHeadings = await careerSection.locator('h3').evaluateAll((headings) =>
    headings.map((heading) => (heading.textContent || '').replace(/\s+/g, ' ').trim())
  );
  await assert(
    JSON.stringify(careerHeadings.slice(0, 4)) === JSON.stringify([
      'Senior Software Engineer — Bitcoin.com',
      'Senior Mobile Developer — ITV',
      'Senior Android Developer — Red Airship',
      'Lead Developer — InnovationTeam',
    ]),
    'About career timeline does not use the requested reverse-chronological employer order'
  );
  const careerSectionText = ((await careerSection.textContent()) || '').replace(/\s+/g, ' ').trim();
  for (const expectedText of [
    'JUN 2024 — PRESENT',
    'Bitcoin.com Wallet — Self-custody crypto wallet',
    'JUN 2023 — JUN 2024',
    'ITVX — Streaming platform',
    'JUN 2021 — JUN 2023',
    'OCBC — Mobile banking',
    'OpenPay — Fintech',
    'MAY 2020 — JUN 2021',
    'MySTC — Telecom project',
    'OWTO — Ride-hailing service',
    'PopSlide — Rewards platform',
    'WebSafety — Parental controls',
  ]) {
    await assert(careerSectionText.includes(expectedText), `About career timeline is missing: ${expectedText}`);
  }
  await assert(!careerSectionText.includes('Littlepay'), 'About career timeline still exposes Littlepay');

  await page.goto(BASE_URL + '/resume.html', { waitUntil: 'domcontentloaded' });
  const resumeText = ((await page.locator('main').textContent()) || '').replace(/\s+/g, ' ').trim();
  for (const expectedText of [
    'Senior Software Engineer Bitcoin.com Bitcoin.com Wallet — Self-custody crypto wallet Jun 2024 — Present',
    'Senior Mobile Developer ITV ITVX — Streaming platform Jun 2023 — Jun 2024',
    'Senior Android Developer Red Airship OCBC — Mobile banking OpenPay — Fintech Jun 2021 — Jun 2023',
    'Lead Developer InnovationTeam MySTC — Telecom project May 2020 — Jun 2021',
    'Team Lead iPARA Technologies and Solutions OWTO — Ride-hailing service Jun 2018 — May 2020',
    'Senior Android Developer YOYO Holdings Pte. Ltd. PopSlide — Rewards platform Jun 2016 — Jun 2018',
    'Full-Stack Web and Mobile Developer Internet Strategy Branding and Execution (ISBX) WebSafety — Parental controls May 2014 — Jun 2016',
  ]) {
    await assert(resumeText.includes(expectedText), `Resume is missing the experience sequence: ${expectedText}`);
  }
  await assert(!resumeText.includes('Littlepay'), 'Resume still exposes Littlepay');

  // Profile tree structure, stable selection, and responsive popover containment.
  async function readProfileTreeGeometry(targetPage, nodeId) {
    return targetPage.evaluate((id) => {
      const visual = document.querySelector('.profile-map__visual').getBoundingClientRect();
      const svg = document.querySelector('.profile-map__svg').getBoundingClientRect();
      const junction = document.querySelector(`.profile-map__node[data-node-id="${id}"] .profile-map__node-mark`).getBoundingClientRect();
      const hit = document.querySelector(`.profile-map__node[data-node-id="${id}"] .profile-map__node-hit`).getBoundingClientRect();
      return {
        junction: {
          x: junction.x - svg.x,
          y: junction.y - svg.y,
          width: junction.width,
          height: junction.height,
        },
        hit: { width: hit.width, height: hit.height },
        visual: { width: visual.width, height: visual.height },
        svg: { width: svg.width, height: svg.height },
      };
    }, nodeId);
  }

  async function readPopoverContainment(targetPage) {
    return targetPage.evaluate(() => {
      const visual = document.querySelector('.profile-map__visual').getBoundingClientRect();
      const popover = document.querySelector('.profile-map__popover');
      const card = popover.getBoundingClientRect();
      return {
        hidden: popover.hidden,
        title: popover.querySelector('strong')?.textContent || '',
        inside: card.left >= visual.left
          && card.top >= visual.top
          && card.right <= visual.right
          && card.bottom <= visual.bottom,
      };
    });
  }

  async function readProfileTreeIntegrity(targetPage) {
    return targetPage.evaluate(() => {
      const nodes = [...document.querySelectorAll('.profile-map__node')].map((group) => {
        const mark = group.querySelector('.profile-map__node-mark');
        const hit = group.querySelector('.profile-map__node-hit');
        return {
          id: group.dataset.nodeId,
          x: Number(mark.getAttribute('cx')),
          y: Number(mark.getAttribute('cy')),
          hitRadius: Number(hit.getAttribute('r')),
          hitWidth: hit.getBoundingClientRect().width,
        };
      });
      const paths = [...document.querySelectorAll('.profile-map__tendril')].map((path) => {
        const length = path.getTotalLength();
        return {
          id: path.dataset.nodeId,
          points: Array.from({ length: 49 }, (_, index) => {
            const point = path.getPointAtLength(length * index / 48);
            return { x: point.x, y: point.y };
          }),
        };
      });
      const labels = [...document.querySelectorAll('.profile-map__node-label, .profile-map__axis-label')]
        .filter((label) => Number.parseFloat(getComputedStyle(label).opacity) > 0.1)
        .map((label) => ({ text: label.textContent, box: label.getBoundingClientRect() }));
      let minimumHitGap = Number.POSITIVE_INFINITY;
      let minimumNodeTendrilDistance = Number.POSITIVE_INFINITY;
      let minimumTendrilDistance = Number.POSITIVE_INFINITY;
      let labelOverlapCount = 0;

      for (let firstIndex = 0; firstIndex < nodes.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex += 1) {
          const first = nodes[firstIndex];
          const second = nodes[secondIndex];
          minimumHitGap = Math.min(
            minimumHitGap,
            Math.hypot(first.x - second.x, first.y - second.y) - first.hitRadius - second.hitRadius,
          );
        }
      }
      paths.forEach((path) => {
        nodes.forEach((node) => {
          if (node.id === path.id) return;
          path.points.forEach((point) => {
            minimumNodeTendrilDistance = Math.min(
              minimumNodeTendrilDistance,
              Math.hypot(node.x - point.x, node.y - point.y),
            );
          });
        });
      });
      for (let firstIndex = 0; firstIndex < paths.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < paths.length; secondIndex += 1) {
          paths[firstIndex].points.forEach((firstPoint) => {
            paths[secondIndex].points.forEach((secondPoint) => {
              minimumTendrilDistance = Math.min(
                minimumTendrilDistance,
                Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y),
              );
            });
          });
        }
      }
      for (let firstIndex = 0; firstIndex < labels.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < labels.length; secondIndex += 1) {
          const first = labels[firstIndex].box;
          const second = labels[secondIndex].box;
          if (first.left < second.right && first.right > second.left
            && first.top < second.bottom && first.bottom > second.top) {
            labelOverlapCount += 1;
          }
        }
      }
      return {
        minimumHitGap,
        minimumHitWidth: Math.min(...nodes.map((node) => node.hitWidth)),
        minimumNodeTendrilDistance,
        minimumTendrilDistance,
        labelOverlapCount,
      };
    });
  }

  function profileTreeGeometryDelta(before, after) {
    return Math.max(
      Math.abs(after.junction.x - before.junction.x),
      Math.abs(after.junction.y - before.junction.y),
      Math.abs(after.junction.width - before.junction.width),
      Math.abs(after.junction.height - before.junction.height),
      Math.abs(after.svg.width - before.svg.width),
      Math.abs(after.svg.height - before.svg.height),
    );
  }

  await page.goto(BASE_URL + '/about.html#profile-map', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.profile-map__svg', { timeout: 15000 });
  await assert((await page.locator('.profile-map__trunk').count()) === 1, 'Profile tree should have one trunk');
  await assert((await page.locator('.profile-map__branch').count()) === 4, 'Engineering profile tree should have four branches');
  await assert((await page.locator('.profile-map__node').count()) === 21, 'Engineering profile tree should render 21 junctions');

  const desktopTreeBefore = await readProfileTreeGeometry(page, 'android');
  await page.locator('.profile-map__node[data-node-id="android"] .profile-map__node-mark').hover();
  const desktopTreeDuringHover = await readProfileTreeGeometry(page, 'android');
  await assert(profileTreeGeometryDelta(desktopTreeBefore, desktopTreeDuringHover) < 0.5, 'Profile tree geometry moved during hover');
  await page.locator('.profile-map__node[data-node-id="android"] .profile-map__node-hit').click();
  const desktopPopover = await readPopoverContainment(page);
  await assert(!desktopPopover.hidden && desktopPopover.title === 'Android', 'Android junction should open a pinned detail card');
  await assert(desktopPopover.inside, 'Desktop profile-tree card should stay inside the visual');
  const desktopTreeAfter = await readProfileTreeGeometry(page, 'android');
  const desktopJunctionDelta = profileTreeGeometryDelta(desktopTreeBefore, desktopTreeAfter);
  await assert(desktopJunctionDelta < 0.5, `Profile tree geometry moved after selection/hover (${desktopJunctionDelta}px)`);
  const desktopTreeIntegrity = await readProfileTreeIntegrity(page);
  await assert(desktopTreeIntegrity.minimumHitGap >= 0, 'Desktop profile-tree hit targets overlap');
  await assert(desktopTreeIntegrity.minimumNodeTendrilDistance >= 8, 'A desktop branchlet crosses another junction');
  await assert(desktopTreeIntegrity.minimumTendrilDistance >= 0.75, 'Desktop branchlets cross each other');
  await assert(desktopTreeIntegrity.labelOverlapCount === 0, 'Desktop profile-tree labels overlap');
  await page.locator('.profile-map__popover-close').click();
  await assert(await page.locator('.profile-map__popover').getAttribute('hidden') !== null, 'Profile-tree close button should dismiss the card');

  await page.getByRole('tab', { name: 'Interests', exact: true }).click();
  await assert((await page.locator('.profile-map__node').count()) === 10, 'Interests profile tree should render 10 junctions');
  await assert((await page.locator('.profile-map__branch').count()) === 4, 'Interests profile tree should keep four branches');

  await mobilePage.goto(BASE_URL + '/about.html#profile-map', { waitUntil: 'domcontentloaded' });
  await mobilePage.waitForSelector('.profile-map__svg', { timeout: 15000 });
  const mobileTreeLayout = await mobilePage.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    junctions: document.querySelectorAll('.profile-map__node').length,
    branches: document.querySelectorAll('.profile-map__branch').length,
  }));
  await assert(mobileTreeLayout.scrollWidth <= mobileTreeLayout.clientWidth, 'Mobile profile tree causes horizontal overflow');
  await assert(mobileTreeLayout.junctions === 21 && mobileTreeLayout.branches === 4, 'Mobile engineering tree has incomplete structure');
  const mobileTreeBefore = await readProfileTreeGeometry(mobilePage, 'android');
  const mobileTreeIntegrity = await readProfileTreeIntegrity(mobilePage);
  await assert(mobileTreeIntegrity.minimumHitWidth >= 32, 'A mobile profile-tree junction hit target is too small');
  await assert(mobileTreeIntegrity.minimumHitGap >= 0, 'Mobile profile-tree hit targets overlap');
  await assert(mobileTreeIntegrity.minimumNodeTendrilDistance >= 8, 'A mobile branchlet crosses another junction');
  await assert(mobileTreeIntegrity.minimumTendrilDistance >= 0.75, 'Mobile branchlets cross each other');
  await assert(mobileTreeIntegrity.labelOverlapCount === 0, 'Mobile profile-tree labels overlap');
  await assert(mobileTreeBefore.hit.width >= 32 && mobileTreeBefore.hit.height >= 32, 'Mobile Android junction hit target is too small');
  await mobilePage.locator('.profile-map__node[data-node-id="android"] .profile-map__node-hit').click();
  const mobilePopover = await readPopoverContainment(mobilePage);
  await assert(!mobilePopover.hidden && mobilePopover.inside, 'Mobile profile-tree card should open inside the visual');
  await mobilePage.locator('.profile-map__popover-close').press('Escape');
  await assert(await mobilePage.locator('.profile-map__popover').getAttribute('hidden') !== null, 'Escape should dismiss the mobile profile-tree card');

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

  await page.goto(BASE_URL + '/blog/case-study-ocbc-banking-experience.html', { waitUntil: 'domcontentloaded' });
  const ocbcHero = page.locator('[data-work-hero-layout="gallery"]');
  await assert((await ocbcHero.count()) === 1, 'OCBC project note is missing its official app-screen gallery');
  await assert((await ocbcHero.locator('.work-post-hero__screen').count()) === 3, 'OCBC project-note gallery does not expose all three app screens');
  const ocbcHeroSources = await ocbcHero.locator('img').evaluateAll((images) => images.map((image) => image.getAttribute('src') || ''));
  await assert(
    ocbcHeroSources.every((src) => src.startsWith('/assets/images/work/img_ocbc_business_')),
    'OCBC project-note gallery is not using the official local app-screen assets'
  );
  await assert(((await page.locator('#post-category').textContent()) || '').trim() === '[portfolio]', 'OCBC project note does not use the portfolio label');

  await page.goto(BASE_URL + '/blog/case-study-openpay-bnpl-experience.html', { waitUntil: 'domcontentloaded' });
  const openpayHeroImage = page.locator('[data-work-hero-layout="cover"] > img');
  await assert((await openpayHeroImage.count()) === 1, 'openpay project note is missing its edge-to-edge hero');
  if ((await openpayHeroImage.count()) === 1) {
    const openpayObjectFit = await openpayHeroImage.evaluate((image) => getComputedStyle(image).objectFit);
    await assert(openpayObjectFit === 'cover', `openpay hero uses object-fit ${openpayObjectFit}; expected cover`);
  }

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

  // Work page portfolio content and progressive-enhancement checks
  await page.goto(BASE_URL + '/work.html', { waitUntil: 'domcontentloaded' });
  const portfolioEntries = page.locator('[data-portfolio-entry]');
  const portfolioEntryCount = await portfolioEntries.count();
  await assert(portfolioEntryCount >= 16, `Work page rendered ${portfolioEntryCount} portfolio entries; expected at least 16`);

  const workPageText = ((await page.locator('body').textContent()) || '').replace(/\s+/g, ' ').trim();
  for (const projectName of ['Bitcoin.com Wallet', 'ITVX', 'MemPalace', 'Persons Finder', 'Orchestrum', 'Littlepay', 'NTU Pass', 'Solo', 'Aqua Expeditions']) {
    await assert(workPageText.includes(projectName), `Work page is missing the ${projectName} portfolio entry`);
  }
  await assert(!workPageText.includes('[N/A]'), 'Work page still exposes an [N/A] placeholder');
  await assert(!workPageText.includes('Portfolio App Sync'), 'Work page still exposes the obsolete Portfolio App Sync label');
  const publicWorkLayout = await page.evaluate(() => {
    const archive = document.querySelector('#more-work');
    const publicBuilds = document.querySelector('#public-builds');
    const publicGrid = document.querySelector('.work-public-grid');
    const persons = document.querySelector('.work-public-card--persons');
    const orchestrum = document.querySelector('.work-public-card--orchestrum');
    const mempalace = document.querySelector('.work-public-card--mempalace');
    const archiveRect = archive.getBoundingClientRect();
    const publicRect = publicBuilds.getBoundingClientRect();
    const gridRect = publicGrid.getBoundingClientRect();
    const personsRect = persons.getBoundingClientRect();
    const orchestrumRect = orchestrum.getBoundingClientRect();
    const mempalaceRect = mempalace.getBoundingClientRect();
    return {
      archiveBeforePublic: archiveRect.top < publicRect.top
        && Boolean(archive.compareDocumentPosition(publicBuilds) & Node.DOCUMENT_POSITION_FOLLOWING),
      archiveLabel: (archive.querySelector('.work-section__head .work-eyebrow')?.textContent || '').trim(),
      publicLabel: (publicBuilds.querySelector('.work-section__head .work-eyebrow')?.textContent || '').trim(),
      publicCardCount: publicGrid.querySelectorAll('.work-public-card').length,
      personsAndOrchestrumShareRow: Math.abs(personsRect.top - orchestrumRect.top) <= 2,
      mempalaceIsFeaturedWidth: mempalaceRect.width >= gridRect.width - 2,
    };
  });
  await assert(publicWorkLayout.archiveBeforePublic, 'Other apps and platforms does not appear before Recent work you can open');
  await assert(publicWorkLayout.archiveLabel === '[02 / archive]', 'Archive section does not use the [02 / archive] label');
  await assert(publicWorkLayout.publicLabel === '[03 / public]', 'Public work section does not use the [03 / public] label');
  await assert(publicWorkLayout.publicCardCount === 3, `Public work section has ${publicWorkLayout.publicCardCount} cards; expected 3`);
  await assert(publicWorkLayout.personsAndOrchestrumShareRow, 'Persons Finder and Orchestrum no longer share the first public-work row');
  await assert(publicWorkLayout.mempalaceIsFeaturedWidth, 'MemPalace contribution is not featured at full public-grid width');
  const mempalaceCardText = ((await page.locator('.work-public-card--mempalace').textContent()) || '').replace(/\s+/g, ' ').trim();
  await assert(
    mempalaceCardText.includes('nested .gitignore-aware project mining')
      && mempalaceCardText.includes('merged change'),
    'MemPalace card does not describe the merged nested .gitignore contribution'
  );
  await assert((await page.locator('.work-flow__checkpoint').count()) === 4, 'Portfolio hero is missing its completed delivery checkpoints');
  await assert((await page.locator('.work-flow__complete').textContent() || '').includes('ALL CHECKS COMPLETE'), 'Portfolio hero does not communicate completed verification');
  await assert(
    (await page.locator('.work-hero__art[role="img"]').getAttribute('aria-label') || '').includes('All checks complete'),
    'Portfolio hero completion message is missing from the accessibility tree'
  );

  const firstProductionCard = page.locator('.work-case-grid > .work-case').first();
  await assert(
    await firstProductionCard.evaluate((card) => card.classList.contains('work-case--bitcoin')),
    'Bitcoin.com Wallet is not the lead production case study'
  );
  const bitcoinScreens = page.locator('.work-case--bitcoin .work-bitcoin-shot');
  await assert((await bitcoinScreens.count()) === 3, 'Bitcoin.com Wallet card does not show all three official app screens');
  const bitcoinScreenSources = await bitcoinScreens.evaluateAll((images) => images.map((image) => image.getAttribute('src') || ''));
  await assert(
    bitcoinScreenSources.every((src) => src.startsWith('/assets/images/work/img_bitcoin_wallet_')),
    'Bitcoin.com Wallet card is not using the local official app-screen assets'
  );
  const bitcoinCardText = ((await page.locator('.work-case--bitcoin').textContent()) || '').replace(/\s+/g, ' ').trim();
  for (const capability of ['Multichain Android', 'Rust + UniFFI', 'Reliability', 'Release engineering']) {
    await assert(bitcoinCardText.includes(capability), `Bitcoin.com Wallet card is missing the ${capability} capability`);
  }

  const itvxScreens = page.locator('.work-case--itvx .work-itvx-shot');
  await assert((await itvxScreens.count()) === 3, 'ITVX card does not show all three official app screens');
  const itvxScreenSources = await itvxScreens.evaluateAll((images) => images.map((image) => image.getAttribute('src') || ''));
  await assert(
    itvxScreenSources.every((src) => src.startsWith('/assets/images/work/img_itvx_')),
    'ITVX card is not using the local official app-screen assets'
  );
  await assert((await page.locator('.work-case--itvx .work-player').count()) === 0, 'ITVX card still exposes the generic player mockup');
  const supportingCardLayout = await page.evaluate(() => {
    const itvx = document.querySelector('.work-case--itvx');
    const ocbc = document.querySelector('.work-case--ocbc');
    const mystc = document.querySelector('.work-case--mystc');
    const openpay = document.querySelector('.work-case--openpay');
    const bitcoin = document.querySelector('.work-case--bitcoin');
    const itvxRect = itvx.getBoundingClientRect();
    const ocbcRect = ocbc.getBoundingClientRect();
    const mystcRect = mystc.getBoundingClientRect();
    const openpayRect = openpay.getBoundingClientRect();
    const bitcoinRect = bitcoin.getBoundingClientRect();
    const background = getComputedStyle(itvx).backgroundColor.match(/[\d.]+/g)?.map(Number) || [];
    return {
      itvxAndOcbcShareRow: Math.abs(itvxRect.top - ocbcRect.top) <= 2 && itvxRect.right < ocbcRect.left,
      openpayAndMystcShareRow: Math.abs(mystcRect.top - openpayRect.top) <= 2 && openpayRect.right < mystcRect.left,
      firstRowUsesFiveSevenSplit: itvxRect.width < ocbcRect.width,
      secondRowUsesSevenFiveSplit: openpayRect.width > mystcRect.width,
      itvxIsSupportingWidth: itvxRect.width < bitcoinRect.width * 0.6,
      itvxHasLightBackground: background.length >= 3 && background[0] >= 245 && background[1] >= 245 && background[2] >= 245,
    };
  });
  await assert(supportingCardLayout.itvxAndOcbcShareRow, 'ITVX is not paired beside OCBC on desktop');
  await assert(supportingCardLayout.openpayAndMystcShareRow, 'Openpay is not positioned left of MySTC on the second supporting-project row');
  await assert(supportingCardLayout.firstRowUsesFiveSevenSplit, 'ITVX and OCBC do not use the intended 5/7 split');
  await assert(supportingCardLayout.secondRowUsesSevenFiveSplit, 'Openpay and MySTC do not use the intended 7/5 split');
  await assert(supportingCardLayout.itvxIsSupportingWidth, 'ITVX still reads as a full-width hero card');
  await assert(supportingCardLayout.itvxHasLightBackground, 'ITVX does not use the light supporting-card background');

  const heroIntro = ((await page.locator('.work-hero__intro').textContent()) || '').replace(/\s+/g, ' ').trim();
  await assert(heroIntro.includes('I’m a problem solver'), 'Portfolio hero does not lead with problem-solving positioning');
  await assert(heroIntro.includes('I lead teams') && heroIntro.includes('use AI'), 'Portfolio hero is missing leadership or AI-accelerated delivery positioning');
  await assert((await page.locator('.work-signals > div').count()) === 4, 'Portfolio hero does not expose all four positioning signals');
  await assert(workPageText.includes('AI-accelerated'), 'Portfolio hero is missing its AI-accelerated delivery signal');

  const ocbcScreens = page.locator('.work-case--ocbc .work-ocbc-shot');
  await assert((await ocbcScreens.count()) === 3, 'OCBC Business card does not show all three official app screens');
  const ocbcScreenSources = await ocbcScreens.evaluateAll((images) => images.map((image) => image.getAttribute('src') || ''));
  await assert(
    ocbcScreenSources.every((src) => src.startsWith('/assets/images/work/img_ocbc_business_')),
    'OCBC Business card is not using the official local app-screen assets'
  );

  const deviceRatio = await page.locator('.work-case--mystc .work-device').evaluate((device) => {
    return device.offsetHeight / device.offsetWidth;
  });
  await assert(deviceRatio >= 2.1 && deviceRatio <= 2.25, `Portfolio device ratio is ${deviceRatio.toFixed(2)}; expected a modern phone proportion`);

  await mobilePage.goto(BASE_URL + '/work.html', { waitUntil: 'domcontentloaded' });
  const mobileProjectOrder = await mobilePage.evaluate(() => {
    const failures = [];
    const tolerance = 2;

    const checkOrder = (card, name, selectors) => {
      const elements = selectors.map((selector) => card.querySelector(selector));
      if (elements.some((element) => !element)) {
        failures.push(`${name}: missing ${selectors[elements.findIndex((element) => !element)]}`);
        return;
      }

      const [label, title, visual, details] = elements.map((element) => element.getBoundingClientRect());
      if (label.bottom > title.top + tolerance) failures.push(`${name}: label is not before title`);
      if (title.bottom > visual.top + tolerance) failures.push(`${name}: title is not before visual`);
      if (visual.bottom > details.top + tolerance) failures.push(`${name}: visual is not before details`);
    };

    const productionCards = [
      ['Bitcoin.com Wallet', '.work-case--bitcoin', '.work-bitcoin-stage'],
      ['ITVX', '.work-case--itvx', '.work-stream-stage'],
      ['OCBC Business', '.work-case--ocbc', '.work-ocbc-stage'],
      ['openpay', '.work-case--openpay', '.work-openpay-stage'],
      ['MySTC', '.work-case--mystc', '.work-device-stage'],
    ];
    productionCards.forEach(([name, cardSelector, visualSelector]) => {
      const card = document.querySelector(cardSelector);
      if (!card) {
        failures.push(`${name}: missing card`);
        return;
      }
      checkOrder(card, name, [
        '.work-case__body > .work-eyebrow',
        '.work-case__body > .work-case__title',
        visualSelector,
        '.work-case__body > :is(.work-case__role, .work-case__lede)',
      ]);
    });

    const publicCards = [
      ['Persons Finder', '.work-public-card--persons', '.work-public-card__image'],
      ['Orchestrum', '.work-public-card--orchestrum', '.work-agent-art'],
      ['MemPalace', '.work-public-card--mempalace', '.work-memory-art'],
    ];
    publicCards.forEach(([name, cardSelector, visualSelector]) => {
      const card = document.querySelector(cardSelector);
      if (!card) {
        failures.push(`${name}: missing card`);
        return;
      }
      checkOrder(card, name, [
        '.work-public-card__body > .work-eyebrow',
        '.work-public-card__body > h3',
        visualSelector,
        '.work-public-card__body > p',
      ]);
    });

    const archiveCards = Array.from(document.querySelectorAll('.work-archive-card'));
    archiveCards.forEach((card, index) => {
      checkOrder(card, card.querySelector('h3')?.textContent?.trim() || `Archive card ${index + 1}`, [
        ':scope > .work-archive-card__top',
        ':scope > h3',
        ':scope > :is(.work-archive-card__media, .work-archive-card__asset-link)',
        ':scope > p',
      ]);
    });

    return {
      archiveCount: archiveCards.length,
      productionCount: document.querySelectorAll('.work-case').length,
      publicCount: document.querySelectorAll('.work-public-card').length,
      failures,
    };
  });
  await assert(mobileProjectOrder.productionCount === 5, 'Mobile project-order check did not cover all production cards');
  await assert(mobileProjectOrder.publicCount === 3, 'Mobile project-order check did not cover all public cards');
  await assert(mobileProjectOrder.archiveCount === 8, 'Mobile project-order check did not cover all archive cards');
  await assert(
    mobileProjectOrder.failures.length === 0,
    `Mobile project cards do not follow label, title, visual, details order: ${mobileProjectOrder.failures.join('; ')}`
  );

  const reducedMotion = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 430, height: 932 }
  });
  const reducedMotionPage = await reducedMotion.newPage();
  await reducedMotionPage.goto(BASE_URL + '/work.html', { waitUntil: 'domcontentloaded' });
  const reducedMotionBitcoinCard = reducedMotionPage.locator('.work-case--bitcoin');
  const reducedMotionBitcoinScreens = reducedMotionBitcoinCard.locator('.work-bitcoin-shot');
  const reducedMotionBitcoinBeforeHover = await reducedMotionBitcoinScreens.evaluateAll((images) =>
    images.map((image) => {
      const rect = image.getBoundingClientRect();
      const galleryRect = image.parentElement.getBoundingClientRect();
      return { x: Math.round(rect.x - galleryRect.x), y: Math.round(rect.y - galleryRect.y) };
    })
  );
  await assert(
    new Set(reducedMotionBitcoinBeforeHover.map(({ x, y }) => `${x}:${y}`)).size === 3,
    'Reduced-motion mode collapses the Bitcoin.com Wallet collage into overlapping screens'
  );
  await reducedMotionBitcoinCard.hover();
  const reducedMotionBitcoinAfterHover = await reducedMotionBitcoinScreens.evaluateAll((images) =>
    images.map((image) => {
      const rect = image.getBoundingClientRect();
      const galleryRect = image.parentElement.getBoundingClientRect();
      return { x: Math.round(rect.x - galleryRect.x), y: Math.round(rect.y - galleryRect.y) };
    })
  );
  await assert(
    JSON.stringify(reducedMotionBitcoinAfterHover) === JSON.stringify(reducedMotionBitcoinBeforeHover),
    'Reduced-motion mode still moves the Bitcoin.com Wallet collage on hover'
  );
  const reducedMotionCard = reducedMotionPage.locator('.work-case--itvx');
  const reducedMotionScreens = reducedMotionCard.locator('.work-itvx-shot');
  const reducedMotionBeforeHover = await reducedMotionScreens.evaluateAll((images) =>
    images.map((image) => {
      const rect = image.getBoundingClientRect();
      const galleryRect = image.parentElement.getBoundingClientRect();
      return { x: Math.round(rect.x - galleryRect.x), y: Math.round(rect.y - galleryRect.y) };
    })
  );
  await assert(
    new Set(reducedMotionBeforeHover.map(({ x, y }) => `${x}:${y}`)).size === 3,
    'Reduced-motion mode collapses the ITVX collage into overlapping screens'
  );
  await reducedMotionCard.hover();
  const reducedMotionAfterHover = await reducedMotionScreens.evaluateAll((images) =>
    images.map((image) => {
      const rect = image.getBoundingClientRect();
      const galleryRect = image.parentElement.getBoundingClientRect();
      return { x: Math.round(rect.x - galleryRect.x), y: Math.round(rect.y - galleryRect.y) };
    })
  );
  await assert(
    JSON.stringify(reducedMotionAfterHover) === JSON.stringify(reducedMotionBeforeHover),
    'Reduced-motion mode still moves the ITVX collage on hover'
  );

  const reducedMotionOcbcCard = reducedMotionPage.locator('.work-case--ocbc');
  const reducedMotionOcbcScreens = reducedMotionOcbcCard.locator('.work-ocbc-shot');
  const reducedMotionOcbcBeforeHover = await reducedMotionOcbcScreens.evaluateAll((images) =>
    images.map((image) => {
      const rect = image.getBoundingClientRect();
      const galleryRect = image.parentElement.getBoundingClientRect();
      return { x: Math.round(rect.x - galleryRect.x), y: Math.round(rect.y - galleryRect.y) };
    })
  );
  await assert(
    new Set(reducedMotionOcbcBeforeHover.map(({ x, y }) => `${x}:${y}`)).size === 3,
    'Reduced-motion mode collapses the OCBC Business collage into overlapping screens'
  );
  await reducedMotionOcbcCard.hover();
  const reducedMotionOcbcAfterHover = await reducedMotionOcbcScreens.evaluateAll((images) =>
    images.map((image) => {
      const rect = image.getBoundingClientRect();
      const galleryRect = image.parentElement.getBoundingClientRect();
      return { x: Math.round(rect.x - galleryRect.x), y: Math.round(rect.y - galleryRect.y) };
    })
  );
  await assert(
    JSON.stringify(reducedMotionOcbcAfterHover) === JSON.stringify(reducedMotionOcbcBeforeHover),
    'Reduced-motion mode still moves the OCBC Business collage on hover'
  );
  await reducedMotion.close();

  const requiredProjectLinks = [
    ['Bitcoin.com Wallet', 'a[href*="play.google.com/store/apps/details?id=com.bitcoin.mwallet"]'],
    ['ITVX', 'a[href*="play.google.com/store/apps/details?id=air.ITVMobilePlayer"]'],
    ['OCBC Business', 'a[href*="play.google.com/store/apps/details?id=com.ocbc.mobilebv"]'],
    ['MemPalace', 'a[href="https://github.com/MemPalace/mempalace/pull/78"]'],
    ['Littlepay', 'a[href^="https://littlepay.com"]'],
    ['NTU Pass', 'a[href*="play.google.com/store/apps/details?id=sg.edu.ntu.apps.ntusmartpass"]'],
    ['Solo', 'a[href*="play.google.com/store/apps/developer?id=Solo+Technologies+Services"]'],
    ['Aqua Expeditions', 'a[href^="https://www.aquaexpeditions.com"]']
  ];
  for (const [projectName, selector] of requiredProjectLinks) {
    await assert((await page.locator(selector).count()) > 0, `Work page ${projectName} source link is missing or incorrect`);
  }

  const deepDiveLinks = await page.locator('a[data-work-deep-dive]').count();
  await assert(deepDiveLinks >= 3, 'Work page deep-dive links are missing');
  const deepDiveHrefs = await page.locator('a[data-work-deep-dive]').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')).filter(Boolean)
  );
  await assert(
    new Set(deepDiveHrefs).size === deepDiveHrefs.length,
    'Work page contains duplicate deep-dive links'
  );

  const noJavaScript = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 900 }
  });
  const noJavaScriptPage = await noJavaScript.newPage();
  const noJavaScriptResponse = await noJavaScriptPage.goto(BASE_URL + '/work.html', { waitUntil: 'domcontentloaded' });
  await assert(
    noJavaScriptResponse && noJavaScriptResponse.status() >= 200 && noJavaScriptResponse.status() < 400,
    'Work page failed to load with JavaScript disabled'
  );
  const staticPortfolioEntryCount = await noJavaScriptPage.locator('[data-portfolio-entry]').count();
  await assert(
    staticPortfolioEntryCount === portfolioEntryCount,
    `Work page exposes ${staticPortfolioEntryCount} of ${portfolioEntryCount} portfolio entries without JavaScript`
  );
  const staticWorkPageText = ((await noJavaScriptPage.locator('body').textContent()) || '').replace(/\s+/g, ' ').trim();
  for (const projectName of ['Bitcoin.com Wallet', 'ITVX', 'MemPalace', 'Persons Finder', 'Orchestrum', 'Littlepay', 'NTU Pass', 'Solo', 'Aqua Expeditions']) {
    await assert(staticWorkPageText.includes(projectName), `Work page hides ${projectName} when JavaScript is disabled`);
  }
  await noJavaScript.close();

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
