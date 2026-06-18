# Civitas LinkedIn Campaign — May 23 → Jun 21 2026

A 30-day, 60-post LinkedIn campaign for the **Meet Civitas** company page. Built for **VC inbound, design-partner recruiting, payroll-processor partnership, and a 10 → 10,000 follower run** in lockstep with the parallel X campaign at `../x-posts-may-2026/`.

- **Cadence:** 11:00 IST (AM, build/tech post) + 21:00 IST (PM, GTM/founder/VC post). 2 posts/day, 30 days.
- **Voice:** Mert × Naruto — receipts over rhetoric, one idea per post, no Cloak mentions.
- **Char range:** 1300–1800 (LinkedIn dwell-time sweet spot). Hard cap 3000.
- **Format mix:** 22 text-only · 12 text-card · 9 mermaid · 6 hero · 8 document carousels · 3 polls.
- **Partner emphasis:** W1 MagicBlock → W2 Nillion (Nucleus big drop) → W3 Privy + SNS/Bonfida → W4 Helius + Solana Foundation + investor close + hiring.

---

## File map

```
social-launch/linkedin-posts/
├── calendar.md         ← 60 posts, human-readable, the source of truth
├── README.md           ← this file
└── images/             ← rendered PNGs (carousels, text cards, mermaids, heroes)
```

The supporting infrastructure (parse-calendar.mjs, render-cards.mjs, render-mermaid.mjs, schedule-all.mjs) is intentionally **not built yet** — content quality first, automation after the user reviews. Patterns to mirror are in `../x-posts-may-2026/` and `../x-posts-noon/`.

---

## Why these times

- **11:00 IST (AM)** = 5:30 GMT, hits APAC EOD + India work day + EU early morning. Build/tech audience.
- **21:00 IST (PM)** = 11:30 ET / 8:30 PT, hits US prime LinkedIn time. GTM + VC + founder content.

The PM slot is the **money slot** — US-prime, when investors, payroll processors, and Fortune 500 finance leaders are scrolling.

---

## Why 60 posts on LinkedIn ≠ 60 posts on X

LinkedIn isn't X with longer character counts. Different rhythm:

1. **Longer-form wins.** Posts in the 1300–1800 char range outperform short posts by ~3x on dwell time, which is the metric LinkedIn weights highest.
2. **Document carousels are the highest-reach native format.** A 7–10-slide PDF carousel routinely 5–10x's the reach of a text post. Eight of the 60 posts are carousels — disproportionate weight.
3. **External links in the body suppress reach.** Always put `meetcivitas.xyz` and GitHub links in the **first comment**, never in the post body.
4. **Comments > likes > shares** for algorithm ranking. Posts ending in a question or hot take get more comments. Many of the 60 end with explicit asks ("comment with the layer you want me to deep-dive").
5. **Polls drive comment + DM volume.** Three polls deliberately placed (D3PM, D17PM, +1 floater) for audience data + engagement spike.
6. **Mentions of partner accounts drive cross-pollination.** Each partner spotlight tags the relevant company page — MagicBlock, Nillion, Privy, Bonfida, Helius, Solana Foundation, Chainalysis. Replace `@CompanyName` with the actual LinkedIn page tags when scheduling.
7. **Founder voice posts outperform tech posts by 3–5x in raw engagement.** The 22 text-only posts lean heavily into founder-voice essays — investor open letters, vulnerability check-ins, customer stories.

---

## Format breakdown (60 posts)

| Format | Count | Why this volume |
|---|---|---|
| Text-only | 22 | Founder voice, hot takes, investor letters, essays. LinkedIn's bread-and-butter long-form. |
| Text-card image | 12 | Quotable punchlines as 1600×900 cards. Same template as X (`../x-posts-may-2026/card-template.html`). |
| Mermaid diagram | 9 | Architecture, flows, decision trees. Same template as X (`../x-posts-noon/mermaid-template.html`). |
| Hero image | 6 | Polish moments. Reuse 5 prompts from `../x-posts-may-2026/hero-prompts.md`; 1 new prompt for D1PM. |
| Document carousel | 8 | LinkedIn's highest-reach format. Each 5–10 slides at 1080×1080, published as native PDF. |
| Poll | 3 | Comment bait + audience data. |

(Numbers add to >60 because some posts span categories — e.g. a text-only post with a 2-slide annotated screenshot carousel.)

---

## Document carousels — the biggest growth lever

These 8 carousels are the rocket fuel. If only one investment goes into image production, make it these:

