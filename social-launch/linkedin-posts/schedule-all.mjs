#!/usr/bin/env node
// Schedule every post in posts-schedule.json onto the Meet Civitas LinkedIn company page.
//
// Usage:
//   node schedule-all.mjs                  → schedule all 60
//   node schedule-all.mjs --dry            → walk the flow without final submit
//   node schedule-all.mjs --from 1 --to 7  → schedule a range only
//   node schedule-all.mjs --skip-polls     → skip the 2 poll posts (D3PM, D17PM)
//
// First run: a Chromium window opens. Log into LinkedIn, navigate to the
// Meet Civitas COMPANY PAGE admin view, set yourself as posting "as Meet
// Civitas" via the author switcher in the composer. Then return to the
// terminal — the script auto-detects /feed and continues. The browser
// profile is persisted in ./browser-data so future runs skip login.
//
// IMPORTANT — timezone: LinkedIn's scheduler uses your account's local
// timezone. Posts in posts-schedule.json are timed in IST (Asia/Kolkata).
// Set your LinkedIn account timezone to IST under Settings → Account →
// Time zone, or the wall-clock times will be wrong.
//
// Selectors target LinkedIn's 2025-2026 desktop web UI. If LinkedIn ships
// a redesign, update the constants at the top of run() below.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const SKIP_POLLS = argv.includes('--skip-polls');
function flagInt(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? parseInt(argv[i + 1], 10) : null;
}
const FROM = flagInt('--from');
const TO = flagInt('--to');

const posts = JSON.parse(readFileSync(path.join(__dirname, 'posts-schedule.json'), 'utf8'));
const logPath = path.join(__dirname, 'scheduled-log.json');
const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : {};
function persist() { writeFileSync(logPath, JSON.stringify(log, null, 2)); }

function inRange(p) {
  if (FROM != null && p.day < FROM) return false;
  if (TO != null && p.day > TO) return false;
  return true;
}

const targets = posts.filter(inRange).filter(p => !(SKIP_POLLS && p.kind === 'poll'));
console.log(`Targeting ${targets.length} posts (DRY=${DRY}, FROM=${FROM ?? 1}, TO=${TO ?? 30})\n`);

// Persistent profile so login survives across runs.
const profileDir = path.join(__dirname, 'browser-data');
mkdirSync(profileDir, { recursive: true });
const ctx = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1400, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] || await ctx.newPage();

console.log('Opening LinkedIn… if not logged in, log in now. Auto-detecting /feed…');
await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
await page.waitForURL(/linkedin\.com\/feed/, { timeout: 600_000 });
console.log('✓ logged in.');

