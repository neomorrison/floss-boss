# Playtest-fix round: generation log

ElevenLabs, 2026-09-24. Budget 3,000 credits (see `check_subscription`'s `character_count`, this
account's unit for a credit). Before: 8,981. After: 9,080 (99 credits for 16 sound-effect takes:
7 new manager keys + 2 retakes where "sparkle"/"warm" still rendered bright, 5 replacement takes
for still-flagged existing keys, 1 retake each for event_bad's duration and interview's missing
tail). Two batches: 7 new manager-layer SFX (DESIGN 10) and 5 warmer replacement takes for existing
keys the audit (`art/audio/audit.py`) still flagged as a tonal beep/whine after EQ alone (EQ detail
in `audit.md`).

Raw takes: `art/audio/raw/manager/` and `art/audio/raw/fixes/` (gitignored). Post-process:
`python art/audio/process_fixes.py` (same pipeline as `process_cases.py`: trim at the first
transient, trailing silence cut below -40 dB of the peak, fades, peak-normalize, mono 44.1 kHz MP3
96 kbps). Every file was decoded by `decodeAudioData` in the audio harness via `node tools/snap.mjs`
(see the sound builder's report for the pass/fail count).

## New manager-layer SFX (DESIGN 10)

| key | kept take | prompt | seconds | peak dBFS |
|---|---|---|---|---|
| event_card | event_card_raw_a | "soft thin paper card sliding and settling on a wooden desk, gentle short swish, no music, foley sound effect", 0.6s | 0.38 | -9.5 |
| event_good | event_good_raw_a | "warm gentle two note rising marimba phrase, soft wooden mallet, cheerful and calm, short musical sting, no reverb tail", 0.6s | 0.55 | -5.4 |
| event_bad | event_bad_raw_a | "soft low wooden bonk, gentle muted knock on a wood block, warm and rounded, not harsh, short", 0.5s (0.4s was rejected: below the API's 0.5s minimum) | 0.33 | -6.4 |
| campaign_start | campaign_start_raw_a | "soft gentle whoosh with a small warm bell chime at the end, cheerful and light, short transition sound effect", 0.8s | 0.64 | -5.5 |
| perk_pick | perk_pick_raw_b | take a ("warm soft sparkle chime... not shrill") still rendered bright (centroid 10.5 kHz, 99.8% energy above 2.5 kHz): the word "sparkle" pulls the model toward a bright bell/cymbal regardless of "warm". Take b asked for "a quick soft marimba flourish, three warm low wooden mallet notes rising gently... no cymbal, no bell, no high pitched shimmer" instead, which rendered at 429 Hz, 0% energy above 2.5 kHz. | 0.55 | -6.4 |
| huddle | huddle_raw_a | "soft clipboard tap on paper followed by a gentle warm bell chime, cozy quiet office sound effect, short" | 0.65 | -7.5 |
| interview | interview_raw_b | take a's "paper shuffle" was near silent after trim (a single pen click survived, 0.10s). Take b asked more directly: "a soft ballpoint pen click, then half a second of gentle paper pages being shuffled and flipped, quiet cozy office sound, both sounds clearly audible", 1.0s. Still click-dominated, but a soft rustle survives just before the click; trim parameters loosened for this key only (`onset_db 36, tail_db 45, fade 0.15`) to keep it instead of shaving it to nothing. | 0.39 | -7.2 |

## Warmer replacement takes (still-flagged keys)

The owner: "the beeping every time they get into a chair is really annoying. poor sound effect,
sounds like a fire alarm." A first pass (`art/audio/soften.py`) tried peaking-EQ notches on each
file's own dominant resonant band. For broadband crunch (scrapes, pops) that worked. For harmonic
tones (bells, dings, a cha-ching) it did not: cutting the loudest partial just exposed the next
harmonic up, and `tooth_ding` measured brighter after the notch (centroid 4353 -> 7210 Hz) than
before. Switched to a 2-stage low-pass for the EQ pass (see `audit.md`), which fixed most files, but
five were still flagged after the best EQ could do without eating the sound's own identity: their
own fundamental pitch sits inside the harsh band. Sent back to ElevenLabs instead.

| key | kept take | prompt | seconds | peak dBFS | result |
|---|---|---|---|---|---|
| tooth_ding | tooth_ding_raw_v2 | "soft warm low wooden ding, gentle muted mallet tap on wood, rounded tone, no metallic ring, no electronic beep, short" | 0.55 | -6.4 | centroid 4353 -> 327 Hz, energy above 2.5 kHz 100% -> 0% |
| sparkle | sparkle_raw_v3 | take v2 ("warm soft sparkle chime... not shrill") still rendered at 10.9 kHz / 98% energy above 2.5 kHz, same "sparkle" word problem as perk_pick above. v3 asked for "a quick soft music box twinkle, warm low mellow bell notes played fast, gentle and cozy, muted, no bright cymbal shimmer, no high pitched ringing" instead. | 0.50 | -7.5 | centroid 9793 -> 1397 Hz, energy above 2.5 kHz 100% -> 0% |
| scrape_2 | scrape_2_raw_v2 | "gritty scraping sound, small hand tool scraping crusty deposit off a hard surface, short warm textured scrape, no metallic ringing, no high pitched whine" | 0.55 | -6.6 | centroid 10348 -> 3119 Hz, energy above 2.5 kHz 98% -> 60%, still flagged (see audit.md, accepted: the very frequent scrape sounds keep their crunch on purpose) |
| scrape_3 | scrape_3_raw_v2 | "gritty crunchy scraping sound, hand tool scraping hard crusty buildup off a surface, warm textured crunch, no metallic ringing, no high pitched whine" | 0.51 | -5.4 | centroid 7473 -> 3614 Hz, energy above 2.5 kHz 89% -> 39%, still flagged (same accepted trade-off) |
| cash | cash_raw_v2 | "soft warm cash register cha-ching, gentle low bell tones, cozy and rounded, not bright or piercing, short", then one more light low-pass touch (2900 Hz) after the standard pipeline | 0.65 | -7.8 | centroid 7408 -> 1407 Hz, energy above 2.5 kHz 99% -> 3% |

Every new key also needs a synthesized fallback recipe in `src/audio/synthSfx.ts` (used when the
real mp3 is missing or fails to decode); this is what was failing `npx tsc --noEmit` before this
round (`RECIPES` was missing the 7 manager-layer keys).
