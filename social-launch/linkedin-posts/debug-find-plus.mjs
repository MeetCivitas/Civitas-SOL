#!/usr/bin/env node
// Open company composer, dump VISIBLE buttons in the toolbar row only.
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
await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.goto('https://www.linkedin.com/company/117124184/admin/dashboard/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
await page.locator('button:has-text("Create")').first().click({ timeout: 8000 });
await page.waitForTimeout(1200);
await page.locator('text=Start a post').first().click({ timeout: 5000 });
await page.waitForTimeout(3500);

// Filter to buttons in the toolbar row (around y=500-540 in viewport).
const toolbar = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('button, [role="button"]'));
  return all
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.top >= 480 && r.top <= 560 && r.left >= 300 && r.left <= 1100 && r.width > 0 && r.height > 0;
    })
    .map(el => ({
      tag: el.tagName,
      aria: el.getAttribute('aria-label'),
      text: (el.innerText || '').trim().slice(0, 60),
      x: Math.round(el.getBoundingClientRect().left),
    }))
    .sort((a, b) => a.x - b.x);
});
writeFileSync(path.join(__dirname, 'debug', 'toolbar-row.json'), JSON.stringify(toolbar, null, 2));
console.log('Toolbar row buttons (left → right):');
for (const b of toolbar) console.log(`  x=${b.x}  aria="${b.aria || ''}"  text="${b.text || ''}"`);

await page.waitForTimeout(1500);
await ctx.close();