// Navigate to the Civitas company admin by numeric company ID (the slug
// URL redirects to /company/unavailable/). 117124184 is the Meet Civitas
// page id — visible in the URL after clicking "Civitas" in the My Pages
// sidebar on /feed.
const COMPANY_ID = '117124184';
const COMPANY_ADMIN_URL = `https://www.linkedin.com/company/${COMPANY_ID}/admin/dashboard/`;
console.log(`Navigating to Civitas admin → ${COMPANY_ADMIN_URL}`);
await page.goto(COMPANY_ADMIN_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
if (/unavailable/i.test(page.url())) {
  console.log(`✗ admin URL redirected to ${page.url()}. Falling back to clicking "Civitas" in /feed sidebar.`);
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.getByText(/^Civitas$/i).first().click({ timeout: 5000 });
  await page.waitForTimeout(4000);
}
console.log(`✓ on Civitas admin → ${page.url()}\n`);

// ─── helpers ──────────────────────────────────────────────────────────────
async function openComposer() {
  // Step 1 — click "+ Create" in the Civitas admin's left page-identity card.
  let createClicked = false;
  for (const fn of [
    () => page.getByRole('button', { name: /Create/i }).first().click({ timeout: 4000 }),
    () => page.locator('button:has-text("Create")').first().click({ timeout: 4000 }),
  ]) {
    try { await fn(); createClicked = true; break; } catch { /* try next */ }
  }
  if (!createClicked) {
    await page.screenshot({ path: path.join(__dirname, 'debug', `no-create-${Date.now()}.png`) }).catch(() => {});
    throw new Error('could not click "+ Create" button on company admin');
  }
  // Step 2 — wait for the "Create" modal (heading text = "Create"), then
  // click the "Start a post" option (don't use ^...$ anchors — parent
  // element's innerText includes the subtitle "Share content to connect…").
  await page.waitForTimeout(1200);
  let postClicked = false;
  for (const fn of [
    () => page.getByText('Start a post', { exact: true }).first().click({ timeout: 4000 }),
    () => page.locator('text=Start a post').first().click({ timeout: 4000 }),
    () => page.locator('[role="dialog"], [role="menu"]').locator('text=Start a post').first().click({ timeout: 4000 }),
  ]) {
    try { await fn(); postClicked = true; break; } catch { /* try next */ }
  }
  if (!postClicked) {
    await page.screenshot({ path: path.join(__dirname, 'debug', `no-start-post-${Date.now()}.png`) }).catch(() => {});
    throw new Error('could not click "Start a post" option inside Create modal');
  }
}

async function setAuthorToCompany() {
  // Canonical "composer is ready" signal: Quill editor mounted.
  const editor = page.locator('div.ql-editor[contenteditable="true"]').first();
  await editor.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);

  // Step 1 — Click the "Post to Anyone" chip to open the Post settings panel.
  const chipStrategies = [
    () => page.locator('button, [role="button"]').filter({ hasText: /post to (?:anyone|connections)/i }).first().click({ timeout: 3000 }),
    () => page.getByText(/Post to Anyone/i).first().locator('xpath=ancestor-or-self::*[self::button or @role="button" or @tabindex="0"][1]').click({ timeout: 3000 }),
    () => page.getByText(/Post to Anyone/i).first().click({ timeout: 3000 }),
  ];
  let chipOk = false;
  for (const fn of chipStrategies) {
    try { await fn(); chipOk = true; break; } catch { /* try next */ }
  }
  if (!chipOk) {
    await page.screenshot({ path: path.join(__dirname, 'debug', `no-chip-${Date.now()}.png`) }).catch(() => {});
    return false;
  }
  // Wait for the Post settings panel to render.
  await page.locator('text=/Who can see your post/i').first().waitFor({ timeout: 5000 }).catch(() => {});

  // Step 2 — Within the Post settings panel, click the author row (shows
  // current author name + a › caret). The author row is ABOVE "Who can see
  // your post?". Find any clickable element whose text contains the user's
  // first name.
  const authorRowOpened = await page.evaluate(() => {
    function clickable(el) {
      return el && (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.getAttribute('tabindex') === '0');
    }
    // Find the visibility row anchor.
    const anchors = Array.from(document.querySelectorAll('*')).filter(el => /who can see your post/i.test((el.innerText || '').trim()));
    if (!anchors.length) return false;
    const anchor = anchors[0];
    const anchorTop = anchor.getBoundingClientRect().top;
    // Find clickable rows above the anchor with a user-name-like text.
    const candidates = Array.from(document.querySelectorAll('*')).filter(clickable);
    for (const c of candidates) {
      const r = c.getBoundingClientRect();
      if (r.top >= anchorTop || r.top < anchorTop - 250) continue;
      const t = (c.innerText || '').trim();
      // Author row will contain the user's display name. Match a "<word> <word>" pattern (Rythme Nagrani).
      if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(t) && t.length < 80) {
        c.click();
        return true;
      }
    }
    return false;
  });
  if (!authorRowOpened) {
    await page.screenshot({ path: path.join(__dirname, 'debug', `no-author-row-${Date.now()}.png`) }).catch(() => {});
    return false;
  }
  await page.waitForTimeout(700);

  // Step 3 — The author picker view shows a list of pages. Click "Civitas".
  let picked = false;
  for (const fn of [
    () => page.getByText(/^Civitas$/i).first().click({ timeout: 4000 }),
    () => page.locator('text=Civitas').first().click({ timeout: 4000 }),
  ]) {
    try { await fn(); picked = true; break; } catch { /* try next */ }
  }
  if (!picked) {
    await page.screenshot({ path: path.join(__dirname, 'debug', `no-civitas-${Date.now()}.png`) }).catch(() => {});
    return false;
  }
  await page.waitForTimeout(500);

  // Step 4 — Close the Post settings panel via the Done button. After
  // clicking Civitas the chip should already show "Civitas" — Done commits.
  for (const fn of [
    () => page.getByRole('button', { name: /^Done$/i }).click({ timeout: 3000 }),
    () => page.getByText(/^Done$/i).first().click({ timeout: 3000 }),
  ]) {
    try { await fn(); break; } catch { /* try next */ }
  }
  await page.waitForTimeout(700);

  // Verify the chip is now Civitas.
  const composerText = await page.evaluate(() => {
    const ed = document.querySelector('div.ql-editor[contenteditable="true"]');
    if (!ed) return '';
    let modal = ed;
    while (modal && modal.parentElement && modal.getBoundingClientRect().width < 500) modal = modal.parentElement;
    return (modal?.innerText || '').slice(0, 300);
  }).catch(() => '');
  const switched = /civitas/i.test(composerText) && !/rythme nagrani/i.test(composerText.slice(0, 150));
  if (!switched) {
    await page.screenshot({ path: path.join(__dirname, 'debug', `not-switched-${Date.now()}.png`) }).catch(() => {});
  }
  return switched;
}

