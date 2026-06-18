#!/usr/bin/env node
// Parse calendar.md into posts.json
import { readFileSync, writeFileSync } from 'node:fs';

const md = readFileSync('./calendar.md', 'utf8');

// Each day block: "### Day N — <Weekday> <Mon> <DD>"
// Inside, two posts, each headed "**AM (build, 09:00 IST):** <kind>" or "**PM (marketing, 20:00 IST):** <kind>"
// Followed by triple-backtick body.

const days = [];
const dayRegex = /### Day (\d+) — (.+?)\n([\s\S]+?)(?=### Day |\n## |\n---\n)/g;
let m;
while ((m = dayRegex.exec(md)) !== null) {
  const dayNum = parseInt(m[1], 10);
  const dateHeader = m[2].trim();
  const block = m[3];

  // Within block, capture each AM/PM post.
  const postRegex = /\*\*(AM|PM)\s*\(([^)]+)\):\*\*\s*([^\n]+)\n```\n([\s\S]+?)\n```/g;
  let p;
  while ((p = postRegex.exec(block)) !== null) {
    const slot = p[1];                        // AM or PM
    const meta = p[2].trim();                 // "build, 09:00 IST" / "marketing, 20:00 IST"
    const kindLine = p[3].trim();             // "hero image" / "text-card" / "text-card (VC bait — measured)"
    const body = p[4];
    const kind = /hero/i.test(kindLine) ? 'hero' : 'card';
    const time = slot === 'AM' ? '09:00' : '20:00';
    days.push({
      day: dayNum,
      slot,
      kind,
      date: dateHeader,         // "Mon May 19"
      time,
      meta,
      body,
      charCount: body.length,
    });
  }
}

// Derive ISO date (assume year 2026, parse Mon May 19 etc)
const MONTHS = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
for (const p of days) {
  const parts = p.date.split(/\s+/);          // ['Mon','May','19']
  const month = MONTHS[parts[1]];
  const dayN  = parseInt(parts[2], 10);
  const yyyy = 2026;
  p.iso = `${yyyy}-${String(month).padStart(2,'0')}-${String(dayN).padStart(2,'0')}`;
  p.id = `day${String(p.day).padStart(2,'0')}-${p.slot.toLowerCase()}`;
  p.imageFile = `./images/${p.id}.png`;
}

writeFileSync('./posts.json', JSON.stringify(days, null, 2));
console.log(`Wrote ${days.length} posts to posts.json`);
const hero = days.filter(d => d.kind === 'hero').length;
console.log(`  hero: ${hero}   card: ${days.length - hero}`);
const over = days.filter(d => d.charCount > 280);
console.log(`  over 280: ${over.length}`);
if (over.length) console.log(JSON.stringify(over.map(o=>({id:o.id, n:o.charCount})), null, 2));
