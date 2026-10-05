const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4207';

async function verifyReadingFlowNavigation(browser, configurePage = async () => {}) {
  const viewports = [{ width: 390, height: 844 }, { width: 820, height: 500 }, { width: 1440, height: 650 }];
  const waitForDetail = (page, key) => page.waitForFunction(key => {
    const root = document.querySelector('[data-synthesis]');
    return root.dataset.phase === 'focused' && root.dataset.selected === key
      && Number(getComputedStyle(document.querySelector('.facet-flight-controls')).opacity) > .95;
  }, key);
  const assertDocumentStart = async (page, key) => {
    await page.waitForFunction(() => Math.abs(scrollY - document.querySelector('[data-synthesis]').offsetTop) <= 2,
      null, { timeout: 5000 });
    const heading = await page.locator(`[data-facet-detail="${key}"] h2`).boundingBox();
    assert(heading.y >= 0 && heading.y + heading.height <= page.viewportSize().height,
      'The incoming heading must be in the viewport after entering or traversing a reading-flow detail');
    assert.equal(new URL(page.url()).hash, `#facet-${key}`, 'Navigation must retain the destination fragment');
  };
  for (const reducedMotion of ['no-preference', 'reduce']) {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport, reducedMotion });
      await configurePage(page);
      await page.goto(baseUrl);
      await page.evaluate(() => document.fonts.ready);
      const map = page.locator('[data-map-target="projects"]');
      await map.scrollIntoViewIfNeeded();
      const overviewScroll = await page.evaluate(() => scrollY);
      assert(overviewScroll > 0, 'The fixture must enter from a scrolled overview map');
      await map.click();
      await waitForDetail(page, 'projects');
      await assertDocumentStart(page, 'projects');
      for (const [selector, key] of [['[data-facet-next]', 'threads'], ['[data-facet-previous]', 'projects']]) {
        const button = page.locator(selector);
        await button.scrollIntoViewIfNeeded();
        assert(await page.evaluate(() => scrollY > document.querySelector('[data-synthesis]').offsetTop + 100),
          'Traversal must begin below the detail copy');
        await button.click();
        await waitForDetail(page, key);
        await page.waitForFunction(selector => document.activeElement.matches(selector), selector);
        await assertDocumentStart(page, key);
      }
      await page.locator('[data-detail-close]').click();
      await page.waitForFunction(() => document.querySelector('[data-synthesis]').dataset.phase === 'overview');
      await page.waitForFunction(expected => Math.abs(scrollY - expected) <= 2, overviewScroll, { timeout: 5000 });
      assert.equal(new URL(page.url()).hash, '', 'Returning home must clear the destination fragment');
      console.log(`PASS reading flow ${viewport.width}x${viewport.height} ${reducedMotion}: map entry, next/previous from below copy, focus/history, overview scroll restore`);
      await page.close();
    }
  }

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await configurePage(desktop);
  await desktop.goto(baseUrl);
  await desktop.evaluate(() => {
    window.landingDocumentScrollCalls = 0;
    const original = window.scrollTo;
    window.scrollTo = (...args) => {
      window.landingDocumentScrollCalls += 1;
      return original.apply(window, args);
    };
  });
  await desktop.locator('[data-map-target="projects"]').click();
  await waitForDetail(desktop, 'projects');
  await desktop.locator('[data-facet-next]').click();
  await waitForDetail(desktop, 'threads');
  await desktop.locator('[data-facet-previous]').click();
  await waitForDetail(desktop, 'projects');
  await desktop.locator('[data-detail-close]').click();
  await desktop.waitForFunction(() => document.querySelector('[data-synthesis]').dataset.phase === 'overview');
  assert.equal(await desktop.evaluate(() => window.landingDocumentScrollCalls), 0,
    'Desktop entry, traversal and return must retain element scrolling');
  console.log('PASS desktop: entry, next/previous and return do not scroll the document');
  await desktop.close();
}