async function typeBody(body) {
  const editor = page.locator('div.ql-editor[contenteditable="true"]').first();
  await editor.waitFor({ timeout: 10_000 });
  await editor.click();
  // Insert newlines as paragraph breaks — pressing Enter in Quill makes a new
  // paragraph, which matches LinkedIn's rendered output.
  const paras = body.split(/\n\n+/);
  for (let i = 0; i < paras.length; i++) {
    if (i > 0) {
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
    }
    // Within a paragraph, single newlines become soft line breaks (Shift+Enter).
    const lines = paras[i].split('\n');
    for (let j = 0; j < lines.length; j++) {
      if (j > 0) await page.keyboard.press('Shift+Enter');
      await page.keyboard.insertText(lines[j]);
    }
  }
}

async function clickComposerButton(locators) {
  for (const fn of locators) {
    try { await fn(); return true; } catch { /* try next */ }
  }
  return false;
}

async function uploadImage(absPath) {
  // LinkedIn opens an OS file picker on image-button click. Intercept via
  // Playwright's filechooser event instead of fishing for input[type=file].
  const tryClicks = [
    () => page.getByRole('button', { name: /^Add a photo$/i }).first().click({ timeout: 3000 }),
    () => page.getByRole('button', { name: /add media/i }).first().click({ timeout: 3000 }),
    () => page.locator('button[aria-label*="photo" i]').first().click({ timeout: 3000 }),
    () => page.locator('button[aria-label*="image" i]').first().click({ timeout: 3000 }),
    () => page.locator('button[aria-label*="media" i]').first().click({ timeout: 3000 }),
  ];
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    (async () => {
      const ok = await clickComposerButton(tryClicks);
      if (!ok) {
        await page.screenshot({ path: path.join(__dirname, 'debug', `no-image-btn-${Date.now()}.png`) }).catch(() => {});
        throw new Error('could not click image-upload button in composer');
      }
    })(),
  ]);
  await chooser.setFiles(absPath);
  // Preview opens. Confirm with Done / Next.
  const done = page.locator('button:has-text("Done"), button:has-text("Next")').first();
  await done.waitFor({ timeout: 30_000 });
  await done.click();
}

