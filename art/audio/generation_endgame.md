# End-game round (DESIGN 11): generation log

ElevenLabs, 2026-09-24. Budget 2,000 credits (`check_subscription`'s `character_count`, this account's unit
for a credit). Before: 9,114. After: 9,331, so **217 credits** for 19 takes (13 sound-effect takes and 6
text-to-speech takes of a single word). Three speech-to-text checks of the "ayy" takes are billed apart from
`character_count`.

Eight new keys: `bling`, `ayy`, `grill_pop` (the Grill Glow-Up case) and `crowd_cheer`, `fanfare_gala`,
`ribbon_snip`, `milestone`, `promotion` (the ceremonies: promotions, ribbon cuttings, milestones, the gala).

Raw takes: `art/audio/raw/endgame/` (gitignored). Post-process: `python art/audio/process_endgame.py`
(the same pipeline as `process_fixes.py` plus an optional 2-stage low-pass, a loudness cap so dense takes
never end up louder than the set, and one layered key). Every file decodes with `decodeAudioData` in the
audio harness (`node tools/snap.mjs` on `/harness/audio.html`: 71 of 71 keys load from file, none fall back),
and every new key also has a synthesized fallback in `src/audio/synthSfx.ts` (rendered and measured in the
same harness run, peaks -4.7 to -13 dBFS, none silent, none clipped).

## Kept takes

Measured with the `audit.py` functions (spectral centroid, energy above 2.5 kHz, the audit's flags). None of
the eight is flagged. `bling` repeats (once per diamond, up to 12 a clean), so it follows the house rule for
repeating cues: a warm centroid near 1 kHz and a quiet level.

| key | kept take | prompt (ElevenLabs) | s | peak dBFS | RMS dBFS | centroid | > 2.5 kHz |
|---|---|---|---|---|---|---|---|
| bling | bling_raw_a | "a quick smooth glassy chime, two soft high bell notes like a glint of light on a diamond, mellow and rounded, gentle, no harsh shimmer, no cymbal, no ringing tail", 0.8 s | 0.50 | -8.5 | -26.5 | 998 Hz | 0.6% |
| ayy | ayy_raw_tts_will_b | text to speech "Eyyy!", voice Will (premade, relaxed optimist), multilingual v2, stability 0.35, style 0.6 | 0.65 | -6.4 | -22.7 | 729 Hz | 8.1% |
| grill_pop | grill_pop_raw_b + grill_pop_raw_a | layer: b ("a satisfying low muted click, a snug plastic and metal retainer popping off teeth, soft rounded thock with a tiny pop...") carries the body, a ("a satisfying small metallic click pop, a snug dental grill snapping off teeth...") low-passed at 4.5 kHz sits under it at 35% for the metallic edge | 0.13 | -6.4 | -25.6 | 2687 Hz | 32% |
| crowd_cheer | crowd_cheer_raw_a | "a short warm friendly crowd cheer, a small happy audience clapping and cheering together, joyful, mid distance, not too loud, no whistles, no screaming", 2.5 s; low-passed at 7 kHz, RMS capped at -22 | 2.34 | -8.9 | -22.4 | 965 Hz | 1.9% |
| fanfare_gala | fanfare_gala_raw_a | "a short celebratory fanfare, warm brass section and wooden marimba playing a bright happy flourish that ends on a big major chord, festive gala award ceremony sting, rounded and warm, no cymbal crash", 3.8 s | 3.70 | -4.4 | -19.5 | 1101 Hz | 3.9% |
| ribbon_snip | ribbon_snip_raw_a | "a single crisp pair of scissors snipping through a satin ribbon, one clean snip, close up foley, short", 0.6 s; low-passed at 6.5 kHz (raw centroid 9.1 kHz) | 0.11 | -9.0 | -28.8 | 2176 Hz | 38% |
| milestone | milestone_raw_c | "a short ascending melody of four warm marimba notes going from low to high, do mi sol do, cheerful video game milestone reached jingle, soft wooden mallets, gentle", 1.4 s, influence 0.75 | 1.30 | -7.0 | -20.4 | 721 Hz | 0.1% |
| promotion | promotion_raw_a | "a short triumphant jingle, warm brass and bright marimba playing a quick heroic rising melody that lands on a proud major chord, video game promotion reward sting, rounded, not shrill", 2.2 s | 1.49 | -7.4 | -19.4 | 575 Hz | 0.0% |

## Rejected takes (and why)

- **bling_raw_b** ("a single warm crystal glass ping with a gentle soft shimmer..."): a pure 1.72 kHz ping. Smooth, but
  brighter than the house rule for a cue that repeats up to 12 times a clean; take a sits at 1 kHz with a
  quiet 2.2 / 4 / 7.4 kHz sparkle partial and reads as a diamond glint.
- **ayy**: speech-to-text was used to check what each take actually says. "Ayyy!" came out as "I" (the /aɪ/
  vowel) for Chris and Liam and as "Hey" for Will; "Aaaay!" with Chris read "Hi."; a sound-effect take read
  "Yay!" and was clipped and compressed (RMS -4.7 dBFS raw). Will's "Eyyy!" transcribes as "A": the /eɪ/
  vowel of "ayy", friendly and relaxed, a short drawn-out decay.
- **grill_pop_raw_a** alone: a 9 kHz tick (centroid 5.2 kHz, flagged as a tonal whine by the audit). Take b
  alone was a dull thock. The layer keeps both qualities and passes the audit.
- **ribbon_snip_raw_b / _c** ("soft muted..." / "big fabric scissors..."): both came out brighter than a
  (centroid 11.3 and 11.9 kHz). Take a with a 6.5 kHz low-pass keeps the snip and passes the audit
  (at 5 kHz it turned into a muffled tap).
- **milestone_raw_a / _b**: both a single struck chord (C E G C at once, spectral peaks present from the first
  window), not a rising chime. Take c climbs 388, 523, 659, 784 Hz over 0.35 s, then rings out.

## Synthesized fallbacks (src/audio/synthSfx.ts)

`bling` a bell ping near 800 Hz plus a soft octave ping; `ayy` a buzzy voice through two formants gliding
"eh" to "ee"; `grill_pop` a short low-passed tick over a falling pop; `crowd_cheer` band-passed noise voices
swelling in and out with scattered claps; `fanfare_gala` a brass pickup (G C E G) into a held C major chord with
a marimba run over it (`brass()`: two detuned saws through a low-pass that swells open); `ribbon_snip` a short
sliding swish into one soft cut; `milestone` a marimba C E G C rise; `promotion` a marimba C E G rise landing on
a held C over soft brass.
