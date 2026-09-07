const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4207';

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
      const positions = () => page.locator('.orbit-node').evaluateAll(nodes => nodes.map(n => n.style.getPropertyValue('--x')));
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
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
