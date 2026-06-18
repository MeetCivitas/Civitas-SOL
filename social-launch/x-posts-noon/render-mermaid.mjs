#!/usr/bin/env node
// Render every noon post's Mermaid diagram to a branded 1600x900 PNG.
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const posts = JSON.parse(readFileSync(path.join(__dirname, 'posts-noon.json'), 'utf8'));
mkdirSync(path.join(__dirname, 'images'), { recursive: true });
const templateUrl = pathToFileURL(path.join(__dirname, 'mermaid-template.html')).href;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(templateUrl);
await page.waitForFunction(() => typeof window.renderCard === 'function');

let n = 0, errs = 0;
for (const p of posts) {
  const meta = `Day ${String(p.day).padStart(2,'0')} · ${p.date.split(' ').slice(1).join(' ')} · 15:00 IST`;
  // Bold the lead noun in the topic.
  const title = p.topic.replace(/^([^—:(]+)/, '<b>$1</b>');
  try {
    await page.evaluate(async ({ meta, title, mer }) => {
      await window.renderCard({ meta, title, mermaid: mer });
    }, { meta, title, mer: p.mermaid });
    await page.waitForFunction(() => window.__RENDERED__ === true, null, { timeout: 15000 });
    // Reset for next iteration.
    await page.evaluate(() => { window.__RENDERED__ = false; });
    const out = path.join(__dirname, 'images', `${p.id}.png`);
    await page.screenshot({ path: out, type: 'png', clip: { x: 0, y: 0, width: 1600, height: 900 } });
    n++;
    if (n % 5 === 0) console.log(`  rendered ${n}/${posts.length}`);
  } catch (e) {
    errs++;
    console.log(`  ✗ ${p.id} render failed: ${e.message.split('\n')[0]}`);
  }
}
await browser.close();
console.log(`Done. ${n} rendered, ${errs} failures.`);
