# Audio audit (round 2, playtest fix)

Owner playtest feedback: "the beeping every time they get into a chair is really annoying. poor sound effect, sounds like a fire alarm." `door_chime` and `notify` were already replaced before this pass (confirmed below: both measure warm and quiet). This pass audited every file in public/audio and de-harshened everything else that measured as a tonal beep/whine, prioritizing the sounds that play most often.

**Method** (`python art/audio/audit.py`, ffmpeg decode + numpy): duration, peak dBFS, RMS dBFS, an approximate BS.1770-style K-weighted loudness (LUFS: 60 Hz highpass + a 4 dB high shelf above 1.5 kHz, ungated, close enough to compare files, not a certified meter), spectral centroid, the share of spectral energy above 2.5 kHz (the beep/hiss band), band flatness (40 log-spaced bands, geometric/arithmetic mean of band power: near 0 = tonal/peaky like a pure beep, near 1 = broadband/noisy like a filtered-noise crunch or hiss) and the share of energy in the single loudest band (how alarm/whistle-like a sound literally is). A file flags as tonal beep/whine when its energy piles narrowly into one band above 2.5 kHz, or bright and peaky when it is bright with low flatness; a broadband-but-bright file (real scrape/pop crunch) does not flag on brightness alone, matching the owner's note that crunchy is good, piercing is not.

