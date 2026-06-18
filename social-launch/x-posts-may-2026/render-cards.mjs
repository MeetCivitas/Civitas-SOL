#!/usr/bin/env node
// Render every "card" post in posts.json to a 1600x900 PNG using a headless Playwright browser.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const posts = JSON.parse(readFileSync(path.join(__dirname, 'posts.json'), 'utf8'));
const cards = posts.filter(p => p.kind === 'card');
mkdirSync(path.join(__dirname, 'images'), { recursive: true });
const templateUrl = pathToFileURL(path.join(__dirname, 'card-template.html')).href;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(templateUrl);

let n = 0;
for (const p of cards) {
  const meta = `Day ${String(p.day).padStart(2,'0')} · ${p.slot} · ${p.date.split(' ').slice(1).join(' ')}`;
  await page.evaluate(({ body, meta }) => window.renderCard({ body, meta }), { body: p.body, meta });
  const out = path.join(__dirname, 'images', `${p.id}.png`);
  await page.screenshot({ path: out, type: 'png', clip: { x: 0, y: 0, width: 1600, height: 900 } });
  n++;
  if (n % 10 === 0) console.log(`  rendered ${n}/${cards.length}`);
}
await browser.close();
console.log(`Done. ${n} cards in ./images/`);
