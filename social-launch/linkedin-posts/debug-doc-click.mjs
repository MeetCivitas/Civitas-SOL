#!/usr/bin/env node
// Click Add a document, screenshot what happens, see if there's an intermediate dialog.
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
await page.locator('button[aria-label="Add a document"]').first().click({ timeout: 5000 });
await page.waitForTimeout(3000);

await page.screenshot({ path: path.join(__dirname, 'debug', 'after-doc-click.png') });

// Dump visible buttons + check for input[type=file] in DOM.
const state = await page.evaluate(() => {
  const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(el => ({
    visible: el.getBoundingClientRect().width > 0,
    accept: el.getAttribute('accept'),
  }));
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top > 100;
    })
    .map(el => ({
      tag: el.tagName,
      aria: el.getAttribute('aria-label'),
      text: (el.innerText || '').trim().slice(0, 80),
    }))
    .filter(b => b.text || b.aria);
  return { fileInputs, buttons };
});
writeFileSync(path.join(__dirname, 'debug', 'after-doc-click.json'), JSON.stringify(state, null, 2));
console.log('File inputs in DOM:', state.fileInputs.length, JSON.stringify(state.fileInputs));
console.log('Visible buttons after Add a document click:');
for (const b of state.buttons.slice(0, 30)) {
  const t = (b.text || b.aria || '').toLowerCase();
  if (/upload|file|browse|share|document|choose|select/.test(t)) {
    console.log(`  aria="${b.aria || ''}" text="${(b.text || '').slice(0, 60)}"`);
  }
}
await page.waitForTimeout(2000);
await ctx.close();