async function uploadDocument(absPath, title) {
  // The company composer's "+" overflow uses aria-label="More" (confirmed
  // via toolbar-row dump). Scope to the composer's dialog so we don't pick
  // up the LinkedIn nav's "Show more"-style page buttons.
  const composer = page.locator('div[role="dialog"]').filter({ has: page.locator('div.ql-editor[contenteditable="true"]') });
  const overflowClicks = [
    () => composer.locator('button[aria-label="More"]').first().click({ timeout: 3000 }),
    () => page.locator('button[aria-label="More"]').last().click({ timeout: 3000 }),
    () => page.locator('button[aria-label="More options"]').first().click({ timeout: 3000 }),
  ];
  const overflowOk = await clickComposerButton(overflowClicks);
  if (!overflowOk) {
    await page.screenshot({ path: path.join(__dirname, 'debug', `no-overflow-${Date.now()}.png`) }).catch(() => {});
    throw new Error('could not click composer "More" overflow button');
  }
  await page.waitForTimeout(900);

  // Click "Add a document" — places a visible file input in the DOM
  // (accept=".doc,.docx,.pdf,.ppt,.pptx"). No native filechooser event fires.
  const docClicks = [
    () => page.locator('button[aria-label="Add a document"]').first().click({ timeout: 4000 }),
    () => page.locator('button[aria-label*="Add a document" i]').first().click({ timeout: 4000 }),
  ];
  const docOk = await clickComposerButton(docClicks);
  if (!docOk) {
    await page.screenshot({ path: path.join(__dirname, 'debug', `no-doc-btn-${Date.now()}.png`) }).catch(() => {});
    throw new Error('could not click "Add a document" in composer');
  }
  // Find the doc-typed file input and stuff the PDF into it directly.
  const docInput = page.locator('input[type="file"][accept*="pdf"]').first();
  await docInput.waitFor({ timeout: 8000 });
  await docInput.setInputFiles(absPath);
  // LinkedIn asks for a doc title.
  const titleField = page.locator('input[placeholder*="title" i], input[aria-label*="title" i]').first();
  try {
    await titleField.waitFor({ timeout: 10_000 });
    await titleField.fill(title || 'Civitas');
  } catch { /* title may auto-populate */ }
  // Confirm with Done / Next.
  const done = page.locator('button:has-text("Done"), button:has-text("Next")').first();
  await done.waitFor({ timeout: 60_000 });
  await done.click();
}

async function openScheduleDialog() {
  // The clock icon lives next to the Post button in the composer footer.
  const clock = page.locator('button[aria-label*="Schedule" i]').first();
  if (await clock.count()) {
    await clock.click();
    return;
  }
  // Fallback: dropdown caret next to "Post".
  const caret = page.locator('button[aria-label*="Post options"], button[aria-label*="Show more options"]').last();
  if (await caret.count()) {
    await caret.click();
    await page.locator('text=/Schedule/i').first().click();
    return;
  }
  throw new Error('could not open Schedule dialog');
}

