#!/usr/bin/env node
// Open /feed, click Civitas in left sidebar, dump full page + buttons so we can see
// exactly where the Create button is on the company admin view.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
mkdirSync(path.join(__dirname, 'debug'), { recursive: true });

const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'browser-data'), {
  headless: false,
  viewport: { width: 1400, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] || await ctx.newPage();

console.log('Going to /feed…');
await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
await page.waitForURL(/linkedin\.com\/feed/, { timeout: 60_000 });
await page.waitForTimeout(3000);

console.log('Clicking "Civitas" in left sidebar…');
let ok = false;
for (const fn of [
  () => page.getByText(/^Civitas$/i).first().click({ timeout: 5000 }),
  () => page.locator('a:has-text("Civitas")').first().click({ timeout: 5000 }),
  () => page.locator('[href*="meetcivitas"]').first().click({ timeout: 5000 }),
]) {
  try { await fn(); ok = true; break; } catch { /* try next */ }
}
console.log(ok ? '✓ clicked' : '✗ failed to click Civitas');
await page.waitForTimeout(5000);
console.log('After click URL:', page.url());

// Full-page screenshot of whatever we landed on.
await page.screenshot({ path: path.join(__dirname, 'debug', 'civitas-admin.png'), fullPage: false });

// Dump all interactive elements in the left 500px of the viewport so we
// can see the Create button + any other admin entry points.
const sidebar = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('button, [role="button"], a, div[tabindex="0"]'));
  return all
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.left < 500 && r.top > 60 && r.top < 800 && r.width > 0 && r.height > 0;
    })
    .map(el => ({
      tag: el.tagName,
      text: (el.innerText || '').trim().slice(0, 80),
      aria: el.getAttribute('aria-label'),
      href: el.getAttribute('href'),
    }))
    .filter(b => b.text || b.aria);
});
writeFileSync(path.join(__dirname, 'debug', 'civitas-sidebar.json'), JSON.stringify(sidebar, null, 2));
console.log(`Dumped ${sidebar.length} sidebar interactive elements.`);

await page.waitForTimeout(1000);
await ctx.close();
console.log('Done.');
