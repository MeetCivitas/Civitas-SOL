#!/usr/bin/env node
// Open composer, dump every visible button + screenshot — so we can see exactly
// what the image / document upload entry points look like.
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

// Warm up /feed first, same way schedule-all.mjs does.
await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.goto('https://www.linkedin.com/company/117124184/admin/dashboard/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
await page.screenshot({ path: path.join(__dirname, 'debug', 'pre-create.png') });
console.log('URL before create click:', page.url());
// Click Create.
await page.getByRole('button', { name: /Create/i }).first().click({ timeout: 8000 });
await page.waitForTimeout(1500);
// Click Start a post.
await page.locator('text=Start a post').first().click({ timeout: 5000 });
await page.waitForTimeout(3500);

await page.screenshot({ path: path.join(__dirname, 'debug', 'composer-open.png') });

// Dump every button + role=button in the composer modal.
const buttons = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('button, [role="button"], [tabindex="0"]'));
  return all
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top > 0;
    })
    .map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      aria: el.getAttribute('aria-label'),
      text: (el.innerText || '').trim().slice(0, 100),
    }))
    .filter(b => b.text || b.aria);
});
writeFileSync(path.join(__dirname, 'debug', 'composer-buttons.json'), JSON.stringify(buttons, null, 2));
console.log(`Dumped ${buttons.length} buttons.`);

await page.waitForTimeout(1000);
await ctx.close();
