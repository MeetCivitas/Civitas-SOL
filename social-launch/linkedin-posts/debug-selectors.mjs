#!/usr/bin/env node
// Open LinkedIn /feed, dump top-of-feed buttons + take screenshot for selector iteration.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profileDir = path.join(__dirname, 'browser-data');
mkdirSync(path.join(__dirname, 'debug'), { recursive: true });

const ctx = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1400, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] || await ctx.newPage();

await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
await page.waitForURL(/linkedin\.com\/feed/, { timeout: 60_000 });
await page.waitForTimeout(4000);

await page.screenshot({ path: path.join(__dirname, 'debug', 'feed.png'), fullPage: false });

// Dump buttons in the top 1000px of the viewport.
const buttons = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('button, [role="button"], a[role="button"], div[role="button"]'));
  return all
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.top < 1000 && r.top > -100 && r.width > 0;
    })
    .map(el => ({
      tag: el.tagName,
      text: (el.innerText || '').trim().slice(0, 80),
      aria: el.getAttribute('aria-label'),
      cls: el.className?.toString?.().slice(0, 200),
      id: el.id || null,
      dataTest: el.getAttribute('data-test-id') || el.getAttribute('data-control-name'),
    }))
    .filter(b => b.text || b.aria);
});

writeFileSync(path.join(__dirname, 'debug', 'feed-buttons.json'), JSON.stringify(buttons, null, 2));
console.log(`Dumped ${buttons.length} buttons. Screenshot at debug/feed.png`);

// Also try the company page admin URL — that's the canonical surface for company-page posting.
await page.goto('https://www.linkedin.com/company/meetcivitas/admin/page-posts/published/', { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(4000);
const url = page.url();
console.log('After admin navigation, URL =', url);
await page.screenshot({ path: path.join(__dirname, 'debug', 'admin.png'), fullPage: false });

const adminButtons = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('button, [role="button"], a[role="button"], div[role="button"]'));
  return all
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.top < 1000 && r.top > -100 && r.width > 0;
    })
    .map(el => ({
      tag: el.tagName,
      text: (el.innerText || '').trim().slice(0, 80),
      aria: el.getAttribute('aria-label'),
      cls: el.className?.toString?.().slice(0, 200),
    }))
    .filter(b => b.text || b.aria);
});
writeFileSync(path.join(__dirname, 'debug', 'admin-buttons.json'), JSON.stringify(adminButtons, null, 2));
console.log(`Admin URL dumped ${adminButtons.length} buttons.`);

await page.waitForTimeout(2000);
await ctx.close();
