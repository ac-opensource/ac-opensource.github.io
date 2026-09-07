const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:42873';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${BASE_URL}/work.html`, { waitUntil: 'domcontentloaded' });
    const phase = value => page.waitForFunction(expected => document.querySelector('[data-nova-field]')?.dataset.phase === expected, value, { timeout: 15000 });
    await phase('collapsing').catch(async error => { console.error(await page.evaluate(() => ({root:{...document.documentElement.dataset},field:{...document.querySelector('[data-nova-field]').dataset},image:document.querySelector('.work-nova__image').naturalWidth,hidden:document.hidden}))); throw error; });
    await phase('exploding');
    await phase('remnant');
    assert.equal(await page.locator('[data-nova-field]').getAttribute('data-frame-pacing'), 'display');
    const geometry = await page.evaluate(() => {
      const nova = document.querySelector('.work-nova').getBoundingClientRect();
      const field = document.querySelector('[data-nova-field]');
      const bounds = field.getBoundingClientRect();
      return { ratio: bounds.width/nova.width, x: (bounds.left+bounds.width/2)-(nova.left+nova.width/2), y: (bounds.top+bounds.height/2)-(nova.top+nova.height/2), pixels: Number(field.dataset.pixelCount), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert(Math.abs(geometry.ratio-2.3)<.01, JSON.stringify(geometry));
    assert(Math.abs(geometry.x)<1 && Math.abs(geometry.y)<1, 'The core anchor moved');
    assert(geometry.pixels>0 && geometry.pixels<=750000);
    assert(!geometry.overflow, 'Desktop horizontal overflow');
    await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
    assert.equal(await page.locator('[data-nova-field]').getAttribute('data-animation-state'), 'paused');
    await page.locator('[data-nova-ignite]').press('Enter');
    await phase('collapsing');
    assert.equal(await page.locator('[data-nova-field]').getAttribute('data-pulse-count'), '1');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert(await page.locator('[data-nova-field]').isHidden());
    assert(await page.locator('.work-nova__image').isVisible());
    await page.close();

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
    await mobile.goto(`${BASE_URL}/work.html`);
    assert(await mobile.locator('[data-nova-field]').isHidden());
    assert.equal(await mobile.locator('[data-nova-field]').getAttribute('data-pixel-count'), null);
    assert(await mobile.locator('.work-nova__image').isVisible());
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth<=innerWidth));
    await mobile.emulateMedia({ reducedMotion: 'no-preference' });
    await mobile.reload();
    await mobile.locator('[data-nova-ignite]').scrollIntoViewIfNeeded();
    await mobile.waitForFunction(() => document.querySelector('[data-nova-field]')?.dataset.phase === 'remnant', null, { timeout: 15000 });
    await mobile.locator('[data-nova-ignite]').tap();
    assert.equal(await mobile.locator('[data-nova-field]').getAttribute('data-pulse-count'), '1');
    assert(await mobile.evaluate(() => Number(document.querySelector('[data-nova-field]').dataset.pixelCount)<=750000 && document.documentElement.scrollWidth<=innerWidth));
    await mobile.locator('#production-work').scrollIntoViewIfNeeded();
    await mobile.waitForFunction(() => document.querySelector('[data-nova-field]')?.dataset.animationState === 'paused');
    await mobile.close();
    const staticPage = await browser.newPage({ javaScriptEnabled: false });
    await staticPage.goto(`${BASE_URL}/work.html`);
    assert(await staticPage.locator('.work-nova__image').isVisible());
    assert.equal(await staticPage.locator('[data-portfolio-entry]').count(), 16);
    assert.deepEqual(errors, []);
    console.log('Work supernova passed: collapse/explosion/remnant, 2.3x anchored field, desktop/mobile budgets, keyboard ignition, pause, reduced motion, offscreen suspension, no-JS content.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode=1; });
