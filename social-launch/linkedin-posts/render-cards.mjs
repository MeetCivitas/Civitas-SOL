#!/usr/bin/env node
// Render every text card from data.json to a 1600x900 PNG via headless Playwright.
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
const cards = data.cards;
mkdirSync(path.join(__dirname, 'images'), { recursive: true });
const templateUrl = pathToFileURL(path.join(__dirname, 'card-template.html')).href;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(templateUrl);
await page.waitForFunction(() => typeof window.renderCard === 'function');

let n = 0;
for (const c of cards) {
  const meta = `Day ${String(c.day).padStart(2,'0')} · ${c.slot} · ${c.date.split(' ').slice(1).join(' ')}`;
  await page.evaluate(({ body, meta }) => window.renderCard({ body, meta }), { body: c.body, meta });
  const out = path.join(__dirname, 'images', `${c.id}.png`);
  await page.screenshot({ path: out, type: 'png', clip: { x: 0, y: 0, width: 1600, height: 900 } });
  console.log(`  ✓ ${c.id}`);
  n++;
}
await browser.close();
console.log(`Done. ${n} cards in ./images/`);
