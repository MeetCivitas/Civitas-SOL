# Civitas X Campaign — May 19 → June 17 2026

A 30-day, 60-post X campaign for Civitas (`meetcivitas.xyz`). Built for **VC inbound, design-partner recruiting, and ecosystem heat** ahead of mainnet.

- **Cadence:** 09:00 IST (AM, build/tech post) + 20:00 IST (PM, marketing post). 2 posts/day, 30 days.
- **Voice:** Mert × Naruto — receipts over rhetoric, one idea per post, no Cloak mentions.
- **Char budget:** all 60 posts ≤ 280 (X free-tier limit).
- **Partner emphasis:** W1 MagicBlock → W2 Nillion (Nucleus big drop) → W3 Privy + SNS → W4 Helius + Solana Foundation + investor note.

---

## File map

```
social-launch/x-posts-may-2026/
├── calendar.md         ← 60 posts, human-readable, the source of truth
├── posts.json          ← parsed structured form (regenerate with parse-calendar.mjs)
├── hero-prompts.md     ← 10 ChatGPT image-gen prompts (1 already used)
├── card-template.html  ← 1600×900 branded text card (rendered by Playwright)
├── render-cards.mjs    ← regenerates the 50 text-card PNGs
├── parse-calendar.mjs  ← regenerates posts.json from calendar.md
├── schedule-all.mjs    ← main: schedules everything on X
├── images/             ← 51 PNGs (1 hero + 50 cards). Drop the 9 remaining heroes here.
├── scheduled-log.json  ← (created on first run) per-post status + scheduled-for
├── browser-data/       ← (created on first run) persistent Chrome profile for X login
└── package.json        ← deps (playwright)
```

---

## Quickstart — one command

```bash
cd social-launch/x-posts-may-2026
node schedule-all.mjs
```

What it does, in order:

1. Opens a real Chromium window pinned to this folder's profile.
2. First run: takes you to `x.com/home`. You log into your `@meet_civitas` account. Then return to the terminal and hit Enter.
3. For each of the 60 posts:
   - Opens compose, uploads `images/dayNN-XX.png`, opens the Schedule sub-dialog, sets date/time to the matching IST slot, confirms, types the post body **after** the schedule is locked in (this is what dodges the Draft.js mangling), submits.
4. Writes per-post status to `scheduled-log.json` (re-runs skip what's already scheduled).

Flags:

```bash
node schedule-all.mjs --from 1 --to 14    # ship only Week 1
node schedule-all.mjs --dry               # walk the flow without clicking final Submit
```

---

## Want the polish heroes too?

10 posts are marked `kind: hero` and look better with a custom DALL-E image instead of the text card.

1. `images/day01-am.png` already exists from the pilot run — keep it.
2. The other 9 prompts live in `hero-prompts.md`. Open a **regular** ChatGPT chat (Temporary mode disables image generation), paste each prompt, save as `images/dayNN-XX.png`.
3. Re-run `node schedule-all.mjs` — it picks up the upgrade automatically (already-scheduled posts that need re-scheduling will require a manual edit in X Drafts → Scheduled).

If you skip this, every post still ships — just with the branded text card.

---

## Voice rules (keep these in your head when reading the calendar)

- Open with a fact, not a feeling. Specifics: byte counts, CU costs, syscall names.
- Punch lines short. Lots of vertical whitespace. One idea per post.
- Code-fence protocol terms: `alt_bn128_pairing`, `claim_payment`, `pi_hash`.
- BANNED: "We're excited to announce", "Revolutionizing", "Web3 native solution", emoji-as-punctuation, hashtag stuffing on X.
- Signature lines (max 1×/week):
  - *Private by construction.*
  - *Settled in USDC. Verified by pairing.*
  - *ZK on Solana isn't a roadmap. It's a Tuesday.*

These were authored into the 60 posts already — don't edit them randomly.

---

## Known limit: X free-tier scheduled-post cap

X's free tier caps scheduled posts at **~50 in queue at any one time**. The campaign has 51 schedulable posts (after 9 hero placeholders), so on first run **the 51st (Day 30 AM) is rejected** with "The content of your post is invalid." That's a wall, not a script bug.

How to ship Day 30 AM:
- Wait for one of the earlier scheduled posts to actually publish (queue size drops to 49), then re-run `node schedule-all.mjs --from 30 --to 30`.
- Or upgrade to X Premium (Pro tier raises the cap).
- Or schedule it manually a minute before the first earlier post fires, after that one publishes.

The 9 hero-image-pending posts (D3-AM, D5-AM, D6-PM, D8-PM, D10-AM, D14-AM, D26-AM, D29-AM, D30-PM) are the same situation — they'd each push you over 50 until earlier ones fire. Generate the hero images via `hero-prompts.md`, then re-run the script in batches as the queue drains.

---

## If something breaks

- **Login lost:** delete `browser-data/` and re-run; it'll prompt for fresh login.
- **A post failed and is marked `error` in `scheduled-log.json`:** delete its entry from the JSON, re-run with `--from N --to N` for that single day.
- **X UI changed and selectors no longer hit:** the working selectors as of 2026-05-18 are encoded in `schedule-all.mjs` (`[data-testid="tweetTextarea_0"]`, `[data-testid="fileInput"]`, `[data-testid="scheduleOption"]`, `[data-testid="tweetButton"]`). Update them in one place if X redesigns.
- **Draft.js mangles text again:** the script types text *after* the schedule date is set, which is what dodged the issue. If it returns, see the comment in `typeText()` and try `await page.keyboard.insertText(body)` instead of `type()`.

---

## What this campaign is aiming at

- **Design partners** — 3 slots open; CTAs in posts D7-PM, D14-PM, D20-PM, D24-PM.
- **VC inbound** — investor-direct notes in D18-PM, D21-PM, D24-PM, D30-PM.
- **Partner air cover** — MagicBlock (W1), Nillion (W2), Privy + SNS (W3), Helius + Solana Foundation (W4).
- **Hiring** — first Rust engineer post in D23-PM.
- **Mainnet narrative** — culminating posts D27-PM, D29, D30 land the Q3 mainnet message.

Don't post the same week's content out of order — the partner-emphasis schedule is what makes each week have a clean story.
