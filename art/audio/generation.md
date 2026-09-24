# Case SFX (round 2): generation log

ElevenLabs, 2026-09-24. Budget 3,000 credits. Account usage before: 8,662. After: 8,965 (303 credits for 30 sound-effect takes and 4 text-to-speech lines; the speech-to-text checks on the voice takes are billed separately and are tiny).

Raw takes: `art/audio/raw/cases/` (gitignored). Post-process: `python art/audio/process_cases.py` (trim at the first transient, trailing silence below -40 dB cut, fades, peak normalize, mono 44.1 kHz MP3 96 kbps, same as the v1 files). Every file was decoded by `decodeAudioData` in headless Chrome (all 56 SFX and music keys decode, see the audio builder's report).

| key | kept take | how it was made | seconds | peak dBFS |
|---|---|---|---|---|
| squish | squish_raw_b | SFX 0.6 s, "cartoon squish of a tiny gooey slime germ being squashed flat, short wet squelchy splat, cute and funny, video game" | 0.48 | -2 |
| floss_creak | floss_creak_raw_a | SFX 0.8 s, "taut thin dental floss string creaking and squeaking under tension, rubbing hard against smooth tooth enamel, tight squeaky rubbery creak, close up". Stick-slip pulses; take b was a single tonal squeak. Kept at -6 dB because it repeats while the floss is pushed sideways. | 0.50 | -6 |
| floss_thwip | floss_thwip_raw_b | SFX 0.5 s, "snappy thwip whoosh, tight thread popping free, short crisp cartoon snap" (takes a and c were nearly silent) | 0.10 | -2 |
| floss_zip | floss_zip_raw_a | SFX 0.6 s, "fast zip of a thin string pulled out quickly, quick zippy swish rising in pitch, cartoon zip-out" | 0.43 | -3 |
| lamp_loop | lamp_loop_raw_b + a | two looped SFX takes, 3 s each: b "quiet low electrical hum of a small handheld lamp, soft steady 120 hertz buzz..." (soft-saturated so small speakers get harmonics) plus a "soft steady electrical hum of a small dental curing light, gentle high electronic whine..." band-passed 700 Hz to 4.2 kHz, 12 dB under. Equal-power crossfade end into start for a seamless 2.65 s loop, RMS -26 dB like the other loops. | 2.65 | -18 |
| gel_paint | gel_paint_raw_b | SFX 0.5 s, "soft sticky wet dab, brush painting gel, tiny moist smack" | 0.32 | -4 |
| gold_ting | gold_ting_raw_a | SFX 1 s, "bright metallic ting of a small gold object, a single clear high shiny ping with a sparkly shimmer tail, treasure glint" | 1.00 | -4 |
| arr | arr_raw_tts_matey | TTS, premade voice Callum (husky character voice), text "Arr, matey!", stability 0.35, style 0.7. The SFX take was transcribed as a growl and the one-word TTS takes as "Oh", so the short greeting won: speech-to-text reads it as "Or matey". | 0.80 | -3 |
| pocket_open | pocket_open_raw_b | SFX 0.5 s, "soft squelchy wet pop, small gooey squelch, cartoon" | 0.38 | -3 |
| shade_tick | shade_tick_raw_a | SFX 0.5 s, "tiny bright tick, a single very short high glassy click, clean user interface tick", cut to its first 0.12 s | 0.12 | -6 |
| check | check_raw_a | SFX 0.7 s, "satisfying checklist tick sound, a crisp soft pop plus a short bright rising two-note chime, task complete, mobile game UI" | 0.52 | -3 |
| hiccup | hiccup_raw_a | SFX 0.6 s, "single cartoon hiccup, a funny short hic from a person, comedic" (transcribed as [hiccup]); cut before a trailing mouth click | 0.40 | -3 |
| snore | snore_raw_a | SFX 1.6 s, "one short cartoon snore, a funny sleepy snore in and a soft whistle out, comedic" (transcribed as [snoring]) | 1.15 | -4 |
| coin_clink | coin_clink_raw_b | SFX 1.5 s, "a gold coin clinking once on stone then spinning and wobbling to a stop, bright metallic clink, treasure" | 1.13 | -3 |
| shell_crack | shell_crack_raw_b | SFX 0.6 s, "crunchy brittle barnacle shell cracking apart, crisp crackle and crumble, small" | 0.31 | -2 |
| tooth_done | tooth_done_raw_a | SFX 0.9 s, "one clean bright chime note, a single struck glass bell with a pure clear tone and a soft sparkle, short ring out". One steady partial at 1706 Hz, so it steps up cleanly with `rate` (the clean scene raises it per snapped tooth). | 0.85 | -5 |

Every key also has a synthesized fallback recipe in `src/audio/synthSfx.ts` (used when a file is missing or fails to decode).