| Day | Slot | Title | Slides |
|---|---|---|---|
| D1 | PM | The Payments Privacy Problem | 8 |
| D5 | PM | Why we built around the failure | 6 |
| D8 | PM | Nillion Nucleus (BIG drop) | 10 |
| D10 | PM | nilCC TEE for non-cryptographers | 7 |
| D15 | PM | Employee onboarding in 90 seconds | 7 |
| D18 | PM | Mobile paystub experience | 8 |
| D26 | PM | Civitas vs alternatives | 6 |
| D28 | AM | Compliance partners (optional) | TBD |

**Production approach:** build a `carousel-template.html` (1080×1080 square, dark theme matching the existing card template), one slide per HTML file, render via Playwright, stitch into a PDF via `pdf-lib` or `pdfkit`. Each carousel takes ~30–45 min of design polish per slide if hand-tuned, ~10 min total if auto-rendered from slide spec.

Cheap fallback: render slides as PNG, manually drop into Canva, export as PDF, upload as LinkedIn document.

---

## Scheduling — three options

LinkedIn has no official scheduling API for personal accounts and a heavily-gated one for company pages (LinkedIn Marketing API requires app review). Three practical paths:

### Option 1 — Native LinkedIn scheduler (recommended for first run)

LinkedIn's built-in scheduler works well for company pages. Manual but reliable.

1. Open the company page → "Create post."
2. Compose the post (body from calendar.md).
3. Upload the image (text card, mermaid, hero, or carousel PDF).
4. Click the clock icon → schedule for the right date + time.
5. Repeat 60 times.

Manual time: ~3 min per post = ~3 hours total for 60 posts. Doable in one Sunday evening.

### Option 2 — Playwright automation (mirroring the X pattern)

Build `schedule-all.mjs` mirroring `../x-posts-may-2026/schedule-all.mjs`. Selectors will differ — LinkedIn's compose flow is more brittle than X's. Worth doing if the user wants to run multiple campaigns over the year.

Estimated build time: 4–6 hours for a working version, +2 hours for selector hardening.

### Option 3 — Hootsuite / Buffer / Loomly

Paid scheduling tools handle LinkedIn natively and reliably. ~$30–$100/month. Best path if the user runs LinkedIn campaigns continuously.

**My recommendation:** Option 1 for this campaign (60 posts, one-shot, ~3 hours of manual work). Build Option 2 only if the next campaign justifies the investment.

---

## What goes in the first comment (every post)

LinkedIn algorithmically suppresses post reach when the body contains external links. Workaround: put links in the first comment, published by the author within 30 seconds of the post going live.

Every post in `calendar.md` that needs a link has a `**First comment:**` line spelling out the exact comment body. Some posts intentionally have no first comment — they're pure thought-leadership and don't need a CTA.

---

## Founder personal-account amplification — the biggest follower lever

The single highest-leverage tactic for getting from 10 → 10,000 followers on the company page is **founder reshares from a personal account**.

Pattern:
1. Company page post publishes at 21:00 IST.
2. Founder personal account reshares it at 21:30 IST with a 1–2 line personal comment ("I wrote this for our company page — here's the thread.").
3. Founder personal-account followers see the reshare. ~10–20% of them click through to the company page. ~5–10% of those follow.

If the founder has 2,000 personal LinkedIn followers, this pattern adds ~10–40 company-page followers per post. Across 60 posts, ~600–2,400 followers from this lever alone.

Schedule founder personal-account reshares as a parallel track. Could be a single `personal-reshares.md` follow-up doc — let me know if you want it.

---

## Partner mention checklist (replace `@CompanyName` placeholders)

When you go to schedule each post, do a find-replace on these placeholders with actual LinkedIn page tags:

- `@MagicBlock` → MagicBlock Labs official LinkedIn page
- `@Nillion` → Nillion official LinkedIn page (verify exact name)
- `@Privy` → Privy official LinkedIn page
- `@Bonfida` → Bonfida official LinkedIn page (or SNS)
- `@Helius` → Helius Labs official LinkedIn page
- `@SolanaFoundation` → Solana Foundation official LinkedIn page
- `@Chainalysis` → Chainalysis official LinkedIn page
- `@Colosseum` → Colosseum official LinkedIn page (verify exact name)

LinkedIn doesn't render the tag if the page name is misspelled — type `@` and pick from the dropdown to make sure each mention actually links.

---

## Cross-channel coordination with X

The X campaign (`../x-posts-may-2026/`) runs the **same partner-week structure** but with shorter posts (≤280 chars) and entirely different content. Some posts are deliberately matched moments (hero days), most are not.

