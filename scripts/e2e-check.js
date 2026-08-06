const { chromium, request } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173';
const CHECK_EXTERNAL_LINKS = process.env.CHECK_EXTERNAL_LINKS === '1';
const siteRoot = path.resolve(__dirname, '..', process.env.SITE_ROOT || '.');
const postsManifestPath = path.join(siteRoot, 'blog', 'posts.json');
const homepageSocialImagePath = path.join(siteRoot, 'assets', 'images', 'og', 'home-orbital-dashboard.png');
const homepageSocialImageUrl = 'https://ac-opensource.github.io/assets/images/og/home-orbital-dashboard.png';
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

  if (!fs.existsSync(homepageSocialImagePath)) {
    failures.push('Homepage social preview image is missing');
  } else {
    const socialImage = fs.readFileSync(homepageSocialImagePath);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await assert(
      socialImage.subarray(0, pngSignature.length).equals(pngSignature),
      'Homepage social preview must be a true PNG image'
    );
    await assert(
      socialImage.length >= 24
        && socialImage.readUInt32BE(16) === 1200
        && socialImage.readUInt32BE(20) === 630,
      'Homepage social preview must be exactly 1200x630'
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
      const socialMetadata = await page.evaluate(() => ({
        openGraphAlt: document.querySelector('meta[property="og:image:alt"]')?.content,
        openGraphImage: document.querySelector('meta[property="og:image"]')?.content,
        twitterAlt: document.querySelector('meta[name="twitter:image:alt"]')?.content,
        twitterImage: document.querySelector('meta[name="twitter:image"]')?.content,
      }));
      await assert(
        socialMetadata.openGraphImage === homepageSocialImageUrl
          && socialMetadata.twitterImage === homepageSocialImageUrl,
        'Homepage social metadata does not reference the current orbital dashboard preview'
      );
      await assert(
        Boolean(socialMetadata.openGraphAlt)
          && socialMetadata.openGraphAlt === socialMetadata.twitterAlt,
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
    if (route.path === '/about.html') {
      const aboutHeroClearance = await mobilePage.evaluate(() => {
        const header = document.querySelector('#site-topbar').getBoundingClientRect();
        const label = document.querySelector('#main-content .bracket-label').getBoundingClientRect();
        return label.top - header.bottom;
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
        glitterVisible: glitters.some((glitter) => {
          const bounds = glitter.getBoundingClientRect();
          return Number.parseFloat(getComputedStyle(glitter).opacity) > .2
            && bounds.width >= 2
            && bounds.height >= 1;
        }),
        tailAngleError,
        trackAspect: trackWidth > 0 && trackHeight > 0
          ? Math.max(trackWidth / trackHeight, trackHeight / trackWidth)
          : 0,
        wakeOpacity: Number.parseFloat(getComputedStyle(node?.querySelector('.comet-wake')).opacity),
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
      flung.tailAngleError <= 1 && flung.glitterCount === 8 && flung.glitterVisible
        && flung.glitterAnimations.every((name) => name === 'comet-glitter'),
      'Desktop comet tail does not face away from AC with eight fading glitter particles'
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
      apoDistance > .4 && inboundDistance > apoDistance * 1.35,
      `Altered node does not visibly accelerate from apoapsis toward the AC focus (${apoDistance.toFixed(2)}px → ${inboundDistance.toFixed(2)}px)`
    );
    await assert(
      inboundDistance > averageRegularDistance * 1.8,
      `Inbound comet is not substantially faster than the regular orbit nodes (${inboundDistance.toFixed(2)}px vs ${averageRegularDistance.toFixed(2)}px average)`
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
      && personalIntro.includes('photography')
      && personalIntro.includes('astronomy'),
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
  const resumeProjectsSection = page.getByRole('heading', { name: 'Projects', exact: true }).locator('xpath=ancestor::section[1]');
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
  const portfolioHeroOffset = await page.evaluate(() => {
    const header = document.querySelector('#site-topbar').getBoundingClientRect();
    const eyebrow = document.querySelector('.work-hero .work-eyebrow').getBoundingClientRect();
    return eyebrow.top - header.bottom;
  });
  await assert(portfolioHeroOffset < 100, `Portfolio hero starts ${portfolioHeroOffset}px below the header; expected less than 100px`);
  const portfolioEntries = page.locator('[data-portfolio-entry]');
  const portfolioEntryCount = await portfolioEntries.count();
  await assert(portfolioEntryCount >= 16, `Work page rendered ${portfolioEntryCount} portfolio entries; expected at least 16`);

  const workPageText = ((await page.locator('body').textContent()) || '').replace(/\s+/g, ' ').trim();
  for (const projectName of ['Bitcoin.com Wallet', 'ITVX', 'MemPalace', 'Persons Finder', 'Orchestrum', 'Littlepay', 'NTU Pass', 'Solo', 'Aqua Expeditions']) {
    await assert(workPageText.includes(projectName), `Work page is missing the ${projectName} portfolio entry`);
  }
  const itvxCardText = ((await page.locator('.work-case--itvx').textContent()) || '').replace(/\s+/g, ' ').trim();
  await assert(
    ['Candyspace', 'ITVX', 'recommendations panel', 'timeline scrubbing', 'phone and tablet', 'Simple XML-to-Jackson']
      .every((expectedText) => itvxCardText.includes(expectedText)),
    'ITVX work card does not show the employer and concrete playback accomplishments'
  );
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
  await assert((await page.locator('.work-pipeline__node').count()) === 6, 'Portfolio hero is missing delivery pipeline stages');
  const workPipelineText = ((await page.locator('.work-pipeline').textContent()) || '').replace(/\s+/g, ' ').trim();
  await assert(
    workPipelineText.includes('PRODUCT PROBLEM')
      && workPipelineText.includes('SHARED CORE')
      && workPipelineText.includes('ANDROID')
      && workPipelineText.includes('iOS')
      && workPipelineText.includes('BACKEND')
      && workPipelineText.includes('AI')
      && workPipelineText.includes('VERIFIED RELEASE'),
    'Portfolio hero does not communicate the complete branching delivery pipeline'
  );
  await assert(
    (await page.locator('.work-hero__art[role="img"]').getAttribute('aria-label') || '').includes('verified release'),
    'Portfolio hero delivery pipeline is missing from the accessibility tree'
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
  for (const capability of ['Staking + reward pools', 'Buy · Sell · Swap', 'Multichain transactions', 'Rust + UniFFI']) {
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
  await assert(heroIntro.includes('I lead teams') && heroIntro.includes('use AI'), 'Portfolio hero is missing leadership or agent-first delivery positioning');
  await assert((await page.locator('.work-signals > div').count()) === 4, 'Portfolio hero does not expose all four positioning signals');
  await assert(workPageText.includes('Agent-first'), 'Portfolio hero is missing its agent-first delivery signal');

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
