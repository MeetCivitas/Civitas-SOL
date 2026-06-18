#!/usr/bin/env node
// Open Civitas admin, click + Create, screenshot the dropdown AND the composer state.
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

await page.goto('https://www.linkedin.com/company/117124184/admin/dashboard/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
await page.screenshot({ path: path.join(__dirname, 'debug', 'A-before-create.png') });

let clicked = false;
for (const fn of [
  () => page.getByRole('button', { name: /Create/i }).first().click({ timeout: 4000 }),
  () => page.locator('button:has-text("Create")').first().click({ timeout: 4000 }),
  () => page.getByText(/^\+?\s*Create$/).first().click({ timeout: 4000 }),
]) {
  try { await fn(); clicked = true; console.log('Create clicked via strategy'); break; } catch { /* try next */ }
}
if (!clicked) { console.log('Failed to click Create; bailing'); await ctx.close(); process.exit(1); }
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(__dirname, 'debug', 'B-after-create.png') });

// Dump every visible element near the Create button.
const popover = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('*'));
  return all
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.top > 50 && r.top < 800 && r.left > 0 && r.left < 800 && r.width > 50 && r.width < 600 && el.innerText && el.innerText.length < 200;
    })
    .map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      text: (el.innerText || '').trim().slice(0, 120),
    }))
    .filter(b => b.text)
    .slice(0, 60);
});
writeFileSync(path.join(__dirname, 'debug', 'create-popover.json'), JSON.stringify(popover, null, 2));
console.log(`Dumped ${popover.length} elements after Create click. URL: ${page.url()}`);

// Try the most likely option labels.
for (const label of ['Start a post', 'Post', 'Create post', 'Share an update']) {
  const loc = page.getByText(new RegExp(`^${label}$`, 'i')).first();
  if (await loc.count()) {
    console.log(`Found option: "${label}". Clicking.`);
    await loc.click().catch(() => {});
    break;
  }
}
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(__dirname, 'debug', 'C-after-option-click.png') });

// Inspect what kind of editor (if any) is now on the page.
const editorInfo = await page.evaluate(() => {
  const ql = document.querySelector('div.ql-editor[contenteditable="true"]');
  const ce = document.querySelectorAll('[contenteditable="true"]');
  return {
    ql: ql ? { tag: ql.tagName, cls: ql.className?.slice(0, 200) } : null,
    contentEditableCount: ce.length,
    contentEditableSamples: Array.from(ce).slice(0, 3).map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      aria: el.getAttribute('aria-label'),
      cls: el.className?.toString?.().slice(0, 200),
    })),
  };
});
console.log('Editor state:', JSON.stringify(editorInfo, null, 2));

await page.waitForTimeout(2000);
await ctx.close();
