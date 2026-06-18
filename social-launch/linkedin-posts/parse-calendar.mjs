#!/usr/bin/env node
// Parse calendar.md into posts-schedule.json — one entry per post with body + media path.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const md = readFileSync(path.join(__dirname, 'calendar.md'), 'utf8');

// Day block: starts at "### Day N — <weekday> <Month> <DD>"
// We allow trailing text on the line (e.g. "— LAUNCH DAY", "— CAMPAIGN CLOSE")
const MONTHS = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };

const dayBlockRe = /### Day (\d+) — (\w+ \w+ \d+)(?:[^\n]*)\n([\s\S]+?)(?=### Day \d+ —|\n## |\n---\n## )/g;
const slotRe = /\*\*(AM|PM) \((\d{1,2}:\d{2}) IST\) · ([^\n*]+?)\*\*\n([\s\S]+?)(?=\n\*\*(?:AM|PM) \(\d|\n### Day |\n## Week |\n## Format|\n## Image|\n## Operating|\n---\s*\n)/g;

// "Post body:" / "Post body (...):" — looser variant for polls.
const postBodyRe = /Post body[^\n:]*:\s*\n```\n([\s\S]+?)\n```/;
// First code block in a slot (used for text-only posts).
const firstCodeRe = /\n```\n([\s\S]+?)\n```/;
// First-comment line.
const firstCommentRe = /\*\*First comment:\*\*\s*`([^`]+)`/;

const posts = [];
let m;
while ((m = dayBlockRe.exec(md)) !== null) {
  const day = parseInt(m[1], 10);
  const dateHeader = m[2].trim();     // e.g. "Sat May 23"
  const block = m[3];

  // Iterate slots inside the day block.
  let s;
  slotRe.lastIndex = 0;
  while ((s = slotRe.exec(block)) !== null) {
    const slot = s[1];                   // AM | PM
    const time = s[2];                   // 11:00 | 21:00
    const typeLine = s[3].trim();        // e.g. "text-only · founder launch post"
    const slotBody = s[4];

    // Extract body — prefer "Post body:" anchored block, else first code block.
    let body = null;
    const pbMatch = postBodyRe.exec(slotBody);
    if (pbMatch) {
      body = pbMatch[1];
    } else {
      const fcMatch = firstCodeRe.exec(slotBody);
      if (fcMatch) body = fcMatch[1];
    }
    if (!body) {
      console.warn(`  ⚠ Day ${day} ${slot}: no body extracted`);
      continue;
    }

    const fcMatch = firstCommentRe.exec(slotBody);
    const firstComment = fcMatch ? fcMatch[1].trim() : null;

    // Type detection from the slot header tag.
    const lower = typeLine.toLowerCase();
    let kind;
    if (lower.includes('text-only') || lower.includes('text only') || lower.includes('founder') || lower.includes('investor') || lower.includes('hiring') || lower.includes('design partner cta') || lower.includes('partner spotlight') || lower.includes('customer story') || lower.includes('compliance partners') || lower.includes('appreciation')) {
      kind = 'text-only';
    } else if (lower.includes('text card') || lower.includes('text-card')) {
      kind = 'card';
    } else if (lower.includes('mermaid')) {
      kind = 'mermaid';
    } else if (lower.includes('hero')) {
      kind = 'hero';
    } else if (lower.includes('carousel') || lower.includes('document carousel')) {
      kind = 'carousel';
    } else if (lower.includes('poll')) {
      kind = 'poll';
    } else if (lower.includes('recap')) {
      kind = 'text-only';
    } else {
      kind = 'text-only';
    }

    const id = `day${String(day).padStart(2, '0')}-${slot.toLowerCase()}`;

    // Derive media path based on what was rendered.
    let mediaType = null, mediaPath = null;
    if (kind === 'card' || kind === 'mermaid' || kind === 'hero') {
      const png = path.join('images', `${id}.png`);
      if (existsSync(path.join(__dirname, png))) {
        mediaType = 'image';
        mediaPath = png;
      }
    } else if (kind === 'carousel') {
      // Find any PDF matching `${id}-*.pdf` in images/.
      const carouselMap = {
        'day01-pm': 'images/day01-pm-payments-privacy.pdf',
        'day05-pm': 'images/day05-pm-built-around.pdf',
        'day08-pm': 'images/day08-pm-nillion-nucleus.pdf',
        'day10-pm': 'images/day10-pm-nilcc-tee.pdf',
        'day15-pm': 'images/day15-pm-onboarding-90s.pdf',
        'day18-pm': 'images/day18-pm-paystub-mobile.pdf',
        'day26-pm': 'images/day26-pm-vs-alternatives.pdf',
      };
      const pdf = carouselMap[id];
      if (pdf && existsSync(path.join(__dirname, pdf))) {
        mediaType = 'document';
        mediaPath = pdf;
      }
    }

    // ISO date — assume year 2026.
    const parts = dateHeader.split(/\s+/);  // ['Sat','May','23']
    const month = MONTHS[parts[1]];
    const dayN = parseInt(parts[2], 10);
    const iso = `2026-${String(month).padStart(2,'0')}-${String(dayN).padStart(2,'0')}`;

    posts.push({
      id,
      day,
      slot,
      date: dateHeader,
      iso,
      time,
      kind,
      typeLine,
      body: body.trim(),
      charCount: body.trim().length,
      mediaType,
      mediaPath,
      firstComment,
    });
  }
}

// Sort by day asc, AM before PM.
posts.sort((a, b) => a.day - b.day || (a.slot === 'AM' ? -1 : 1));

const out = path.join(__dirname, 'posts-schedule.json');
writeFileSync(out, JSON.stringify(posts, null, 2));
console.log(`Wrote ${posts.length} posts → posts-schedule.json`);

// Sanity report.
const kinds = posts.reduce((acc, p) => { acc[p.kind] = (acc[p.kind] || 0) + 1; return acc; }, {});
console.log('Kinds:', kinds);
const withMedia = posts.filter(p => p.mediaPath).length;
console.log(`With media: ${withMedia}/${posts.length}`);
const tooLong = posts.filter(p => p.charCount > 2900);
if (tooLong.length) {
  console.log(`⚠ ${tooLong.length} posts over 2900 chars:`, tooLong.map(p => `${p.id}=${p.charCount}`));
}
const noBody = posts.filter(p => !p.body || p.body.length < 30);
if (noBody.length) {
  console.log(`⚠ ${noBody.length} posts with short/missing body:`, noBody.map(p => p.id));
}
