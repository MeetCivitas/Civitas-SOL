#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const md = readFileSync('./noon-calendar.md', 'utf8');

// Day blocks: "## Day N — <Weekday> <Mon> <DD>" ...next "## Day" or "## Image" or "---"
const dayRegex = /## Day (\d+) — (.+?)\n([\s\S]+?)(?=## Day |\n---\n|## Image)/g;
const posts = [];
let m;
while ((m = dayRegex.exec(md)) !== null) {
  const dayNum = parseInt(m[1], 10);
  const dateHeader = m[2].split('(')[0].trim();   // "Mon May 19"
  const block = m[3];

  // Topic line: **Topic:** <text>
  const topic = (block.match(/\*\*Topic:\*\*\s*(.+)/) || [])[1]?.trim() || '';

  // Mermaid source
  const mer = (block.match(/```mermaid\n([\s\S]+?)\n```/) || [])[1] || '';

  // Caption
  const cap = (block.match(/\*\*Caption:\*\*\n```\n([\s\S]+?)\n```/) || [])[1] || '';

  posts.push({
    day: dayNum,
    slot: 'NOON',
    kind: 'mermaid',
    date: dateHeader,
    time: '15:00',
    topic,
    mermaid: mer,
    body: cap,
    charCount: cap.length,
  });
}

const MONTHS = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
for (const p of posts) {
  const parts = p.date.split(/\s+/);
  p.iso = `2026-${String(MONTHS[parts[1]]).padStart(2,'0')}-${String(parseInt(parts[2],10)).padStart(2,'0')}`;
  p.id = `day${String(p.day).padStart(2,'0')}-noon`;
  p.imageFile = `./images/${p.id}.png`;
}

writeFileSync('./posts-noon.json', JSON.stringify(posts, null, 2));
console.log(`Wrote ${posts.length} noon posts to posts-noon.json`);
const over = posts.filter(p => p.charCount > 280);
console.log(`Over 280: ${over.length}`);
