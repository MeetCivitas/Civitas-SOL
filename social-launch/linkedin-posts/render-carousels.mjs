#!/usr/bin/env node
// Render each carousel's slides to 1080x1080 PNGs, then stitch into one PDF per carousel.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
const carousels = data.carousels;
mkdirSync(path.join(__dirname, 'images'), { recursive: true });
mkdirSync(path.join(__dirname, 'images', 'carousels'), { recursive: true });
const templateUrl = pathToFileURL(path.join(__dirname, 'carousel-template.html')).href;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(templateUrl);
await page.waitForFunction(() => typeof window.renderSlide === 'function');

let totalSlides = 0, totalPdfs = 0;
for (const c of carousels) {
  const slidePngs = [];
  const total = c.slides.length;
  for (let i = 0; i < total; i++) {
    const slide = c.slides[i];
    const opts = { ...slide, pager: `${i + 1} / ${total}` };
    await page.evaluate((o) => {
      window.__RENDERED__ = false;
      window.renderSlide(o);
    }, opts);
    await page.waitForFunction(() => window.__RENDERED__ === true, null, { timeout: 8000 });
    const pngPath = path.join(__dirname, 'images', 'carousels', `${c.id}-${String(i + 1).padStart(2, '0')}.png`);
    const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1080 } });
    writeFileSync(pngPath, buf);
    slidePngs.push(buf);
    totalSlides++;
  }

  // Stitch all slides into one PDF.
  const pdf = await PDFDocument.create();
  for (const buf of slidePngs) {
    const img = await pdf.embedPng(buf);
    // LinkedIn doc carousels at 1:1 — pages 1080x1080 pts (1pt = 1/72 in).
    const pg = pdf.addPage([1080, 1080]);
    pg.drawImage(img, { x: 0, y: 0, width: 1080, height: 1080 });
  }
  const pdfBytes = await pdf.save();
  const pdfPath = path.join(__dirname, 'images', `${c.id}.pdf`);
  writeFileSync(pdfPath, pdfBytes);
  totalPdfs++;
  console.log(`  ✓ ${c.id}.pdf (${total} slides)`);
}

await browser.close();
console.log(`Done. ${totalSlides} slides across ${totalPdfs} PDFs in ./images/`);