| LinkedIn day | X cross-post moment? |
|---|---|
| D1 (launch) | Match — same hero day, different body |
| D8 (Nillion drop) | Match — same hero day, lead with same announcement |
| D14 (W2 wrap) | Match — same recap moment |
| D21 (W3 wrap + investor letter) | Match — same investor positioning |
| D30 (close) | Match — same Series Seed CTA |

All other days: LinkedIn and X are **separate content streams**, not duplicated. Different audience, different rhythm.

---

## What to do this week

1. **Read `calendar.md`** end to end. Flag anything that misses on tone, accuracy (especially tech claims, partner names, deployed program ID), or strategy. The Mert × Naruto voice is intentional — but if there's a specific claim that doesn't reflect what shipped, fix it before scheduling.
2. **Generate the 8 carousel PDFs** (highest-leverage assets). Slide-by-slide specs are in `calendar.md` per post.
3. **Render the 12 text cards + 9 mermaid diagrams** via the existing X templates (`../x-posts-may-2026/card-template.html` + `../x-posts-noon/mermaid-template.html`), updated to LinkedIn's 1200×627 or 1080×1080 aspect.
4. **Generate the 6 hero images** via ChatGPT 4o image gen using `../x-posts-may-2026/hero-prompts.md` (5 reuses + 1 new for D1PM).
5. **Schedule all 60 posts** via LinkedIn's native scheduler (Option 1 above) — one ~3-hour Sunday evening.
6. **Set up founder personal-account reshare schedule** as a parallel track.

---

## What this campaign is aiming at

- **Followers:** 10 → 10,000 by end of campaign. Aggressive. Hits require partner amplification + founder personal reshares + 1–2 viral posts.
- **Design partners:** 3 slots, filled by Day 14. CTAs in D7PM, D14PM, D20PM.
- **VC inbound:** investor-direct posts in D19PM, D21PM, D24PM. Investor open letters in D21PM, D24PM.
- **Payroll processor pitches:** D19AM (API surface), D20PM (profile), D28AM (compliance). The payroll-processor wedge is the highest-leverage pre-mainnet GTM motion.
- **Hiring:** Rust + Anchor engineer in D23PM. ZK engineer hire targeted for following campaign.
- **Mainnet narrative:** culminating posts D27, D29, D30 land the Q3 mainnet message.

---

## Voice rules (keep these in your head when scheduling)

- Open with a fact, not a feeling. Specifics: byte counts, CU costs, syscall names, dollar amounts.
- One idea per post. Punch lines short. Lots of vertical whitespace.
- Code-fence protocol terms: `alt_bn128_pairing`, `authorize_disburse`, `%allot`.
- BANNED phrases: "We're excited to announce", "Revolutionizing", "Web3 native solution", emoji-as-punctuation.
- Signature lines (max 1× per week across the 60 posts):
  - *Private by construction.*
  - *Settled in USDC. Verified by pairing.*
  - *ZK on Solana isn't a roadmap. It's a Tuesday.*
  - *Engineering > waiting.*

These are baked into the calendar already — don't edit randomly.

---

## Known limits

- LinkedIn company pages have **no scheduled-post cap** (unlike X's 50-in-queue cap), so all 60 can sit in the queue at once.
- LinkedIn's algorithm **may suppress the second post of the day** if posted within 6 hours of the first. The 11:00 + 21:00 IST schedule is 10 hours apart, which is the recommended minimum gap.
- LinkedIn document carousels have a **300MB file limit** per PDF. Stay well under 50MB to keep upload fast.

---

## If something needs to change mid-campaign

The single highest-value mid-campaign adjustment is **doubling down on whatever's working**. If a specific post format goes viral, lean into it for the remaining schedule. If a specific partner mention triggers measurable inbound, schedule a second spotlight.

Log per-post metrics (impressions, dwell, comments, profile visits, follower delta) in a `metrics-log.json` after the first 7 days. The data will tell you which week-2/3/4 posts to amplify, restructure, or pull.

---

## Aimed at the goal

10 → 10,000 followers in 30 days is aggressive. Realistic ranges based on similar campaigns:

- Bottom case: +800 (mostly from partner amplification + 1 viral post)
- Median case: +2,000–4,000 (consistent posting + good carousels + founder reshares)
- Top case: +10,000 (one mega-viral post in the Nillion drop or D30 close, picked up by ecosystem voices)

Hitting 10k requires at least one post breaking out of the LinkedIn algorithm's normal reach ceiling. The two highest-probability candidates: **D8PM (Nillion Nucleus carousel)** and **D30PM (closing seed announcement)**. Polish those two especially hard.

The other 58 posts compound the brand. The two breakouts are the events.
