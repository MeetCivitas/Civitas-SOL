#!/usr/bin/env node
// Render every mermaid diagram from data.json to a 1600x900 PNG via headless Playwright.
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
const posts = data.mermaids;
mkdirSync(path.join(__dirname, 'images'), { recursive: true });
const templateUrl = pathToFileURL(path.join(__dirname, 'mermaid-template.html')).href;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(templateUrl);
await page.waitForFunction(() => typeof window.renderCard === 'function');

let n = 0, errs = 0;
for (const p of posts) {
  const meta = `Day ${String(p.day).padStart(2,'0')} · ${p.slot} · ${p.date.split(' ').slice(1).join(' ')} · 11:00 IST`;
  const title = p.title.replace(/^([^—:(]+)/, '<b>$1</b>');
  try {
    await page.evaluate(async ({ meta, title, mer }) => {
      window.__RENDERED__ = false;
      await window.renderCard({ meta, title, mermaid: mer });
    }, { meta, title, mer: p.mermaid });
    await page.waitForFunction(() => window.__RENDERED__ === true, null, { timeout: 15000 });
    const out = path.join(__dirname, 'images', `${p.id}.png`);
    await page.screenshot({ path: out, type: 'png', clip: { x: 0, y: 0, width: 1600, height: 900 } });
    console.log(`  ✓ ${p.id}`);
    n++;
  } catch (e) {
    errs++;
    console.log(`  ✗ ${p.id}: ${e.message.split('\n')[0]}`);
  }
}
await browser.close();
console.log(`Done. ${n} rendered, ${errs} failures.`);