async function verifyNoJsReadingFlow(browser, configurePage = async () => {}) {
  for (const viewport of [{ width: 320, height: 900 }, { width: 820, height: 500 }, { width: 1440, height: 650 }]) {
    const page = await browser.newPage({ viewport, javaScriptEnabled: false });
    await configurePage(page);
    await page.goto(baseUrl);
    await page.evaluate(() => document.fonts.ready);
    const rows = await page.locator('.focus-satellites > *').evaluateAll(nodes => nodes.map(node => {
      const bounds = node.getBoundingClientRect();
      const parent = node.parentElement.getBoundingClientRect();
      return { title: node.querySelector('strong').textContent, left: bounds.left, right: bounds.right,
        parentLeft: parent.left, parentRight: parent.right, width: bounds.width, parentWidth: parent.width };
    }));
    assert.equal(rows.length, 18, 'All six destinations must retain three explanations');
    for (const row of rows) {
      assert(row.left >= -.8 && row.right <= viewport.width + .8, `${row.title} must stay inside the viewport without JavaScript`);
      assert(row.left >= row.parentLeft - .8 && row.right <= row.parentRight + .8,
        `${row.title} must stay inside its reading-flow grid`);
      if (viewport.width <= 767) assert(Math.abs(row.width - row.parentWidth) <= .8,
        `${row.title} must use the full explanation row on phones`);
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No-JavaScript must not add horizontal overflow');
    console.log(`PASS no-JavaScript ${viewport.width}x${viewport.height}: eighteen explanation rows stay in bounds`);
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(baseUrl);
      await page.waitForFunction(() => document.body.dataset.orbitalMotion === 'active');
      if (process.env.EVIDENCE_DIR) {
        await page.screenshot({ path: `${process.env.EVIDENCE_DIR}/landing-${viewport.width}.png` });
      }
      const positions = () => page.locator('.orbit-node').evaluateAll(nodes => nodes.map(n => n.style.translate));
      const before = await positions();
      await page.waitForTimeout(180);
      assert.notDeepEqual(await positions(), before, 'Orbits should advance');
      if (viewport.width > 767) {
        await page.locator('[data-motion-toggle]').click();
        const paused = await positions();
        await page.waitForTimeout(180);
        assert.deepEqual(await positions(), paused, 'Pause should freeze orbital positions');
        const runningDecorations = await page.evaluate(() => document.getAnimations().filter(a =>
          a.playState === 'running' && a.effect?.target?.matches?.('.sculpture, .sculpture *, .neural-mesh, .neural-node, .comet-wake b')
        ).map(a => a.animationName));
        assert.deepEqual(runningDecorations, [], 'Pause should freeze decorative animations');
        await page.locator('[data-motion-toggle]').click();
        await page.waitForTimeout(180);
        assert.notDeepEqual(await positions(), paused, 'Resume should restart orbits');
        await page.locator('[data-view-toggle]').click();
        await page.waitForFunction(() => document.querySelector('[data-synthesis]').dataset.view === 'top');
      }
      for (const key of ['about', 'profile', 'work', 'projects', 'threads', 'contact']) {
        await page.goto(`${baseUrl}/#facet-${key}`);
        await page.waitForFunction(key => document.querySelector(`[data-facet-detail="${key}"]`)?.getAttribute('aria-hidden') === 'false', key);
        assert(await page.locator(`[data-facet-detail="${key}"]`).isVisible());
        await page.locator('[data-detail-close]').click();
        await page.waitForFunction(() => document.querySelector('[data-synthesis]').dataset.phase === 'overview');
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => document.body.dataset.orbitalMotion === 'idle');
      const reduced = await positions();
      await page.waitForTimeout(180);
      assert.deepEqual(await positions(), reduced, 'Reduced motion should freeze positions');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
      assert.deepEqual(errors, [], 'No page errors');
      console.log(`PASS ${viewport.width}x${viewport.height}: motion, six facets, reduced motion, overflow, console`);
      await page.close();
    }
    const noJs = await browser.newPage({ javaScriptEnabled: false });
    await noJs.goto(baseUrl);
    assert(await noJs.locator('h1').isVisible());
    assert.equal(await noJs.locator('.facet-detail:visible').count(), 6);
    console.log('PASS no-JavaScript: introduction and six destinations remain visible');
    await noJs.close();
    await verifyReadingFlowNavigation(browser);
    await verifyNoJsReadingFlow(browser);
  } finally {
    await browser.close();
  }
}
module.exports = { verifyReadingFlowNavigation, verifyNoJsReadingFlow };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
