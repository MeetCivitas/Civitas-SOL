# LinkedIn Hero Image Prompts

Four "hero" slots in the LinkedIn campaign call for polished cinematic images instead of branded text cards. These need to be generated externally — **ChatGPT 4o with image generation enabled** (regular chat, not Temporary, which disables image gen).

Output spec: **16:9 cinematic, 1600×900 or LinkedIn-native 1200×627**. No text/letters/watermarks in the image — the text lives in the post body. Save each as `images/<id>.png` so it sits next to the rendered cards and mermaids.

Brand palette to enforce in every prompt:
- Background: deep midnight gradient `#05070d → #0b1322 → #0f1d36`
- Accent 1 (teal): `#7CF9C7`
- Accent 2 (electric blue): `#5B8DEF`
- Aesthetic anchor: Stripe × Apple × Vercel dark-mode product polish

Five of these reuse the prompts already authored for the X campaign at `../x-posts-may-2026/hero-prompts.md`. If `images/dayNN-XX.png` exists in that folder, copy it over instead of regenerating.

---

## 1. `day14-am.png` — Civitas privacy stack (4 layers)

**Reuse from X.** Copy `../x-posts-may-2026/images/day14-am.png` if it exists. Otherwise regenerate:

```
Wide 16:9 cinematic technical hero image, no text/letters anywhere. Subject: four translucent horizontal "layers" stacked vertically in a clean architectural arrangement, each glowing a unique shade — bottom layer deep blue, second layer teal, third layer mint-green, top layer crystal white. Thin vertical beams of light pass cleanly through all four layers from top to bottom, suggesting end-to-end privacy. Background: deep midnight (#05070d → #0b1322 → #0f1d36) with subtle particle field. Premium product / infra brochure aesthetic — Stripe × Apple × Vercel polish. Strictly no text, no glyphs, no letters.
```

---

## 2. `day26-am.png` — Stress test scaling graph

**Reuse from X.** Copy `../x-posts-may-2026/images/day26-am.png` if it exists. Otherwise regenerate:

```
Wide 16:9 cinematic data-visualization render, no text/letters/numbers visible. Subject: a stylized 3D performance graph in dark space, with multiple ascending teal/electric-blue parallel lines (no axis labels, no numbers) forming a clean rising "scaling" silhouette. Below the curves, a subtle grid plane. Above, faint particle streaks representing throughput. Color palette: teal (#7CF9C7), electric blue (#5B8DEF), midnight gradient (#05070d → #0b1322 → #0f1d36). Premium fintech / Linear-style analytics aesthetic. Strictly no text, no glyphs, no letters, no numbers.
```

---

## 3. `day29-am.png` — Full Civitas architecture (isometric)

**Reuse from X.** Copy `../x-posts-may-2026/images/day29-am.png` if it exists. Otherwise regenerate:

```
Wide 16:9 cinematic architectural diagram-style image, no text/letters/labels. Subject: a clean isometric system architecture in dark space — left side an "off-chain" cluster of glowing translucent cubes connected by light lines; center a single bright atomic "transaction pill"; right side an "on-chain" cluster of geometric circuit slabs. A glowing arc of light connects left → center → right. Color palette: teal (#7CF9C7), electric blue (#5B8DEF), midnight gradient (#05070d → #0b1322 → #0f1d36). Premium fintech / cloud-architecture brochure aesthetic. Strictly no text, no glyphs, no letters, no labels.
```

---

## 4. `day30-pm.png` — Closing / Series Seed hero

**Reuse from X.** Copy `../x-posts-may-2026/images/day30-pm.png` if it exists. Otherwise regenerate:

```
Wide 16:9 cinematic flagship hero image, no text/letters/watermarks anywhere. Subject: a single perfectly-rendered translucent obsidian-and-teal "Civitas mark" — abstract crystalline shape floating in deep space, illuminated from within. Around it, a slow orbit of small glowing particles in teal (#7CF9C7) and electric blue (#5B8DEF). Background: deep midnight gradient (#05070d → #0b1322 → #0f1d36) with subtle volumetric light. Apple-keynote-finale-level premium product render. Strictly no text, no glyphs, no letters, no signature.
```

---

## How to generate

1. Check `../x-posts-may-2026/images/` first — if the file already exists from the X campaign, `cp` it into `./images/`.
2. For any missing files, open a fresh **regular** ChatGPT chat (Temporary mode disables image generation).
3. Paste each prompt above.
4. ChatGPT 4o returns 1–2 images. Pick the cleanest.
5. Right-click → Save Image → save as the exact filename (e.g. `day14-am.png`).
6. Drop in `./images/`.

---

## What if you skip this

Every hero post still has a renderable fallback — you can just use a branded text card with the post body, rendered via `render-cards.mjs`. The hero images are polish moments, not requirements. The campaign ships either way.

To generate a fallback text card for any of these days, add the day to `data.json`'s `cards` array with the post's key phrase as the `body`, and re-run `node render-cards.mjs`.

---

## Other image-supported posts (no hero needed)

These two posts in the calendar are marked as "text-only with small image carousel" but aren't full hero shots — they're supporting visuals you can either skip or hand-craft in Figma/Canva:

- **Day 13 AM** — nilCC attestation code screenshot (2-slide carousel)
- **Day 17 AM** — Privy embedded-wallet onboarding flow (2-slide carousel)

For these: take real screenshots from the repo / product on devnet, drop them in `./images/dayNN-XX.png`, and reference manually when scheduling. Not worth investing in a generator for two ad-hoc visuals.