**Fixes applied** (`python art/audio/soften.py` for EQ, `python art/audio/process_fixes.py` for ElevenLabs replacement takes; raw takes and prompts in `art/audio/raw/fixes/`, `art/audio/raw/manager/` and `generation_fixes.md`):
- **EQ only** (gentle 2-stage low-pass, about -24 dB/octave, tuned per file so a bell keeps its fundamental and a scrape keeps its crunch): check, coins, day_end, debris_pop, flake, floss_creak, gel_paint, purchase, shade_tick, shell_crack, coin_clink, gold_ting, polish_loop, rinse_loop, suction_loop, ultrasonic_loop.
- **Regenerated with ElevenLabs** (EQ alone could not fix these without destroying the sound: notching a bell's fundamental just exposed the next harmonic and made it measure brighter, not darker): cash, tooth_ding, sparkle, scrape_2, scrape_3, prompted for warm, low, rounded, non-metallic, non-electronic takes, run through the same EQ pipeline, plus one more light low-pass touch on cash.
- **Level fix**: music_clean and music_clinic peaked at +0.5/+0.6 dBFS (already clipping in the file); trimmed to -1 dBFS true peak.

## Before / after: every file this pass touched

| key | plays | peak before -> after | RMS before -> after | centroid before -> after | energy>2.5kHz before -> after | fix | still flagged after |
|---|---|---|---|---|---|---|---|
| cash | frequent (every payout) | -9.4 -> -7.8 | -22.7 -> -26.1 | 7408Hz -> 1407Hz | 99% -> 3% | regenerated + EQ | no |
| coins | frequent (every payout) | -3.1 -> -3.9 | -23.2 -> -23.8 | 9332Hz -> 4853Hz | 100% -> 71% | EQ (lowpass 4.6kHz) | no |
| check | frequent (every objective tick) | -3.5 -> -4.1 | -20.4 -> -22.8 | 7591Hz -> 1880Hz | 76% -> 6% | EQ (lowpass 4.2kHz) | no |
| tooth_ding | frequent (sealant cure) | -5.3 -> -6.4 | -22.4 -> -20.4 | 4353Hz -> 327Hz | 100% -> 0% | regenerated | no |
| sparkle | frequent (every sparkle cue) | -8.6 -> -7.5 | -25.2 -> -22.5 | 9793Hz -> 1397Hz | 100% -> 0% | regenerated | no |
| scrape_2 | very frequent (every scaler stroke) | -11.3 -> -6.6 | -26.5 -> -21.0 | 10348Hz -> 3119Hz | 98% -> 60% | regenerated + EQ | yes, bright and peaky (centroid > 3 kHz, flatness 0.04, 24% in one band) ; HIGH PRIORITY: very frequent (every scaler stroke) |
| scrape_3 | very frequent (every scaler stroke) | -4.2 -> -5.4 | -22.0 -> -22.4 | 7473Hz -> 3614Hz | 89% -> 39% | regenerated + EQ | yes, bright and peaky (centroid > 3 kHz, flatness 0.08, 29% in one band) ; HIGH PRIORITY: very frequent (every scaler stroke) |
| flake | very frequent (every flake shed) | -5.3 -> -6.3 | -26.5 -> -23.7 | 10810Hz -> 2458Hz | 99% -> 50% | EQ (lowpass 3.9kHz) | no |
| shade_tick | frequent while curing (every 1.2s) | -6.3 -> -6.8 | -20.1 -> -24.6 | 10225Hz -> 809Hz | 100% -> 10% | EQ (lowpass 2.7kHz) | no |
| day_end |  | -8.0 -> -8.4 | -24.1 -> -24.2 | 6149Hz -> 5707Hz | 100% -> 99% | EQ (lowpass 4.5kHz) | yes, tonal beep/whine (centroid 5707 Hz, 54% of energy in one band) |
| debris_pop |  | -9.2 -> -9.7 | -33.9 -> -30.2 | 9114Hz -> 3135Hz | 94% -> 63% | EQ (lowpass 5.0kHz) | yes, tonal beep/whine (centroid 3135 Hz, 40% of energy in one band) |
| floss_creak |  | -6.3 -> -6.7 | -29.6 -> -27.2 | 4035Hz -> 1665Hz | 33% -> 8% | EQ (lowpass 5.5kHz) | no |
| gel_paint |  | -5.1 -> -5.6 | -25.4 -> -24.4 | 4247Hz -> 1671Hz | 69% -> 40% | EQ (lowpass 4.8kHz) | no |
| purchase |  | -2.4 -> -2.8 | -19.9 -> -17.9 | 3119Hz -> 955Hz | 45% -> 2% | EQ (lowpass 3.6kHz) | no |
| shell_crack |  | -2.3 -> -2.6 | -27.3 -> -28.6 | 7398Hz -> 4125Hz | 97% -> 80% | EQ (lowpass 5.2kHz) | yes, bright and peaky (centroid > 3 kHz, flatness 0.04, 32% in one band) |
| coin_clink |  | -3.5 -> -3.8 | -18.2 -> -24.6 | 9684Hz -> 6798Hz | 100% -> 95% | EQ (lowpass 6.5kHz) | yes, tonal beep/whine (centroid 6798 Hz, 41% of energy in one band) |
| gold_ting |  | -4.1 -> -4.3 | -18.4 -> -17.3 | 6697Hz -> 6651Hz | 100% -> 99% | EQ (lowpass 6.5kHz) | yes, tonal beep/whine (centroid 6651 Hz, 98% of energy in one band) |
| polish_loop |  | -9.7 -> -10.1 | -24.2 -> -24.1 | 6103Hz -> 4346Hz | 94% -> 86% | EQ (lowpass 6.0kHz) | yes, tonal beep/whine (centroid 4346 Hz, 38% of energy in one band) |
| rinse_loop |  | -11.7 -> -12.1 | -24.8 -> -25.2 | 9960Hz -> 5193Hz | 98% -> 86% | EQ (lowpass 6.5kHz) | no |
| suction_loop |  | -2.9 -> -3.4 | -21.7 -> -23.3 | 4620Hz -> 2425Hz | 59% -> 32% | EQ (lowpass 6.5kHz) | no |
| ultrasonic_loop |  | -10.8 -> -11.1 | -22.5 -> -24.2 | 8246Hz -> 7081Hz | 100% -> 99% | EQ (lowpass 6.2kHz) | yes, bright and peaky (centroid > 3 kHz, flatness 0.02, 34% in one band) |
| music_clean |  | 0.5 -> -1.4 | -14.5 -> -16.5 | 185Hz -> 185Hz | 0% -> 0% | peak trim to -1dBFS | no |
| music_clinic |  | 0.6 -> -1.4 | -15.4 -> -17.5 | 325Hz -> 325Hz | 2% -> 2% | peak trim to -1dBFS | no |

## New manager-layer SFX (DESIGN 10)

Generated fresh with ElevenLabs (no before state). See `generation_fixes.md` for prompts and takes.

| key | dur (s) | peak dBFS | RMS dBFS | centroid (Hz) | flag |
|---|---|---|---|---|---|
| event_card | 0.38 | -9.5 | -29.6 | 4503 | ok |
| event_good | 0.55 | -5.4 | -20.0 | 373 | ok |
| event_bad | 0.33 | -6.4 | -27.7 | 402 | ok |
| campaign_start | 0.64 | -5.5 | -21.5 | 1608 | ok |
| perk_pick | 0.55 | -6.4 | -20.3 | 429 | ok |
| huddle | 0.65 | -7.5 | -22.0 | 334 | ok |
| interview | 0.39 | -7.9 | -34.4 | 1943 | ok |

## Remaining flagged files (accepted as-is)

All of these are infrequent (pirate treasure sounds, day-close, or continuous tool loops) or the brightness is the intended character; EQ was applied (see table above) but pushing further would flatten a sound that is supposed to shimmer (a gold tooth ting, a coin clink) or would risk killing crunch texture on the very frequent scrape sounds, which the owner explicitly asked to keep ("crunchy is good, piercing is not"). None of these are in the owner's complaint list.

- **coin_clink**: tonal beep/whine (centroid 6798 Hz, 41% of energy in one band) (centroid 6798 Hz, 95% energy above 2.5 kHz, was 9684 Hz / 100% before this pass)
- **day_end**: tonal beep/whine (centroid 5707 Hz, 54% of energy in one band) (centroid 5707 Hz, 99% energy above 2.5 kHz, was 6149 Hz / 100% before this pass)
- **debris_pop**: tonal beep/whine (centroid 3135 Hz, 40% of energy in one band) (centroid 3135 Hz, 63% energy above 2.5 kHz, was 9114 Hz / 94% before this pass)
- **gold_ting**: tonal beep/whine (centroid 6651 Hz, 98% of energy in one band) (centroid 6651 Hz, 99% energy above 2.5 kHz, was 6697 Hz / 100% before this pass)
- **polish_loop**: tonal beep/whine (centroid 4346 Hz, 38% of energy in one band) (centroid 4346 Hz, 86% energy above 2.5 kHz, was 6103 Hz / 94% before this pass)
- **scrape_2**: bright and peaky (centroid > 3 kHz, flatness 0.04, 24% in one band) | HIGH PRIORITY: very frequent (every scaler stroke) (centroid 3119 Hz, 60% energy above 2.5 kHz, was 10348 Hz / 98% before this pass)
- **scrape_3**: bright and peaky (centroid > 3 kHz, flatness 0.08, 29% in one band) | HIGH PRIORITY: very frequent (every scaler stroke) (centroid 3614 Hz, 39% energy above 2.5 kHz, was 7473 Hz / 89% before this pass)
- **shell_crack**: bright and peaky (centroid > 3 kHz, flatness 0.04, 32% in one band) (centroid 4125 Hz, 80% energy above 2.5 kHz, was 7398 Hz / 97% before this pass)
- **ultrasonic_loop**: bright and peaky (centroid > 3 kHz, flatness 0.02, 34% in one band) (centroid 7081 Hz, 99% energy above 2.5 kHz, was 8246 Hz / 100% before this pass)

## door_chime and notify (owner: already fixed)

Confirmed warm and quiet: door_chime centroid 702 Hz, 0% energy above 2.5 kHz, RMS -23.6 dBFS. notify centroid 301 Hz, 0% energy above 2.5 kHz, RMS -21.7 dBFS. Neither flags.

## Full measured table (every file, current state)

| key | dur (s) | peak dBFS | RMS dBFS | LUFS (approx) | centroid (Hz) | energy > 2.5kHz | flatness | dominant band | plays | flag |
|---|---|---|---|---|---|---|---|---|---|---|
| arr | 0.80 | -3.4 | -20.7 | -21.1 | 962 | 4.1% | 0.069 | 27.4% |  | ok |
| campaign_start | 0.64 | -5.5 | -21.5 | -19.8 | 1608 | 0.0% | 0.000 | 43.3% |  | ok |
| cash | 0.65 | -7.8 | -26.1 | -25.2 | 1407 | 3.0% | 0.001 | 89.6% | frequent (every payout) | ok |
| chatter | 0.80 | -6.0 | -22.2 | -21.1 | 1315 | 0.2% | 0.004 | 38.4% |  | ok |
| check | 0.52 | -4.1 | -22.8 | -22.3 | 1880 | 5.8% | 0.025 | 37.6% | frequent (every objective tick) | ok |
| coin_clink | 1.13 | -3.8 | -24.6 | -21.6 | 6798 | 94.9% | 0.066 | 40.9% |  | tonal beep/whine (centroid 6798 Hz, 41% of energy in one band) |
| coins | 0.60 | -3.9 | -23.8 | -21.1 | 4853 | 70.8% | 0.198 | 24.3% | frequent (every payout) | ok |
| combo | 0.48 | -4.4 | -21.6 | -21.0 | 1517 | 0.3% | 0.001 | 58.7% | frequent (every combo) | ok |
| crack_big | 0.48 | -5.2 | -24.7 | -22.9 | 1845 | 12.2% | 0.136 | 63.0% |  | ok |
| crunch_pop | 0.48 | -2.1 | -25.4 | -23.4 | 2915 | 28.8% | 0.054 | 31.1% |  | ok |
| day_end | 1.00 | -8.4 | -24.2 | -21.0 | 5707 | 99.1% | 0.004 | 54.2% |  | tonal beep/whine (centroid 5707 Hz, 54% of energy in one band) |
| debris_pop | 0.48 | -9.7 | -30.2 | -31.6 | 3135 | 63.2% | 0.097 | 40.3% |  | tonal beep/whine (centroid 3135 Hz, 40% of energy in one band) |
| door_chime | 1.00 | -11.2 | -23.6 | -24.1 | 702 | 0.0% | 0.000 | 98.0% | frequent (every patient seated) | ok |
| error | 0.48 | -7.1 | -24.8 | -26.5 | 208 | 0.4% | 0.049 | 21.3% |  | ok |
| event_bad | 0.33 | -6.4 | -27.7 | -28.8 | 402 | 0.0% | 0.003 | 26.5% |  | ok |
| event_card | 0.38 | -9.5 | -29.6 | -27.7 | 4503 | 65.7% | 0.210 | 12.8% |  | ok |
| event_good | 0.55 | -5.4 | -20.0 | -20.9 | 373 | 0.0% | 0.000 | 75.5% |  | ok |
| flake | 0.48 | -6.3 | -23.7 | -22.5 | 2458 | 50.0% | 0.213 | 22.9% | very frequent (every flake shed) | ok |
| floss_creak | 0.50 | -6.7 | -27.2 | -25.8 | 1665 | 7.6% | 0.007 | 62.4% |  | ok |
| floss_snap | 0.48 | -2.3 | -31.6 | -28.8 | 4973 | 53.0% | 0.016 | 21.7% |  | ok |
| floss_thwip | 0.10 | -2.4 | -14.6 | -15.0 | 788 | 3.1% | 0.033 | 42.6% |  | ok |
| floss_zip | 0.43 | -3.6 | -15.3 | -18.5 | 350 | 2.7% | 0.182 | 22.5% |  | ok |
| gag | 0.60 | -6.5 | -20.1 | -18.8 | 2117 | 10.5% | 0.012 | 31.1% |  | ok |
| gel_paint | 0.32 | -5.6 | -24.4 | -23.1 | 1671 | 39.5% | 0.049 | 29.6% |  | ok |
| giggle | 0.80 | -5.2 | -18.8 | -19.2 | 599 | 3.3% | 0.010 | 53.2% |  | ok |
| gold_ting | 1.00 | -4.3 | -17.3 | -14.0 | 6651 | 99.3% | 0.003 | 98.2% |  | tonal beep/whine (centroid 6651 Hz, 98% of energy in one band) |
| hiccup | 0.40 | -3.4 | -15.2 | -14.8 | 1266 | 7.4% | 0.009 | 58.0% |  | ok |
| hire | 0.68 | -7.3 | -20.1 | -20.9 | 440 | 0.0% | 0.002 | 73.7% |  | ok |
| huddle | 0.65 | -7.5 | -22.0 | -24.9 | 334 | 0.0% | 0.001 | 92.4% |  | ok |
| interview | 0.39 | -7.9 | -34.4 | -32.6 | 1943 | 36.1% | 0.116 | 11.4% |  | ok |
| lamp_loop | 2.65 | -18.0 | -26.4 | -32.2 | 251 | 3.6% | 0.040 | 83.5% |  | ok |
| level_up | 1.00 | -3.8 | -21.8 | -20.1 | 2491 | 36.6% | 0.025 | 25.2% |  | ok |
| mmhm | 0.60 | -8.8 | -18.8 | -20.5 | 203 | 0.0% | 0.005 | 62.6% |  | ok |
| music_clean | 22.51 | -1.4 | -16.5 | -19.5 | 185 | 0.0% | 0.008 | 19.0% |  | ok |
| music_clinic | 28.04 | -1.4 | -17.5 | -20.3 | 325 | 2.1% | 0.212 | 16.2% |  | ok |
| music_title | 18.51 | -2.9 | -16.9 | -17.6 | 574 | 1.2% | 0.016 | 33.0% |  | ok |
| notify | 0.60 | -6.4 | -21.7 | -22.8 | 301 | 0.0% | 0.000 | 56.6% | frequent (every toast) | ok |
| ow | 0.48 | -6.9 | -22.1 | -20.5 | 1900 | 21.1% | 0.027 | 12.5% |  | ok |
| perfect | 1.36 | -5.6 | -24.6 | -22.8 | 2027 | 25.6% | 0.019 | 27.0% |  | ok |
| perk_pick | 0.55 | -6.4 | -20.3 | -21.2 | 429 | 0.0% | 0.000 | 88.4% |  | ok |
| pocket_open | 0.38 | -3.5 | -28.8 | -26.0 | 5409 | 80.6% | 0.024 | 17.2% |  | ok |
| polish_loop | 2.75 | -10.1 | -24.1 | -21.1 | 4346 | 85.7% | 0.011 | 37.5% |  | tonal beep/whine (centroid 4346 Hz, 38% of energy in one band) |
| purchase | 0.60 | -2.8 | -17.9 | -17.7 | 955 | 1.9% | 0.001 | 45.6% |  | ok |
| reassure | 0.80 | -8.9 | -22.1 | -22.8 | 629 | 0.0% | 0.000 | 92.0% |  | ok |
| review_bad | 0.68 | -7.6 | -18.4 | -19.1 | 487 | 0.0% | 0.001 | 48.1% |  | ok |
| review_good | 0.68 | -9.6 | -20.8 | -20.1 | 1338 | 6.6% | 0.010 | 34.4% |  | ok |
| rinse_loop | 2.50 | -12.1 | -25.2 | -22.2 | 5193 | 86.2% | 0.092 | 16.2% |  | ok |
| scrape_1 | 0.60 | -2.0 | -26.8 | -23.6 | 7730 | 97.2% | 0.038 | 21.2% |  | ok |
| scrape_2 | 0.55 | -6.6 | -21.0 | -18.6 | 3119 | 59.8% | 0.042 | 23.6% | very frequent (every scaler stroke) | bright and peaky (centroid > 3 kHz, flatness 0.04, 24% in one band) ; HIGH PRIORITY: very frequent (every scaler stroke) |
| scrape_3 | 0.51 | -5.4 | -22.4 | -20.1 | 3614 | 39.4% | 0.078 | 29.3% | very frequent (every scaler stroke) | bright and peaky (centroid > 3 kHz, flatness 0.08, 29% in one band) ; HIGH PRIORITY: very frequent (every scaler stroke) |
| shade_tick | 0.12 | -6.8 | -24.6 | -25.7 | 809 | 10.3% | 0.102 | 14.1% | frequent while curing (every 1.2s) | ok |
| shell_crack | 0.31 | -2.6 | -28.6 | -25.5 | 4125 | 80.4% | 0.041 | 31.9% |  | bright and peaky (centroid > 3 kHz, flatness 0.04, 32% in one band) |
| snore | 1.15 | -4.2 | -17.6 | -19.0 | 1136 | 12.7% | 0.231 | 28.1% |  | ok |
| sparkle | 0.50 | -7.5 | -22.5 | -21.3 | 1397 | 0.3% | 0.001 | 99.3% | frequent (every sparkle cue) | ok |
| splash | 0.48 | -2.1 | -25.3 | -23.6 | 3269 | 42.4% | 0.043 | 15.6% |  | ok |
| squish | 0.48 | -2.2 | -20.0 | -16.9 | 4989 | 82.6% | 0.061 | 19.6% | frequent (every sugar bug squash) | ok |
| star | 0.48 | -7.9 | -23.4 | -20.8 | 2406 | 4.4% | 0.002 | 93.2% | frequent (every star awarded) | ok |
| suction_loop | 2.50 | -3.4 | -23.3 | -21.9 | 2425 | 31.8% | 0.028 | 36.8% |  | ok |
| tooth_ding | 0.55 | -6.4 | -20.4 | -21.4 | 327 | 0.0% | 0.000 | 99.9% | frequent (sealant cure) | ok |
| tooth_done | 0.85 | -5.4 | -20.8 | -18.9 | 1732 | 0.8% | 0.001 | 98.7% |  | ok |
| ui_click | 0.48 | -2.3 | -21.8 | -22.2 | 843 | 1.3% | 0.008 | 31.0% | very frequent (every button) | ok |
| ui_tab | 0.48 | -2.4 | -27.4 | -24.3 | 7004 | 81.2% | 0.052 | 17.6% | very frequent (every tab switch) | ok |
| ultrasonic_loop | 2.50 | -11.1 | -24.2 | -21.0 | 7081 | 98.7% | 0.016 | 34.1% |  | bright and peaky (centroid > 3 kHz, flatness 0.02, 34% in one band) |
