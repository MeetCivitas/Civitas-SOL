#!/usr/bin/env node
// Open the company composer, screenshot the toolbar, then click the overflow
// menu and screenshot what's inside (where "Add a document" lives).
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'browser-data'), {
  headless: false,
  viewport: { width: 1400, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] || await ctx.newPage();

// Warm up /feed first.
await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.goto('https://www.linkedin.com/company/117124184/admin/dashboard/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

await page.locator('button:has-text("Create")').first().click({ timeout: 8000 });
await page.waitForTimeout(1200);
await page.locator('text=Start a post').first().click({ timeout: 5000 });
await page.waitForTimeout(3500);

await page.screenshot({ path: path.join(__dirname, 'debug', 'toolbar-1-composer.png') });

// Dump every visible button inside the composer with its aria-label.
const toolbarBefore = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('button, [role="button"]'));
  return all
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .map(el => ({
      tag: el.tagName,
      aria: el.getAttribute('aria-label'),
      text: (el.innerText || '').trim().slice(0, 60),
    }))
    .filter(b => b.aria || b.text);
});
writeFileSync(path.join(__dirname, 'debug', 'toolbar-buttons.json'), JSON.stringify(toolbarBefore, null, 2));
console.log(`Composer-state buttons dumped: ${toolbarBefore.length}`);

// Try to click the overflow / "Show all" button.
let overflowClicked = false;
for (const sel of [
  'button[aria-label*="Show all" i]',
  'button[aria-label*="More" i]',
  'button[aria-label*="overflow" i]',
  'button[aria-label*="more options" i]',
  'button[aria-label*="More actions" i]',
]) {
  const loc = page.locator(sel).first();
  if (await loc.count()) {
    try {
      await loc.click({ timeout: 3000 });
      console.log(`Clicked overflow with selector: ${sel}`);
      overflowClicked = true;
      break;
    } catch { /* try next */ }
  }
}
if (!overflowClicked) console.log('Could not find overflow button.');
await page.waitForTimeout(1500);

await page.screenshot({ path: path.join(__dirname, 'debug', 'toolbar-2-overflow.png') });

// Dump the resulting menu options.
const menu = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('[role="menuitem"], li, button'));
  return all
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top > 100;
    })
    .map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      aria: el.getAttribute('aria-label'),
      text: (el.innerText || '').trim().slice(0, 60),
    }))
    .filter(b => b.text && b.text.length < 60);
});
writeFileSync(path.join(__dirname, 'debug', 'overflow-menu.json'), JSON.stringify(menu, null, 2));
console.log(`Overflow-menu options dumped: ${menu.length}`);

await page.waitForTimeout(1500);
await ctx.close();
