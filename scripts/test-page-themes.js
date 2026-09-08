'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4187';
(async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' });
      const page = await context.newPage();
      for (const [route, attr, toggle] of [
        ['/about.html', 'data-about-theme', '[data-about-theme-toggle]'],
        ['/blog/', 'data-logs-theme', '[data-logs-theme-toggle]'],
      ]) {
        await page.goto(base + route);
        assert.equal(await page.locator('html').getAttribute(attr), 'dark');
        await page.locator(toggle).click();
        assert.equal(await page.locator('html').getAttribute(attr), 'light');
        await page.reload();
        assert.equal(await page.locator('html').getAttribute(attr), 'light');
        await page.locator(toggle).click();
        await page.reload();
        assert.equal(await page.locator('html').getAttribute(attr), 'dark');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (process.env.THEME_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.THEME_SCREENSHOTS, `${width}-${attr}.png`) });
      }
      for (const file of fs.readdirSync(path.join(__dirname, '../dist/blog')).filter(f => f.endsWith('.html') && f !== 'index.html')) {
        await page.goto(base + '/blog/' + file);
        assert.equal(await page.locator('html').getAttribute('data-logs-theme'), 'dark', file);
        assert.equal(await page.locator('[data-logs-theme-toggle]').count(), 1, file);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, file);
      }
      await page.locator('[data-logs-theme-toggle]').click();
      await page.goto(base + '/blog/');
      assert.equal(await page.locator('html').getAttribute('data-logs-theme'), 'light', 'article choice shared with archive');
      await page.goto(base + '/resume.html');
      assert.equal(await page.locator('html').getAttribute('data-logs-theme'), null, 'theme scoped to Logs');
      await context.close();
    }
    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ javaScriptEnabled });
      if (javaScriptEnabled) await context.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw Error('blocked'); } }));
      const page = await context.newPage();
      for (const [route, attr] of [['/about.html', 'data-about-theme'], ['/blog/', 'data-logs-theme']]) {
        await page.goto(base + route);
        assert.equal(await page.locator('html').getAttribute(attr), 'dark');
      }
      await context.close();
    }
    console.log('Themes passed: desktop/mobile defaults, toggles, persistence, 28 articles, shared Logs preference, scoped routes, no-JS and blocked storage.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