async function setScheduleDateTime(iso, time) {
  // LinkedIn's schedule dialog has a Date dropdown (calendar picker) and a
  // Time dropdown (HH:MM AM/PM). We use the underlying inputs where exposed.
  // Date — try native input first.
  const dateInput = page.locator('input[name="scheduleDate"], input[aria-label*="Date" i][type="text"], input[type="date"]').first();
  if (await dateInput.count()) {
    await dateInput.fill('');
    // LinkedIn's date is MM/DD/YYYY in US locale; we re-format from iso "YYYY-MM-DD".
    const [y, m, d] = iso.split('-');
    await dateInput.fill(`${m}/${d}/${y}`);
    await page.keyboard.press('Tab');
  }
  // Time — LinkedIn shows e.g. "9:00 AM" in 12-hour format.
  const [hh, mm] = time.split(':').map(Number);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = ((hh + 11) % 12) + 1;
  const timeStr = `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
  const timeInput = page.locator('input[name="scheduleTime"], input[aria-label*="Time" i]').first();
  if (await timeInput.count()) {
    await timeInput.fill('');
    await timeInput.fill(timeStr);
    await page.keyboard.press('Tab');
  }
  // Click Next/Done in the schedule modal.
  const next = page.locator('button:has-text("Next"), button:has-text("Done")').first();
  await next.waitFor({ timeout: 15_000 });
  await next.click();
}

async function clickSchedule() {
  // After setting date/time the main Post button becomes "Schedule".
  const btn = page.locator('button:has-text("Schedule")').last();
  await btn.waitFor({ timeout: 10_000 });
  if (DRY) {
    console.log('  [dry] would click Schedule.');
    // Bail out of the composer.
    await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")').first();
    if (await discard.count()) await discard.click().catch(() => {});
    return;
  }
  await btn.click();
}

// ─── main loop ────────────────────────────────────────────────────────────
let ok = 0, skipped = 0, failed = 0;
for (const p of targets) {
  const prev = log[p.id];
  if (prev?.status === 'scheduled') { skipped++; console.log(`SKIP ${p.id} (already scheduled @ ${prev.scheduledFor})`); continue; }

  console.log(`\n[${p.id}] ${p.iso} ${p.time} IST · ${p.kind} · ${p.charCount} chars`);
  if (p.mediaPath) console.log(`  media: ${p.mediaType} ${p.mediaPath}`);

  try {
    // Re-anchor on the admin dashboard for every iteration. This is the
    // only state where the "+ Create" button reliably exists. Cheaper than
    // surgical recovery after each failure.
    if (page.url() !== COMPANY_ADMIN_URL) {
      await page.goto(COMPANY_ADMIN_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
    }
    await openComposer();
    await page.locator('div.ql-editor[contenteditable="true"]').first().waitFor({ timeout: 12_000 });
    await page.waitForTimeout(500);

    // Upload media FIRST while the toolbar is in its full state. Once
    // body is typed the toolbar collapses some buttons behind a "+" overflow
    // whose aria-label varies — easier to side-step the problem.
    if (p.mediaType === 'image') {
      const abs = path.join(__dirname, p.mediaPath);
      await uploadImage(abs);
    } else if (p.mediaType === 'document') {
      const abs = path.join(__dirname, p.mediaPath);
      const titleMap = {
        'day01-pm': 'The Payments Privacy Problem',
        'day05-pm': 'Why we built around the failure',
        'day08-pm': 'Civitas × Nillion Nucleus',
        'day10-pm': 'nilCC TEE for non-cryptographers',
        'day15-pm': 'Employee onboarding in 90 seconds',
        'day18-pm': 'The mobile paystub experience',
        'day26-pm': 'Civitas vs the alternatives',
      };
      await uploadDocument(abs, titleMap[p.id] || 'Civitas');
    }

    // Body goes in AFTER media — preview is already attached, so typing
    // doesn't shrink the toolbar visibility anymore.
    await page.waitForTimeout(500);
    await typeBody(p.body);

    await page.waitForTimeout(500);
    await openScheduleDialog();
    await page.waitForTimeout(400);
    await setScheduleDateTime(p.iso, p.time);
    await page.waitForTimeout(400);
    await clickSchedule();

    log[p.id] = { status: DRY ? 'dry-ok' : 'scheduled', scheduledFor: `${p.iso} ${p.time} IST`, kind: p.kind, at: new Date().toISOString() };
    persist();
    ok++;
    console.log(`  ✓ ${DRY ? 'dry-walked' : 'scheduled'} ${p.id}`);
    // Brief randomized cool-down to look less bot-like.
    await page.waitForTimeout(2500 + Math.floor(Math.random() * 2500));
  } catch (e) {
    failed++;
    log[p.id] = { status: 'error', error: e.message, kind: p.kind, at: new Date().toISOString() };
    persist();
    console.log(`  ✗ ${p.id} — ${e.message.split('\n')[0]}`);
    // Best-effort recovery — close any open dialog, then re-anchor on
    // admin dashboard so the NEXT iteration starts clean.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
    const discard = page.locator('button:has-text("Discard")').first();
    if (await discard.count()) await discard.click().catch(() => {});
    await page.goto(COMPANY_ADMIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(3000);
  }
}

console.log(`\nDone. ok=${ok} skipped=${skipped} failed=${failed}. Log → scheduled-log.json`);
await ctx.close();
