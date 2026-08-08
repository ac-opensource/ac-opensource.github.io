const { chromium, request } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173';
const CHECK_EXTERNAL_LINKS = process.env.CHECK_EXTERNAL_LINKS === '1';
const siteRoot = path.resolve(__dirname, '..', process.env.SITE_ROOT || '.');
const postsManifestPath = path.join(siteRoot, 'blog', 'posts.json');
const homepageSocialImageUrl = 'https://ac-opensource.github.io/assets/images/og/home-orbital-dashboard-hero.png';
const socialPreviewContracts = [
  { path: '/', canonicalUrl: 'https://ac-opensource.github.io/', image: 'home-orbital-dashboard-hero.png' },
  { path: '/work.html', canonicalUrl: 'https://ac-opensource.github.io/work.html', image: 'work-delivery-system.png' },
  { path: '/blog/', canonicalUrl: 'https://ac-opensource.github.io/blog/', image: 'logs-spiral-galaxy.png' },
  { path: '/about.html', canonicalUrl: 'https://ac-opensource.github.io/about.html', image: 'about-stellar-tree.png' },
  { path: '/contact.html', canonicalUrl: 'https://ac-opensource.github.io/contact.html', image: 'contact-payload-integration.png' },
  { path: '/resume.html', canonicalUrl: 'https://ac-opensource.github.io/resume.html', image: 'resume-flight-recorder.png' },
  { path: '/signals.html', canonicalUrl: 'https://ac-opensource.github.io/signals.html', image: 'signals-registry.png' },
  { path: '/skills-graph.html', canonicalUrl: 'https://ac-opensource.github.io/about.html#profile-map', image: 'about-stellar-tree.png' },
].map((contract) => ({
  ...contract,
  imagePath: path.join(siteRoot, 'assets', 'images', 'og', contract.image),
  imageUrl: `https://ac-opensource.github.io/assets/images/og/${contract.image}`,
}));
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

  const contactEndpointRequests = [];
  const contactEndpointPattern = /^https:\/\/(?:script\.google\.com|(?:[^/]+\.)?script\.googleusercontent\.com)\//;
  const blockContactEndpoint = async (route) => {
    contactEndpointRequests.push(route.request().url());
    await route.abort();
  };
  await desktop.route(contactEndpointPattern, blockContactEndpoint);
  await mobile.route(contactEndpointPattern, blockContactEndpoint);

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

  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  for (const socialImagePath of new Set(socialPreviewContracts.map(({ imagePath }) => imagePath))) {
    if (!fs.existsSync(socialImagePath)) {
      failures.push(`Social preview image is missing: ${path.relative(siteRoot, socialImagePath)}`);
      continue;
    }
    const socialImage = fs.readFileSync(socialImagePath);
    const relativeSocialImagePath = path.relative(siteRoot, socialImagePath);
    await assert(
      socialImage.subarray(0, pngSignature.length).equals(pngSignature),
      `${relativeSocialImagePath}: social preview must be a true PNG image`
    );
    await assert(
      socialImage.length >= 24
        && socialImage.readUInt32BE(16) === 1200
        && socialImage.readUInt32BE(20) === 630,
      `${relativeSocialImagePath}: social preview must be exactly 1200x630`
    );
  }

  const readMetaContent = (html, attribute, value) => {
    const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tag = (html.match(/<meta\b[^>]*>/gi) || []).find((candidate) =>
      new RegExp(`${attribute}\\s*=\\s*["']${escapedValue}["']`, 'i').test(candidate)
    );
    return tag?.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1]
      || tag?.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1]
      || '';
  };

  for (const contract of socialPreviewContracts) {
    const response = await api.get(contract.path);
    const html = await response.text();
    const metadata = {
      locale: readMetaContent(html, 'property', 'og:locale'),
      siteName: readMetaContent(html, 'property', 'og:site_name'),
      type: readMetaContent(html, 'property', 'og:type'),
      url: readMetaContent(html, 'property', 'og:url'),
      title: readMetaContent(html, 'property', 'og:title'),
      description: readMetaContent(html, 'property', 'og:description'),
      image: readMetaContent(html, 'property', 'og:image'),
      imageType: readMetaContent(html, 'property', 'og:image:type'),
      imageWidth: readMetaContent(html, 'property', 'og:image:width'),
      imageHeight: readMetaContent(html, 'property', 'og:image:height'),
      imageAlt: readMetaContent(html, 'property', 'og:image:alt'),
      twitterCard: readMetaContent(html, 'name', 'twitter:card'),
      twitterTitle: readMetaContent(html, 'name', 'twitter:title'),
      twitterDescription: readMetaContent(html, 'name', 'twitter:description'),
      twitterImage: readMetaContent(html, 'name', 'twitter:image'),
      twitterAlt: readMetaContent(html, 'name', 'twitter:image:alt'),
    };
    await assert(
      response.ok()
        && metadata.locale === 'en_US'
        && metadata.siteName === 'Andrew Concepcion'
        && metadata.type === 'website'
        && metadata.url === contract.canonicalUrl
        && Boolean(metadata.title)
        && Boolean(metadata.description)
        && metadata.image === contract.imageUrl
        && metadata.imageType === 'image/png'
        && metadata.imageWidth === '1200'
        && metadata.imageHeight === '630'
        && Boolean(metadata.imageAlt)
        && metadata.twitterCard === 'summary_large_image'
        && metadata.twitterTitle === metadata.title
        && metadata.twitterDescription === metadata.description
        && metadata.twitterImage === contract.imageUrl
        && metadata.twitterAlt === metadata.imageAlt,
      `${contract.path}: incomplete or stale social metadata: ${JSON.stringify(metadata)}`
    );
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
    const isSpatialHome = route.path === '/';
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    await assert(resp && resp.status() >= 200 && resp.status() < 400, `Route ${route.path} did not load successfully`);

    const hasTopbar = await page.locator('#site-topbar').count();
    const hasFooter = await page.locator('#site-footer').count();
    await assert(hasTopbar > 0, `${route.path}: missing #site-topbar`);
    await assert(isSpatialHome ? hasFooter === 0 : hasFooter > 0, `${route.path}: unexpected footer state`);
    const desktopPortfolioLabels = await page.locator(
      '#site-nav a[href="/work.html"], #site-footer a[href="/work.html"]'
    ).allTextContents();
    await assert(
      desktopPortfolioLabels.length === (isSpatialHome ? 1 : 2)
        && desktopPortfolioLabels.every((label) => label.trim() === '[portfolio]'),
      `${route.path}: desktop navigation must label /work.html as [portfolio]`
    );
    if (isSpatialHome) {
      const homepageContract = await page.evaluate(() => ({
        eyebrow: document.querySelector('[data-identity-hero] .eyebrow')?.textContent?.trim(),
        heading: document.querySelector('[data-identity-hero] h1')?.innerText?.replace(/\s+/g, ' ').trim(),
        summary: document.querySelector('[data-identity-hero] > p:not(.eyebrow)')?.textContent?.replace(/\s+/g, ' ').trim(),
        openGraphAlt: document.querySelector('meta[property="og:image:alt"]')?.content,
        openGraphImage: document.querySelector('meta[property="og:image"]')?.content,
        twitterAlt: document.querySelector('meta[name="twitter:image:alt"]')?.content,
        twitterImage: document.querySelector('meta[name="twitter:image"]')?.content,
      }));
      await assert(
        homepageContract.eyebrow === '[IDENTITY: AI_NATIVE_SOFTWARE_ENGINEER]'
          && homepageContract.heading === 'Hello, I’m Andrew. AI-native software engineer.'
          && homepageContract.summary === 'I build and improve production engineering systems across Android, iOS, backend, shared native code, and agent-first delivery workflows.',
        `Homepage identity copy drifted from the published introduction: ${JSON.stringify(homepageContract)}`
      );
      await assert(
        homepageContract.openGraphImage === homepageSocialImageUrl
          && homepageContract.twitterImage === homepageSocialImageUrl,
        'Homepage social metadata does not reference the current orbital dashboard preview'
      );
      await assert(
        Boolean(homepageContract.openGraphAlt)
          && homepageContract.openGraphAlt === homepageContract.twitterAlt,
        'Homepage social preview alt text is missing or inconsistent'
      );
    }

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
      mobilePortfolioLabels.length === (isSpatialHome ? 1 : 2)
        && mobilePortfolioLabels.every((label) => label.trim() === '[portfolio]'),
      `${route.path}: mobile navigation must label /work.html as [portfolio]`
    );
    const routeMobileChromeFontSizes = await mobilePage.evaluate(() => {
      const selectors = {
        brand: '#site-topbar > div > a:first-child',
        status: '#site-topbar > div > div:last-child',
        navigation: '#site-nav-mobile'
      };
      return Object.fromEntries(
        Object.entries(selectors).map(([name, selector]) => {
          const element = document.querySelector(selector);
          return [name, element ? getComputedStyle(element).fontSize : null];
        })
      );
    });
    await assert(
      await mobilePage.locator('#site-topbar > div > div:last-child').isVisible(),
      `${route.path}: mobile status indicator is hidden`
    );
    await assert(
      Object.values(routeMobileChromeFontSizes).every(Boolean),
      `${route.path}: mobile site chrome is missing a typography target`
    );
    if (!mobileChromeFontSizes) {
      mobileChromeFontSizes = routeMobileChromeFontSizes;
    } else {
      await assert(
        Object.keys(mobileChromeFontSizes).every((key) => (
          Math.abs(parseFloat(routeMobileChromeFontSizes[key]) - parseFloat(mobileChromeFontSizes[key])) <= 0.5
        )),
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
    if (route.path === '/about.html') {
      const aboutHeroClearance = await mobilePage.evaluate(() => {
        const header = document.querySelector('#site-topbar').getBoundingClientRect();
        const hero = document.querySelector('#about-title').getBoundingClientRect();
        return hero.top - header.bottom;
      });
      await assert(aboutHeroClearance >= 0, 'About mobile hero is obscured by the fixed header');
    }
    if (route.screenshot !== false) {
      await prepareForScreenshot(mobilePage);
      await mobilePage.screenshot({ path: path.join(mobileDir, `${route.name}.png`), fullPage: true });
    }
  }

  const readOrbitCoordinates = (targetPage) => targetPage.evaluate(() => (
    [...document.querySelectorAll('[data-orbit-object]')].map((element) => ({
      key: element.dataset.orbitObject,
      x: Number.parseFloat(getComputedStyle(element).getPropertyValue('--x')),
      y: Number.parseFloat(getComputedStyle(element).getPropertyValue('--y')),
    }))
  ));

  const findVisibleBackdropPoint = (targetPage) => targetPage.evaluate(() => {
    const layer = document.querySelector('[data-detail-layer]');
    const backdrop = document.querySelector('[data-detail-backdrop]');
    const bounds = layer.getBoundingClientRect();
    const left = Math.max(2, bounds.left + 2);
    const right = Math.min(window.innerWidth - 2, bounds.right - 2);
    const top = Math.max(2, bounds.top + 2);
    const bottom = Math.min(window.innerHeight - 2, bounds.bottom - 2);
    const candidates = [];

    for (let y = top; y <= bottom; y += 24) {
      candidates.push({ x: left, y }, { x: right, y });
    }
    for (let x = left; x <= right; x += 24) {
      candidates.push({ x, y: top }, { x, y: bottom });
    }

    return candidates.find(({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return hit === backdrop || hit?.closest('[data-detail-backdrop]') === backdrop;
    }) || null;
  });

  // Phones retain the desktop interaction model: a vertically scrollable
  // landing scene, moving parametric ellipses, camera controls, field map and
  // spatial focus. Short screens may simplify satellite placement, but never
  // replace the primary field with a static horizontal carousel.
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 568, height: 320 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    const spatialContext = await browser.newContext({
      hasTouch: true,
      isMobile: viewport.width < 768,
      viewport,
    });
    const spatialPage = await spatialContext.newPage();
    spatialPage.on('pageerror', (error) => failures.push(`Homepage ${viewport.width}x${viewport.height} pageerror: ${error.message}`));
    await spatialPage.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await spatialPage.locator('[data-synthesis]').waitFor();
    await spatialPage.evaluate(() => document.fonts?.ready);

    const overview = await spatialPage.evaluate(() => {
      const rect = (element) => {
        const bounds = element.getBoundingClientRect();
        return {
          bottom: bounds.bottom + window.scrollY,
          left: bounds.left + window.scrollX,
          right: bounds.right + window.scrollX,
          top: bounds.top + window.scrollY,
        };
      };
      const intersection = (first, second) => (
        Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left))
        * Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top))
      );
      const ctas = [...document.querySelectorAll('.identity-actions a')].map(rect);
      const map = rect(document.querySelector('[data-field-map]'));
      const nodes = [...document.querySelectorAll('[data-orbit-object]')];
      const nodeRects = nodes.map(rect);
      const plane = document.querySelector('[data-orbit-plane]');
      const orbitAnchorErrors = nodes.map((node) => {
        const marker = document.createElement('span');
        marker.style.cssText = [
          'position:absolute',
          'top:50%',
          'left:50%',
          'width:0',
          'height:0',
          'pointer-events:none',
          `transform:translate3d(${node.style.getPropertyValue('--x')},${node.style.getPropertyValue('--y')},0)`,
        ].join(';');
        plane.append(marker);
        const markerBounds = marker.getBoundingClientRect();
        const sculptureBounds = node.querySelector('.sculpture').getBoundingClientRect();
        marker.remove();
        return Math.hypot(
          sculptureBounds.left + sculptureBounds.width / 2 - markerBounds.left,
          sculptureBounds.top + sculptureBounds.height / 2 - markerBounds.top,
        );
      });
      const orbitTrackErrors = nodes.map((node) => {
        const key = node.dataset.orbitObject;
        const track = document.querySelector(`[data-track="${key}"]`);
        const style = getComputedStyle(track);
        const percentage = (property, size) => Number.parseFloat(style.getPropertyValue(property)) * size / 100;
        const centerX = percentage('--ox', plane.clientWidth);
        const centerY = percentage('--oy', plane.clientHeight);
        const radiusX = percentage('--tw', plane.clientWidth) / 2;
        const radiusY = percentage('--th', plane.clientHeight) / 2;
        const tilt = Number.parseFloat(style.getPropertyValue('--tr')) * Math.PI / 180;
        const deltaX = Number.parseFloat(node.style.getPropertyValue('--x')) - centerX;
        const deltaY = Number.parseFloat(node.style.getPropertyValue('--y')) - centerY;
        const localX = deltaX * Math.cos(tilt) + deltaY * Math.sin(tilt);
        const localY = -deltaX * Math.sin(tilt) + deltaY * Math.cos(tilt);
        const normalizedRadius = Math.hypot(localX / radiusX, localY / radiusY);
        return Math.abs(normalizedRadius - 1) * Math.min(radiusX, radiusY);
      });
      const stage = document.querySelector('.camera-window');
      const identity = document.querySelector('.scene-identity');
      const fieldOrigin = document.querySelector('.field-origin');
      const fieldOriginBounds = fieldOrigin.getBoundingClientRect();
      const controls = [...document.querySelectorAll('.scene-controls button')];
      const visibleMapSvg = [...document.querySelectorAll('[data-field-map] svg')].some((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
      });
      const geometry = getComputedStyle(document.querySelector('.sculpture--range i:first-child'));
      const planeSize = document.querySelector('[data-orbit-plane]');
      const focusPoint = { x: planeSize.clientWidth * .04, y: planeSize.clientHeight * .02 };
      const orbitPoints = nodes.map((node) => ({
        key: node.dataset.orbitObject,
        x: Number.parseFloat(node.style.getPropertyValue('--x')),
        y: Number.parseFloat(node.style.getPropertyValue('--y')),
      }));
      const projectsPoint = orbitPoints.find(({ key }) => key === 'projects');
      const radialDistance = (point) => Math.hypot(point.x - focusPoint.x, point.y - focusPoint.y);
      const regularTrackPathCount = new Set(
        [...document.querySelectorAll('.track:not(.is-comet-track)')].map((track) => {
          const style = getComputedStyle(track);
          return ['--tw', '--th', '--ox', '--oy', '--tr']
            .map((property) => style.getPropertyValue(property).trim())
            .join('/');
        })
      ).size;
      return {
        defaultComet: {
          key: document.querySelector('[data-synthesis]').dataset.comet || null,
          nodeCount: document.querySelectorAll('.orbit-node.is-comet').length,
          period: Number.parseFloat(document.querySelector('.track.is-comet-track i')?.dataset.period),
          resetDisabled: document.querySelector('[data-orbit-reset]')?.disabled,
          trackCount: document.querySelectorAll('.track.is-comet-track').length,
          upperLeftAndOutermost: projectsPoint.x < 0 && projectsPoint.y < 0
            && radialDistance(projectsPoint) > Math.max(...orbitPoints.filter(({ key }) => key !== 'projects').map(radialDistance)),
        },
        controlsVisible: controls.every((element) => {
          const bounds = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
        }),
        cameraAboveHero: Number.parseInt(getComputedStyle(stage).zIndex, 10)
          > Number.parseInt(getComputedStyle(identity).zIndex, 10),
        controlTargets: controls.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { height: bounds.height, width: bounds.width };
        }),
        ctaMapOverlaps: ctas.map((cta) => intersection(cta, map)).filter((area) => area > 1),
        ctaNodeOverlaps: ctas.flatMap((cta) => nodeRects.map((node) => intersection(cta, node))).filter((area) => area > 1),
        documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        documentScrollRange: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight,
        geometry: {
          animationName: geometry.animationName,
          animationPlayState: geometry.animationPlayState,
        },
        mapNodeOverlaps: nodeRects.map((node) => intersection(node, map)).filter((area) => area > 1),
        mapVisible: visibleMapSvg,
        motion: document.querySelector('[data-synthesis]').dataset.motion,
        originVisible: getComputedStyle(fieldOrigin).display !== 'none'
          && getComputedStyle(fieldOrigin).visibility !== 'hidden'
          && fieldOriginBounds.width > 0
          && fieldOriginBounds.height > 0,
        orbitAnchorErrors,
        orbitTrackErrors,
        regularTrackPathCount,
        nodePairOverlaps: nodeRects.flatMap((first, index) => (
          nodeRects.slice(index + 1).map((second) => intersection(first, second))
        )).filter((area) => area > 1),
        nodeOpacities: nodes.map((element) => Number.parseFloat(getComputedStyle(element).opacity)),
        nodeStyles: nodes.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { height: bounds.height, position: getComputedStyle(element).position, width: bounds.width };
        }),
        stageOverflowX: stage.scrollWidth - stage.clientWidth,
        stageOverflowStyle: getComputedStyle(stage).overflowX,
        stageScrollSnap: getComputedStyle(stage).scrollSnapType,
      };
    });

    await assert(
      Math.abs(overview.documentOverflowX) <= 1,
      `Homepage overflows horizontally at ${viewport.width}x${viewport.height}: ${overview.documentOverflowX}`
    );
    if (viewport.width < 768 && viewport.height > viewport.width) {
      await assert(
        overview.documentScrollRange > 1,
        `Homepage phone scene is not vertically scrollable at ${viewport.width}x${viewport.height}`
      );
      await spatialPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await spatialPage.waitForTimeout(80);
      await assert(await spatialPage.evaluate(() => window.scrollY > 0), `Homepage phone scene did not scroll at ${viewport.width}x${viewport.height}`);
      await spatialPage.evaluate(() => window.scrollTo(0, 0));
    }
    await assert(overview.controlsVisible, `Homepage camera controls are hidden at ${viewport.width}x${viewport.height}`);
    await assert(
      overview.controlTargets.every(({ height, width }) => Math.min(height, width) >= 44),
      `Homepage camera controls are too small at ${viewport.width}x${viewport.height}`
    );
    await assert(overview.mapVisible, `Homepage field map is hidden at ${viewport.width}x${viewport.height}`);
    await assert(
      overview.nodeOpacities.every((opacity) => opacity >= .99),
      `Homepage orbit node is unexpectedly transparent at ${viewport.width}x${viewport.height}: ${JSON.stringify(overview.nodeOpacities)}`
    );
    await assert(overview.cameraAboveHero, `Homepage orbital system is layered below the hero at ${viewport.width}x${viewport.height}`);
    await assert(overview.originVisible, `Homepage AC origin is hidden at ${viewport.width}x${viewport.height}`);
    await assert(overview.ctaMapOverlaps.length === 0, `Homepage CTA overlaps the field map at ${viewport.width}x${viewport.height}`);
    await assert(overview.ctaNodeOverlaps.length === 0, `Homepage CTA overlaps an orbit node at ${viewport.width}x${viewport.height}`);
    await assert(overview.mapNodeOverlaps.length === 0, `Homepage orbit node overlaps the field map at ${viewport.width}x${viewport.height}`);
    await assert(overview.nodePairOverlaps.length === 0, `Homepage orbit nodes overlap each other at ${viewport.width}x${viewport.height}`);
    await assert(
      Math.max(...overview.orbitAnchorErrors) <= 3,
      `Homepage orbital path is not centered on the geometric icons at ${viewport.width}x${viewport.height}: ${JSON.stringify(overview.orbitAnchorErrors)}`
    );
    await assert(
      Math.max(...overview.orbitTrackErrors) <= .5,
      `Homepage geometric icons do not sit on their rendered orbit guides at ${viewport.width}x${viewport.height}: ${JSON.stringify(overview.orbitTrackErrors)}`
    );
    await assert(
      overview.regularTrackPathCount === 5,
      `Homepage regular nodes collapse onto shared orbit paths at ${viewport.width}x${viewport.height}`
    );
    await assert(
      overview.nodeStyles.every(({ height, position, width }) => Math.min(height, width) >= 44 && position === 'absolute'),
      `Homepage orbit objects are too small at ${viewport.width}x${viewport.height}`
    );
    await assert(overview.motion === 'active', `Homepage orbital motion is inactive at ${viewport.width}x${viewport.height}`);
    await assert(
      overview.defaultComet.key === 'projects'
        && overview.defaultComet.nodeCount === 1
        && overview.defaultComet.trackCount === 1
        && overview.defaultComet.period >= 18
        && overview.defaultComet.period <= 34
        && overview.defaultComet.resetDisabled === false
        && overview.defaultComet.upperLeftAndOutermost,
      `Homepage does not seed 04 / Highlighted Projects as the single default comet at ${viewport.width}x${viewport.height}`
    );
    await assert(
      overview.stageOverflowStyle === 'hidden' && overview.stageScrollSnap === 'none',
      `Homepage still uses a horizontal orbit carousel at ${viewport.width}x${viewport.height}`
    );
    await assert(
      overview.geometry.animationName === 'range-shift' && overview.geometry.animationPlayState === 'running',
      `Homepage internal geometry is not animated at ${viewport.width}x${viewport.height}`
    );

    const beforeOrbit = await readOrbitCoordinates(spatialPage);
    await spatialPage.waitForTimeout(900);
    const afterOrbit = await readOrbitCoordinates(spatialPage);
    const movingNodes = beforeOrbit.filter((before, index) => {
      const after = afterOrbit[index];
      return after?.key === before.key && Math.hypot(after.x - before.x, after.y - before.y) > 0.4;
    });
    await assert(movingNodes.length >= 4, `Homepage nodes do not follow moving parametric orbits at ${viewport.width}x${viewport.height}`);

    const controls = spatialPage.locator('.scene-controls');
    await controls.scrollIntoViewIfNeeded();
    const viewToggle = spatialPage.locator('[data-view-toggle]');
    const orbitTransform = await spatialPage.locator('[data-camera-rig]').evaluate((element) => getComputedStyle(element).transform);
    await viewToggle.click();
    await spatialPage.waitForFunction((initialTransform) => (
      getComputedStyle(document.querySelector('[data-camera-rig]')).transform !== initialTransform
    ), orbitTransform, { timeout: 2000 });
    const transitionTransform = await spatialPage.locator('[data-camera-rig]').evaluate((element) => getComputedStyle(element).transform);
    await spatialPage.waitForTimeout(1160);
    const topTransform = await spatialPage.locator('[data-camera-rig]').evaluate((element) => getComputedStyle(element).transform);
    await assert(await spatialPage.locator('[data-synthesis]').getAttribute('data-view') === 'top', `Homepage did not enter top view at ${viewport.width}x${viewport.height}`);
    await assert(await viewToggle.getAttribute('aria-pressed') === 'true', `Homepage top-view control has stale state at ${viewport.width}x${viewport.height}`);
    await assert(
      transitionTransform !== orbitTransform && topTransform !== orbitTransform,
      `Homepage top-view camera does not animate at ${viewport.width}x${viewport.height}`
    );
    await viewToggle.click();
    await spatialPage.waitForTimeout(1160);

    const fieldMap = spatialPage.locator('[data-field-map]');
    await fieldMap.scrollIntoViewIfNeeded();
    const mapTargets = await spatialPage.locator('[data-field-map] button').evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return {
        height: bounds.height,
        topmost: hit === element || hit?.closest('button') === element,
        width: bounds.width,
      };
    }));
    await assert(
      mapTargets.every(({ height, topmost, width }) => Math.min(height, width) >= 44 && topmost),
      `Homepage field-map targets are obscured or too small at ${viewport.width}x${viewport.height}`
    );

    const orbitStage = spatialPage.locator('[data-orbit-stage]');
    await orbitStage.scrollIntoViewIfNeeded();
    const tappableNode = await spatialPage.evaluate(() => {
      for (const element of document.querySelectorAll('[data-orbit-object]')) {
        const bounds = element.getBoundingClientRect();
        const x = bounds.left + bounds.width / 2;
        const y = bounds.top + bounds.height / 2;
        if (x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit === element || hit?.closest('[data-orbit-object]') === element) {
          return { key: element.dataset.orbitObject, x, y };
        }
      }
      return null;
    });
    await assert(Boolean(tappableNode), `Homepage has no directly tappable orbit node at ${viewport.width}x${viewport.height}`);
    if (tappableNode) {
      await spatialPage.touchscreen.tap(tappableNode.x, tappableNode.y);
    } else {
      await spatialPage.locator('[data-map-target="projects"]').click();
    }

    await spatialPage.waitForFunction(() => document.querySelector('[data-synthesis]')?.dataset.phase === 'focused');
    await spatialPage.waitForFunction(() => {
      const satellites = [...document.querySelectorAll('.facet-detail.is-active .focus-satellites > *')];
      return satellites.length === 3
        && satellites.every((element) => Number.parseFloat(getComputedStyle(element).opacity) >= 0.99);
    }, null, { timeout: 2200 });
    const focused = await spatialPage.evaluate(() => {
      const layer = document.querySelector('[data-detail-layer]').getBoundingClientRect();
      const map = document.querySelector('[data-field-map]').getBoundingClientRect();
      const active = document.querySelector('.facet-detail.is-active');
      const copy = active.querySelector('.landing-copy').getBoundingClientRect();
      const object = active.querySelector('.landing-object').getBoundingClientRect();
      const intersection = (first, second) => (
        Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left))
        * Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top))
      );
      const satellites = [...active.querySelectorAll('.focus-satellites > *')].map((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          animationName: style.animationName,
          copyOverlap: intersection(bounds, copy),
          height: bounds.height,
          mapOverlap: intersection(bounds, map),
          opacity: Number.parseFloat(style.opacity),
          outside: bounds.left < layer.left - 1
            || bounds.right > layer.right + 1
            || bounds.top < layer.top - 1
            || bounds.bottom > layer.bottom + 1,
          width: bounds.width,
        };
      });
      return {
        activeKey: active?.dataset.facetDetail,
        copyMapOverlap: intersection(copy, map),
        horizontalOverflow: document.querySelector('[data-detail-layer]').scrollWidth - document.querySelector('[data-detail-layer]').clientWidth,
        objectMapOverlap: intersection(object, map),
        satellites,
      };
    });
    await assert(Math.abs(focused.horizontalOverflow) <= 1, `Homepage detail overflows horizontally at ${viewport.width}x${viewport.height}`);
    await assert(
      focused.copyMapOverlap === 0 && focused.objectMapOverlap === 0,
      `Homepage focus content covers the field map at ${viewport.width}x${viewport.height}`
    );
    await assert(focused.satellites.length === 3, `Homepage focus satellites are incomplete at ${viewport.width}x${viewport.height}`);
    await assert(
      focused.satellites.every(({ height, mapOverlap, opacity, width }) => (
        height > 0 && width > 0 && opacity > 0 && mapOverlap === 0
      )),
      `Homepage focus satellites are obscured at ${viewport.width}x${viewport.height}`
    );

    await assert(
      focused.satellites.every(({ animationName, copyOverlap, outside }) => (
        animationName.includes('satellite-orbit') && copyOverlap === 0 && !outside
      )),
      `Homepage focus satellites do not orbit clear of the copy at ${viewport.width}x${viewport.height}`
    );
    const satelliteBefore = await spatialPage.locator('.facet-detail.is-active .focus-satellites > *').evaluateAll((elements) => (
      elements.map((element) => getComputedStyle(element).transform)
    ));
    await spatialPage.waitForTimeout(850);
    const satelliteAfter = await spatialPage.locator('.facet-detail.is-active .focus-satellites > *').evaluateAll((elements) => (
      elements.map((element) => getComputedStyle(element).transform)
    ));
    await assert(
      satelliteBefore.filter((transform, index) => transform !== satelliteAfter[index]).length >= 2,
      `Homepage focus satellites do not move at ${viewport.width}x${viewport.height}`
    );

    const backdropPoint = await findVisibleBackdropPoint(spatialPage);
    await assert(Boolean(backdropPoint), `Homepage has no unobscured outside-dismiss target at ${viewport.width}x${viewport.height}`);
    if (backdropPoint) await spatialPage.touchscreen.tap(backdropPoint.x, backdropPoint.y);
    else await spatialPage.locator('[data-detail-close]').click();
    await spatialPage.waitForFunction(() => document.querySelector('[data-synthesis]')?.dataset.phase === 'overview');
    await assert(new URL(spatialPage.url()).hash === '', `Homepage outside dismiss leaves a stale hash at ${viewport.width}x${viewport.height}`);

    await spatialPage.locator('[data-field-map]').scrollIntoViewIfNeeded();
    await spatialPage.locator('[data-map-target="projects"]').click();
    await spatialPage.waitForFunction(() => document.querySelector('[data-synthesis]')?.dataset.phase === 'focused');
    await spatialPage.waitForFunction(() => {
      const logos = Array.from(document.querySelectorAll('[data-facet-detail="projects"] .project-app-logo img'));
      return logos.length === 12 && logos.every((image) => image.complete && image.naturalWidth > 0);
    });
    const projectLogoGeometry = await spatialPage.evaluate(() => {
      const disc = (element) => {
        const bounds = element.getBoundingClientRect();
        return {
          radius: Math.min(bounds.width, bounds.height) / 2,
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        };
      };
      const distance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);
      const clearance = (first, second) => distance(first, second) - first.radius - second.radius;
      const core = disc(document.querySelector('[data-facet-detail="projects"] .project-app-core'));
      const outer = Array.from(document.querySelectorAll('[data-facet-detail="projects"] .project-app-ring--outer .project-app-logo')).map(disc);
      const inner = Array.from(document.querySelectorAll('[data-facet-detail="projects"] .project-app-ring--inner .project-app-logo')).map(disc);
      const pairClearances = (discs) => discs.flatMap((first, index) => (
        discs.slice(index + 1).map((second) => clearance(first, second))
      ));
      const innerCoreClearance = Math.min(...inner.map((logo) => clearance(logo, core)));
      const outerInnerRadialClearance = Math.min(...outer.map((logo) => distance(logo, core) - logo.radius))
        - Math.max(...inner.map((logo) => distance(logo, core) + logo.radius));
      return {
        innerCoreClearance,
        minimumSameRingClearance: Math.min(...pairClearances(outer), ...pairClearances(inner)),
        outerInnerRadialClearance,
      };
    });
    await assert(
      projectLogoGeometry.innerCoreClearance >= 1
        && projectLogoGeometry.minimumSameRingClearance >= 1
        && projectLogoGeometry.outerInnerRadialClearance >= 1,
      `Homepage project logo rings collide at ${viewport.width}x${viewport.height}: ${JSON.stringify(projectLogoGeometry)}`
    );
    await spatialPage.locator('[data-detail-close]').click();
    await spatialPage.waitForFunction(() => document.querySelector('[data-synthesis]')?.dataset.phase === 'overview');
    await spatialContext.close();
  }

  // A direct fling keeps navigation intact while re-routing exactly one node
  // onto a severe, focus-based ellipse. Pause, resume, sound and reset share the
  // existing native control surface instead of creating a second animation loop.
  const flingContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const flingPage = await flingContext.newPage();
  flingPage.on('pageerror', (error) => failures.push(`Fling homepage pageerror: ${error.message}`));
  await flingPage.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await flingPage.locator('[data-synthesis]').waitFor();
  await flingPage.evaluate(() => {
    window.__orbitalTestCues = [];
    window.__orbitalTestFling = null;
    window.addEventListener('orbital:sound', (event) => window.__orbitalTestCues.push(event.detail?.cue));
    window.addEventListener('orbital:fling', (event) => { window.__orbitalTestFling = event.detail; });
  });
  const flingTarget = await flingPage.evaluate(() => {
    for (const element of document.querySelectorAll('[data-orbit-object]')) {
      const bounds = element.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2;
      const y = bounds.top + bounds.height / 2;
      if (x < 150 || x > innerWidth - 150 || y < 120 || y > innerHeight - 120) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit !== element && hit?.closest('[data-orbit-object]') !== element) continue;
      return {
        key: element.dataset.orbitObject,
        start: { x, y },
        end: {
          x: Math.max(150, Math.min(innerWidth - 150, x + (x < innerWidth / 2 ? 150 : -150))),
          y: Math.max(120, Math.min(innerHeight - 120, y + (y < innerHeight / 2 ? 100 : -100))),
        },
      };
    }
    return null;
  });
  await assert(Boolean(flingTarget), 'Homepage has no unobscured desktop node to fling');
  if (flingTarget) {
    const flingNode = flingPage.locator(`[data-orbit-object="${flingTarget.key}"]`);
    await flingPage.mouse.move(flingTarget.start.x, flingTarget.start.y);
    await flingPage.mouse.down();
    await flingPage.mouse.move(flingTarget.end.x, flingTarget.end.y, { steps: 9 });
    await flingPage.mouse.up();
    await flingPage.waitForFunction(() => Boolean(document.querySelector('[data-synthesis]')?.dataset.comet));
    await flingPage.waitForTimeout(820);

    const flung = await flingPage.evaluate(() => {
      const root = document.querySelector('[data-synthesis]');
      const node = document.querySelector('.orbit-node.is-comet');
      const track = document.querySelector('.track.is-comet-track');
      const trackStyle = track && getComputedStyle(track);
      const plane = document.querySelector('[data-orbit-plane]');
      const trackWidth = Number.parseFloat(trackStyle?.width);
      const trackHeight = Number.parseFloat(trackStyle?.height);
      const point = {
        x: Number.parseFloat(getComputedStyle(node).getPropertyValue('--x')),
        y: Number.parseFloat(getComputedStyle(node).getPropertyValue('--y')),
      };
      const tailAngle = Number.parseFloat(getComputedStyle(node).getPropertyValue('--tail-angle'));
      const expectedTailAngle = Math.atan2(point.y - plane.clientHeight * .02, point.x - plane.clientWidth * .04) * 180 / Math.PI;
      const tailAngleError = Math.abs(((tailAngle - expectedTailAngle + 540) % 360) - 180);
      const glitters = Array.from(node?.querySelectorAll('.comet-wake b') || []);
      const wake = node?.querySelector('.comet-wake');
      return {
        audioState: root?.dataset.audioState,
        activeControl: document.activeElement?.matches('[data-orbit-reset]') || false,
        comet: root?.dataset.comet,
        customNodes: document.querySelectorAll('.orbit-node.is-comet').length,
        customTracks: document.querySelectorAll('.track.is-comet-track').length,
        eccentricity: Number.parseFloat(track?.querySelector('i')?.dataset.eccentricity),
        fling: window.__orbitalTestFling,
        hash: location.hash,
        phase: root?.dataset.phase,
        resetDisabled: document.querySelector('[data-orbit-reset]')?.disabled,
        glitterAnimations: glitters.map((glitter) => getComputedStyle(glitter).animationName),
        glitterCount: glitters.length,
        documentGlitterCount: document.querySelectorAll('.comet-particle').length,
        glitterColorCount: new Set(glitters.map((glitter) => getComputedStyle(glitter).color)).size,
        glitterMaximumSize: Math.max(...glitters.map((glitter) => Number.parseFloat(getComputedStyle(glitter).width))),
        glitterTrails: glitters.filter((glitter) => Number.parseFloat(getComputedStyle(glitter, '::before').width) >= 5).length,
        glitterVisible: glitters.some((glitter) => {
          const bounds = glitter.getBoundingClientRect();
          return Number.parseFloat(getComputedStyle(glitter).opacity) > .2
            && bounds.width >= 2
            && bounds.height >= 1;
        }),
        tailAngleError,
        tailThickness: Number.parseFloat(getComputedStyle(wake).height),
        trackAspect: trackWidth > 0 && trackHeight > 0
          ? Math.max(trackWidth / trackHeight, trackHeight / trackWidth)
          : 0,
        wakeOpacity: Number.parseFloat(getComputedStyle(wake).opacity),
      };
    });
    await assert(
      flung.comet === flingTarget.key && flung.customNodes === 1 && flung.customTracks === 1,
      'Desktop fling does not create exactly one altered orbit'
    );
    await assert(flung.phase === 'overview' && flung.hash === '', 'Desktop fling accidentally opens a destination');
    await assert(flung.eccentricity >= .9 && flung.trackAspect >= 2.2, 'Desktop fling path is not a severe ellipse');
    await assert(flung.fling?.period >= 18 && flung.fling?.period <= 34, 'Desktop comet is not faster than the regular 178–360 second orbits');
    await assert(flung.resetDisabled === false && flung.wakeOpacity > 0, 'Desktop fling does not expose its wake and reset control');
    await assert(
      flung.tailAngleError <= 1 && flung.glitterCount === 22 && flung.documentGlitterCount === 22 && flung.glitterVisible
        && flung.glitterColorCount === 5 && flung.glitterMaximumSize <= 3.6
        && flung.glitterTrails === flung.glitterCount && flung.tailThickness <= 20
        && flung.glitterAnimations.every((name) => ['comet-ion-eject', 'comet-dust-eject'].includes(name)),
      'Desktop comet tail does not face away from AC with thin multi-color ion and dust particle streams'
    );
    await assert(flung.audioState === 'running', 'Desktop fling does not activate the action-sound engine');
    await assert(flung.activeControl, 'Desktop fling leaves keyboard focus on the moving node instead of the stable reset control');

    const displacement = (before, after, key) => {
      const start = before.find((point) => point.key === key);
      const end = after.find((point) => point.key === key);
      return start && end ? Math.hypot(end.x - start.x, end.y - start.y) : 0;
    };
    const apoBefore = await readOrbitCoordinates(flingPage);
    await flingPage.waitForTimeout(320);
    const apoAfter = await readOrbitCoordinates(flingPage);
    const apoDistance = displacement(apoBefore, apoAfter, flingTarget.key);
    const apoRadius = await flingPage.evaluate((key) => {
      const plane = document.querySelector('[data-orbit-plane]');
      const node = document.querySelector(`[data-orbit-object="${key}"]`);
      const focusX = plane.clientWidth * .04;
      const focusY = plane.clientHeight * .02;
      const x = Number.parseFloat(getComputedStyle(node).getPropertyValue('--x'));
      const y = Number.parseFloat(getComputedStyle(node).getPropertyValue('--y'));
      return Math.hypot(x - focusX, y - focusY);
    }, flingTarget.key);
    const apoWake = await flingNode.evaluate((node) => ({
      proximity: Number.parseFloat(getComputedStyle(node).getPropertyValue('--solar-proximity')),
      scale: Number.parseFloat(getComputedStyle(node).getPropertyValue('--wake-scale')),
    }));
    await flingPage.waitForFunction(({ key, threshold }) => {
      const plane = document.querySelector('[data-orbit-plane]');
      const node = document.querySelector(`[data-orbit-object="${key}"]`);
      if (!plane || !node) return false;
      const focusX = plane.clientWidth * .04;
      const focusY = plane.clientHeight * .02;
      const x = Number.parseFloat(getComputedStyle(node).getPropertyValue('--x'));
      const y = Number.parseFloat(getComputedStyle(node).getPropertyValue('--y'));
      return Math.hypot(x - focusX, y - focusY) <= threshold;
    }, { key: flingTarget.key, threshold: apoRadius * .58 }, { timeout: 30000, polling: 100 });
    const inboundWake = await flingNode.evaluate((node) => ({
      proximity: Number.parseFloat(getComputedStyle(node).getPropertyValue('--solar-proximity')),
      scale: Number.parseFloat(getComputedStyle(node).getPropertyValue('--wake-scale')),
    }));
    const inboundBefore = await readOrbitCoordinates(flingPage);
    await flingPage.waitForTimeout(420);
    const inboundAfter = await readOrbitCoordinates(flingPage);
    const inboundDistance = displacement(inboundBefore, inboundAfter, flingTarget.key);
    const regularDistances = inboundBefore
      .filter(({ key }) => key !== flingTarget.key)
      .map(({ key }) => displacement(inboundBefore, inboundAfter, key));
    const averageRegularDistance = regularDistances.reduce((total, distance) => total + distance, 0)
      / Math.max(regularDistances.length, 1);
    await assert(
      // CI runners can briefly deliver a single throttled frame at apoapsis;
      // keep the acceleration assertion about the relative inbound speed,
      // rather than requiring a minimum pixel displacement for that frame.
      apoDistance > .1 && inboundDistance > apoDistance * 1.35,
      `Altered node does not visibly accelerate from apoapsis toward the AC focus (${apoDistance.toFixed(2)}px → ${inboundDistance.toFixed(2)}px)`
    );
    await assert(
      inboundDistance > averageRegularDistance * 1.8,
      `Inbound comet is not substantially faster than the regular orbit nodes (${inboundDistance.toFixed(2)}px vs ${averageRegularDistance.toFixed(2)}px average)`
    );
    await assert(
      inboundWake.proximity > apoWake.proximity && inboundWake.scale > apoWake.scale + .08,
      `Comet tail does not lengthen as it approaches AC (${apoWake.scale.toFixed(2)} → ${inboundWake.scale.toFixed(2)})`
    );

    await flingPage.locator('[data-motion-toggle]').click();
    const pausedBefore = await readOrbitCoordinates(flingPage);
    await flingPage.waitForTimeout(750);
    const pausedAfter = await readOrbitCoordinates(flingPage);
    await assert(JSON.stringify(pausedBefore) === JSON.stringify(pausedAfter), 'Pause does not freeze the altered orbit');
    await assert(
      await flingPage.locator('.orbit-node.is-comet .comet-wake b').first().evaluate((element) => getComputedStyle(element).animationPlayState) === 'paused',
      'Pause does not freeze the comet glitter trail'
    );
    await flingPage.locator('[data-motion-toggle]').click();

    await flingPage.locator('[data-orbit-reset]').click();
    await flingPage.waitForTimeout(820);
    const resetState = await flingPage.evaluate(() => ({
      comet: document.querySelector('[data-synthesis]')?.dataset.comet || null,
      customNodes: document.querySelectorAll('.orbit-node.is-comet').length,
      customTracks: document.querySelectorAll('.track.is-comet-track').length,
      cues: window.__orbitalTestCues,
      resetDisabled: document.querySelector('[data-orbit-reset]')?.disabled,
      resettingNodes: document.querySelectorAll('.orbit-node.is-resetting').length,
    }));
    await assert(
      resetState.comet === null && resetState.customNodes === 0 && resetState.customTracks === 0
        && resetState.resettingNodes === 0 && resetState.resetDisabled,
      'Reset does not restore the original orbital field'
    );
    await assert(
      resetState.cues.includes('fling') && resetState.cues.includes('reset'),
      'Fling and reset do not emit their action sounds'
    );

    await flingPage.locator('[data-motion-toggle]').click();
    await flingNode.click();
    await flingPage.waitForFunction(() => document.querySelector('[data-synthesis]')?.dataset.phase === 'focused');
    await assert(
      new URL(flingPage.url()).hash === `#facet-${flingTarget.key}`,
      'A normal click no longer opens a node after fling reset'
    );

    await flingPage.locator('[data-detail-close]').click();
    await flingPage.waitForFunction(() => document.querySelector('[data-synthesis]')?.dataset.phase === 'overview');
    await flingPage.locator('[data-map-target="projects"]').click();
    await flingPage.waitForFunction(() => document.querySelector('[data-synthesis]')?.dataset.phase === 'focused');
    const projectConstellation = await flingPage.evaluate(() => {
      const logos = Array.from(document.querySelectorAll('[data-facet-detail="projects"] .project-app-logo'));
      const sources = logos.map((logo) => logo.querySelector('img')?.getAttribute('src') || '');
      return {
        ariaLabel: document.querySelector('[data-facet-detail="projects"] .project-app-orbits')?.getAttribute('aria-label') || '',
        circular: logos.every((logo) => getComputedStyle(logo).borderRadius === '50%' && getComputedStyle(logo).overflow === 'hidden'),
        loaded: logos.every((logo) => {
          const image = logo.querySelector('img');
          return image?.complete && image.naturalWidth > 0;
        }),
        logoCount: logos.length,
        outerSources: Array.from(document.querySelectorAll('[data-facet-detail="projects"] .project-app-ring--outer img'))
          .map((image) => image.getAttribute('src') || ''),
        ringAnimations: Array.from(document.querySelectorAll('[data-facet-detail="projects"] .project-app-ring'))
          .map((ring) => getComputedStyle(ring).animationName),
        sources,
        titles: Array.from(document.querySelectorAll('[data-facet-detail="projects"] .focus-satellites strong'))
          .map((title) => title.textContent?.trim()),
      };
    });
    await assert(
      projectConstellation.logoCount === 12 && projectConstellation.loaded && projectConstellation.circular,
      'Highlighted-project app constellation is not twelve loaded circular logo medallions'
    );
    await assert(
      ['ic_bitcoin_wallet_logo.svg', 'ic_itvx_logo.svg', 'ic_ocbc_logo.png']
        .every((filename) => projectConstellation.outerSources.some((src) => src.endsWith(filename))),
      'Bitcoin.com Wallet, ITVX, and OCBC Business are not all on the prominent app ring'
    );
    await assert(
      projectConstellation.ringAnimations.every((name) => name === 'project-app-ring-spin'),
      'Highlighted-project app rings are not animated'
    );
    await assert(
      JSON.stringify(projectConstellation.titles) === JSON.stringify(['Bitcoin.com Wallet', 'ITVX', 'OCBC Business']),
      'Highlighted-project satellites do not use the selected production trio'
    );
    await assert(
      await flingPage.locator('[data-facet-detail="profile"] .landing-copy a').getAttribute('href') === '/about.html#profile-map',
      'Skills and interests CTA does not lead to the capability tree'
    );

    const outgoingFacet = await flingPage.locator('[data-synthesis]').getAttribute('data-selected');
    await flingPage.locator('[data-facet-next]').click();
    const outgoingTransfer = await flingPage.evaluate(() => {
      const root = document.querySelector('[data-synthesis]');
      return {
        phase: root?.dataset.phase,
        stage: root?.dataset.transferStage,
        selected: root?.dataset.selected,
        from: root?.dataset.transferFrom,
        to: root?.dataset.transferTo,
        selectedNodes: [...document.querySelectorAll('.orbit-node.is-selected')]
          .map((node) => node.dataset.orbitObject),
      };
    });
    await assert(
      outgoingTransfer.phase === 'transferring'
        && outgoingTransfer.stage === 'outgoing'
        && outgoingTransfer.selected === outgoingFacet
        && outgoingTransfer.from === outgoingFacet
        && outgoingTransfer.to !== outgoingFacet
        && JSON.stringify(outgoingTransfer.selectedNodes) === JSON.stringify([outgoingFacet]),
      `Homepage facet handoff shrinks the destination instead of the outgoing world: ${JSON.stringify(outgoingTransfer)}`
    );
    await flingPage.waitForFunction((from) => (
      document.querySelector('[data-synthesis]')?.dataset.selected !== from
    ), outgoingFacet);
    const incomingFacet = await flingPage.locator('[data-synthesis]').getAttribute('data-selected');
    await assert(
      incomingFacet === outgoingTransfer.to
        && await flingPage.locator(`.orbit-node[data-orbit-object="${incomingFacet}"]`).getAttribute('class').then((value) => value.includes('is-selected')),
      'Homepage facet handoff did not commit the incoming world after the outgoing collapse'
    );
    await flingPage.waitForFunction(() => document.querySelector('[data-synthesis]')?.dataset.phase === 'focused');
  }
  await flingContext.close();

  // Reduced motion keeps the complete mobile interaction model but freezes all
  // continuous motion and makes camera/focus transitions effectively immediate.
  const reducedHomeContext = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 844 },
  });
  const reducedHomePage = await reducedHomeContext.newPage();
  reducedHomePage.on('pageerror', (error) => failures.push(`Reduced-motion homepage pageerror: ${error.message}`));
  await reducedHomePage.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await reducedHomePage.locator('[data-synthesis]').waitFor();
  await reducedHomePage.evaluate(() => document.fonts?.ready);
  await assert(
    await reducedHomePage.locator('[data-synthesis]').getAttribute('data-motion') === 'reduced',
    'Reduced-motion homepage does not expose its reduced state'
  );
  await assert(
    await reducedHomePage.locator('[data-motion-toggle]').getAttribute('aria-disabled') === 'true',
    'Reduced-motion homepage leaves the motion control enabled'
  );
  const reducedBefore = await readOrbitCoordinates(reducedHomePage);
  await reducedHomePage.waitForTimeout(650);
  const reducedAfter = await readOrbitCoordinates(reducedHomePage);
  await assert(
    JSON.stringify(reducedBefore) === JSON.stringify(reducedAfter),
    'Reduced-motion homepage still moves orbit nodes'
  );
  const reducedFlingState = await reducedHomePage.locator('[data-orbit-object]').first().evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    const pointer = (type, clientX, clientY) => element.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      isPrimary: true,
      pointerId: 41,
      pointerType: 'touch',
    }));
    pointer('pointerdown', x, y);
    pointer('pointermove', x + 80, y - 60);
    pointer('pointerup', x + 80, y - 60);
    return {
      comet: document.querySelector('[data-synthesis]')?.dataset.comet || null,
      resetDisabled: document.querySelector('[data-orbit-reset]')?.disabled,
      touchAction: getComputedStyle(element).touchAction,
      wakeDisplay: getComputedStyle(element.querySelector('.comet-wake')).display,
    };
  });
  await assert(
    reducedFlingState.comet === null && reducedFlingState.resetDisabled
      && reducedFlingState.touchAction === 'manipulation' && reducedFlingState.wakeDisplay === 'none',
    'Reduced-motion homepage still enables continuous fling behavior'
  );
  await reducedHomePage.locator('.scene-controls').scrollIntoViewIfNeeded();
  await reducedHomePage.locator('[data-view-toggle]').click();
  await assert(
    await reducedHomePage.locator('[data-synthesis]').getAttribute('data-view') === 'top',
    'Reduced-motion homepage top-view control no longer works'
  );
  await reducedHomePage.locator('[data-field-map]').scrollIntoViewIfNeeded();
  await reducedHomePage.locator('[data-map-target="projects"]').click();
  await reducedHomePage.waitForFunction(() => document.querySelector('[data-synthesis]')?.dataset.phase === 'focused');
  const reducedSatellitesBefore = await reducedHomePage.locator('[data-facet-detail="projects"] .focus-satellites > *').evaluateAll((elements) => (
    elements.map((element) => ({ opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform }))
  ));
  await reducedHomePage.waitForTimeout(500);
  const reducedSatellitesAfter = await reducedHomePage.locator('[data-facet-detail="projects"] .focus-satellites > *').evaluateAll((elements) => (
    elements.map((element) => ({ opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform }))
  ));
  await assert(
    reducedSatellitesBefore.length === 3
      && reducedSatellitesBefore.every(({ opacity }) => Number.parseFloat(opacity) > 0)
      && JSON.stringify(reducedSatellitesBefore) === JSON.stringify(reducedSatellitesAfter),
    'Reduced-motion homepage satellites are hidden or still moving'
  );
  const reducedProjectConstellation = await reducedHomePage.evaluate(() => {
    const logos = Array.from(document.querySelectorAll('[data-facet-detail="projects"] .project-app-logo img'));
    return {
      animations: Array.from(document.querySelectorAll('[data-facet-detail="projects"] .project-app-ring'))
        .map((ring) => getComputedStyle(ring).animationName),
      loaded: logos.length === 12 && logos.every((image) => image.complete && image.naturalWidth > 0),
    };
  });
  await assert(
    reducedProjectConstellation.loaded && reducedProjectConstellation.animations.every((name) => name === 'none'),
    'Reduced-motion project logos are missing or their rings still animate'
  );
  const reducedBackdropPoint = await findVisibleBackdropPoint(reducedHomePage);
  await assert(Boolean(reducedBackdropPoint), 'Reduced-motion homepage has no outside-dismiss target');
  if (reducedBackdropPoint) await reducedHomePage.touchscreen.tap(reducedBackdropPoint.x, reducedBackdropPoint.y);
  else await reducedHomePage.locator('[data-detail-close]').click();
  await reducedHomePage.waitForFunction(() => document.querySelector('[data-synthesis]')?.dataset.phase === 'overview');
  await reducedHomeContext.close();

  // Career timeline and resume stay aligned on the current employer sequence.
  await page.goto(BASE_URL + '/about.html', { waitUntil: 'domcontentloaded' });
  const personalIntro = ((await page.locator('#about-personal-intro').textContent()) || '').replace(/\s+/g, ' ').trim();
  await assert(
    personalIntro.includes('husband, dad')
      && personalIntro.includes('photographer')
      && personalIntro.includes('astronomer'),
    'About hero does not expose the requested personal dimension'
  );
  const careerSection = page.getByRole('heading', { name: 'Career Trajectory', exact: true }).locator('xpath=ancestor::section[1]');
  const careerHeadings = await careerSection.locator('h3').evaluateAll((headings) =>
    headings.map((heading) => (heading.textContent || '').replace(/\s+/g, ' ').trim())
  );
  await assert(
    JSON.stringify(careerHeadings.slice(0, 4)) === JSON.stringify([
      'AI-Native Software Engineer — Bitcoin.com',
      'Senior Mobile Developer — Candyspace',
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
  for (const itvxAchievement of ['recommendations panel', 'timeline scrubbing', 'Simple XML-to-Jackson']) {
    await assert(careerSectionText.includes(itvxAchievement), `About career timeline is missing ITVX achievement: ${itvxAchievement}`);
  }

  await page.goto(BASE_URL + '/resume.html', { waitUntil: 'domcontentloaded' });
  const resumeText = ((await page.locator('main').textContent()) || '').replace(/\s+/g, ' ').trim();
  for (const expectedText of [
    'AI-Native Software Engineer Bitcoin.com Bitcoin.com Wallet — Self-custody crypto wallet Jun 2024 — Present',
    'Senior Mobile Developer Candyspace ITVX — Streaming platform Jun 2023 — Jun 2024',
    'Senior Android Developer Red Airship OCBC — Mobile banking OpenPay — Fintech Jun 2021 — Jun 2023',
    'Lead Developer InnovationTeam MySTC — Telecom project May 2020 — Jun 2021',
    'Team Lead iPARA Technologies and Solutions OWTO — Ride-hailing service Jun 2018 — May 2020',
    'Senior Android Developer YOYO Holdings Pte. Ltd. PopSlide — Rewards platform Jun 2016 — Jun 2018',
    'Full-Stack Web and Mobile Developer Internet Strategy Branding and Execution (ISBX) WebSafety — Parental controls May 2014 — Jun 2016',
  ]) {
    await assert(resumeText.includes(expectedText), `Resume is missing the experience sequence: ${expectedText}`);
  }
  await assert(!resumeText.includes('Littlepay'), 'Resume still exposes Littlepay');
  for (const itvxAchievement of ['recommendations panel', 'timeline scrubbing', 'tablet support', 'Simple XML-to-Jackson']) {
    await assert(resumeText.includes(itvxAchievement), `Resume is missing ITVX achievement: ${itvxAchievement}`);
  }
  const resumeProjectsSection = page.locator('#projects');
  const resumeProjectHeadings = await resumeProjectsSection.locator('article .font-headline').evaluateAll((headings) =>
    headings.map((heading) => (heading.textContent || '').replace(/\s+/g, ' ').trim())
  );
  await assert(
    JSON.stringify(resumeProjectHeadings) === JSON.stringify([
      'Bitcoin.com Wallet',
      'ITVX',
      'OCBC',
      'OpenPay',
      'MySTC',
    ]),
    'Resume projects do not lead with Bitcoin.com Wallet'
  );

  const resumeStructure = await page.evaluate(() => ({
    summaryBeforeScanner: document.querySelector('#professional-summary')?.compareDocumentPosition(
      document.querySelector('#signal-scanner')
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
    scannerBeforeSkills: document.querySelector('#signal-scanner')?.compareDocumentPosition(
      document.querySelector('#core-skills')
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
    roles: document.querySelectorAll('.resume-role').length,
    roleBullets: document.querySelectorAll('.resume-role > ul > li').length,
    projects: document.querySelectorAll('.resume-project').length,
    evidenceBoundaries: document.querySelectorAll('.resume-evidence-boundary').length,
  }));
  await assert(
    Boolean(resumeStructure.summaryBeforeScanner)
      && Boolean(resumeStructure.scannerBeforeSkills)
      && resumeStructure.roles === 7
      && resumeStructure.roleBullets === 21
      && resumeStructure.projects === 5
      && resumeStructure.evidenceBoundaries === 12,
    `Resume dossier structure/content changed: ${JSON.stringify(resumeStructure)}`
  );
  await page.locator('[data-signal="android"]').click();
  const resumeSignalState = await page.evaluate(() => ({
    signal: new URL(location.href).searchParams.get('signal'),
    active: document.querySelector('[data-resume-dossier]')?.dataset.activeSignal,
    pressed: document.querySelector('[data-signal="android"]')?.getAttribute('aria-pressed'),
    hiddenRoles: [...document.querySelectorAll('.resume-role')]
      .filter((role) => getComputedStyle(role).display === 'none').length,
    hiddenProjects: [...document.querySelectorAll('.resume-project')]
      .filter((project) => getComputedStyle(project).display === 'none').length,
    matches: document.querySelectorAll('[data-signals][data-signal-match="true"]').length,
  }));
  await assert(
    resumeSignalState.signal === 'android'
      && resumeSignalState.active === 'android'
      && resumeSignalState.pressed === 'true'
      && resumeSignalState.hiddenRoles === 0
      && resumeSignalState.hiddenProjects === 0
      && resumeSignalState.matches > 0,
    `Resume signal scan hid or lost evidence: ${JSON.stringify(resumeSignalState)}`
  );
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('signal')
    && document.querySelector('[data-resume-dossier]')?.dataset.activeSignal === '');

  // The About opening is a compact biography beside one directly manipulated
  // 3D nebula. Evidence stays exact and visible without a control dashboard.
  const profileMapData = JSON.parse(fs.readFileSync(path.join(siteRoot, 'assets', 'data', 'profile-map.json'), 'utf8'));
  const androidEvidenceUrls = profileMapData.datasets.engineering.nodes
    .find((node) => node.id === 'android').evidenceRefs
    .map((reference) => profileMapData.evidence[reference].url)
    .sort();
  const readAboutCamera = (targetPage) => targetPage.locator('[data-stellar-spectrum]').evaluate((element) => ({
    pitch: Number(element.dataset.treePitch),
    roll: Number(element.dataset.treeRoll),
    view: element.dataset.treeView,
    yaw: Number(element.dataset.treeYaw),
    zoom: Number(element.dataset.treeZoom),
  }));
  const findAboutCanvasPoint = (targetPage) => targetPage.evaluate(() => {
    const canvas = document.querySelector('.stellar-tree__canvas');
    const bounds = canvas.getBoundingClientRect();
    for (let row = 1; row <= 8; row += 1) {
      for (let column = 1; column <= 8; column += 1) {
        const x = bounds.left + (bounds.width * column) / 10;
        const y = bounds.top + (bounds.height * row) / 10;
        if (document.elementFromPoint(x, y) === canvas) return { x, y };
      }
    }
    return null;
  });
  const findAboutCanvasPair = (targetPage) => targetPage.evaluate(() => {
    const canvas = document.querySelector('.stellar-tree__canvas');
    const stage = document.querySelector('#stellar-spectrum-panel').getBoundingClientRect();
    const hitLayers = {};
    for (const vector of [{ x: 85, y: 0 }, { x: 64, y: 48 }, { x: 0, y: 85 }, { x: 48, y: 32 }]) {
      for (let y = Math.max(1, stage.top + 24); y < Math.min(innerHeight - 1, stage.bottom - 24); y += 16) {
        if (y + vector.y >= Math.min(innerHeight - 1, stage.bottom - 24)) continue;
        for (let x = Math.max(1, stage.left + 24); x < Math.min(innerWidth - vector.x - 24, stage.right - vector.x - 24); x += 16) {
          const first = document.elementFromPoint(x, y);
          const second = document.elementFromPoint(x + vector.x, y + vector.y);
          const layer = `${first?.className || first?.tagName || 'none'} | ${second?.className || second?.tagName || 'none'}`;
          hitLayers[layer] = (hitLayers[layer] || 0) + 1;
          if (first === canvas && second === canvas) {
            return {
              pair: [{ x, y }, { x: x + vector.x, y: y + vector.y }],
              diagnostics: { hitLayers, interaction: document.querySelector('[data-stellar-spectrum]').dataset.treeInteraction },
            };
          }
        }
      }
    }
    return {
      pair: null,
      diagnostics: {
        canvas: canvas.getBoundingClientRect().toJSON(),
        hitLayers,
        interaction: document.querySelector('[data-stellar-spectrum]').dataset.treeInteraction,
        pointerEvents: getComputedStyle(canvas).pointerEvents,
        scrollY,
        stage: stage.toJSON(),
        toolbar: document.querySelector('.stellar-tree__toolbar').getBoundingClientRect().toJSON(),
        touchAction: getComputedStyle(canvas).touchAction,
      },
    };
  });

  await page.goto(BASE_URL + '/about.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.stellar-spectrum--enhanced', { timeout: 15000 });
  await page.waitForSelector('#stellar-spectrum-panel:not([hidden])', { timeout: 15000 });
  await page.evaluate(() => document.fonts?.ready);
  const desktopSpectrum = await page.evaluate(() => {
    const bounds = (selector) => document.querySelector(selector).getBoundingClientRect();
    const opening = bounds('.about-opening');
    const hero = bounds('#present-origin');
    const stage = bounds('#stellar-spectrum-panel');
    const toolbar = bounds('.stellar-tree__toolbar');
    const rootMarker = bounds('.stellar-tree__root');
    const topbar = bounds('#site-topbar');
    const canvas = document.querySelector('.stellar-tree__canvas');
    const canvasBounds = canvas.getBoundingClientRect();
    const nodeIds = [...document.querySelectorAll('[data-node-id]')].map((node) => node.dataset.nodeId);
    const bodyText = document.body.textContent || '';
    const visibleControlSelector = 'button[data-tree-projection], [data-tree-interaction-toggle], [data-tree-zoom-range], [data-tree-reset], [data-about-theme-toggle]';
    const backgrounds = ['html', 'body', '#site-topbar', '#main-content', '.stellar-tree__viewport', '#site-footer']
      .map((selector) => getComputedStyle(document.querySelector(selector)).backgroundColor);
    return {
      adjacent: hero.right <= stage.left + 2,
      backgrounds,
      belowTopbar: hero.top >= topbar.bottom && stage.top >= topbar.bottom,
      branches: document.querySelectorAll('[data-band-trigger]').length,
      canvas: {
        backingHeight: canvas.height,
        backingWidth: canvas.width,
        coversOpening: canvasBounds.left <= 0
          && canvasBounds.right >= window.innerWidth
          && canvasBounds.top <= opening.top + 1
          && canvasBounds.bottom >= opening.bottom - 1,
        height: canvasBounds.height,
        hidden: canvas.getAttribute('aria-hidden'),
        overdrawsStage: canvasBounds.left < stage.left
          && canvasBounds.right > stage.right
          && canvasBounds.top < stage.top
          && canvasBounds.bottom > stage.bottom,
        width: canvasBounds.width,
      },
      cameraFinite: ['treeYaw', 'treePitch', 'treeRoll', 'treeZoom']
        .every((key) => Number.isFinite(Number(document.querySelector('[data-stellar-spectrum]').dataset[key]))),
      controls: [...document.querySelectorAll(visibleControlSelector)]
        .filter((element) => !element.hidden && getComputedStyle(element).display !== 'none').length,
      interactionToggleVisible: getComputedStyle(document.querySelector('[data-tree-interaction-toggle]')).display !== 'none',
      fitsOpening: hero.top >= opening.top - 1 && hero.bottom <= opening.bottom + 1
        && stage.top >= opening.top - 1 && stage.bottom <= opening.bottom + 1,
      namedBranches: [...document.querySelectorAll('[data-band-trigger]')]
        .every((button) => Boolean(button.getAttribute('aria-label') || button.textContent.trim())),
      namedNodes: [...document.querySelectorAll('[data-node-id]')]
        .every((button) => Boolean(button.getAttribute('aria-label') || button.textContent.trim())),
      nodes: nodeIds.length,
      oldControls: document.querySelectorAll('[data-stellar-mode], [data-stellar-receipts-toggle], [data-tree-rotate-axis], button[data-tree-zoom]').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      projections: [...document.querySelectorAll('button[data-tree-projection]')]
        .map((button) => ({ label: button.textContent.trim().toLowerCase(), pressed: button.getAttribute('aria-pressed') })),
      removedCopy: ['Reading the scan', 'How my worlds connect', 'NEBULA ARBOR', 'Drag or use arrow keys']
        .filter((text) => bodyText.includes(text)),
      rootBottomMargin: stage.bottom - rootMarker.bottom,
      rows: document.querySelectorAll('.profile-map-evidence tbody tr').length,
      sourceInStage: document.querySelector('#profile-map-evidence').parentElement === document.querySelector('#stellar-spectrum-panel'),
      sourceOpen: document.querySelector('#profile-map-evidence').dataset.panelOpen === 'true',
      stageHeight: stage.height,
      status: document.querySelector('[data-stellar-status]')?.textContent || '',
      toolbar: {
        contained: toolbar.left >= stage.left && toolbar.right <= stage.right
          && toolbar.top >= stage.top && toolbar.bottom <= stage.bottom,
        lowerRight: toolbar.right >= stage.right - 80 && toolbar.bottom >= stage.bottom - 32,
        vertical: getComputedStyle(document.querySelector('.stellar-tree__camera')).flexDirection === 'column',
      },
      typography: {
        assessment: parseFloat(getComputedStyle(document.querySelector('.stellar-calibration h2')).fontSize),
        journal: parseFloat(getComputedStyle(document.querySelector('#about-lab-journal article a.block')).fontSize),
        role: parseFloat(getComputedStyle(document.querySelector('.stellar-light-cone__role h3')).fontSize),
        system: parseFloat(getComputedStyle(document.querySelector('.stellar-systems-ledger__groups li')).fontSize),
      },
      uniqueNodes: new Set(nodeIds).size,
      alignedOpening: Math.abs(hero.top - stage.top) <= 2,
      verticalOverlap: Math.max(0, Math.min(hero.bottom, stage.bottom) - Math.max(hero.top, stage.top)),
    };
  });
  await assert(
    desktopSpectrum.branches === 8
      && desktopSpectrum.nodes === 31
      && desktopSpectrum.uniqueNodes === 31
      && desktopSpectrum.rows === 31
      && desktopSpectrum.status.includes('8 branches · 31 signals'),
    `About nebula canonical counts changed: ${JSON.stringify(desktopSpectrum)}`
  );
  await assert(
    desktopSpectrum.adjacent && desktopSpectrum.verticalOverlap > 0
      && desktopSpectrum.belowTopbar && desktopSpectrum.fitsOpening
      && desktopSpectrum.alignedOpening && desktopSpectrum.stageHeight >= 760
      && desktopSpectrum.rootBottomMargin >= 32,
    `About hero and nebula no longer share the desktop opening: ${JSON.stringify(desktopSpectrum)}`
  );
  await assert(
    desktopSpectrum.overflow <= 0
      && desktopSpectrum.canvas.width > 0
      && desktopSpectrum.canvas.height > 0
      && desktopSpectrum.canvas.backingWidth > 0
      && desktopSpectrum.canvas.backingHeight > 0
      && desktopSpectrum.canvas.hidden === 'true'
      && desktopSpectrum.canvas.coversOpening
      && desktopSpectrum.cameraFinite,
    `Desktop About nebula is missing or overflows: ${JSON.stringify(desktopSpectrum)}`
  );
  await assert(
    desktopSpectrum.controls === 6
      && desktopSpectrum.oldControls === 0
      && desktopSpectrum.removedCopy.length === 0
      && !desktopSpectrum.sourceOpen
      && desktopSpectrum.sourceInStage
      && desktopSpectrum.namedBranches
      && desktopSpectrum.namedNodes
      && desktopSpectrum.toolbar.contained
      && desktopSpectrum.toolbar.lowerRight
      && desktopSpectrum.toolbar.vertical
      && !desktopSpectrum.interactionToggleVisible
      && JSON.stringify(desktopSpectrum.projections.map(({ label }) => label)) === JSON.stringify(['front', 'top', 'free move'])
      && desktopSpectrum.projections.find(({ label }) => label === 'free move')?.pressed === 'true',
    `About retained removed controls/copy or lost accessible names: ${JSON.stringify(desktopSpectrum)}`
  );
  await assert(
    desktopSpectrum.backgrounds.every((color) => color === 'rgb(2, 8, 23)'),
    `Dark About is not one continuous surface: ${JSON.stringify(desktopSpectrum.backgrounds)}`
  );
  await assert(
    desktopSpectrum.typography.assessment >= 32 && desktopSpectrum.typography.assessment <= 44
      && desktopSpectrum.typography.role <= 28
      && desktopSpectrum.typography.journal <= 34
      && desktopSpectrum.typography.system <= 21,
    `About section typography regressed to oversized display scale: ${JSON.stringify(desktopSpectrum.typography)}`
  );

  const idleBefore = await readAboutCamera(page);
  await page.waitForTimeout(700);
  const idleAfter = await readAboutCamera(page);
  const idleMotion = await page.locator('[data-stellar-spectrum]').getAttribute('data-tree-motion');
  await assert(
    idleAfter.view === 'free'
      && Math.abs(idleAfter.yaw - idleBefore.yaw) > 0.003
      && Math.abs(idleAfter.pitch - idleBefore.pitch) < 0.001
      && Math.abs(idleAfter.roll - idleBefore.roll) < 0.001
      && idleMotion === 'idle-rotation',
    `About nebula does not rotate gently while idle: ${JSON.stringify({ idleBefore, idleAfter, idleMotion })}`
  );

  await page.locator('.stellar-tree__root').click();
  const openedSourceIndex = await page.evaluate(() => {
    const details = document.querySelector('#profile-map-evidence');
    const bounds = details.getBoundingClientRect();
    const stage = document.querySelector('#stellar-spectrum-panel').getBoundingClientRect();
    const rootMarker = document.querySelector('.stellar-tree__root');
    return {
      contained: bounds.left >= stage.left && bounds.right <= stage.right
        && bounds.top >= stage.top && bounds.bottom <= stage.bottom,
      expanded: rootMarker.getAttribute('aria-expanded'),
      open: details.dataset.panelOpen === 'true',
      parent: details.parentElement.id,
      rows: details.querySelectorAll('tbody tr').length,
    };
  });
  await assert(
    openedSourceIndex.open
      && openedSourceIndex.contained
      && openedSourceIndex.expanded === 'true'
      && openedSourceIndex.parent === 'stellar-spectrum-panel'
      && openedSourceIndex.rows === 31,
    `The AC base does not open the integrated source table: ${JSON.stringify(openedSourceIndex)}`
  );
  const sourceScrollState = await page.evaluate(() => {
    const body = document.querySelector('#profile-map-evidence .profile-map-evidence__body');
    body.scrollTo({ top: 240, left: 120, behavior: 'instant' });
    return {
      clientHeight: body.clientHeight,
      clientWidth: body.clientWidth,
      scrollHeight: body.scrollHeight,
      scrollLeft: body.scrollLeft,
      scrollTop: body.scrollTop,
      scrollWidth: body.scrollWidth,
      touchAction: getComputedStyle(body).touchAction,
    };
  });
  await assert(
    sourceScrollState.scrollHeight > sourceScrollState.clientHeight
      && sourceScrollState.scrollWidth > sourceScrollState.clientWidth
      && sourceScrollState.scrollTop > 100
      && sourceScrollState.scrollLeft > 50
      && sourceScrollState.touchAction === 'pan-x pan-y',
    `The integrated source table is clipped instead of independently scrollable: ${JSON.stringify(sourceScrollState)}`
  );
  await page.keyboard.press('Escape');
  const closedSourceIndex = await page.evaluate(() => ({
    activeRoot: document.activeElement?.classList.contains('stellar-tree__root'),
    expanded: document.querySelector('.stellar-tree__root').getAttribute('aria-expanded'),
    open: document.querySelector('#profile-map-evidence').dataset.panelOpen === 'true',
  }));
  await assert(
    !closedSourceIndex.open && closedSourceIndex.expanded === 'false' && closedSourceIndex.activeRoot,
    `Closing the integrated source table does not restore the AC base: ${JSON.stringify(closedSourceIndex)}`
  );

  await page.locator('.stellar-tree__root').click();
  await page.locator('#profile-map-evidence > summary').click();
  await page.waitForTimeout(40);
  const summaryClosedSourceIndex = await page.evaluate(() => ({
    activeRoot: document.activeElement?.classList.contains('stellar-tree__root'),
    expanded: document.querySelector('.stellar-tree__root').getAttribute('aria-expanded'),
    open: document.querySelector('#profile-map-evidence').dataset.panelOpen === 'true',
  }));
  await assert(
    !summaryClosedSourceIndex.open
      && summaryClosedSourceIndex.expanded === 'false'
      && summaryClosedSourceIndex.activeRoot,
    `Closing the source table from its summary loses focus: ${JSON.stringify(summaryClosedSourceIndex)}`
  );

  const initialCamera = await readAboutCamera(page);
  const dragPoint = await findAboutCanvasPoint(page);
  await assert(Boolean(dragPoint), 'About nebula has no unobscured drag surface');
  if (dragPoint) {
    await page.mouse.move(dragPoint.x, dragPoint.y);
    await page.mouse.down();
    await page.mouse.move(dragPoint.x + 100, dragPoint.y + 55, { steps: 5 });
    await page.mouse.up();
  }
  const draggedCamera = await readAboutCamera(page);
  await assert(
    Math.abs(draggedCamera.yaw - initialCamera.yaw) > 0.05
      && Math.abs(draggedCamera.pitch - initialCamera.pitch) > 0.03,
    `Dragging does not rotate the About nebula: ${JSON.stringify({ initialCamera, draggedCamera })}`
  );

  const rollPoint = await findAboutCanvasPoint(page);
  await page.keyboard.down('Shift');
  if (rollPoint) {
    await page.mouse.move(rollPoint.x, rollPoint.y);
    await page.mouse.down();
    await page.mouse.move(rollPoint.x + 100, rollPoint.y, { steps: 5 });
    await page.mouse.up();
  }
  await page.keyboard.up('Shift');
  const rolledCamera = await readAboutCamera(page);
  await assert(
    Math.abs(rolledCamera.roll - draggedCamera.roll) > 0.05
      && Math.abs(rolledCamera.yaw - draggedCamera.yaw) < 0.01
      && Math.abs(rolledCamera.pitch - draggedCamera.pitch) < 0.01,
    `Shift-drag does not independently roll the About nebula: ${JSON.stringify({ draggedCamera, rolledCamera })}`
  );

  const canvas = page.locator('.stellar-tree__canvas');
  const zoomBeforePlainWheel = (await readAboutCamera(page)).zoom;
  await canvas.dispatchEvent('wheel', { deltaY: -120 });
  const zoomAfterPlainWheel = (await readAboutCamera(page)).zoom;
  await canvas.dispatchEvent('wheel', { ctrlKey: true, deltaY: -120 });
  const zoomAfterModifiedWheel = (await readAboutCamera(page)).zoom;
  await assert(
    zoomAfterPlainWheel === zoomBeforePlainWheel && zoomAfterModifiedWheel > zoomAfterPlainWheel,
    `About wheel zoom modifier contract failed: ${JSON.stringify({ zoomBeforePlainWheel, zoomAfterPlainWheel, zoomAfterModifiedWheel })}`
  );

  const zoomRange = page.locator('[data-tree-zoom-range]');
  await assert(
    await zoomRange.getAttribute('min') === '40'
      && await zoomRange.getAttribute('max') === '260',
    'About zoom range no longer exposes its full supported interval'
  );
  await zoomRange.fill('40');
  await page.waitForFunction(() => (
    document.querySelector('[data-stellar-spectrum]')?.dataset.treeZoom === '0.400'
  ), undefined, { timeout: 2000 });
  const minimumZoom = (await readAboutCamera(page)).zoom;
  await zoomRange.fill('260');
  await page.waitForTimeout(90);
  const tweenedMaximumState = await page.evaluate(() => ({
    ariaValue: document.querySelector('[data-tree-zoom-range]')?.getAttribute('aria-valuetext'),
    output: document.querySelector('[data-tree-zoom-output]')?.textContent,
    range: document.querySelector('[data-tree-zoom-range]')?.value,
    zoom: Number(document.querySelector('[data-stellar-spectrum]')?.dataset.treeZoom),
  }));
  await page.waitForFunction(() => (
    document.querySelector('[data-stellar-spectrum]')?.dataset.treeZoom === '2.600'
  ), undefined, { timeout: 2000 });
  const maximumZoom = (await readAboutCamera(page)).zoom;
  await assert(
    minimumZoom === 0.4
      && tweenedMaximumState.zoom > minimumZoom
      && tweenedMaximumState.zoom < 1
      && tweenedMaximumState.range === '260'
      && tweenedMaximumState.ariaValue === '260 percent'
      && tweenedMaximumState.output !== '260%'
      && maximumZoom === 2.6,
    `About zoom endpoints or tween are not reachable: ${JSON.stringify({ minimumZoom, tweenedMaximumState, maximumZoom })}`
  );
  await page.waitForFunction(() => (
    document.querySelector('[data-stellar-spectrum]')?.dataset.treeMotion === 'idle-rotation'
  ), undefined, { timeout: 3000 });
  const tweenedIdleNodeId = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-node-id]')];
    const visible = nodes.find((node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.right > 0 && bounds.left < innerWidth && bounds.bottom > 0 && bounds.top < innerHeight;
    });
    return (visible || nodes[0])?.dataset.nodeId;
  });
  const tweenedIdlePositions = [];
  for (let index = 0; index < 10; index += 1) {
    tweenedIdlePositions.push(await page.evaluate((nodeId) => {
      const node = document.querySelector(`[data-node-id="${nodeId}"]`);
      const bounds = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        canvasFrame: document.querySelector('[data-stellar-spectrum]')?.dataset.treeCanvasFrame,
        canvasPixels: Number(document.querySelector('[data-stellar-spectrum]')?.dataset.treeCanvasPixels),
        position: `${bounds.x.toFixed(3)}:${bounds.y.toFixed(3)}`,
        properties: style.transitionProperty,
      };
    }, tweenedIdleNodeId));
    await page.waitForTimeout(20);
  }
  await assert(
    new Set(tweenedIdlePositions.map(({ position }) => position)).size >= 5
      && new Set(tweenedIdlePositions.map(({ canvasFrame }) => canvasFrame)).size >= 3
      && tweenedIdlePositions.every(({ canvasPixels }) => canvasPixels > 0 && canvasPixels <= 1050000)
      && tweenedIdlePositions.every(({ properties }) => properties.includes('left') && properties.includes('top')),
    `About high-zoom idle motion is not interpolated: ${JSON.stringify(tweenedIdlePositions)}`
  );
  await zoomRange.fill('145');
  await page.waitForFunction(() => (
    document.querySelector('[data-stellar-spectrum]')?.dataset.treeZoom === '1.450'
  ), undefined, { timeout: 2000 });
  const rangeState = await page.evaluate(() => ({
    output: document.querySelector('[data-tree-zoom-output]')?.textContent,
    valueText: document.querySelector('[data-tree-zoom-range]')?.getAttribute('aria-valuetext'),
    zoom: Number(document.querySelector('[data-stellar-spectrum]')?.dataset.treeZoom),
  }));
  await assert(
    rangeState.zoom === 1.45 && rangeState.output === '145%' && rangeState.valueText === '145 percent',
    `About zoom range is not synchronized: ${JSON.stringify(rangeState)}`
  );

  await page.locator('#stellar-spectrum-panel').focus();
  const keyboardBefore = await readAboutCamera(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('+');
  const keyboardAfter = await readAboutCamera(page);
  await assert(
    keyboardAfter.yaw !== keyboardBefore.yaw
      && keyboardAfter.roll !== keyboardBefore.roll
      && keyboardAfter.zoom > keyboardBefore.zoom,
    `About keyboard camera controls failed: ${JSON.stringify({ keyboardBefore, keyboardAfter })}`
  );

  await page.locator('button[data-tree-projection="front"]').click();
  const frontState = await page.evaluate(() => ({
    frontPressed: document.querySelector('button[data-tree-projection="front"]')?.getAttribute('aria-pressed'),
    freePressed: document.querySelector('button[data-tree-projection="free"]')?.getAttribute('aria-pressed'),
    topPressed: document.querySelector('button[data-tree-projection="top"]')?.getAttribute('aria-pressed'),
    urlProjection: new URL(location.href).searchParams.get('projection'),
    view: document.querySelector('[data-stellar-spectrum]')?.dataset.treeView,
  }));
  await assert(
    frontState.frontPressed === 'true'
      && frontState.freePressed === 'false'
      && frontState.topPressed === 'false'
      && frontState.urlProjection === 'front'
      && frontState.view === 'front',
    `About front projection state is incomplete: ${JSON.stringify(frontState)}`
  );
  const frontIdleBefore = await page.locator('[data-node-id="android"]').evaluate((element) => ({
    left: parseFloat(element.style.left),
    top: parseFloat(element.style.top),
  }));
  await page.waitForTimeout(700);
  const frontIdleAfter = await page.locator('[data-node-id="android"]').evaluate((element) => ({
    left: parseFloat(element.style.left),
    motion: document.querySelector('[data-stellar-spectrum]').dataset.treeMotion,
    top: parseFloat(element.style.top),
    view: document.querySelector('[data-stellar-spectrum]').dataset.treeView,
  }));
  await assert(
    frontIdleAfter.view === 'front'
      && frontIdleAfter.motion === 'idle-rotation'
      && Math.hypot(frontIdleAfter.left - frontIdleBefore.left, frontIdleAfter.top - frontIdleBefore.top) > 0.03,
    `Front view disables the nebula's idle motion: ${JSON.stringify({ frontIdleBefore, frontIdleAfter })}`
  );

  await page.locator('#stellar-spectrum-panel').focus();
  await page.keyboard.press('ArrowRight');
  const freeFromFront = await page.evaluate(() => ({
    freePressed: document.querySelector('button[data-tree-projection="free"]')?.getAttribute('aria-pressed'),
    urlProjection: new URL(location.href).searchParams.get('projection'),
    view: document.querySelector('[data-stellar-spectrum]')?.dataset.treeView,
  }));
  await assert(
    freeFromFront.freePressed === 'true'
      && freeFromFront.urlProjection === null
      && freeFromFront.view === 'free',
    `Keyboard rotation from Front did not enter Free: ${JSON.stringify(freeFromFront)}`
  );

  await page.locator('button[data-tree-projection="top"]').click();
  const topState = await page.evaluate(() => ({
    freePressed: document.querySelector('button[data-tree-projection="free"]')?.getAttribute('aria-pressed'),
    topPressed: document.querySelector('button[data-tree-projection="top"]')?.getAttribute('aria-pressed'),
    urlProjection: new URL(location.href).searchParams.get('projection'),
    view: document.querySelector('[data-stellar-spectrum]')?.dataset.treeView,
  }));
  await assert(
    topState.topPressed === 'true'
      && topState.freePressed === 'false'
      && topState.urlProjection === 'top'
      && topState.view === 'top',
    `About top projection state is incomplete: ${JSON.stringify(topState)}`
  );
  const topIdleBefore = await page.locator('[data-node-id="android"]').evaluate((element) => ({
    left: parseFloat(element.style.left),
    top: parseFloat(element.style.top),
  }));
  await page.waitForTimeout(700);
  const topIdleAfter = await page.locator('[data-node-id="android"]').evaluate((element) => ({
    left: parseFloat(element.style.left),
    motion: document.querySelector('[data-stellar-spectrum]').dataset.treeMotion,
    top: parseFloat(element.style.top),
    view: document.querySelector('[data-stellar-spectrum]').dataset.treeView,
  }));
  await assert(
    topIdleAfter.view === 'top'
      && topIdleAfter.motion === 'idle-rotation'
      && Math.hypot(topIdleAfter.left - topIdleBefore.left, topIdleAfter.top - topIdleBefore.top) > 0.03,
    `Top view disables the nebula's idle motion: ${JSON.stringify({ topIdleBefore, topIdleAfter })}`
  );
  const topDragPoint = await findAboutCanvasPoint(page);
  if (topDragPoint) {
    await page.mouse.move(topDragPoint.x, topDragPoint.y);
    await page.mouse.down();
    await page.mouse.move(topDragPoint.x + 80, topDragPoint.y + 40, { steps: 5 });
    await page.mouse.up();
  }
  const freeFromTopDrag = await readAboutCamera(page);
  await assert(
    Boolean(topDragPoint)
      && freeFromTopDrag.view === 'free'
      && Math.abs(freeFromTopDrag.pitch - (-Math.PI / 2)) > 0.03,
    `Dragging from Top did not enter a freely rotated view: ${JSON.stringify({ topDragPoint, freeFromTopDrag })}`
  );

  await page.locator('[data-tree-reset]').click();
  const resetCamera = await readAboutCamera(page);
  const resetControls = await page.evaluate(() => ({
    output: document.querySelector('[data-tree-zoom-output]')?.textContent,
    range: document.querySelector('[data-tree-zoom-range]')?.value,
    urlProjection: new URL(location.href).searchParams.get('projection'),
  }));
  await assert(
    resetCamera.view === 'free'
      && Math.abs(resetCamera.yaw - (-0.14)) < 0.001
      && Math.abs(resetCamera.pitch - 0.035) < 0.001
      && Math.abs(resetCamera.roll) < 0.001
      && Math.abs(resetCamera.zoom - 1) < 0.001
      && resetControls.range === '100'
      && resetControls.output === '100%'
      && resetControls.urlProjection === null,
    `About reset does not restore the full camera: ${JSON.stringify({ resetCamera, resetControls })}`
  );

  const surfacesBand = page.locator('[data-band-trigger="engineering:surfaces"]');
  await surfacesBand.click();
  await assert((await page.locator('[data-band-id="engineering:surfaces"] [data-node-id]').count()) === 4,
    'Engineering surfaces branch does not expose its four exact signals');
  const compactBandPopup = await page.evaluate(() => {
    const popup = document.querySelector('[data-stellar-readout]');
    return {
      emptyPersonalContext: Boolean(popup.querySelector('[data-source-context="personal"]')),
      selectedTabs: [...popup.querySelectorAll('[role="tab"][aria-selected="true"]')].map((tab) => tab.getAttribute('aria-label')),
      tabLabels: [...popup.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('aria-label')),
      visiblePanels: [...popup.querySelectorAll('[role="tabpanel"]')].filter((panel) => !panel.hidden).map((panel) => panel.dataset.sourceContext),
      scrollHeight: popup.scrollHeight,
    };
  });
  await assert(
    JSON.stringify(compactBandPopup.tabLabels) === JSON.stringify([
      'Career history, 2 items',
      'Projects, 6 items',
      'Writing, 2 items',
    ])
      && compactBandPopup.selectedTabs[0] === 'Career history, 2 items'
      && compactBandPopup.visiblePanels[0] === 'career'
      && !compactBandPopup.emptyPersonalContext
      && compactBandPopup.scrollHeight < 520,
    `About branch evidence is not compactly tabbed: ${JSON.stringify(compactBandPopup)}`
  );
  await page.locator('[data-stellar-readout] [role="tab"]').first().press('ArrowRight');
  const keyboardSelectedSourceTab = await page.evaluate(() => ({
    activeLabel: document.activeElement?.getAttribute('aria-label'),
    selectedLabel: document.querySelector('[data-stellar-readout] [role="tab"][aria-selected="true"]')?.getAttribute('aria-label'),
    visiblePanels: [...document.querySelectorAll('[data-stellar-readout] [role="tabpanel"]')]
      .filter((panel) => !panel.hidden)
      .map((panel) => panel.dataset.sourceContext),
  }));
  await assert(
    keyboardSelectedSourceTab.activeLabel === 'Projects, 6 items'
      && keyboardSelectedSourceTab.selectedLabel === 'Projects, 6 items'
      && keyboardSelectedSourceTab.visiblePanels[0] === 'projects',
    `About evidence tabs do not follow keyboard selection: ${JSON.stringify(keyboardSelectedSourceTab)}`
  );
  const androidNode = page.locator('[data-band-id="engineering:surfaces"] [data-node-id="android"]');
  await androidNode.click();
  const selectedAndroid = await page.evaluate(() => {
    const url = new URL(location.href);
    const popup = document.querySelector('[data-stellar-readout]');
    const popupBounds = popup.getBoundingClientRect();
    const stageBounds = document.querySelector('#stellar-spectrum-panel').getBoundingClientRect();
    const nodeBounds = document.querySelector('[data-node-id="android"]').getBoundingClientRect();
    const horizontalDistance = Math.max(nodeBounds.left - popupBounds.right, popupBounds.left - nodeBounds.right, 0);
    const verticalDistance = Math.max(nodeBounds.top - popupBounds.bottom, popupBounds.top - nodeBounds.bottom, 0);
    return {
      band: url.searchParams.get('band'),
      contained: popupBounds.left >= stageBounds.left - 1
        && popupBounds.right <= stageBounds.right + 1
        && popupBounds.top >= stageBounds.top - 1
        && popupBounds.bottom <= stageBounds.bottom + 1,
      directSources: [...popup.querySelectorAll('.stellar-spectrum__source-grid .stellar-spectrum__source-link')]
        .map((link) => link.getAttribute('href')).sort(),
      hash: url.hash,
      hidden: popup.hidden,
      modal: popup.getAttribute('aria-modal'),
      node: url.searchParams.get('node'),
      placement: popup.dataset.placement,
      primaryRows: document.querySelectorAll('.profile-map-evidence tbody tr.is-stellar-primary').length,
      relatedCareer: document.querySelectorAll('[data-stellar-surface="career"].is-stellar-related').length,
      relatedStack: document.querySelectorAll('[data-stellar-surface="stack"].is-stellar-related').length,
      role: popup.getAttribute('role'),
      sourceOpen: document.querySelector('#profile-map-evidence').dataset.panelOpen === 'true',
      title: popup.querySelector('h3')?.textContent || '',
      distance: Math.hypot(horizontalDistance, verticalDistance),
    };
  });
  await assert(
    selectedAndroid.band === 'engineering:surfaces'
      && selectedAndroid.node === 'android'
      && selectedAndroid.hash === '#profile-map'
      && selectedAndroid.title === 'Android'
      && !selectedAndroid.hidden
      && selectedAndroid.role === 'dialog'
      && selectedAndroid.modal === 'false'
      && selectedAndroid.primaryRows === 1
      && selectedAndroid.relatedCareer > 0
      && selectedAndroid.relatedStack > 0
      && !selectedAndroid.sourceOpen
      && selectedAndroid.contained
      && Boolean(selectedAndroid.placement)
      && selectedAndroid.distance < 220,
    `About Android evidence popup is incomplete or detached: ${JSON.stringify(selectedAndroid)}`
  );
  await assert(
    JSON.stringify(selectedAndroid.directSources) === JSON.stringify(androidEvidenceUrls),
    `About Android popup receipts differ from canonical profile data: ${JSON.stringify(selectedAndroid.directSources)}`
  );
  const relationshipTab = page.locator('[data-stellar-readout] [role="tab"][aria-controls$="-relationships"]');
  await assert((await relationshipTab.count()) === 1, 'About Android popup does not expose relationships as a compact tab');
  await relationshipTab.click();
  const selectedRelationships = await page.evaluate(() => ({
    activeContext: document.querySelector('[data-stellar-readout] [role="tabpanel"]:not([hidden])')?.dataset.sourceContext,
    relationshipCount: document.querySelectorAll('[data-stellar-readout] [role="tabpanel"]:not([hidden]) .stellar-spectrum__relationship').length,
    visiblePanels: document.querySelectorAll('[data-stellar-readout] [role="tabpanel"]:not([hidden])').length,
  }));
  await assert(
    selectedRelationships.activeContext === 'relationships'
      && selectedRelationships.relationshipCount > 0
      && selectedRelationships.visiblePanels === 1,
    `About relationship tab is not synchronized with its panel: ${JSON.stringify(selectedRelationships)}`
  );
  await page.keyboard.press('Escape');
  const dismissedAndroid = await page.evaluate(() => ({
    activeNode: document.activeElement?.dataset?.nodeId,
    band: new URL(location.href).searchParams.get('band'),
    hidden: document.querySelector('[data-stellar-readout]').hidden,
    node: new URL(location.href).searchParams.get('node'),
  }));
  await assert(
    dismissedAndroid.activeNode === 'android'
      && dismissedAndroid.band === null
      && dismissedAndroid.node === null
      && dismissedAndroid.hidden,
    `Escape does not close and restore focus from the About popup: ${JSON.stringify(dismissedAndroid)}`
  );

  await mobilePage.goto(BASE_URL + '/about.html', { waitUntil: 'domcontentloaded' });
  await mobilePage.waitForSelector('.stellar-spectrum--enhanced', { timeout: 15000 });
  const mobileSpectrum = await mobilePage.evaluate(() => {
    const hero = document.querySelector('#present-origin').getBoundingClientRect();
    const stage = document.querySelector('#stellar-spectrum-panel').getBoundingClientRect();
    const opening = document.querySelector('.about-opening').getBoundingClientRect();
    const toolbar = document.querySelector('.stellar-tree__toolbar').getBoundingClientRect();
    const rootMarker = document.querySelector('.stellar-tree__root').getBoundingClientRect();
    const canvas = document.querySelector('.stellar-tree__canvas').getBoundingClientRect();
    const controls = [...document.querySelectorAll(
      'button[data-tree-projection], [data-tree-interaction-toggle], [data-tree-reset], [data-about-theme-toggle], [data-tree-zoom-range], [data-band-trigger], [data-node-id]'
    )].filter((element) => !element.hidden && getComputedStyle(element).display !== 'none');
    const lock = document.querySelector('[data-tree-interaction-toggle]');
    const sourcePanel = document.querySelector('#profile-map-evidence');
    const routeMap = document.querySelector('[data-universe-route-map]');
    const routeMapBounds = routeMap.getBoundingClientRect();
    const routeMapLinks = [...routeMap.querySelectorAll('a')].map((link) => link.getBoundingClientRect());
    const profileMap = document.querySelector('#profile-map').getBoundingClientRect();
    const lockIcon = lock.querySelector('.stellar-tree__lock-icon--closed').getBoundingClientRect();
    const resetIcon = document.querySelector('.stellar-tree__reset > [aria-hidden="true"]').getBoundingClientRect();
    const themeIcon = document.querySelector('.about-theme-toggle > [aria-hidden="true"]').getBoundingClientRect();
    return {
      branches: document.querySelectorAll('[data-band-trigger]').length,
      canvasCoversScene: canvas.left <= 0 && canvas.right >= document.documentElement.clientWidth
        && canvas.top <= opening.top + 1
        && canvas.bottom >= opening.bottom + innerHeight * 0.9,
      clientWidth: document.documentElement.clientWidth,
      minimumControlHeight: Math.min(...controls.map((element) => element.getBoundingClientRect().height)),
      interaction: document.querySelector('[data-stellar-spectrum]').dataset.treeInteraction,
      lockLabel: lock.getAttribute('aria-label'),
      lockPressed: lock.getAttribute('aria-pressed'),
      lockVisible: getComputedStyle(lock).display !== 'none',
      lockIconSize: Math.min(lockIcon.width, lockIcon.height),
      resetIconSize: Math.min(resetIcon.width, resetIcon.height),
      themeIconSize: Math.min(themeIcon.width, themeIcon.height),
      pointerEvents: getComputedStyle(document.querySelector('.stellar-tree__canvas')).pointerEvents,
      routeMapContained: routeMapBounds.left >= profileMap.left - 1
        && routeMapBounds.right <= profileMap.right + 1
        && routeMapBounds.top >= stage.bottom - 1
        && routeMapBounds.bottom <= profileMap.bottom + 1,
      routeMapMode: routeMap.dataset.universeRouteMapMode,
      routeMapParent: routeMap.parentElement?.id,
      routeMapPosition: getComputedStyle(routeMap).position,
      routeMapVerticalSpread: Math.max(...routeMapLinks.map((link) => link.top))
        - Math.min(...routeMapLinks.map((link) => link.top)),
      touchAction: getComputedStyle(document.querySelector('.stellar-tree__canvas')).touchAction,
      nodes: document.querySelectorAll('[data-node-id]').length,
      rootBottomMargin: stage.bottom - rootMarker.bottom,
      scrollWidth: document.documentElement.scrollWidth,
      sourcePanelDisplay: getComputedStyle(sourcePanel).display,
      sourcePanelOpen: sourcePanel.dataset.panelOpen,
      stacked: stage.top >= hero.bottom - 1,
      toolbarContained: toolbar.left >= stage.left && toolbar.right <= stage.right
        && toolbar.top >= stage.top && toolbar.bottom <= stage.bottom,
      toolbarLowerRight: toolbar.right >= stage.right - 64 && toolbar.bottom >= stage.bottom - 120,
      verticalControls: getComputedStyle(document.querySelector('.stellar-tree__camera')).flexDirection === 'column',
    };
  });
  await assert(
    mobileSpectrum.scrollWidth <= mobileSpectrum.clientWidth
      && mobileSpectrum.minimumControlHeight >= 44
      && mobileSpectrum.branches === 8
      && mobileSpectrum.nodes === 31
      && mobileSpectrum.stacked
      && mobileSpectrum.canvasCoversScene
      && mobileSpectrum.rootBottomMargin >= 24
      && mobileSpectrum.toolbarContained
      && mobileSpectrum.toolbarLowerRight
      && mobileSpectrum.verticalControls
      && mobileSpectrum.interaction === 'locked'
      && mobileSpectrum.lockPressed === 'true'
      && mobileSpectrum.lockLabel === 'Unlock stellar tree interaction'
      && mobileSpectrum.lockVisible
      && mobileSpectrum.lockIconSize >= 20
      && mobileSpectrum.resetIconSize >= 20
      && mobileSpectrum.themeIconSize >= 20
      && mobileSpectrum.pointerEvents === 'none'
      && mobileSpectrum.touchAction === 'pan-y'
      && mobileSpectrum.routeMapMode === 'integrated'
      && mobileSpectrum.routeMapParent === 'profile-map'
      && mobileSpectrum.routeMapPosition === 'absolute'
      && mobileSpectrum.routeMapContained
      && mobileSpectrum.routeMapVerticalSpread > 70
      && mobileSpectrum.sourcePanelOpen === 'false'
      && mobileSpectrum.sourcePanelDisplay === 'none',
    `Mobile About nebula containment/targets failed: ${JSON.stringify(mobileSpectrum)}`
  );

  await mobilePage.locator('button[data-tree-projection="front"]').click();
  const mobileLockedFrontBefore = await mobilePage.locator('[data-node-id="android"]').evaluate((element) => ({
    left: parseFloat(element.style.left),
    top: parseFloat(element.style.top),
  }));
  await mobilePage.waitForTimeout(700);
  const mobileLockedFrontAfter = await mobilePage.locator('[data-node-id="android"]').evaluate((element) => ({
    interaction: document.querySelector('[data-stellar-spectrum]').dataset.treeInteraction,
    left: parseFloat(element.style.left),
    motion: document.querySelector('[data-stellar-spectrum]').dataset.treeMotion,
    top: parseFloat(element.style.top),
    view: document.querySelector('[data-stellar-spectrum]').dataset.treeView,
  }));
  await assert(
    mobileLockedFrontAfter.interaction === 'locked'
      && mobileLockedFrontAfter.view === 'front'
      && mobileLockedFrontAfter.motion === 'idle-rotation'
      && Math.hypot(
        mobileLockedFrontAfter.left - mobileLockedFrontBefore.left,
        mobileLockedFrontAfter.top - mobileLockedFrontBefore.top
      ) > 0.02,
    `Mobile lock or Front selection disables idle animation: ${JSON.stringify({ mobileLockedFrontBefore, mobileLockedFrontAfter })}`
  );
  // The authored idle rotation intentionally keeps every node moving. Force the
  // pointer click so Playwright does not wait forever for a stable bounding box.
  await mobilePage.locator('[data-node-id="android"]').click({ force: true });
  const mobilePopup = await mobilePage.evaluate(() => {
    const popup = document.querySelector('[data-stellar-readout]');
    const url = new URL(location.href);
    const selectedNode = url.searchParams.get('node');
    const selectedBand = url.searchParams.get('band');
    const target = selectedNode
      ? document.querySelector(`[data-node-id="${CSS.escape(selectedNode)}"]`)
      : document.querySelector(`[data-band-trigger="${CSS.escape(selectedBand || '')}"]`);
    const bounds = popup.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const close = popup.querySelector('.stellar-tree__popup-close').getBoundingClientRect();
    const sourceTabs = [...popup.querySelectorAll('[role="tab"]')];
    const visibleSourceLinks = [...popup.querySelectorAll('[role="tabpanel"]:not([hidden]) .stellar-spectrum__source-link')];
    const firstSourceLink = visibleSourceLinks[0];
    const firstSourceBounds = firstSourceLink?.getBoundingClientRect();
    const sourcePointTarget = firstSourceBounds
      ? document.elementFromPoint(firstSourceBounds.left + firstSourceBounds.width / 2, firstSourceBounds.top + firstSourceBounds.height / 2)
      : null;
    const overlapWidth = Math.max(0, Math.min(bounds.right, targetBounds.right) - Math.max(bounds.left, targetBounds.left));
    const overlapHeight = Math.max(0, Math.min(bounds.bottom, targetBounds.bottom) - Math.max(bounds.top, targetBounds.top));
    const horizontalDistance = Math.max(targetBounds.left - bounds.right, bounds.left - targetBounds.right, 0);
    const verticalDistance = Math.max(targetBounds.top - bounds.bottom, bounds.top - targetBounds.bottom, 0);
    return {
      bottom: bounds.bottom,
      closeHeight: close.height,
      closeWidth: close.width,
      hidden: popup.hidden,
      left: bounds.left,
      minimumSourceLinkHeight: Math.min(...visibleSourceLinks.map((link) => link.getBoundingClientRect().height)),
      minimumSourceTabHeight: Math.min(...sourceTabs.map((tab) => tab.getBoundingClientRect().height)),
      targetDistance: Math.hypot(horizontalDistance, verticalDistance),
      targetOverlap: overlapWidth * overlapHeight,
      placement: popup.dataset.placement,
      position: getComputedStyle(popup).position,
      overflowY: getComputedStyle(popup).overflowY,
      right: bounds.right,
      sourceLinkTopmost: Boolean(firstSourceLink && sourcePointTarget && firstSourceLink.contains(sourcePointTarget)),
      top: bounds.top,
      viewportHeight: innerHeight,
      viewportWidth: innerWidth,
    };
  });
  await assert(
    !mobilePopup.hidden
      && mobilePopup.left >= 0
      && mobilePopup.right <= mobilePopup.viewportWidth
      && mobilePopup.top >= 0
      && mobilePopup.bottom <= mobilePopup.viewportHeight
      && mobilePopup.closeHeight >= 44
      && mobilePopup.closeWidth >= 44
      && mobilePopup.minimumSourceLinkHeight >= 43.5
      && mobilePopup.minimumSourceTabHeight >= 43.5
      && mobilePopup.position === 'absolute'
      && mobilePopup.overflowY === 'auto'
      && Boolean(mobilePopup.placement)
      && mobilePopup.targetOverlap < 1
      && mobilePopup.targetDistance < 80
      && mobilePopup.sourceLinkTopmost,
    `Mobile About popup is clipped or has a small close target: ${JSON.stringify(mobilePopup)}`
  );
  await mobilePage.locator('.stellar-tree__popup-close').click();

  const touchAboutContext = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const touchAboutPage = await touchAboutContext.newPage();
  await touchAboutPage.goto(BASE_URL + '/about.html', { waitUntil: 'domcontentloaded' });
  await touchAboutPage.waitForSelector('.stellar-spectrum--enhanced', { timeout: 15000 });
  const lockedTouchSurface = await touchAboutPage.evaluate(() => {
    const stage = document.querySelector('#stellar-spectrum-panel');
    const stageTop = stage.getBoundingClientRect().top + scrollY;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const scrollRunway = 220;
    scrollTo(0, Math.max(0, Math.min(stageTop + 80, maxScroll - scrollRunway)));
    const canvas = document.querySelector('.stellar-tree__canvas');
    const lock = document.querySelector('[data-tree-interaction-toggle]');
    return {
      interaction: document.querySelector('[data-stellar-spectrum]').dataset.treeInteraction,
      lockPressed: lock.getAttribute('aria-pressed'),
      maxScroll,
      pointerEvents: getComputedStyle(canvas).pointerEvents,
      scrollY,
      touchAction: getComputedStyle(canvas).touchAction,
    };
  });
  const lockedScrollPoint = await touchAboutPage.evaluate(() => {
    const stage = document.querySelector('#stellar-spectrum-panel').getBoundingClientRect();
    for (let y = Math.max(80, stage.top + 80); y < Math.min(innerHeight - 80, stage.bottom - 80); y += 40) {
      for (let x = Math.max(40, stage.left + 40); x < Math.min(innerWidth - 70, stage.right - 70); x += 40) {
        const target = document.elementFromPoint(x, y);
        if (target && !target.closest('button, a, input, summary')) return { x, y };
      }
    }
    return null;
  });
  await assert(Boolean(lockedScrollPoint), 'Locked mobile About has no pass-through scroll surface');
  const cdp = await touchAboutContext.newCDPSession(touchAboutPage);
  if (lockedScrollPoint) {
    const start = { id: 1, x: lockedScrollPoint.x, y: lockedScrollPoint.y };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ ...start, y: Math.max(40, start.y - 180) }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await touchAboutPage.waitForTimeout(220);
  const lockedScrollAfter = await touchAboutPage.evaluate(() => ({
    rotated: document.querySelector('.stellar-tree__canvas').dataset.rotated || '',
    scrollY,
  }));
  await assert(
    lockedTouchSurface.interaction === 'locked'
      && lockedTouchSurface.lockPressed === 'true'
      && lockedTouchSurface.pointerEvents === 'none'
      && lockedTouchSurface.touchAction === 'pan-y'
      // Headless Linux may commit only one scroll frame for this synthetic
      // touch gesture; any positive movement proves the locked canvas yields
      // the gesture to page scrolling while the rotation check guards intent.
      && lockedScrollAfter.scrollY > lockedTouchSurface.scrollY
      && lockedScrollAfter.rotated === '',
    `Locked mobile nebula prevents page scrolling or rotates anyway: ${JSON.stringify({ lockedTouchSurface, lockedScrollAfter })}`
  );

  await touchAboutPage.locator('.stellar-tree__root').click();
  const mobileSourceScrollPoint = await touchAboutPage.evaluate(() => {
    const body = document.querySelector('#profile-map-evidence .profile-map-evidence__body');
    const bounds = body.getBoundingClientRect();
    return {
      x: bounds.left + Math.min(bounds.width - 30, Math.max(40, bounds.width * 0.45)),
      y: bounds.top + Math.min(bounds.height - 40, Math.max(160, bounds.height * 0.72)),
    };
  });
  const mobileSourceStart = { id: 2, ...mobileSourceScrollPoint };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [mobileSourceStart] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...mobileSourceStart, y: Math.max(80, mobileSourceStart.y - 180) }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touchAboutPage.waitForTimeout(180);
  const mobileSourceAfterSwipe = await touchAboutPage.evaluate(() => {
    const body = document.querySelector('#profile-map-evidence .profile-map-evidence__body');
    const panel = document.querySelector('#profile-map-evidence');
    const panelBounds = panel.getBoundingClientRect();
    return {
      bottomClearance: innerHeight - panelBounds.bottom,
      clientHeight: body.clientHeight,
      open: panel.dataset.panelOpen,
      scrollHeight: body.scrollHeight,
      scrollTop: body.scrollTop,
    };
  });
  await assert(
    mobileSourceAfterSwipe.open === 'true'
      && mobileSourceAfterSwipe.scrollHeight > mobileSourceAfterSwipe.clientHeight
      && mobileSourceAfterSwipe.scrollTop > 30
      && mobileSourceAfterSwipe.bottomClearance >= 0,
    `The mobile source index does not respond to touch scrolling: ${JSON.stringify(mobileSourceAfterSwipe)}`
  );
  const mobileSourceDismissPoint = await touchAboutPage.evaluate(() => {
    const panel = document.querySelector('#profile-map-evidence').getBoundingClientRect();
    const backdrop = document.querySelector('[data-source-dismiss]').getBoundingClientRect();
    const x = Math.min(backdrop.right - 12, panel.right + 28);
    const y = Math.min(backdrop.bottom - 40, Math.max(backdrop.top + 80, panel.top + 100));
    const target = document.elementFromPoint(x, y);
    return { isBackdrop: Boolean(target?.matches('[data-source-dismiss]')), x, y };
  });
  await assert(mobileSourceDismissPoint.isBackdrop, `The source index has no outside-tap dismissal surface: ${JSON.stringify(mobileSourceDismissPoint)}`);
  const mobileSourceDismissTouch = { id: 3, x: mobileSourceDismissPoint.x, y: mobileSourceDismissPoint.y };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [mobileSourceDismissTouch] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touchAboutPage.waitForTimeout(100);
  const mobileSourceDismissed = await touchAboutPage.evaluate(() => ({
    backdropHidden: document.querySelector('[data-source-dismiss]').hidden,
    open: document.querySelector('#profile-map-evidence').dataset.panelOpen,
  }));
  await assert(
    mobileSourceDismissed.open === 'false' && mobileSourceDismissed.backdropHidden,
    `Touching outside the mobile source index does not dismiss it: ${JSON.stringify(mobileSourceDismissed)}`
  );

  await touchAboutPage.locator('[data-tree-interaction-toggle]').click();
  await touchAboutPage.locator('#stellar-spectrum-panel').evaluate((element) => {
    element.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await touchAboutPage.waitForTimeout(100);
  const unlockedTouchSurface = await touchAboutPage.evaluate(() => {
    const canvas = document.querySelector('.stellar-tree__canvas');
    const lock = document.querySelector('[data-tree-interaction-toggle]');
    return {
      interaction: document.querySelector('[data-stellar-spectrum]').dataset.treeInteraction,
      label: lock.getAttribute('aria-label'),
      lockPressed: lock.getAttribute('aria-pressed'),
      pointerEvents: getComputedStyle(canvas).pointerEvents,
      touchAction: getComputedStyle(canvas).touchAction,
    };
  });
  const touchSurface = await findAboutCanvasPair(touchAboutPage);
  const touchPair = touchSurface.pair;
  await assert(Boolean(touchPair), `About nebula has no unobscured two-touch surface: ${JSON.stringify(touchSurface.diagnostics)}`);
  if (touchPair) {
    const touchBefore = await readAboutCamera(touchAboutPage);
    const firstTouch = { id: 1, ...touchPair[0] };
    const secondTouch = { id: 2, ...touchPair[1] };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [firstTouch, secondTouch] });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { id: 1, x: firstTouch.x - 20, y: firstTouch.y - 20 },
        { id: 2, x: secondTouch.x + 55, y: secondTouch.y + 42 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const touchAfter = await readAboutCamera(touchAboutPage);
    await assert(
      unlockedTouchSurface.interaction === 'unlocked'
        && unlockedTouchSurface.lockPressed === 'false'
        && unlockedTouchSurface.label === 'Lock stellar tree interaction'
        && unlockedTouchSurface.pointerEvents === 'auto'
        && unlockedTouchSurface.touchAction === 'none'
        && touchAfter.zoom > touchBefore.zoom
        && Math.abs(touchAfter.roll - touchBefore.roll) > 0.05,
      `Unlocked mobile About does not enable pinch/twist: ${JSON.stringify({ unlockedTouchSurface, touchBefore, touchAfter })}`
    );
  }
  await touchAboutContext.close();

  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const printableSources = await page.evaluate(() => ({
    detailsOpen: document.querySelector('#profile-map-evidence').open,
    rows: [...document.querySelectorAll('.profile-map-evidence tbody tr')]
      .filter((row) => row.getBoundingClientRect().height > 0 && getComputedStyle(row).display !== 'none').length,
    stageDisplay: getComputedStyle(document.querySelector('#stellar-spectrum-panel')).display,
  }));
  await assert(
    printableSources.detailsOpen
      && printableSources.rows === 31
      && printableSources.stageDisplay !== 'none',
    `Enhanced About hides exact sources in print: ${JSON.stringify(printableSources)}`
  );
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });

  const themedAboutContext = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });
  const themedAboutPage = await themedAboutContext.newPage();
  await themedAboutPage.goto(BASE_URL + '/about.html', { waitUntil: 'domcontentloaded' });
  await themedAboutPage.waitForSelector('.stellar-spectrum--enhanced', { timeout: 15000 });
  const readAboutTheme = () => themedAboutPage.evaluate(() => ({
    backgrounds: ['html', 'body', '#site-topbar', '#main-content', '.stellar-tree__viewport', '#site-footer']
      .map((selector) => getComputedStyle(document.querySelector(selector)).backgroundColor),
    classDark: document.documentElement.classList.contains('dark'),
    label: document.querySelector('[data-about-theme-toggle]').getAttribute('aria-label'),
    pressed: document.querySelector('[data-about-theme-toggle]').getAttribute('aria-pressed'),
    saved: localStorage.getItem('about-theme'),
    theme: document.documentElement.dataset.aboutTheme,
    transparentAssessment: [...document.querySelectorAll('.stellar-calibration-note, .stellar-calibration__card')]
      .every((element) => getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)'),
  }));
  const defaultTheme = await readAboutTheme();
  await assert(
    defaultTheme.theme === 'dark'
      && defaultTheme.classDark
      && defaultTheme.pressed === 'false'
      && defaultTheme.label === 'Use light theme'
      && defaultTheme.backgrounds.every((color) => color === 'rgb(2, 8, 23)')
      && defaultTheme.transparentAssessment,
    `About does not default to one dark surface: ${JSON.stringify(defaultTheme)}`
  );
  await themedAboutPage.locator('[data-about-theme-toggle]').click();
  const lightTheme = await readAboutTheme();
  await assert(
    lightTheme.theme === 'light'
      && !lightTheme.classDark
      && lightTheme.pressed === 'true'
      && lightTheme.label === 'Use dark theme'
      && lightTheme.saved === 'light'
      && lightTheme.backgrounds.every((color) => color === 'rgb(245, 247, 251)')
      && lightTheme.transparentAssessment,
    `About light theme is not one continuous surface: ${JSON.stringify(lightTheme)}`
  );
  await themedAboutPage.reload({ waitUntil: 'domcontentloaded' });
  await themedAboutPage.waitForSelector('.stellar-spectrum--enhanced', { timeout: 15000 });
  await assert((await readAboutTheme()).theme === 'light', 'About theme choice does not survive reload');
  await themedAboutContext.close();

  const reducedAboutContext = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
  const reducedAboutPage = await reducedAboutContext.newPage();
  await reducedAboutPage.goto(BASE_URL + '/about.html', { waitUntil: 'domcontentloaded' });
  await reducedAboutPage.waitForSelector('.stellar-spectrum--enhanced', { timeout: 15000 });
  const reducedAboutBefore = await reducedAboutPage.evaluate(() => ({
    camera: ['treeYaw', 'treePitch', 'treeRoll', 'treeZoom']
      .map((key) => document.querySelector('[data-stellar-spectrum]').dataset[key]),
    controls: [...document.querySelectorAll('[data-band-trigger], [data-node-id]')]
      .map((element) => [element.style.left, element.style.top]),
  }));
  await reducedAboutPage.waitForTimeout(500);
  const reducedAboutAfter = await reducedAboutPage.evaluate(() => ({
    camera: ['treeYaw', 'treePitch', 'treeRoll', 'treeZoom']
      .map((key) => document.querySelector('[data-stellar-spectrum]').dataset[key]),
    controls: [...document.querySelectorAll('[data-band-trigger], [data-node-id]')]
      .map((element) => [element.style.left, element.style.top]),
    scanning: document.querySelector('#stellar-spectrum-panel').classList.contains('is-scanning'),
  }));
  await assert(
    JSON.stringify(reducedAboutBefore.camera) === JSON.stringify(reducedAboutAfter.camera)
      && JSON.stringify(reducedAboutBefore.controls) === JSON.stringify(reducedAboutAfter.controls)
      && !reducedAboutAfter.scanning,
    `Reduced-motion About moves while idle: ${JSON.stringify({ reducedAboutBefore, reducedAboutAfter })}`
  );
  await reducedAboutPage.locator('[data-tree-zoom-range]').fill('130');
  await reducedAboutPage.locator('[data-node-id="android"]').click();
  await assert(
    (await readAboutCamera(reducedAboutPage)).zoom === 1.3
      && await reducedAboutPage.locator('[data-stellar-readout]').isVisible(),
    'Reduced-motion About disables manual zoom or evidence popup'
  );
  await reducedAboutContext.close();

  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const noJsAboutContext = await browser.newContext({ javaScriptEnabled: false, viewport });
    const noJsAboutPage = await noJsAboutContext.newPage();
    const response = await noJsAboutPage.goto(BASE_URL + '/about.html', { waitUntil: 'domcontentloaded' });
    const noJsAbout = await noJsAboutPage.evaluate(() => {
      const bodyText = document.body.textContent || '';
      return {
        fallbackGroups: document.querySelectorAll('.stellar-spectrum__fallback-group').length,
        fallbackSignals: document.querySelectorAll('.stellar-spectrum__fallback-group li').length,
        heroVisible: document.querySelector('#about-title').getBoundingClientRect().height > 0,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        removedCopy: ['Reading the scan', 'How my worlds connect', 'NEBULA ARBOR', 'Drag or use arrow keys']
          .filter((text) => bodyText.includes(text)),
        rows: document.querySelectorAll('.profile-map-evidence tbody tr').length,
        sourceOpen: document.querySelector('#profile-map-evidence').open,
        stageHidden: document.querySelector('#stellar-spectrum-panel').hidden,
      };
    });
    await noJsAboutPage.locator('#profile-map-evidence > summary').click();
    const noJsSourceOpened = await noJsAboutPage.evaluate(() => ({
      open: document.querySelector('#profile-map-evidence').open,
      visibleRows: [...document.querySelectorAll('.profile-map-evidence tbody tr')]
        .filter((row) => row.getBoundingClientRect().height > 0).length,
    }));
    await assert(
      response && response.status() >= 200 && response.status() < 400
        && noJsAbout.heroVisible
        && noJsAbout.stageHidden
        && noJsAbout.fallbackGroups === 8
        && noJsAbout.fallbackSignals === 31
        && noJsAbout.rows === 31
        && !noJsAbout.sourceOpen
        && noJsSourceOpened.open
        && noJsSourceOpened.visibleRows === 31
        && noJsAbout.removedCopy.length === 0
        && noJsAbout.overflow <= 0,
      `No-JavaScript About contract failed at ${viewport.width}x${viewport.height}: ${JSON.stringify(noJsAbout)}`
    );
    await noJsAboutContext.close();
  }

  const themeTransitionContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const themeTransitionPage = await themeTransitionContext.newPage();
  await themeTransitionPage.goto(BASE_URL + '/work.html', { waitUntil: 'domcontentloaded' });
  await themeTransitionPage.evaluate(() => {
    localStorage.removeItem('about-theme');
    sessionStorage.clear();
  });
  await themeTransitionPage.reload({ waitUntil: 'domcontentloaded' });
  const toAboutStarted = Date.now();
  const toAboutTransition = await themeTransitionPage.evaluate(() => {
    document.querySelector('#site-nav a[href="/about.html"]').click();
    return {
      mode: document.documentElement.dataset.themeTransition,
      overlay: Boolean(document.querySelector('.universe-theme-wash')),
      path: location.pathname,
    };
  });
  await assert(
    toAboutTransition.path === '/work.html'
      && toAboutTransition.mode === 'to-about'
      && toAboutTransition.overlay,
    `Light-to-About transition does not ease into the dark surface: ${JSON.stringify(toAboutTransition)}`
  );
  await themeTransitionPage.waitForURL('**/about.html', { timeout: 5000, waitUntil: 'commit' });
  await assert(Date.now() - toAboutStarted < 500, 'Light-to-About navigation is artificially delayed');
  const arrivedAboutHandle = await themeTransitionPage.waitForFunction(() => {
    if (document.documentElement.dataset.themeTransition !== 'arrive-about') return false;
    return {
      overlay: Boolean(document.querySelector('.universe-theme-wash')),
      theme: document.documentElement.dataset.aboutTheme,
    };
  });
  const arrivedAbout = await arrivedAboutHandle.jsonValue();
  await assert(arrivedAbout.overlay && arrivedAbout.theme === 'dark',
    `About arrival does not continue the dark gradient: ${JSON.stringify(arrivedAbout)}`);
  await themeTransitionPage.waitForFunction(() => !document.querySelector('.universe-theme-wash'), { timeout: 1200 });

  const fromAboutStarted = Date.now();
  const fromAboutTransition = await themeTransitionPage.evaluate(() => {
    document.querySelector('#site-nav a[href="/work.html"]').click();
    return {
      mode: document.documentElement.dataset.themeTransition,
      overlay: Boolean(document.querySelector('.universe-theme-wash')),
      path: location.pathname,
    };
  });
  await assert(
    fromAboutTransition.path === '/about.html'
      && fromAboutTransition.mode === 'from-about'
      && fromAboutTransition.overlay,
    `About-to-light transition does not ease into the light surface: ${JSON.stringify(fromAboutTransition)}`
  );
  await themeTransitionPage.waitForURL('**/work.html', { timeout: 5000, waitUntil: 'commit' });
  await assert(Date.now() - fromAboutStarted < 500, 'About-to-light navigation is artificially delayed');
  const arrivedLightHandle = await themeTransitionPage.waitForFunction(() => (
    document.documentElement.dataset.themeTransition === 'arrive-light'
      && Boolean(document.querySelector('.universe-theme-wash'))
  ));
  await assert(Boolean(await arrivedLightHandle.jsonValue()), 'Light arrival did not continue the route gradient');
  await themeTransitionPage.waitForFunction(() => !document.querySelector('.universe-theme-wash'), { timeout: 1200 });

  await themeTransitionPage.evaluate(() => localStorage.setItem('about-theme', 'light'));
  const sameSurfaceStarted = Date.now();
  await themeTransitionPage.evaluate(() => document.querySelector('#site-nav a[href="/about.html"]').click());
  await themeTransitionPage.waitForURL('**/about.html', { timeout: 5000, waitUntil: 'domcontentloaded' });
  const sameSurfaceTransition = await themeTransitionPage.evaluate(() => ({
    mode: document.documentElement.dataset.themeTransition || null,
    overlay: Boolean(document.querySelector('.universe-theme-wash')),
    theme: document.documentElement.dataset.aboutTheme,
  }));
  sameSurfaceTransition.elapsed = Date.now() - sameSurfaceStarted;
  await assert(
    sameSurfaceTransition.mode === null
      && !sameSurfaceTransition.overlay
      && sameSurfaceTransition.theme === 'light',
    `A saved light About theme still creates a cross-theme transition: ${JSON.stringify(sameSurfaceTransition)}`
  );
  await themeTransitionContext.close();

  const reducedTransitionContext = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
  const reducedTransitionPage = await reducedTransitionContext.newPage();
  await reducedTransitionPage.goto(BASE_URL + '/work.html', { waitUntil: 'domcontentloaded' });
  await reducedTransitionPage.evaluate(() => {
    localStorage.removeItem('about-theme');
    document.querySelector('#site-nav a[href="/about.html"]').click();
  });
  await reducedTransitionPage.waitForURL('**/about.html', { timeout: 5000, waitUntil: 'domcontentloaded' });
  await assert(
    await reducedTransitionPage.locator('.universe-theme-wash').count() === 0,
    'Reduced-motion navigation still creates the cross-theme wash'
  );
  await reducedTransitionContext.close();

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
    await page.waitForFunction((path) => location.pathname === path, expected, { timeout: 5000 });
    const current = new URL(page.url()).pathname;
    if (!(expected === '/' ? current === '/' : current === expected)) {
      failures.push(`Nav link ${label} expected ${expected} but landed on ${current}`);
    }
  }

  // Blog list behavior
  await page.goto(BASE_URL + '/blog/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#blog-feed article', { timeout: 15000 });
  await page.waitForSelector('#galaxy-field[data-ready="true"]', { timeout: 15000 });

  const rssResp = await api.get('/blog/rss.xml');
  await assert(rssResp.status() >= 200 && rssResp.status() < 400, 'RSS feed endpoint /blog/rss.xml failed');
  const rssBody = await rssResp.text();
  await assert(rssBody.includes('<rss') && rssBody.includes('<item>'), 'RSS feed content is invalid');

  const initialCount = await page.locator('#blog-feed article').count();
  await assert(initialCount > 0, 'Blog feed did not render any posts from the public manifest');
  const blogArchiveStatus = ((await page.locator('#infinite-status').textContent()) || '').replace(/\s+/g, ' ').trim();
  await assert(
    blogArchiveStatus.includes(`${initialCount} published entr`)
      && blogArchiveStatus.includes('engineering, systems, and life')
      && !/javascript|controls|resolved|end of field/i.test(blogArchiveStatus),
    `Logs archive end copy describes interface mechanics instead of Andrew's writing: ${blogArchiveStatus}`
  );

  const rssLinkHref = await page.locator('a[href="/blog/rss.xml"]').first().getAttribute('href');
  await assert(rssLinkHref === '/blog/rss.xml', 'Blog RSS link is missing');
  const shareButtonsCount = await page.locator('button[data-share-slug]').count();
  const bookmarkButtonsCount = await page.locator('button[data-bookmark-slug]').count();
  await assert(shareButtonsCount > 0, 'Share buttons are missing on blog index');
  await assert(bookmarkButtonsCount > 0, 'Bookmark buttons are missing on blog index');

  const galaxyNodes = page.locator('#galaxy-field .galaxy-node');
  await assert(
    (await galaxyNodes.count()) === initialCount,
    'Logs galaxy does not expose one labeled node per published entry'
  );
  const nodeTruth = await galaxyNodes.evaluateAll((nodes) => nodes.map((node) => ({
    label: node.querySelector('.galaxy-node__label')?.textContent?.trim() || '',
    minutes: Number(node.dataset.readingMinutes || 0),
    size: Number.parseFloat(getComputedStyle(node).getPropertyValue('--node-size')),
    display: getComputedStyle(node.querySelector('.galaxy-node__label')).display,
  })));
  await assert(
    nodeTruth.every((node) => node.label && node.display !== 'none'),
    'Logs galaxy hides titles until hover instead of keeping every node labeled'
  );
  const minuteOrdered = [...nodeTruth].sort((left, right) => left.minutes - right.minutes);
  await assert(
    minuteOrdered.every((node, index) => index === 0 || node.size >= minuteOrdered[index - 1].size),
    'Logs galaxy node size does not grow monotonically with published reading time'
  );
  await assert(await page.locator('#blog-feed .galaxy-entry__media img').count() > 0, 'Logs chronology did not restore published entry imagery');

  const selectedTransmission = await galaxyNodes.first().getAttribute('data-slug');
  await galaxyNodes.first().click();
  await page.waitForFunction((slug) => new URL(location.href).searchParams.get('target') === slug, selectedTransmission);
  const galaxyFocus = await page.evaluate((slug) => {
    const node = document.querySelector(`.galaxy-node[data-slug="${CSS.escape(slug)}"]`);
    const selected = document.querySelector('#galaxy-focus');
    const stage = document.querySelector('#galaxy-field');
    const nodeRect = node.getBoundingClientRect();
    const focusRect = selected.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const overlaps = !(focusRect.right <= nodeRect.left || focusRect.left >= nodeRect.right || focusRect.bottom <= nodeRect.top || focusRect.top >= nodeRect.bottom);
    const gap = Math.min(
      Math.abs(focusRect.left - nodeRect.right),
      Math.abs(nodeRect.left - focusRect.right),
      Math.abs(focusRect.top - nodeRect.bottom),
      Math.abs(nodeRect.top - focusRect.bottom)
    );
    return {
      hidden: selected.hidden,
      direct: selected.querySelector('#galaxy-focus-link')?.getAttribute('href'),
      placement: selected.dataset.placement,
      overlaps,
      gap,
      insideStage: focusRect.left >= stageRect.left - 1 && focusRect.right <= stageRect.right + 1
        && focusRect.top >= stageRect.top - 1 && focusRect.bottom <= stageRect.bottom + 1,
      selectedArticle: document.querySelector(`[data-blog-slug="${CSS.escape(slug)}"]`)?.dataset.blogSelected,
    };
  }, selectedTransmission);
  await assert(
    !galaxyFocus.hidden
      && galaxyFocus.direct === `/blog/${encodeURIComponent(selectedTransmission)}.html`
      && ['right', 'left', 'below', 'above'].includes(galaxyFocus.placement)
      && !galaxyFocus.overlaps
      && galaxyFocus.gap <= 30
      && galaxyFocus.insideStage
      && galaxyFocus.selectedArticle === 'true',
    `Logs selected-entry bubble is not adjacent to its node: ${JSON.stringify(galaxyFocus)}`
  );
  await page.locator('.galaxy-intro').click({ position: { x: 4, y: 4 } });
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('target'));
  await assert(await page.locator('#galaxy-focus').getAttribute('hidden') !== null, 'Clicking outside did not dismiss the Logs node bubble');

  await galaxyNodes.first().focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction((slug) => new URL(location.href).searchParams.get('target') === slug, selectedTransmission);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('target'));
  await assert(
    await galaxyNodes.first().evaluate((node) => document.activeElement === node),
    'Escape did not dismiss the Logs bubble and restore focus to its node'
  );

  await galaxyNodes.first().click();
  await page.waitForFunction((slug) => new URL(location.href).searchParams.get('target') === slug, selectedTransmission);
  await page.goBack();
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('target'));
  await assert(await page.locator('#galaxy-focus').getAttribute('hidden') !== null,
    'Logs Back navigation did not clear only the selected galaxy target');

  await assert(
    initialCount === GENERATED_BLOG_POST_PATHS.length,
    `Logs archive rendered ${initialCount} of ${GENERATED_BLOG_POST_PATHS.length} public entries`
  );

  const categoryButtons = page.locator('#galaxy-categories button[data-category]');
  const categoryCount = await categoryButtons.count();
  await assert(categoryCount > 1, 'Category filters were not rendered from SQLite categories');
  if (categoryCount > 1) {
    await categoryButtons.nth(1).click();
    await page.waitForTimeout(540);
    const filteredCount = await page.locator('#blog-feed article:not([hidden])').count();
    await assert(filteredCount > 0, 'Category filter returned zero posts unexpectedly');
  }

  const firstTitle = await page.locator('#blog-feed article:not([hidden]) h3').first().textContent();
  const searchToken = (firstTitle || '').split(/\s+/).find((word) => word.length > 4) || 'mobile';
  await page.fill('#galaxy-search', searchToken);
  await page.waitForTimeout(540);
  const searchCount = await page.locator('#blog-feed article:not([hidden])').count();
  await assert(searchCount > 0, `Search returned zero results for token: ${searchToken}`);
  await page.locator('#galaxy-search').press('Enter');
  await assert(
    await page.locator('#galaxy-search').inputValue() === searchToken
      && new URL(page.url()).searchParams.get('q') === searchToken
      && await page.locator('#blog-feed article:not([hidden])').count() === searchCount,
    'Pressing Enter cleared or changed the committed Logs search'
  );

  await page.fill('#galaxy-search', '___unlikely___term___');
  await page.waitForTimeout(540);
  const zeroStateVisible = await page.locator('#galaxy-empty:not([hidden])').filter({ hasText: /No writing matches/ }).count();
  await assert(zeroStateVisible > 0, 'Search zero-state message did not render');
  await page.fill('#galaxy-search', '');
  await page.locator('#galaxy-categories button[data-category="all"]').click();
  await page.waitForTimeout(540);

  await mobilePage.goto(BASE_URL + '/blog/', { waitUntil: 'networkidle' });
  await mobilePage.waitForSelector('#galaxy-field[data-ready="true"]', { timeout: 15000 });
  const mobileLogsLayout = await mobilePage.evaluate(() => {
    const map = document.querySelector('.universe-route-map');
    const mapBounds = map.getBoundingClientRect();
    const tuner = document.querySelector('#galaxy-tuner').getBoundingClientRect();
    const field = document.querySelector('#galaxy-field').getBoundingClientRect();
    return {
      fieldGap: field.top - tuner.bottom,
      mapBottom: innerHeight - mapBounds.bottom,
      mapMode: map.dataset.universeRouteMapMode || null,
      mapParent: map.parentElement?.tagName,
      mapPosition: getComputedStyle(map).position,
    };
  });
  await assert(
    mobileLogsLayout.fieldGap <= 8
      && mobileLogsLayout.mapBottom <= 2
      && mobileLogsLayout.mapMode === null
      && mobileLogsLayout.mapParent === 'BODY'
      && mobileLogsLayout.mapPosition === 'fixed',
    `Mobile Logs does not keep search adjacent to the galaxy with floating navigation: ${JSON.stringify(mobileLogsLayout)}`
  );
  await mobilePage.fill('#galaxy-search', 'privacy');
  await mobilePage.locator('#galaxy-search').press('Enter');
  await mobilePage.waitForFunction(() => document.querySelector('.galaxy-hero')?.dataset.merger === 'remnant');
  await mobilePage.waitForTimeout(900);
  const mobileEnterState = await mobilePage.evaluate(() => {
    const core = document.querySelector('.galaxy-core__horizon').getBoundingClientRect();
    return {
      coreCenterDistance: Math.abs((core.top + core.bottom) / 2 - innerHeight / 2),
      query: new URL(location.href).searchParams.get('q'),
      scrollY,
      value: document.querySelector('#galaxy-search').value,
    };
  });
  await assert(
    mobileEnterState.value === 'privacy'
      && mobileEnterState.query === 'privacy'
      && mobileEnterState.scrollY > 0
      && mobileEnterState.coreCenterDistance < 90,
    `Mobile Logs Enter did not retain search and scroll to the galaxy: ${JSON.stringify(mobileEnterState)}`
  );

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
  await assert(((await page.locator('#post-category').textContent()) || '').trim() === 'portfolio', 'OCBC project note does not use the portfolio label');

  await page.goto(BASE_URL + '/blog/case-study-openpay-bnpl-experience.html', { waitUntil: 'domcontentloaded' });
  const openpayHeroImage = page.locator('[data-work-hero-layout="cover"] > img');
  await assert((await openpayHeroImage.count()) === 1, 'openpay project note is missing its edge-to-edge hero');
  if ((await openpayHeroImage.count()) === 1) {
    const openpayObjectFit = await openpayHeroImage.evaluate((image) => getComputedStyle(image).objectFit);
    await assert(openpayObjectFit === 'cover', `openpay hero uses object-fit ${openpayObjectFit}; expected cover`);
  }

  // Contact form behavior
  await page.goto(BASE_URL + '/contact.html', { waitUntil: 'domcontentloaded' });
  const contactRuntime = JSON.parse(await page.locator('#contact-runtime-config').textContent());
  const action = await page.locator('#contact-form').getAttribute('action');
  await assert(action === '/contact.html#contact-form', 'Contact form does not retain the inert local action');
  await assert(!String(action).startsWith('mailto:'), 'Production Contact still opens an email client');
  await assert((await page.locator('[data-payload-visual]').count()) === 1, 'Promoted Payload Integration visual is missing');
  await page.fill('input[name="name"]', 'QA Runner');
  await page.fill('input[name="email"]', 'qa@example.com');
  await page.fill('textarea[name="privateMessage"]', 'Checking the stored-record contact flow without leaving the page.');
  await page.locator('#contact-storage-consent').check();
  const nameVal = await page.locator('input[name="name"]').inputValue();
  const emailVal = await page.locator('input[name="email"]').inputValue();
  await assert(nameVal === 'QA Runner' && emailVal === 'qa@example.com', 'Contact form fields did not accept input');
  if (contactRuntime.enabled) {
    const endpoint = new URL(contactRuntime.endpoint);
    await assert(contactRuntime.transport === 'apps_script_iframe', 'Enabled Contact runtime does not use the Apps Script iframe transport');
    await assert(endpoint.protocol === 'https:', 'Enabled Contact endpoint is not HTTPS');
    await assert(endpoint.hostname === 'script.google.com', 'Enabled Contact endpoint is not hosted at script.google.com');
    await assert(/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint.pathname), 'Enabled Contact endpoint is not an Apps Script /exec deployment');
    await assert(!endpoint.search && !endpoint.hash && !endpoint.username && !endpoint.password, 'Enabled Contact endpoint contains disallowed URL components');
    await assert(contactRuntime.publicFeedEndpoint === '', 'Enabled Contact runtime unexpectedly configures a public feed endpoint');
    await assert(!(await page.locator('[data-contact-submit]').isDisabled()), 'Approved Apps Script runtime did not enable the completed Contact form');
  } else {
    await assert(contactRuntime.transport === 'disabled', 'Disabled Contact runtime uses a non-disabled transport');
    await assert(contactRuntime.endpoint === '' && contactRuntime.publicFeedEndpoint === '', 'Disabled Contact runtime exposes an endpoint');
    await assert(await page.locator('[data-contact-submit]').isDisabled(), 'Disabled runtime exposed an active Contact submit control');
  }
  await assert(contactEndpointRequests.length === 0, 'Ordinary E2E contacted the live Apps Script endpoint');

  // Work page: public baseline hierarchy plus the shared route navigator.
  await page.goto(BASE_URL + '/work.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#production-work .work-case');
  const portfolioContract = await page.evaluate(() => {
    const titles = (selector) => [...document.querySelectorAll(selector)]
      .map((entry) => entry.textContent.replace(/\s+/g, ' ').trim());
    const productionCards = [...document.querySelectorAll('#production-work .work-case')];
    const archiveCards = [...document.querySelectorAll('#more-work .work-archive-card')];
    const publicCards = [...document.querySelectorAll('#public-builds .work-public-card')];
    const hero = document.querySelector('.work-hero');
    const heroTitle = document.querySelector('.work-hero__title');
    const production = document.querySelector('#production-work');
    const routeMap = document.querySelector('.universe-route-map');
    const rect = (element) => {
      const bounds = element.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height, area: bounds.width * bounds.height };
    };
    return {
      production: titles('#production-work .work-case h3'),
      archive: titles('#more-work .work-archive-card h3'),
      publicBuilds: titles('#public-builds .work-public-card h3'),
      entryCount: document.querySelectorAll('[data-portfolio-entry]').length,
      heroTitle: heroTitle?.textContent.replace(/\s+/g, ' ').trim() || '',
      heroIntro: document.querySelector('.work-hero__intro')?.textContent.replace(/\s+/g, ' ').trim() || '',
      heroFontSize: Number.parseFloat(getComputedStyle(heroTitle).fontSize),
      hero: rect(hero),
      heroTitleRect: rect(heroTitle),
      productionRect: rect(production),
      routeMapCount: routeMap?.querySelectorAll('a').length || 0,
      routeMapVisible: Boolean(routeMap) && getComputedStyle(routeMap).display !== 'none',
      viewportHeight: innerHeight,
      productionAreas: productionCards.map(rect).map((value) => value.area),
      archiveAreas: archiveCards.map(rect).map((value) => value.area),
      imageCounts: {
        production: document.querySelectorAll('#production-work img').length,
        archive: document.querySelectorAll('#more-work img').length,
        publicBuilds: document.querySelectorAll('#public-builds img').length,
      },
      allImagesNamed: [...document.querySelectorAll('#production-work img, #more-work img, #public-builds img')]
        .every((image) => Boolean(image.getAttribute('alt')?.trim())),
    };
  });
  const expectedProductionProjects = ['Bitcoin.com Wallet', 'ITVX', 'OCBC Business', 'openpay', 'MySTC'];
  const expectedArchiveProjects = ['Littlepay', 'OWTO', 'Popslide', 'WebSafety', 'Solo', 'ProjectBASS', 'NTU Pass + NUS', 'Aqua Expeditions'];
  const expectedPublicProjects = ['Persons Finder', 'Orchestrum', 'MemPalace'];
  await assert(
    portfolioContract.entryCount === 16
      && JSON.stringify(portfolioContract.production) === JSON.stringify(expectedProductionProjects)
      && JSON.stringify(portfolioContract.archive) === JSON.stringify(expectedArchiveProjects)
      && JSON.stringify(portfolioContract.publicBuilds) === JSON.stringify(expectedPublicProjects),
    `Work page no longer matches the public 5 / 8 / 3 portfolio baseline: ${JSON.stringify(portfolioContract)}`
  );
  await assert(
    portfolioContract.heroTitle === 'I build the parts people notice when they fail.'
      && portfolioContract.heroIntro.includes('I’m a problem solver')
      && portfolioContract.heroIntro.includes('I lead teams')
      && portfolioContract.heroIntro.includes('use AI'),
    `Work opening copy drifted from the restored public baseline: ${JSON.stringify(portfolioContract)}`
  );
  await assert(
    portfolioContract.heroFontSize <= 90
      && portfolioContract.hero.height <= 700
      && portfolioContract.heroTitleRect.bottom <= portfolioContract.viewportHeight
      && portfolioContract.productionRect.top < portfolioContract.viewportHeight * 1.6,
    `Work opening is oversized or buries the flagship content: ${JSON.stringify(portfolioContract)}`
  );
  await assert(
    portfolioContract.routeMapVisible && portfolioContract.routeMapCount >= 6,
    `Work page is missing the whole-site navigator: ${JSON.stringify(portfolioContract)}`
  );
  const largestSupportArea = Math.max(...portfolioContract.productionAreas.slice(1));
  const smallestSupportArea = Math.min(...portfolioContract.productionAreas.slice(1));
  const largestArchiveArea = Math.max(...portfolioContract.archiveAreas);
  await assert(
    portfolioContract.productionAreas[0] > largestSupportArea * 1.2
      && smallestSupportArea > largestArchiveArea * 2.5,
    `Work visual hierarchy no longer reads Bitcoin > four production credentials > archive: ${JSON.stringify(portfolioContract)}`
  );
  await assert(
    portfolioContract.imageCounts.production === 11
      && portfolioContract.imageCounts.archive === 7
      && portfolioContract.imageCounts.publicBuilds === 1
      && portfolioContract.allImagesNamed,
    `Work image evidence changed: ${JSON.stringify(portfolioContract.imageCounts)}`
  );

  const workPageText = ((await page.locator('body').textContent()) || '').replace(/\s+/g, ' ').trim();
  for (const projectName of [...expectedProductionProjects, ...expectedArchiveProjects, ...expectedPublicProjects]) {
    await assert(workPageText.includes(projectName), `Work page is missing the ${projectName} portfolio entry`);
  }
  await assert(!workPageText.includes('[N/A]'), 'Work page still exposes an [N/A] placeholder');
  await assert(!workPageText.includes('Mission trajectory control'), 'Restored Work page still exposes trajectory-interface commentary');

  const projectEvidence = [
    ['ITVX', ['Candyspace', 'recommendations panel', 'preview timeline scrubbing', 'phone and tablet', 'Simple XML-to-Jackson']],
    ['OCBC Business', ['Senior Mobile Engineer · RedAirship', 'onboarding', 'business accounts', 'transfers', 'third-party identity SDKs', 'concurrent updates']],
    ['openpay', ['Senior Mobile Engineer · RedAirship', 'BNPL checkout', 'partner-integrated payment flows', 'delayed and unexpected partner responses']],
    ['MySTC', ['Lead Developer · 2020–2021', 'five senior Android engineers', 'English and Arabic', 'data sync', 'release integration']],
  ];
  for (const [projectName, evidence] of projectEvidence) {
    const projectText = await page.locator('#production-work .work-case').evaluateAll((cards, title) => {
      const card = cards.find((entry) => entry.querySelector('h3')?.textContent.trim() === title);
      return card?.textContent.replace(/\s+/g, ' ').trim() || '';
    }, projectName);
    await assert(evidence.every((expectedText) => projectText.includes(expectedText)),
      `${projectName} production card is missing exact role or delivery evidence`);
  }

  const pipelineText = ((await page.locator('.work-pipeline').textContent()) || '').replace(/\s+/g, ' ').trim().toUpperCase();
  for (const stage of ['PRODUCT PROBLEM', 'SHARED CORE', 'ANDROID', 'IOS', 'BACKEND', 'AI', 'VERIFIED RELEASE']) {
    await assert(pipelineText.includes(stage), `Portfolio opening diagram is missing ${stage}`);
  }

  const productionImageContracts = [
    ['Bitcoin.com Wallet', '.work-case--bitcoin .work-bitcoin-shot', 3, '/assets/images/work/img_bitcoin_wallet_'],
    ['ITVX', '.work-case--itvx .work-itvx-shot', 3, '/assets/images/work/img_itvx_'],
    ['OCBC Business', '.work-case--ocbc .work-ocbc-shot', 3, '/assets/images/work/img_ocbc_business_'],
    ['openpay', '.work-case--openpay .work-openpay-stage img', 1, '/assets/images/work/img_openpay_app-optimized.webp'],
    ['MySTC', '.work-case--mystc .work-device-stage img', 1, '/assets/images/work/img_mystc_app-optimized.webp'],
  ];
  for (const [projectName, selector, expectedCount, sourcePrefix] of productionImageContracts) {
    const sources = await page.locator(selector).evaluateAll((nodes) => nodes.map((image) => image.getAttribute('src') || ''));
    await assert(
      sources.length === expectedCount && sources.every((source) => source.startsWith(sourcePrefix)),
      `${projectName} does not expose the expected official local image evidence: ${JSON.stringify(sources)}`
    );
  }

  const requiredProjectLinks = [
    ['Bitcoin.com Wallet', 'a[href*="play.google.com/store/apps/details?id=com.bitcoin.mwallet"]'],
    ['ITVX', 'a[href*="play.google.com/store/apps/details?id=air.ITVMobilePlayer"]'],
    ['OCBC Business', 'a[href*="play.google.com/store/apps/details?id=com.ocbc.mobilebv"]'],
    ['MemPalace', 'a[href="https://github.com/MemPalace/mempalace/pull/78"]'],
    ['Littlepay', 'a[href^="https://littlepay.com"]'],
    ['NTU Pass', 'a[href*="play.google.com/store/apps/details?id=sg.edu.ntu.apps.ntusmartpass"]'],
    ['Solo', 'a[href*="play.google.com/store/apps/developer?id=Solo+Technologies+Services"]'],
    ['Aqua Expeditions', 'a[href^="https://www.aquaexpeditions.com"]'],
  ];
  for (const [projectName, selector] of requiredProjectLinks) {
    await assert((await page.locator(selector).count()) > 0, `Work page ${projectName} source link is missing or incorrect`);
  }
  const deepDiveHrefs = await page.locator('a[data-work-deep-dive]').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')).filter(Boolean)
  );
  await assert(deepDiveHrefs.length >= 3 && new Set(deepDiveHrefs).size === deepDiveHrefs.length,
    'Work page deep-dive links are missing or duplicated');

  await mobilePage.goto(BASE_URL + '/work.html', { waitUntil: 'domcontentloaded' });
  const mobileWork = await mobilePage.evaluate(() => ({
    entryCount: document.querySelectorAll('[data-portfolio-entry]').length,
    heroFontSize: Number.parseFloat(getComputedStyle(document.querySelector('.work-hero__title')).fontSize),
    rootWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    routeMapCount: document.querySelectorAll('.universe-route-map a').length,
    productionTitles: [...document.querySelectorAll('#production-work .work-case h3')].map((heading) => heading.textContent.trim()),
  }));
  await assert(
    mobileWork.entryCount === 16
      && mobileWork.heroFontSize <= 58
      && mobileWork.rootWidth <= mobileWork.viewportWidth + 2
      && mobileWork.routeMapCount >= 6
      && JSON.stringify(mobileWork.productionTitles) === JSON.stringify(expectedProductionProjects),
    `Mobile Work layout or navigator regressed: ${JSON.stringify(mobileWork)}`
  );

  const reducedMotion = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 430, height: 932 } });
  const reducedMotionPage = await reducedMotion.newPage();
  await reducedMotionPage.goto(BASE_URL + '/work.html', { waitUntil: 'domcontentloaded' });
  const reducedMotionCard = reducedMotionPage.locator('.work-case--bitcoin');
  const reducedMotionScreens = reducedMotionCard.locator('.work-bitcoin-shot');
  const positions = async () => reducedMotionScreens.evaluateAll((images) => images.map((image) => {
    const rect = image.getBoundingClientRect();
    const galleryRect = image.parentElement.getBoundingClientRect();
    return { x: Math.round(rect.x - galleryRect.x), y: Math.round(rect.y - galleryRect.y) };
  }));
  const reducedBeforeHover = await positions();
  await assert(new Set(reducedBeforeHover.map(({ x, y }) => `${x}:${y}`)).size === 3,
    'Reduced-motion mode collapses the Bitcoin collage into overlapping screens');
  await reducedMotionCard.hover();
  await assert(JSON.stringify(await positions()) === JSON.stringify(reducedBeforeHover),
    'Reduced-motion mode still moves the Bitcoin collage on hover');
  await reducedMotion.close();

  const noJavaScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
  const noJavaScriptPage = await noJavaScript.newPage();
  const noJavaScriptResponse = await noJavaScriptPage.goto(BASE_URL + '/work.html', { waitUntil: 'domcontentloaded' });
  await assert(noJavaScriptResponse && noJavaScriptResponse.status() >= 200 && noJavaScriptResponse.status() < 400,
    'Work page failed to load with JavaScript disabled');
  await assert(await noJavaScriptPage.locator('[data-portfolio-entry]').count() === 16,
    'Work page does not expose all 16 portfolio entries without JavaScript');
  const staticWorkPageText = ((await noJavaScriptPage.locator('body').textContent()) || '').replace(/\s+/g, ' ').trim();
  for (const projectName of [...expectedProductionProjects, ...expectedArchiveProjects, ...expectedPublicProjects]) {
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
