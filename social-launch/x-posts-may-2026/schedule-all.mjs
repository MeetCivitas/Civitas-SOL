#!/usr/bin/env node
/*
 * schedule-all.mjs — Schedule all 60 Civitas X posts in one unattended run.
 *
 * Usage:
 *   node schedule-all.mjs            # schedule everything in posts.json
 *   node schedule-all.mjs --from 1 --to 14   # only Week 1
 *   node schedule-all.mjs --dry      # walk through composes, don't click Schedule
 *
 * First run: a Chromium window opens at x.com. Log in once.
 * The script then waits for `pnpm run logged-in` (or you can press Enter in
 * the launching terminal) and proceeds. Browser state is saved to
 * ./browser-data/ so subsequent runs skip login.
 *
 * Output: scheduled-log.json (post id → status + scheduled-for + tweet error).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ----- args -----
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i === -1 ? d : argv[i + 1];
};
const dryRun = argv.includes('--dry');
const fromDay = parseInt(arg('--from', '1'), 10);
const toDay   = parseInt(arg('--to',   '30'), 10);

// ----- load posts -----
const allPosts = JSON.parse(readFileSync(path.join(__dirname, 'posts.json'), 'utf8'));
const posts = allPosts.filter(p => p.day >= fromDay && p.day <= toDay);
console.log(`▶ Posts in range Day ${fromDay}–${toDay}: ${posts.length} of ${allPosts.length}`);

// ----- load existing log -----
const logFile = path.join(__dirname, 'scheduled-log.json');
const log = existsSync(logFile) ? JSON.parse(readFileSync(logFile, 'utf8')) : {};
const writeLog = () => writeFileSync(logFile, JSON.stringify(log, null, 2));

// ----- browser session (persistent) -----
const userDataDir = path.join(__dirname, 'browser-data');
mkdirSync(userDataDir, { recursive: true });

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1400, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] || (await ctx.newPage());

// ----- helpers -----
async function ensureLoggedIn() {
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  const isLoggedIn = async () => {
    try {
      await page.waitForSelector('[data-testid="SideNav_NewTweet_Button"]', { timeout: 2000 });
      return true;
    } catch { return false; }
  };
  if (await isLoggedIn()) {
    console.log('▶ Already logged in.');
    return;
  }
  console.log('▶ Please log in to X in the open browser window. Polling every 5s for up to 5 min…');
  const start = Date.now();
  while (Date.now() - start < 5 * 60 * 1000) {
    if (await isLoggedIn()) {
      console.log('▶ Login detected — continuing.');
      return;
    }
    await page.waitForTimeout(5000);
  }
  throw new Error('Login timeout — aborting.');
}

// Click a testid in the modal via JS — bypasses ScrollSnap visibility issues.
async function clickModalTestid(testid) {
  const ok = await page.evaluate((tid) => {
    const dlg = document.querySelector('[aria-labelledby="modal-header"]');
    const el  = dlg?.querySelector(`[data-testid="${tid}"]`);
    if (!el) return false;
    el.click();
    return true;
  }, testid);
  if (!ok) throw new Error(`clickModalTestid: no element with data-testid=${testid}`);
}

async function openCompose() {
  await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[aria-labelledby="modal-header"] [data-testid="tweetTextarea_0"]', { timeout: 20000 });
}

async function uploadImage(imagePath) {
  // Set files directly on the (hidden) file input in the modal.
  const fileInput = page.locator('[aria-labelledby="modal-header"] [data-testid="fileInput"]');
  await fileInput.setInputFiles(imagePath);
  // Wait for the media preview to appear.
  await page.waitForSelector('[aria-labelledby="modal-header"] [data-testid="attachments"]', { timeout: 20000 });
}

async function typeText(body) {
  // Focus textbox.
  const tb = page.locator('[aria-labelledby="modal-header"] [data-testid="tweetTextarea_0"]');
  await tb.click();
  // Clear.
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  // Type slowly so Draft.js processes each keystroke.
  await page.keyboard.type(body, { delay: 5 });
  await page.waitForTimeout(400);
}

async function verifyText(expected) {
  const actual = await page.locator('[aria-labelledby="modal-header"] [data-testid="tweetTextarea_0"]').innerText();
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  return norm(actual).includes(norm(expected).slice(0, 40));
}

async function setSchedule(iso, time /* 'HH:MM' */) {
  // Click via JS to avoid ScrollSnap visibility issues with .click().
  await clickModalTestid('scheduleOption');
  // Wait for selects to appear (5 selects = schedule dialog ready).
  await page.waitForFunction(() => document.querySelectorAll('select').length >= 5, null, { timeout: 20000 });

  const [yyyy, mm, dd] = iso.split('-');
  const [hh, mi]       = time.split(':');
  await page.evaluate(({ mm, dd, yyyy, hh, mi }) => {
    function setSelect(sel, value) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const s = document.querySelectorAll('select');
    setSelect(s[0], String(parseInt(mm, 10)));
    setSelect(s[1], String(parseInt(dd, 10)));
    setSelect(s[2], String(parseInt(yyyy, 10)));
    setSelect(s[3], String(parseInt(hh, 10)));
    setSelect(s[4], String(parseInt(mi, 10)));
  }, { mm, dd, yyyy, hh, mi });

  // Click Confirm via JS.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => b.textContent?.trim() === 'Confirm');
    btn?.click();
  });
  // Wait for the schedule sub-modal to close (selects disappear) and modal compose textbox to be ready again.
  await page.waitForFunction(() => document.querySelectorAll('select').length === 0, null, { timeout: 20000 });
  await page.waitForSelector('[aria-labelledby="modal-header"] [data-testid="tweetTextarea_0"]', { timeout: 10000 });
}

