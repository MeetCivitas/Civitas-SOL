#!/usr/bin/env node
// Open composer, click "More" overflow, dump menu items.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'browser-data'), {
  headless: false, viewport: { width: 1400, height: 900 },
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

const composer = page.locator('div[role="dialog"]').filter({ has: page.locator('div.ql-editor[contenteditable="true"]') });
await composer.locator('button[aria-label="More"]').first().click({ timeout: 5000 });
await page.waitForTimeout(1200);

await page.screenshot({ path: path.join(__dirname, 'debug', 'more-menu.png') });

// Dump every visible button/role=button/menuitem after click.
const items = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], li, a'));
  return all
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top > 100 && r.top < 850;
    })
    .map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      aria: el.getAttribute('aria-label'),
      text: (el.innerText || '').trim().slice(0, 80),
    }))
    .filter(b => (b.text && b.text.length < 80) || b.aria);
});
writeFileSync(path.join(__dirname, 'debug', 'more-menu.json'), JSON.stringify(items, null, 2));
console.log(`After More click, dumped ${items.length} candidates.`);
// Print likely menu items.
console.log('---Likely menu items (with "add" or "document" or "poll" or "create")---');
for (const it of items) {
  const t = (it.text || it.aria || '').toLowerCase();
  if (/add|document|poll|create|celebrate|hiring|product|expert/.test(t)) {
    console.log(`  ${it.tag} role=${it.role || '-'} aria="${it.aria || ''}" text="${(it.text || '').slice(0,60)}"`);
  }
}
await page.waitForTimeout(1000);
await ctx.close();