async function submitSchedule() {
  // The Post button reads "Schedule" once a schedule is set.
  // aria-disabled check first.
  const isDisabled = await page.evaluate(() => {
    const dlg = document.querySelector('[aria-labelledby="modal-header"]');
    const btn = dlg?.querySelector('[data-testid="tweetButton"]');
    return btn?.getAttribute('aria-disabled') === 'true';
  });
  if (isDisabled) throw new Error('Schedule button disabled — likely empty text/image.');
  await clickModalTestid('tweetButton');
  // Wait for compose dialog to dismiss (URL leaves /compose/post OR modal disappears).
  await page.waitForFunction(
    () => !document.querySelector('[aria-labelledby="modal-header"]'),
    null,
    { timeout: 15000 }
  );
}

// ----- main loop -----
await ensureLoggedIn();

for (const p of posts) {
  if (log[p.id]?.status === 'scheduled') {
    console.log(`▶ ${p.id} already scheduled, skipping.`);
    continue;
  }
  const imagePath = path.join(__dirname, 'images', `${p.id}.png`);
  if (!existsSync(imagePath)) {
    console.log(`✗ ${p.id} — missing image at ${imagePath}, skipping`);
    log[p.id] = { status: 'no-image', path: imagePath };
    writeLog();
    continue;
  }
  console.log(`▶ ${p.id} — ${p.iso} ${p.time} IST (${p.kind}, ${p.charCount}c)`);
  try {
    await openCompose();
    await uploadImage(imagePath);
    await setSchedule(p.iso, p.time);
    // Type text LAST, after schedule is set, so no further focus loss mangles it.
    await typeText(p.body);
    if (!(await verifyText(p.body))) {
      // Retry once: clear and re-type.
      await typeText(p.body);
    }
    if (!(await verifyText(p.body))) throw new Error('text-mangled');
    if (dryRun) {
      console.log(`  (dry) would Schedule. Skipping submit.`);
      log[p.id] = { status: 'dry', scheduledFor: `${p.iso} ${p.time}` };
    } else {
      await submitSchedule();
      console.log(`  ✓ scheduled for ${p.iso} ${p.time} IST`);
      log[p.id] = { status: 'scheduled', scheduledFor: `${p.iso} ${p.time}`, ts: new Date().toISOString() };
    }
    writeLog();
    // Tiny inter-post delay to avoid rate triggers.
    await page.waitForTimeout(1500);
  } catch (e) {
    console.log(`  ✗ ${p.id} failed: ${e.message}`);
    log[p.id] = { status: 'error', error: e.message, ts: new Date().toISOString() };
    writeLog();
    // Close compose if stuck, then continue.
    try { await page.keyboard.press('Escape'); } catch {}
    try { await page.keyboard.press('Escape'); } catch {}
  }
}

console.log('Done. See scheduled-log.json.');
await ctx.close();
