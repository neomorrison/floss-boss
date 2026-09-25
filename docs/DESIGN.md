# Floss Boss: Game Design

A dental hygienist sim. You start as a hygiene student, work shifts at someone else's practice, scrape tartar and polish smiles by hand in a 3D mouth, save up, open your own practice, hire a team that cleans patients for you, and grow into a chain of clinics. Bright cartoon look, gross-but-fun gunk, satisfying crunch.

Platform: static web game (Vite + TypeScript + three.js), GitHub Pages, desktop mouse and iPad touch are both first-class. Save in cookies + localStorage.

All numbers below are starting values. The sim builder may retune numbers (never ids) to hit the pacing targets, and must update this file when it does.

---

## 1. Pillars

1. **The clean is the toy.** Scraping a crusty yellow chunk until it cracks off with a crunch, polishing a brown stain to a sparkle, flicking a popcorn husk out with floss. Every action gives instant visual, audio and number feedback.
2. **Always something to buy.** A better tool, a skill, a new chair, a new hire. The next purchase is visible and usually close.
3. **Watch it run.** Once you own a practice, the office is a living 3D diorama: patients walk in, wait, get cleaned by your hires, pay, leave. You can jump into any chair you staff yourself, or let the team do everything.
4. **Readable economy.** Every dollar has a line in the day report. Prices, marketing and hiring are real levers with visible trade-offs.

## 2. Pacing targets (validated by `npm run balance`)

Median bot = hands-on quality 0.85, 100 s real time per cleaning, buys the cheapest useful upgrade when affordable.

| Milestone | Target |
|---|---|
| Tutorial done (school) | 2 cleanings, under 5 min |
| First tool upgrade affordable | by cleaning 3 |
| Level 4 (practice license) | cleaning 12 to 16 |
| Own practice opened | cleaning 20 to 28 (about 40 to 50 min) |
| First hire | within 2 owner days |
| Office T2 (Main Street) | 1.5 to 2.5 h total play at 1x to 2x |
| Office T3 | 3 to 4 h |
| Second location | 4 to 5 h |
| Floss Boss title (5 locations or $5M valuation) | 8 to 12 h, idle-friendly |

The v3 targets in 10.8 replace this table where they differ. Last `npm run balance` (median of 5 seeds, v3 rules with the follow-up raise rules, full output in `out/sim/balance-final.txt`): the table and checks are in 10.8.

Known tension: the idle owner (chair on autopilot, 4x clock, auto-huddle, no hands-on) needs far more game days than the median (240 vs 130 to Floss Boss) but each of its days costs about 40 s of real time against 2 to 5 min for a player who cleans and manages, so it reaches Floss Boss in about 3 h. Sim levers already in: autopilot earns no XP and works at auto quality minus 0.05; owner hands-on cleans add next-day demand and count double in reviews; the manager layer (focus, campaigns, perks) is worth about 20% more net per day than ignoring it. The remaining lever is the clock (UI): cap it at 2x on days with no hands-on clean.

A game day (8:00 to 17:00, 540 game minutes) lasts 108 s real time at 1x (1 game min = 0.2 s). Speeds: pause, 1x, 2x, 4x. Hands-on cleaning **freezes the clinic clock**; on completion the clinic fast-forwards `HANDS_ON_MINUTES[service]` (cleaning 45, deep 75) and the UI shows "While you were cleaning" with the events of that window.

## 3. Career phases (`state.phase`)

### 3.1 `school`
Hygiene school practical. Two guided cleanings on "Dennis the Dummy" (a training mannequin, archetype `mannequin`), with tutorial prompts in the clean scene. Practical 2 turns on the dummy's comfort sensor (starts at 70, drains) so the player meets the comfort hint and Reassure before real patients. No pay, XP only. Then graduation card and hire at Bright Smiles Dental.

### 3.2 `employee`
You work at **Bright Smiles Dental**, owned by **Dr. Ruth Canal**. The employer clinic is a T2 layout with 4 operatories; 3 are run by NPC colleagues (display only, their revenue is not yours), one is **your chair**.

- Shift size: 4 patients (level 1 to 3), 5 (level 4 to 6), 6 (level 7+). Appointment i at `510 + i * floor(450 / n)` minutes.
- A patient in your chair waits for you. Start it hands-on (full pay + tips), or **Quick clean** once you hold Bronze mastery of that patient's case (5.9: 50% wage, no tip, no XP, 60 game minutes of clock).
- Every patient brings a case (5.5), 0 to 2 twists and a bonus (5.6). The shift avoids repeating a case type back to back, and a new case type is introduced with the "New case" card.
- Pay per patient: `rate(title) * (0.4 + 0.8 * quality) * payMult(case) * (Silver ? 1.1 : 1) + tip`. rate: Staff Hygienist $85, Senior Hygienist $110 (level 4), Lead Hygienist $140 (level 7) (v3: raised so the practice opens at cleaning 15 to 20). payMult: routine 1, candy 1.05, braces 1.15, pirate 1.3, whitening 1.35, deep 1.5 (`CASES`).
- Graduation: Dr. Canal pays a $200 signing bonus (enough for Floss Picks right away).
- Tip: `fee * tipRate(archetype) * max(0, (quality - 0.6) / 0.4) * (1 + 0.5 * speedBonus) * tipMult`, `fee = 120 * payMult(case)`, `speedBonus = clamp((par - seconds) / par, 0, 1)`, `tipMult = (Tip Magnet 1.25) * (Gold 1.2) * (bonus met 1.25)`.
- Treasure: the pirate's doubloon pays `$30 + $10 * level` on top (both phases).
- A case unlocked by a level-up is scheduled once in the next shift (tracked in `flags.case_sched_<case>`).
- Shift bonus: $40 if every shift patient was seen.
- 5 five-star cleanings in a row: "Dr. Canal is impressed" bonus of $150.
- Open your own practice when `level >= 4` and `cash >= tierPrice(T1) - maxLoan` ($1,600 down on the $4,000 Strip Mall Suite).

### 3.3 `owner`
You own one or more clinics (`state.locations`). Revenue is yours, costs are yours. You can staff your own chair (hands-on or autopilot) or stay off the floor.

## 4. Player progression

### 4.1 XP and levels
- Hands-on XP: `10 + 30 * quality + (stars == 5 ? 5 : 0)`. Quick clean and autopilot: none (v2: delegating is not progress).
- Owner phase: +2 XP per patient any staff member serves (so the owner keeps levelling while idle).
- `xpToNext(L)`: 60, 100, 150 for levels 1 to 3 (a level-up every 2 to 5 cleans while employed), then `round(60 * L^1.4)` (418 at level 4). Level-up: +1 skill point, full comfort heal jingle, toast.
- Titles: Hygiene Student (school), Staff Hygienist (L1), Senior Hygienist (L4), Lead Hygienist (L7), Practice Owner (owner, T1), Clinic Director (T2 or 2 locations), Dental Mogul (T3 or 3 locations), Floss Boss (5 locations or valuation >= $5M).

### 4.2 Auto quality (Quick clean and autopilot)
`autoQuality = min(0.9, 0.5 + 0.025 * level + toolBonus)`, `toolBonus = 0.02 * ((scalerTier - 1) + (polisherTier - 1) + (ultrasonic ? 1 : 0))`, capped at 0.1. Quick clean uses it as is; the owner's chair on autopilot works at `autoQuality - 0.05`. Employees cannot put their chair on autopilot.

### 4.3 Skills (`src/data/skills.ts`)
One point per level. Three branches. Each node has `requires` (previous node in branch).
- **Technique**: Steady Hands I (gum damage -25%), Steady Hands II (-50% total), Power Stroke (scaler and ultrasonic damage +25%), Polish Pro (polisher radius +25%, polish speed +25%), Eagle Eye (remaining dirt pulses with an outline for 2 s every 6 s), Speed Cleaner (par +20%).
- **Bedside**: Calming Voice (reassure +50%), Small Talk (comfort drain -20%), Kid Whisperer (kid fidget -60%), Gag Guru (gag threshold +2 s), Tip Magnet (tips +25%).
- **Business**: Negotiator (salaries -10%), Marketer (demand +12%), Leader (staff morale +1/day), Lean Ops (supplies -20%), Upseller (add-on acceptance +15%).

### 4.4 Tools (`src/data/tools.ts`)
Slots: `scaler`, `polisher`, `floss`, `suction`, `rinse`. Tier 1 is owned from the start.

| Slot | Tier | Name | Price | Stats |
|---|---|---|---|---|
| scaler | 1 | Sickle Scaler | free | tartar 1.0, plaque 0.8, radius 1.0, gum risk 1.0 |
| scaler | 2 | Gracey Curette | $300 | tartar 1.4, plaque 0.9, radius 1.1, gum 0.9 |
| scaler | 3 | Titanium Scaler | $1,100 | tartar 1.9, plaque 1.0, radius 1.15, gum 0.75 |
| scaler | 4 | Ultrasonic Scaler | $2,400 | tartar 3.2 (time based), plaque 1.6, radius 1.2, gum 0.7, water +0.05/s, buzz |
| scaler | 5 | Piezo Pro | $7,000 | tartar 4.6, plaque 2.0, radius 1.3, gum 0.55, water +0.03/s |
| polisher | 1 | Prophy Angle | free | plaque 2.2, stain 1.3, polish 1.4, radius 1.0 |
| polisher | 2 | Cordless Polisher | $550 | plaque 2.6, stain 1.8, polish 1.8, radius 1.25 |
| polisher | 3 | Air Polisher | $3,800 | plaque 3.2, stain 3.6, polish 1.2, radius 1.7, water +0.04/s |
| floss | 1 | String Floss | free | 1 swipe per debris hp |
| floss | 2 | Floss Picks | $150 | x1.8 |
| floss | 3 | Water Flosser | $1,700 | point-and-hold, x3, water +0.04/s |
| suction | 1 | Saliva Ejector | free | drain 0.25/s, bits 1.0 |
| suction | 2 | High-Volume Evacuator | $850 | drain 0.7/s, bits x2.5, radius x1.6 |
| rinse | 1 | Air-Water Syringe | free | washes loose bits into water, water +0.12/s |

Extras (one-off): Magnifying Loupes $800 (camera zoom x1.25, dirt outline on hover), LED Headlamp $400 (brighter light, plaque easier to see), Disclosing Solution $250 (toggle: plaque dyed bright magenta), Patient Headphones $500 (comfort drain -25%). Consumable: Numbing Gel $15 each (gum damage -50% for one patient). While the toggle is on and you have gel, one is used on each hands-on patient (starting the same patient again does not use a second).

## 5. The hands-on clean (`src/clean`): cases, not chores

Playtest verdict on v1 (2026-09-24): painting dirt off 28 teeth was tedious, a perfect tooth was out of reach because plaque hid where no camera could see, rinse had no job, floss was a swipe, and every patient felt the same. v2 turns each patient into a **case**: a short checklist of clear objectives on a handful of marked teeth, with its own mechanic, plus a twist and a bonus. Satisfaction comes from frequent completions (chunk pops, tooth snaps, checklist ticks), a finishing ritual (polish, rinse, suction) and a before/after reveal.

### 5.1 Mouth and camera
28 teeth (no wisdom teeth), upper arch indices 0 to 13 left to right as seen by the player, lower 14 to 27. Types per arch position: `M M P P C I I I I C P P M M`. Teeth sit on the arch curve in `src/core/mouth.ts`. Missing teeth leave a gap.
Views: Front, Left, Right, Upper, Lower, orbit by dragging the lips/cheeks, two fingers or the right mouse button, pinch/wheel zoom. Tapping a tooth on the mini-map frames it from the angle that shows the most of it (`focusAngles` in `src/clean/camera.ts`, tuned with the GPU reachability audit): the back molars are seen from a little to their own side and steeply from below (upper) or above (lower), which shows about 250 of their 270 face cells where the old side view showed about 65. The camera never enters the lip plane. On touch the tool works 40 px above the fingertip with a small reticle so the finger does not hide the work.

### 5.2 Scope: marked problem teeth
`CleanSetup.problemTeeth` lists the teeth that carry the case's dirt (count from `problemToothCount(level)` in `src/data/cases.ts`: 4 at level 1 up to 9). They are outlined on the mini-map and get a soft glow ring in the mouth until snapped. Every other present tooth only shows faint cosmetic dirt and is not scored.
- Dirt spawns only where a player can press it: the outward face (`u` 0.3..0.7) from just above the gum (`v` >= 0.05, so bands start at about 0.06) and the biting surface of premolars and molars, and only on cells of the reachability table `src/clean/reach.ts`. The table is baked by a GPU audit (`out/cleanfu/reach.mjs`, then `bake.mjs`) at 1440x900, 1024x768 touch and 390x844 touch: a cell counts when some provided view (Front, Left, Right, Upper, Lower or the mini-map focus) shows it (the rendered gum does not cover it) and a pointer outside the HUD picks exactly that spot. Mirror-symmetric. Tartar lumps, pocket tartar and sugar bugs sit only on such cells. Nothing on hidden sides, nothing under the gum. Regenerate the table after changing the mouth layout, the pick proxies, the views or the focus angles.
- Early mouths are light: level 1 is about 1 tartar chunk per problem tooth, plaque bands on half of them, stains on two. Amounts grow with level (DESIGN 6 difficulty) and case.
- **Tooth snap**: when a problem tooth has no tartar left and 80% of its plaque and stain is gone (at most 20% left), it snaps clean: leftover specks fade, a sparkle ring, and `tooth_done` plays at a pitch that rises with each snapped tooth this clean. The mini-map chip turns white with a check. Snapping is what "perfect" means: no pixel hunting.
- **Last bits**: from 70% done (plaque and stain removed weigh 1, each lump's hp 0.5 per lump) the specks left on a problem tooth tint pink and pulse gently, even residue too faint to read as plaque, and a lump still on it glows with them, so the player sees exactly what is left. The glow stops when the tooth snaps.

### 5.3 Tools
The pointer ray hits a tooth; the hit gives `(tooth, u, v)`. Tools act in a brush around it.
- **Scaler** (hand tiers): damage by stroke distance (scrape, do not hold), capped stroke speed (the cap covers the time since the pointer last moved, so 120+ Hz screens with 60 Hz input lose nothing). Deposits crack in visible stages (hairline cracks, bigger cracks, pop). Aim assist: on the gum within 0.32 units of a deposit, the scaler scrapes the deposit instead of the gum. A deposit takes about 0.8 s with the Sickle Scaler and 0.4 s with the Titanium Scaler.
- **Ultrasonic** (tiers 4, 5): time based while held, always faster than every hand scaler (Ultrasonic about 0.3 s per deposit, Piezo about 0.2 s). Buzz, spray, water rises.
- **Polisher**: time based, faster when moving (movement speed decays when the pointer stops). Removes plaque and stain, raises shine. **Wrap assist**: holding the cup on one tooth also polishes a band around the whole crown at the same height (40% rate, rising to 70% after 1 s on the same tooth), shown as a soft ring, so hidden sides never block a snap. The cup reaches the gum edge: a gum hit just outside a tooth's neck polishes that tooth at the gumline (`v` 0), and it is never a gum slip (only scalers slip). Polishing leaves gritty pink **prophy paste** on the cells it touched.
- **Floss** (string, picks): see 5.4.
- **Water flosser** (floss tier 3): point at a gap or bracket and hold; no hooking.
- **Rinse**: hold to spray a wide cone (2.5 units on the teeth, 3 on the tongue): washes paste off teeth (the big shine reveal), floats loose bits and popped debris off the tongue into the water, raises the water (55% of the syringe's rate stays in the mouth). One sweep across a view is enough; a lump drops one crumb (two for big lumps and barnacles).
- **Suction**: hold: drains water and removes only floating bits. Bits resting on the tongue must be rinsed first. So the finish is always scrape, polish, rinse, suction.
- **Case tools** appear in the tool bar only in their case: **Gel brush** (whitening gel, sealants: paints the outward face or biting surface of the tooth under it, with the same wrap assist) and **UV lamp** (whitening cure).
- **Reassure** (in the sleepy twist the button reads **Nudge**): +8 comfort, 18 s cooldown.
- Gum slip: scaler or ultrasonic on gum tissue for 0.15 s: comfort `-8 * gumRisk * gumSensitivity * (1 - gumSkill)` per second, red flash, wince, "Ow".

### 5.4 Floss
1. With floss selected, gaps that matter (debris, objectives) show glowing markers.
2. Press within 0.45 units of a gap to **hook** the floss into it. The string is drawn between two hands on the outward side and follows the gap's axis (the teeth's long axis, projected to the screen). On braces the floss must be **threaded** first: hold still at the gap or bracket for 0.6 s (a ring fills).
3. Pointer motion is split into along-axis and cross-axis parts. Cross-axis motion is blocked: the string presses against the tooth, bows, creaks (`floss_creak`) and does not move. You cannot drag floss through a tooth.
4. Pushing toward the gum builds **contact pressure**; the string bows tighter. At full pressure it **snaps through** the contact point (`floss_thwip`, a small camera nudge).
5. Below the contact, **saw**: each reversal of along-axis direction with enough travel is a stroke. Strokes remove debris hp (times floss power) and the plaque between those teeth; debris pops out with a spin.
6. Pull back past the contact to **zip** out (`floss_zip`), or release to unhook.

### 5.5 Cases (`CleanSetup.caseType`, catalog in `src/data/cases.ts`)
Each case builds a checklist of 3 to 5 objectives (`CleanObjective { id, label, progress, done }`) shown in the HUD, ticking with `check`. Unlock levels and odds per archetype are in `CASES`.
- **Routine**: Pop the tartar (n). Clear plaque on the marked teeth. Polish out the stains. Floss out the food (n, if any). Rinse and suction.
- **Sugar Bug Attack** (candy): cartoon sugar bugs (`sugar_bug` model) crawl over plaque on problem teeth; every 6 s a live bug spreads a new plaque patch around itself; any scaler or polisher touch squashes one (`squish`, a small goo splat) and bugs sidle away when the tool comes within 0.6 units. Objectives: Squash the sugar bugs (n). Floss out the gummies (n). Clear plaque. From level 3: Seal the molars (4) with the gel brush on the biting surfaces. Rinse and suction.
- **Whitening**: enamel starts at `startShade` (a shade guide from 1 brightest to 16 darkest). Polish the stains on the front teeth. Paint gel on the 12 front teeth (arch positions 4 to 9 of each arch). Cure with the UV lamp: each gel-coated tooth under the lamp brightens one shade per 1.2 s (`shade_tick`), the shade meter climbs toward `targetShade`; more than 4 s nonstop on one tooth zings (comfort -5, "Ooh, cold"), so keep the lamp moving. Rinse off the gel and suction. `shadeGain` = shades gained. Owner phase: needs the Whitening Lamp in that operatory, otherwise the visit is routine.
- **Braces Check**: brackets (`bracket` model) and a wire on arch positions 2 to 11. Cells under a bracket are not reachable; polisher or scaler on a bracket clinks and does nothing there. Food wedged under the wire at brackets: thread the floss at the bracket (hold 0.6 s), then saw; or the water flosser. Objectives: Clear the food from the brackets (n). Clear plaque around the brackets. Pop the tartar. Rinse and suction.
- **Pirate Visit** (pirate archetype, rare): 3 to 6 missing teeth. One incisor or canine is gold (`goldTooth`): Buff the gold tooth (polish to full shine, `gold_ting` and a star glint). Barnacles (`tartar_barnacle`, 2x hp, shell crack stages, `shell_crack`). Seaweed strands (`debris_seaweed`) in gaps: floss them out. `treasure`: a doubloon (`doubloon`) is wedged in one molar gap, only visible from a side view; floss it out for a coin spin and `coin_clink` (the treasure bonus). Rinse and suction.
- **Deep Cleaning**: `pockets` stretches of angry red, puffy gumline on problem teeth. Hold the scaler on a pocket for 0.8 s to open it (`pocket_open`): the gum there darkens and hidden tartar slides up into view. Scrape it out; once a pocket's tartar is gone the gum heals from red to healthy pink with a sparkle. Comfort drains 1.5x (numbing gel matters). Objectives: Open the gum pockets (n). Scrape out the hidden tartar (n). Pop the visible tartar. Rinse and suction. Owner phase: needs Deep Cleaning Certification, otherwise routine.
- **"New case"**: the first time a case type appears (`firstOfCase`) the intro card shows its `tip` and waits for a tap; afterwards the intro shows the checklist for about 2 s and dismisses itself (tap to skip).

**Spawn contract (sim fills, clean interprets; starting values, L = player level).** `DirtProfile` in v2: `tartarCount` = visible deposits spread over the problem teeth, `tartarSize` = mean hp multiplier, `plaque` = share of problem teeth with a plaque band (0..1, band thickness grows with it), `stain` = share of problem teeth with stains, `debrisCount` = food bits in gaps beside problem teeth (braces: at brackets). Case extras live in `special`.

| case | problem teeth | tartar n x size | plaque | stain | debris | special |
|---|---|---|---|---|---|---|
| routine | problemToothCount(L) | round(problem x (1 + 0.1(L-1))), cap 2x; size 1.0 to 1.3 | 0.5 + 0.05(L-1), cap 0.9 | archetype stain x 0.6 | 1 + L/3 | |
| candy | problemToothCount(L) | 2 x 0.7 | 0.7 | 0.1 | 2 to 4 (gummies) | sugarBugs 3 + floor(L/2), max 8; sealants 4 from L3 |
| whitening | 4 to 6 front teeth | 2 x 1.0 | 0.3 | 0.9 | 0 | startShade 11 to 15 (coffee, smoker darker), targetShade = max(1, start - 6 to 8) |
| braces | problemToothCount(L) within positions 2..11 | 3 x 1.0 | 0.7 | 0.2 | 3 to 5 (at brackets) | braces true |
| pirate | problemToothCount(L) | 2 x 1.0 | 0.4 | 0.6 | 0 | barnacles 3 to 5, seaweed 2 to 3, goldTooth a present incisor/canine, treasure 70% of visits |
| deep | problemToothCount(L) | 3 to 5 x 1.2 | 0.6 | 0.3 | 1 | pockets 2 to 4 (each hides 1 to 2 deposits) |

Sim notes (src/sim/cases.ts): L is the player level (employee) or `min(level, 4 + 2 * tierIndex)` as an owner. Whitening problem teeth are 4 to 6 teeth drawn from arch positions 4 to 9 (the gel and lamp still cover all 12 front teeth). Problem teeth alternate upper and lower arch; a pirate's gold tooth is never a problem tooth. Routine tartar size is `1 + 0.3 * dirtLevel`. `startShade` is 0 outside whitening. Twists are written into `traits` too: chatty, gag, fidget (at least 0.5) and Sensitive Gums (`gumSensitivity` x2, so the clean must not double it again). Bonus: `treasure` for a pirate with a doubloon, else one of noSlips, fast, spotless (and combo when there are 4+ deposits), from the setup seed. School practicals are routine cases on 4 marked teeth (practical 1: 3 deposits, plaque 0.4, stain 0.25; practical 2: 5, 0.5, 0.3), no twists, no bonus.
Case picks: `CASES[case].weight[archetype]`, gated by `minLevel` (employee) and, as an owner, by what the office offers (whitening: a staffed operatory with a Whitening Lamp, odds x `whiteningPrice^-2`; deep: the certification). A case the chair cannot do when you start (or an NPC seats it) becomes routine. A deep case is the deep cleaning service; a whitening case bills the whitening add-on (whitening is no longer an upsell). Pirates only arrive from level 3. Twists: archetype traits (chatty, gagger, kid fidget) always, then a 30% chance (level 2 to 3) or 50% (level 4+) of one more from `TWISTS` by level, a 25% chance of a second from level 4; at most 1 below level 4, 2 from 4.

### 5.6 Twists and bonus
`twists` (0 to 2; see `TWISTS` for unlock levels) are shown on the chair card and the intro:
- **Chatty**: every 18 to 30 s the jaw closes for 2 s with a speech bubble (+3 comfort). A jaw closing (chat or gag) pauses the stroke you are holding; the tool resumes by itself when the jaw opens (held floss hooks the gap under the pointer again).
- **Fidgety**: the mouth sways; amplitude reduced by Kid Whisperer.
- **Gag Reflex**: more than 2.5 s (+2 with Gag Guru) of nonstop work on a molar triggers a gag (jaw snaps shut 1.2 s, comfort -15). A warning builds first: past 60% of the limit the portrait turns uneasy, "Hng...", and a ring pulses around it.
- **Sensitive Gums**: gum slips cost double; gums near problem teeth glow faintly red.
- **Hiccups**: every 10 to 16 s a "hic" bubble appears, 0.8 s later the mouth jolts; a scaler stroke touching the gum during the jolt counts as a slip. Lift the tool when you see "hic".
- **Sleepy**: every 20 to 30 s the patient dozes and the jaw closes over 4 s (snore). Past 60% closed the lower arch cannot be reached. Nudge wakes them.

`bonus` (one per patient, optional, see `BONUSES`): No gum slips, Finish under par, Pop a 4-chunk combo, Snap every marked tooth, Find the doubloon (pirate only). Met: bonus star animation, tips +25%.

### 5.7 Comfort
Comfort 0..100 from `traits.comfortStart`. Passive drain `0.35 * comfortDrain * (headphones 0.75) * (small talk 0.8) * (deep 1.5)` per second; water above 0.6: -3/s. Reassure/Nudge +8 per 18 s cannot outpace a nervous patient forever. The first time comfort drops below 50 in a clean, a hint reads "Comfort is dropping: tap Reassure" ("tap Nudge" in the sleepy twist) and the button pulses until it is used; in the tutorial the hint is a step that returns to the current step once Reassure is used. Comfort 0: walkout, quality capped at 0.25. Portrait: happy above 60, neutral 30..60, pain below 30 or just hurt, wow on a big pop or a tooth snap.

### 5.8 Scoring
```
objective progress: each 0..1 (count objectives = done/total; area objectives = removed/initial on problem teeth, 80% removal counting as all,
                    a snapped tooth counts as 1; "Rinse and suction" = 1 when paste, floating and resting bits are 0 and water < 0.1)
clean   = mean(objective progress)
quality = clamp(0.8*clean + 0.2*comfort/100, 0, 1)            (walkout: min(quality, 0.25))
stars   = quality >= 0.92 ? 5 : >= 0.80 ? 4 : >= 0.65 ? 3 : >= 0.45 ? 2 : 1
perfect = every objective done and the bonus met
par     = (20 + 2.6*tartarHp + 5*problemTeeth + 4*debris + case extra) * parMult
          case extra: whitening 25, candy 10, braces 15, pirate 20, deep 25
```
The legacy fractions (`tartar`, `plaque`, `stain`, `debris`, `polish`, `mess`) are still reported for stats. **Done** below 80% clean asks "Finish at 62%?" (Keep cleaning, Finish). Done and Enter are ignored until the scene has loaded. The tutorial's last step is "Clean the rest, then press Done" and the Done pulse waits for 70%. The back button asks "Step away?" ("{Name} waits in your chair. This clean starts over and pays nothing until you finish.", Keep cleaning / Step away); in school "Stop the practical?" ("You can start it again from the school.", Keep going / Stop).
Pace (measured with human-like scripted play on the GPU, `out/cleanfu/bot.mjs`: tools from the tool bar, teeth from the mini-map, pointer at hand speed, Reassure when comfort sags; 1440x900 and 1024x768 touch): a level 1 routine case takes 30 to 40 s for a quick player and 38 to 53 s at an average pace, all teeth snapped, 5 stars; level 4 takes 55 to 78 s quick and 71 to 98 s average, 4 stars (comfort costs the fifth). The finish (rinse and suction) is about a fifth of it.

### 5.9 Mastery and Quick clean
- Every hands-on clean of 3+ stars adds 1 to `player.mastery[caseType]`. Tiers at 3 / 10 / 25 (`MASTERY_TIERS`): Bronze unlocks **Quick clean** for that case type; Silver +10% hands-on pay on that case (as an owner, a master's rate: +10% on the fee billed); Gold +20% tips on that case. The tier in force is the one held before the clean. A tier-up gets its own celebration on the result screen, and the Goals screen has a **Cases** tab with a badge per case.
- **Quick clean** (employee phase: delegate the patient to a colleague) needs Bronze on that patient's case, in both phases (`sim.quickCleanStatus`). It pays 50% of the wage part (an owner bills the normal fee), no tip, **no XP**, and does not count for mastery, streaks or goals. Locked, the button shows "Bronze needed: 1/3" and the sim changes nothing.
- Owner phase: your chair's autopilot keeps working (the team does the work), but earns no XP. Each hands-on clean you do as the owner adds +4% demand at that location the next day (max +20%), and that patient's review counts double ("The owner cleaned my teeth").

### 5.10 Reward moments
Before/after: the scene snapshots the Front view (small JPEG) right after loading and again at the end; the result screen shows a draggable before/after slider. Also: chunk pops with crack stages, tooth snap chime scale, checklist ticks, combo text, rinse reveal shine wave, gold glint, coin spin, shade meter, bonus star, mastery badge on tier-up.

### 5.11 Juice checklist
Crunch with pitch jitter, crack stages and pop with spin and gravity, flakes, sparkle, combo counter, tooth snap ring and rising chime, polish shimmer, paste smear then rinse reveal, water ripple, slurp, floss bow and snap, squish splat, lamp glow, portrait reactions, speech bubbles, hitch on big chunks (off with reduced motion), `navigator.vibrate(8)` where supported.

## 6. Patients (`src/data/patients.ts`)

| id | Name idea | plaque | stain | tartar n x size | debris | comfortStart / drain | traits | tipRate | patience (min) | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| mannequin | Dennis the Dummy | 0.4 | 0.3 | 6 x 1.0 | 1 | 100 / 0 | none | 0 | 999 | tutorial only |
| regular | Everyday regular | 0.5 | 0.3 | 10 x 1.0 | 2 | 80 / 1.0 | | 0.10 | 45 | |
| coffee | Coffee addict | 0.4 | 0.9 | 8 x 1.0 | 1 | 80 / 1.0 | | 0.12 | 40 | |
| kid | Candy kid | 0.8 | 0.1 | 3 x 0.7 | 6 | 70 / 1.3 | fidget 0.6 | 0.05 | 30 | sealant add-on |
| nervous | Nervous patient | 0.5 | 0.3 | 8 x 1.0 | 1 | 60 / 2.0 | gumSensitivity 1.4 | 0.15 | 35 | |
| gagger | Gag reflex | 0.5 | 0.3 | 10 x 1.0 | 2 | 75 / 1.0 | gag | 0.10 | 45 | |
| smoker | Heavy smoker | 0.6 | 1.0 | 18 x 1.3 | 1 | 80 / 1.0 | | 0.10 | 45 | |
| senior | Grandpa Gums | 0.5 | 0.5 | 22 x 1.4 | 2 | 85 / 0.8 | 3 to 6 missing teeth | 0.18 | 60 | deep cleaning service when tartar >= 18 |
| influencer | Influencer | 0.2 | 0.5 | 4 x 0.8 | 1 | 75 / 1.2 | review weight 3 | 0.20 | 30 | whitening interest 0.5 |
| athlete | Sports drink fan | 0.9 | 0.2 | 8 x 1.0 | 2 | 80 / 1.0 | | 0.10 | 25 | |
| chatty | Chatterbox | 0.5 | 0.4 | 10 x 1.0 | 3 | 90 / 0.6 | chatty | 0.12 | 50 | |

Difficulty scaling: employee phase multiplies tartar count, plaque and stain by `1 + 0.05 * (level - 1)` (cap 1.5). Pay scales with level through titles.

Archetype mix: weights per office tier (seniors and smokers more common at T3+, kids with Kids Corner x2, influencers at T3+).

## 7. Services and pricing (owner phase)

| id | Market fee | Minutes | Supplies | Requires |
|---|---|---|---|---|
| cleaning | $120 | 45 | $14 | |
| deep | $260 | 75 | $24 | Deep Cleaning Certification (office upgrade $2,000) |
| fluoride (add-on) | $35 | +5 | $4 | |
| sealant (add-on, kids) | $60 | +10 | $5 | |
| xray (add-on) | $90 | +10 | $6 | X-Ray Suite |
| whitening (add-on) | $350 | +40 | $40 | Whitening Lamp in that operatory |
| exam (dentist) | $75 | 10 of dentist time | $2 | a Dentist on staff |
| filling (dentist) | $220 | 20 of dentist time | $30 | a Dentist; 25% of exams find a cavity |

Price multiplier per service `0.7..1.5` (UI slider, steps of 0.05). Demand uses the cleaning multiplier; add-on acceptance uses each add-on's multiplier.

Add-on acceptance: `base * priceMult^-2 * (1 + upseller 0.15) * (intraoral camera ? 1.1 : 1)`. Bases: fluoride 0.45, sealant 0.6 (kids only), xray 0.35, exam 0.7 (only while a dentist is at work, not on a course). Whitening is billed with every whitening case and never sold otherwise. The front desk stops selling exams while 3 exams per present dentist are already pending.

Prices lock per patient: the service price when the appointment is booked (walk-ins: at arrival), add-on prices at check-in.

In the hands-on clean the scene is the cleaning only; add-ons are applied by the sim after the clean (they add minutes to the chair and revenue).

## 8. Clinic simulation (`src/sim/clinic.ts`)

Pure, deterministic, tick-based in game minutes. `tick(state, minutes)` advances all locations (and the employer clinic in the employee phase) and returns `SimEvent[]`.

### 8.1 Patient flow
`scheduled -> entering (WALK_MIN) -> checkin -> waiting -> toChair (WALK_MIN) -> inChair -> toDesk (WALK_MIN) -> checkout (CHECKOUT_MIN) -> exiting (WALK_MIN) -> gone`
Side exits: `noshow` (never appears), `walkout` (waiting too long, or comfort walkout: walks from seat or chair to the door, WALK_MIN, then gone).
- `WALK_MIN = 1.5`, `CHECKOUT_MIN = 2`. Check-in: 3 min with a receptionist (`* (1.2 - 0.4 * skill/100)`), 7 min without (the front desk is you or nobody). Only one check-in at a time per receptionist (or one total without).
- Waiting: patience in minutes from archetype `* (espresso 1.25) * (sound masking 1.2) * (spa lounge 1.5)` (kids with a Kids Corner 1.3). The patience clock starts at the appointment time (early arrivals wait for free). If `waited > patience` the patient walks out: a wait walkout reviews only half the time, at 2 stars, weight 0.5 ("Waited too long"); a comfort walkout during a clean is still 1 star.
- Assignment: VIPs first, then booked patients whose appointment time has come, then walk-ins, to the first free, staffed operatory that can serve the service (a whitening case prefers a lamp, then a specialist of the patient's case type, DESIGN 10.4); hired hygienists (and your autopilot) come first, your hands-on chair only gets a patient when nobody else is free. Nobody is seated in the past when an operatory starts serving mid-day. Player's chair in hands-on mode: the patient sits and waits for the player (`awaitingPlayer`), still using patience (x1.5 while seated, x1.25 more with a Ceiling TV), but always gets at least 20 minutes in the chair.
- Fast-forward after your own clean: when your hands-on chair is the only one serving at that location, the waiting room's patience is paused for the window (nobody else could have seated them).
- Walk-ins come in only when a seat is free and someone can clean, and (v3) only when a chair is free or nobody else is waiting (walk-ins take the gaps); with only your hands-on chair serving, only into an empty waiting room. A walk-in who does not come in counts as turned away.
- In chair: NPC duration `d = minutes(service + addons) * (1.3 - 0.6*speed/100) * difficulty(archetype) * (assistant ? 0.8 : 1) * (ultrasonic kits ? 0.9 : 1)`.
- Dentist: the dentist drops in during the last 12 minutes of a cleaning that has an exam (walk WALK_MIN, exam `10 * (1.2 - 0.4*speed/100)` minutes, a filling adds 20 more). If the exam is not finished when the cleaning ends, the patient holds the chair until it is; if no dentist comes within 20 minutes the exam is skipped and not billed. Fillings happen in the same chair.

### 8.2 NPC quality and comfort
```
q = clamp(normal(0.42 + 0.5*skill/100 + chairBonus + equipBonus + (morale-50)/500, 0.07), 0.2, 0.99)
comfort = clamp(0.4 + 0.45*bedside/100 + chairComfort + opTv, 0, 1)
```
chairBonus: basic 0, comfort 0.02, deluxe 0.04. chairComfort: 0, 0.1, 0.2. opTv 0.08. equipBonus: sterilizer 0.03, intraoral camera 0.03.

### 8.3 Reviews and rating
Each patient reviews with probability 0.6 (influencer always, weight 3).
```
waitScore = 1 - clamp(waited / patience, 0, 1)
e = 0.55*quality + 0.25*comfort + 0.20*waitScore - 0.40*max(0, priceMult - 1)
stars = e >= 0.85 ? 5 : >= 0.74 ? 4 : >= 0.60 ? 3 : >= 0.45 ? 2 : 1      (walkout = 1)
rating = (prior*3 + sum(stars*weight)) / (3 + sum(weight)) + (Fish Tank ? 0.1 : 0)   over the last 40 reviews, prior 3.5, max 5
```
An average NPC clean (skill 50, basic chair) lands at 3 stars, a good hygienist in a comfort chair at 4, a strong hands-on clean at 5. A hands-on clean by the owner always reviews and counts double. Prices in the review are the ones the patient was locked to.
```
```

### 8.4 Demand and booking (start of each day)
```
awareness      = 0.5 + 0.5*(1 - exp(-reach/150)) + event and campaign bonus (max 0.3), capped at 1.15
                 reach = patients served at this office tier (Brand Builder: /75). Moving to a bigger office keeps
                 reach up to 40 (the new neighbourhood has not met you yet); a new location starts at 0.
ratingFactor   = 0.6 + 0.16*rating
priceFactor    = cleaningMult^-2.2          (the price locked at the day's first booking)
marketing      = [1, 1.2, 1.45, 1.75][level], cost/day [0, 60, 180, 420] * tierScale
equipment      = online booking 1.1, loyalty cards 1.08, patient app 1.05, helipad (chain-wide) 1.15
weekday        = [1.1, 1.0, 1.0, 1.0, 1.15]   (Mon..Fri, weekends skipped)
lambda         = baseDemand(tier) * awareness * ratingFactor * priceFactor * marketing * (marketer 1.12) * equipment
                 * modifiers.demand (events, campaigns) * weekday * boss
                 * 0.85 at a location that is not the active one and has no manager (Delegator: no penalty)
demand         = poisson(lambda) new patients, plus yesterday's waitlist (booked first)
booking        = greedy lanes: one lane per serving operatory; each patient takes the earliest lane for their
                 expected chair time (service + average add-ons + whitening for a whitening case, times the
                 hygienist's speed factor and the archetype difficulty, + 9 min turnover; your hands-on chair uses
                 the fast-forward time). Appointments start until 16:00 (Night Shift 17:00). Nobody is ever
                 double-booked into a slot (v2 stacked extra patients on used slots: the main source of wait walkouts).
capacity       = sum over serving operatories of floor(span / expectedInterval) (AI Scheduler x1.1), for display
waitlist       = min(today's unbooked new patients, capacity) come back tomorrow; the rest are turnedAway
boss           = 1 + min(0.2, 0.04 * owner hands-on cleans at this location yesterday)
noShow         = 0.12 * (receptionist 0.6) * (online booking 0.5) * (patient app 0.7) * modifiers.noShows
walkIns        = poisson(0.12 * lambda * modifiers.walkins), arrive at random open times (see 8.1)
```
`turnedAway` counts patients lost for good (overflow beyond the waitlist, walk-ins who did not come in); the day report's `perLocation[i].waitlist` and a note show tomorrow's waitlist. Every decision in the morning huddle (focus, events, campaigns) rebooks the day before the doors open with the same seeded booking RNG, so the list only changes where the decision changes it.

### 8.5 Staff (`src/data/staff.ts`)
Roles: `hygienist`, `receptionist`, `assistant`, `dentist`, `manager`.
- Candidates: a board of 6 (mix of roles weighted to what the office lacks), stats 15..95 (normal around 50, better with office tier), traits 0 to 2. Each stays 2 days (today and tomorrow); the board is topped up at every day close and after a move.
- Salary ask per day: hygienist `200 + 4*avg(skill,speed,bedside)`, receptionist `120 + 1.5*skill`, assistant `110 + 1.4*skill`, dentist `800 + 6*skill`, manager `350 + 3*skill` (rounded to $5). Negotiator -10%. Hiring fee = 1 day of salary.
- Traits: Perfectionist (+0.05 quality, -10% speed), Speedy (+15% speed, -0.03 quality), Charmer (+0.1 comfort), Clumsy (5% chance of a bad clean: quality -0.3), Night Owl (morale +, slow first hour), Loyal (never quits), Ambitious (levels 2x; when underpaid also asks for a raise on a random day, 10% a day, under the raise rules below).
- Morale 0..100, daily: `+2 - overwork + (break room 3) + (leader 1) + (manager 2) - round(30*(1 - salary/ask)) when underpaid`. Overwork for hygienists and assistants is measured in chair minutes: `3 * max(0, minutes - 470) / 45` (so assistants and Ultrasonic Kits never burn anyone out); dentists `3 * max(0, patients - 18)`, receptionists `3 * max(0, patients - 40)`. While cash is below zero the boosters do not apply and morale falls 8 a day instead. A drop of more than 5 in a day adds a report note with the reason. Morale < 25: 20% daily quit chance (Loyal never). Morale affects quality (above) and speed (`+-10%`). Salaries can be set from 75% to 200% of the ask; at the floor staff lose about 6 morale a day and quit within two weeks, so underpaying loses money unless morale boosters (break room, manager, Leader) cover it.
- Staff XP: +1 per patient cleaned, assisted, examined or checked in (a receptionist sees every patient and levels about four times faster than a hygienist); an Office Manager +0.25 per patient served. Level up every `25*level` XP: skill +3, speed +2, bedside +2, ask +5% up to level 10 (v3: +8% at every level). Past level 10 stats keep growing but the ask does not: a veteran asks about 1.55x their hiring ask. Without that cap an owner who approved every raise (or ran auto raises) ended up paying more in salaries than the chairs earn; the idle owner with auto raises went bankrupt after 400 to 500 days.
- Training course: $1,500, the staff member is off for the next day (`offFrom` = `offUntilDay` = tomorrow); skill +8 lands when the course day ends, and the ask follows.
- **Raise requests** (owner playtest: "too much work to give them raises every day"; the v3 rules asked about 0.9 times a day at a new Main Street Office with 6 staff). A level-up, a finished course or a skill event that raises the ask puts a request in the pipeline (`raiseDue`); it is settled at the day close, never mid-day:
  - No request while the salary is at least **95% of the ask**. One level-up from a fair salary stays inside that band (1/1.05), so staff ask about every second level.
  - **Auto raise**: with `settings.autoRaise` (off by default) or an **Office Manager** at that location (no setting needed), an ask up to **+15%** above the salary is approved at the close: the salary becomes the ask, morale +5, and the report notes "Auto raise: Ava +$12" (the full name when two teammates share a first name). It does not wait for the quiet period, but it waits while cash is below zero (the ask stays in the pipeline).
  - Otherwise the owner gets a `raiseRequest` event and the note "Ava Park asks for a raise to $460 per day", **at most once per 10 working days** per staff member, counted from hiring, the last request or the last raise. A request that comes up during that quiet period waits for it to end. Asks above +15% (the owner pays under about 87% on purpose) always go to the owner. `raiseRequest` is only emitted when the owner has to act.
  - Any raise the owner gives on the Staff screen answers the request and restarts the 10-day quiet period.
  - Measured (`npm run balance` checks: new Main Street Office, 4 hygienists, a receptionist and an assistant, all newly hired, 30 days, 5 seeds): the owner who approves each request gets 0.33 a day (v3 rules: 0.82 in the same setup), one who ignores them 0.39 (v3: 0.93; either way staff quit when ignored long enough), autoRaise 0 (about 11 auto raises), an Office Manager 0. Days 31 to 60 of the same office: 0.25. Over a whole median game (up to 5 locations, Office Managers at the newer ones) 0.27 a day reach the owner.
- A hygienist without an operatory moves into a new operatory, or into the one a fired hygienist leaves.
- Firing: pay 1 day severance.

### 8.6 Offices (`src/data/offices.ts`)
| tier | Name | op slots | seats | rent/day | price | baseDemand | appeal |
|---|---|---|---|---|---|---|---|
| t1 | Strip Mall Suite | 2 | 4 | $180 | $4,000 | 11 | 1.0 |
| t2 | Main Street Office | 4 | 8 | $700 | $25,000 | 17 | 1.25 |
| t3 | Medical Plaza | 6 | 12 | $1,800 | $120,000 | 22 | 1.5 |
| t4 | Smile Tower | 8 | 16 | $3,600 | $400,000 | 27 | 1.8 |

- The first operatory is included in the price. More operatories: $4,000 each.
- Moving up: pay the new tier price minus 50% of the current tier price (trade-in); operatories, chairs and equipment move with you (up to the new slot count).
- New location: requires owning at least one T2+ location; pay the tier price in full plus a franchise license of `$78,000 * 2.25^(locations owned - 1)` ($78k, $176k, $395k, $888k). Max 5 locations. A location without a manager runs at -15% demand (nobody minding the store) when it is not the active one.
- Bank loan: up to 60% of the next purchase; 0.25% interest per day on principal; auto payment 1% of principal per day; repay any time. Outside a purchase the bank lends up to 60% of the next move (or of the next location) minus what you already owe.

### 8.7 Upgrades (`src/data/upgrades.ts`)
Operatory: Comfort Chair $2,500, Deluxe Massage Chair $9,000, Ceiling TV $1,200 (comfort +0.08, chair patience x1.25), Whitening Lamp $6,000 (whitening cases), Intraoral Camera $3,000.
Office: Deep Cleaning Certification $2,000 (deep cases), X-Ray Suite $8,000, Sterilizer Pro $3,500, Ultrasonic Kits $5,000, Espresso Machine $1,500, Fish Tank $2,500 (rating +0.1 flat, at once), Kids Corner $2,000 (twice the kids, kid patience x1.3), Online Booking $4,000, Break Room $3,000 (t2+).

### 8.8 Day close
```
revenue  = fees + add-ons + dentist work (+ tips when you cleaned hands-on)
costs    = salaries + rent + supplies*(1 - leanOps 0.2) + marketing + loan interest + loan payment + overdraft interest
net      = revenue - costs
```
Overdraft: while cash is below zero after the day's costs, 0.5% of the negative balance is charged as overdraft interest, the bank skips the loan's auto-payment (interest still runs), staff lose 8 morale a day, and Debt Free is only awarded with cash at or above zero. `closeDay` returns the report with `events` (achievements, level-ups, quits) for the UI to emit after it; `operatingNet` is the day's operating net.
Day report: patients served, turned away, walkouts, reviews, rating delta, revenue and cost lines, top staff, goals completed. Weekends are skipped (Fri -> Mon); rent and salaries are charged for 5 working days only.

### 8.9 Offline progress
On load, if `phase == 'owner'`, at least one hired hygienist and `now - lastSeen > 10 min`:
`credit = max(0, avgNet(last 3 days)) * min(hoursAway * 0.5, 6) * 0.6`. Shown in a "While you were away" card. No days advance.

### 8.10 Goals and achievements
Three daily goals from templates (remove N tartar chunks, N five-star reviews, serve N patients, clean in under N s, sell N add-ons, finish a perfect clean, hit an N-chunk combo). Each pays `max($100, 0.2 * avg operating net of the last 3 days)` as an owner (`$20 + $5 * level` as an employee) plus `15 + 5 * level` XP, so the three together are about half a day of net. As an owner with no hands-on chair anywhere, the third goal only draws from served, five-star and add-on goals. Finished goals are paid out before opening the practice replaces them. Finished goals left unclaimed at the day close are claimed for half their reward (v3); with Paperwork Pro they pay in full. The fast-clean goal reads "Finish a 3-star cleaning in under N s" (only 3-star cleans count). Owner goals: DESIGN 10.7. About 24 achievements (first chunk, 100 chunks, first hire, T2, 5 locations, perfect clean, 10-combo, and so on).

### 8.11 Valuation
`(sum(tierPrice*0.6 + equipmentValue*0.5) + max(0, avgNet7)*150) * (Investor Relations 1.1) + cash - loan`. avgNet7 is the operating net of the last 7 owner days: purchases, loans, hiring fees, training, severance, interviews, event cash, goal rewards and offline credit are excluded (`NON_OPERATING_LABELS`), so offline credit and goal rewards (both based on it) cannot feed themselves.

## 9. Look and feel
- Light-first bright cartoon. Palette: mint `#3DD6B5`, teal `#0E8F8A`, bubblegum `#FF7AA8`, sunshine `#FFD166`, enamel white `#FFFDF7`, ink `#16323A`. Tartar is mustard `#D8B04A` with darker crust, plaque buttery `#F2DE8A`, stain coffee `#8A5A2B`.
- Fonts: Baloo 2 (display), Nunito (UI).
- 3D: low-poly, soft shading, gentle ambient + key light, no harsh blacks.
- Everything works by touch: no hover-only controls, 44 px targets, drag to scrape, two-finger drag or drag on empty space to orbit.

## 10. The manager layer (v3, owner phase)

Playtest verdict (2026-09-24): once you own offices, the only things to do were fast-forward and collect money; marketing was useless because every office was always over capacity; the Piezo Pro card fell off the Tools screen; wait walkouts spammed 1-star reviews. v3 gives the owner decisions every day, levers that matter at every stage, and more to buy. Catalog: `src/data/manager.ts`, `src/data/upgrades.ts`, `src/data/skills.ts`.

### 10.1 Morning huddle and daily focus
After "Next day" on the day report (owner phase) the **Morning Huddle** opens: today's booked patients per location with case-type icons, who is on duty, active campaigns and modifiers, and the event cards drawn this morning (10.2). The owner picks the **Daily Focus** (`FOCUSES`, one slot, two with Huddle Pro) and answers the events, then "Open the doors". Focus effects are runtime effects for that day only (speed, quality, walk-ins, fees, add-on acceptance, morale at close, staff XP). `state.settings.autoHuddle` skips the huddle: the last focus is kept and events resolve with choice 0. `sim.setFocus(state, focusIds)`, `sim.resolveEvent(state, index, choice)` returns the outcome text.

### 10.2 Events
Each owner morning every location draws an event with `EVENT_CHANCE[tier]` from `EVENTS` (weights, `minTier`, `needs`, never the same event twice in 5 days at a location). Choices are real trade-offs; `chance` effects roll with the day's RNG (+0.2 with Crisis Manager) and show win or lose text. Effects are applied generically by kind (cash scaled by `tierScale`, rating, awareness, modifier for N days or permanent, morale, skill, salary, quit chance, VIP patient added to today with its own fee and review weight 5, closed operatory, late opening, temporary staff, discounted or free equipment, XP). Every resolution goes in `state.eventLog` and the day report. Unanswered events at "Open the doors" resolve with choice 0. The diorama shows a prop for active events where one fits (puppy, balloons for a party or campaign, Jolly Roger, SmileCo sign across the street, camera crew, generator, red carpet).

### 10.3 Demand, capacity and marketing
- **Offices start under capacity.** A new office at the default price and no marketing should fill about 70 to 90% of its staffed capacity in its first week; awareness growth alone takes it to about 100% over 2 to 3 weeks. Every operatory you add creates spare capacity that marketing and campaigns fill. Turned-away demand should stay under about 15% unless you over-market.
- **Waitlist.** Turned-away patients are not lost: up to one day of capacity carries over as a waitlist that is booked first the next day. `ClinicDayStats.turnedAway` reports only the patients lost for good; the day report's `perLocation[i].waitlist` (and a note) shows tomorrow's waitlist.
- **Marketing levels** stay (volume). **Campaigns** (`CAMPAIGNS`) run 4 to 5 days per location, cost scales with `tierScale` (Brand Builder -25%), and shift the case mix (`caseBoost`) toward specific cases: kids, whitening, deep cleans, braces, pirates. Premium cases pay more (whitening add-on, deep service) and feed mastery, so campaigns are worth running even when an office is full. Grand Opening is for a new location (big demand and awareness boost, long cooldown). One campaign per location at a time, cooldown after it ends.
- **Wait walkouts review gently**: a patient who leaves the waiting room reviews only half the time, at 2 stars, weight 0.5 ("Waited too long"). A comfort walkout during a clean is still 1 star.

### 10.4 Staff depth
- **Perks.** At staff levels 2, 4, 6 and 8 the owner picks one of two offered perks (`PERKS`, filtered by role) from a card ("Ava leveled up: choose a perk"). Unpicked perks auto-pick the first after 2 days. Case perks make a hygienist a **specialist**: seating prefers routing a patient to a free specialist of that case type.
- **Interviews.** Candidates show stat ranges (width about 30, true value inside) and hidden traits until interviewed. Interview costs $40 x `tierScale` (free with Talent Scout) and reveals exact stats and traits.
- Temporary staff (intern event) leave after `tempUntilDay`.

### 10.5 Equipment and upgrades
25 equipment items and 5 operatory upgrades, some exclusive to bigger offices (`minTier`); locked ones show "Needs Main Street Office" and so on. Every blurb is implemented exactly as written. Chain-wide items (Research Wing, Helipad) apply at every location. The diorama renders every owned item at its spot.

### 10.6 Skills
Four branches: Technique, Bedside, Business, Management (`SKILLS`). Paperwork Pro pays unclaimed goals in full at day close (they pay half without it). Owners keep earning skill points from staff patients, so the Management branch fills in while managing.

### 10.7 Owner goals
Owner daily goals come from management verbs: run a campaign, zero walkouts at a location, serve N, operating net over N, sell N add-ons, answer N events, reach a rating. Hands-on goals only appear when the owner staffs a chair in hands mode.

### 10.8 Pacing (v3 targets, replaces section 2 targets where they differ)
Hands-on only (no Quick clean until Bronze), median bot 80 s per v2 clean plus 15 s hub time:
| Milestone | Target |
|---|---|
| First tool upgrade affordable | by cleaning 2 |
| Level 2 | cleaning 2 |
| A level-up | every 2 to 3 cleanings through level 4 |
| Level 4 (practice license) | cleaning 9 to 12 |
| Own practice opened | cleaning 15 to 20, about 25 to 35 min |
| Office T2 | 1.25 to 2 h |
| Office T3 | 2.5 to 3.5 h |
| Second location | 3.5 to 4.5 h |
| Floss Boss | 7 to 10 h |

Last `npm run balance` (v3 rules, median of 5 seeds; 80 s cleans + 15 s hub time; 2x while cleaning, 4x otherwise; owners clean 3 a day at T1, 2 at T2, 1 from T3 and Quick clean only Bronze cases). "Managed" bots run the huddle every morning (focus by a simple rule, events by expected value, campaigns when there is spare capacity or a lamp or certification, the first offered perk, interviews before hiring); casual answers every event with its first choice; the idle owner uses auto-huddle and never manages. Every bot but the idle owner approves each raise request at once; the idle owner turns on auto raises (DESIGN 8.5). The v3 bots never paid a raise, which hid how expensive veterans got.

| Milestone | Target | Median (q 0.85) | Casual (q 0.70) | Expert (q 0.95) | Greedy expander | Median, no manager | Idle owner |
|---|---|---|---|---|---|---|---|
| Tutorial done | < 5 min | 4.3 min | 4.3 | 4.3 | 4.3 | 4.3 | 4.3 |
| First tool affordable | cleaning 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| Level 2 / 3 / 4 | 2 / 4-5 / 9-12 | 2 / 5 / 9 | 2 / 6 / 10 | 2 / 5 / 8 | 2 / 5 / 9 | 2 / 5 / 9 | 2 / 5 / 9 |
| Practice opened | cleaning 15-20, 25-35 min | 15, 27 min | 20, 35 min | 15, 27 min | 15, 27 min | 15, 27 min | 15, 27 min |
| First hire | owner day 1-2 | 1 | 1 | 1 | 1 | 1 | 1 |
| Office T2 | 1.25-2 h | 1.95 h (owner day 14) | 2.37 h | 1.84 h | 1.48 h | 2.12 h | 0.73 h (day 25) |
| Office T3 | 2.5-3.5 h | 3.20 h (day 34) | 3.70 h | 3.13 h | 2.17 h | 3.99 h | 1.00 h (day 51) |
| Second location | 3.5-4.5 h | 4.32 h (day 60) | 4.78 h | 4.07 h | 2.74 h | 5.22 h | 1.27 h (day 81) |
| Floss Boss | 7-10 h | 7.42 h (day 132) | 7.77 h | 6.91 h | 6.11 h | 9.02 h | 3.04 h (day 244) |

Demand (median bot, all locations by tier; new demand over the morning's capacity, fill of a new or moved office in its first 5 days, share lost for good, walkouts a day): T1 109% (first week 113%, the bot runs a Grand Opening at once), lost 13%, 0.21 walkouts; T2 90% (first week 71%), lost 8%, 0.27; T3 92% (86%), lost 14%, 0.10; T4 91% (95%), lost 7%, 0.03. The unmanaged median sits at 98 to 114% with 13 to 16% lost (it never markets down or runs campaigns but also never adds demand). v2 ran 128 to 157% with 21 to 36% lost and about 3 wait walkouts a day at T2 and up; lane booking (no double-booked slots) and walk-ins that only take the gaps bring walkouts to 0.03 to 0.3 a day, and none of them is a 1-star review any more.

Manager layer over a median game: about 165 events answered (event cash +$18k / -$45k: events cost more than they pay), 29 campaigns (Golden Years and Smile Makeover when full, Grand Opening at new locations), focus mostly Speed and Upsell when full, Walk-in and Quality when there is room, about 130 perks picked, 42 interviews, 34 raise requests answered (0.27 per owner day across every location) and 76 auto raises by the Office Managers of the newer locations.

Degenerate checks (A/B from one forked state, autopilot chair, 3 seeds): cash always equals the ledger and the loan round trip moves no money; a second operatory plus a hygienist at T1 on owner day 6 pays back in 4 to 19 days (+$96/day over 20 days: a young office has spare capacity until awareness, marketing or a campaign fills it); price at T1 1.0 / 1.2 / 1.5 nets $985 / $957 / $839 a day, at T2 $3,484 / $1,737 / $504 (demand-limited: raising prices loses); paying everyone the 75% floor for 30 days at T2 loses 3 to 4 people and -$893 to -$1,513 a day; Kids Week over 10 days at a full T2 office nets +$103 / +$986 / +$1,779 a day and with a fresh spare operatory +$1,127 / +$1,490 / +$2,279 (3 noisy seeds; the previous run had losses at a full office, so the premium cases carry it); Smile Makeover with a Whitening Lamp +$371 to +$587 (the lamp and the staffed operatory are the price of entry; cost $1,200 x tierScale, 4-day cooldown); the BlueTooth insurance network nets $3,246 / $2,963 / $2,488 a day over 30 days against $4,032 / $3,392 / $2,986 for staying independent; always taking the richest-looking event choice nets $3,494 / $2,858 / $1,929 a day against $3,872 / $3,380 / $1,905 for the first choice (no infinite event money: event cash is non-operating and costs more than it pays); raise requests at a new Main Street Office with 6 new staff over 30 days (5 seeds): 0.33 a day when the owner approves each (v3 rules: about 0.8), 0.39 when ignored (v3: about 0.9), 0 with auto raises or an Office Manager.

### 10.9 Sim rules as implemented (src/sim/manager.ts, effects.ts, booking.ts, staff.ts)
- **Huddle.** `closeDay` (owner) books the new day, then draws events (at most one per location), then makes the goals. `huddlePending(state)` is true until `completeHuddle` ("Open the doors"); `tick()` completes it itself if the clock starts first (leftover events take choice 0 and come back as toasts), and `closeDay` does too. With `settings.autoHuddle` the events resolve inside `closeDay` and the focus is kept. Every morning decision (focus, event, campaign) rebooks that location before the doors open with the day's seeded booking RNG; prices stay locked at the first booking of the day.
- **Focus.** `setFocus` validates the office tier (the highest owned) and the slots (1, Huddle Pro 2); `[]` means Steady. The focus persists across days and is written each morning as `focus:<id>:<day>` modifiers on every location (speed, quality, walk-ins, fees, add-ons); Team Day adds its morale at close and Training Day doubles staff XP.
- **Events.** Draw: `EVENT_CHANCE[tier]` per location, weights, `minTier`, `needs` (temporary staff do not count), no repeat within 5 days, and never an event whose permanent modifier is already in force there (no second insurance network or puppy). Vars: `{clinic}`, `{staff}`/`{staffId}` (poaching picks one of your two best), `{op}`/`{opId}`, `{equip}`/`{equipId}` (an unowned item this office can buy). `eventText` fills them and rewrites scaled cash in the hints ("-$300" reads "-$540" at Main Street). Effects: cash (`Events` ledger line, non-operating so it never feeds valuation or goal rewards), rating (a bonus capped at +-0.5 that fades 5% a day), awareness (cap +0.3; the keynote lifts every location), modifier (`event:<id>:<day>`, `days: null` = permanent), morale, skill (the ask follows), salary, quit chance (Loyal stays), VIP (added to today, `vip: true`, flat fee, review weight 5, seated first), closed operatory, late opening, temporary staff (salary 0, leave after `tempUntilDay`), salesman discount (today only, `equipmentPrice`), free equipment, XP, chance (+0.2 with Crisis Manager). A choice that changes no numbers still leaves a one-day marker modifier so the diorama can show its prop. Every resolution goes to `eventLog` (last 30) and the next report's notes.
- **Campaigns.** `campaignStatus` / `startCampaign`: cost x `tierScale` (Brand Builder -25%, ledger line `Campaigns`, operating), `minTier`, a Whitening Lamp (Smile Makeover) or the certification (Golden Years), one at a time, cooldown after (`campaignCooldownUntil = end + 1 + cooldown`), Grand Opening only within 10 days of opening a location (or under 150 patients served). Bought before the doors open it runs today plus `days - 1`; bought later it starts tomorrow and runs `days` days. The `campaign:<id>:<startDay>` modifier carries the demand multiplier and the case boost; its id holds the real start day and a modifier is only in force from the day in its id (`effects.modActive`), so the UI can read a start day after `state.day` as "Starts tomorrow"; the booking picks patient and case together with the boost, so a pirate campaign brings pirates.
- **Owner case premium.** Sugar bug, braces and pirate cases bill the cleaning at their case rate (1.05, 1.15, 1.3) at your own offices; whitening and deep cases bill their add-on and service. Premium campaigns pay even when an office is full.
- **Perks.** At levels 2, 4, 6, 8 two perks for the role (not owned) are offered in `pendingPerks`; `pickPerk` takes one; after 2 days the first is picked. Effects: case specialists get their case's quality and speed and are seated their case type first; Speed Demon x1.1 (hygienists, desk check-in, assistants, dentist exams); Gentle Hands +0.1 comfort (dentists: +0.05 on the exam); Mentor: teammates x1.5 XP; Iron Lungs: two more patients (90 chair minutes) before overwork; Upsell Star: the desk's check-ins, a dentist's exams, a hygienist's chair-side second offer; Pirate Whisperer: pirates leave a tip at checkout.
- **Candidates and interviews.** Six on the board (eight with Talent Scout), each stat shown as a 30-wide range holding the true value until `interview` ($40 x tierScale of the active office, free with Talent Scout, ledger `Interviews`, non-operating).
- **Equipment, upgrades and skills** (blurbs as written): Water Filter supplies x0.9; Aromatherapy +0.05 comfort; Loyalty Cards demand x1.08; Staff Lockers +1 morale; Digital X-Ray needs the X-Ray Suite, X-rays accepted x1.2 and take half the time; Sound Masking patience x1.2; Patient App no-shows x0.7, demand x1.05; Central Nitrous Line +0.10 comfort everywhere and laughing gas in every operatory; Laser Whitening whitening fees x1.25 and +0.05 quality on whitening; Spa Lounge patience x1.5 and rating +0.15; CAD/CAM fillings x1.5 fee and 2/3 of the time; Rooftop Garden +3 morale and staff only quit after 5 days in a row under 25; Smile Studio one VIP a day ($2,400, weight 5); Research Wing staff XP x1.5 at every location and training half price; Helipad demand x1.15 at every location; AI Scheduler capacity x1.1 (tighter lanes); Ergonomic Stool 5% faster and 80% of chair minutes count toward overwork; Laughing Gas (Main Street and up) +0.15 comfort, and a nervous patient in that chair never walks out of a hands-on clean (the clean is scored as finished with comfort floored at 20; the scene also gets +15 starting comfort and 30% slower drain). Paperwork Pro: unclaimed goals pay in full at close (half without); Bulk Buyer -10% on equipment, chairs and operatory upgrades; Brand Builder awareness scale 75 instead of 150; Investor Relations loan interest halved and valuation x1.1; Franchise Savvy moves and new locations x0.8; HR Guru training x0.6 and +12 skill; Delegator no -15% at unmanaged locations; Night Shift appointments until 17:00, close 18:00, overwork threshold +60 minutes; Mentor Program staff XP x1.5; Morale Officer morale floor 30.
- **Owner goals.** First goal: serve N. Second: five-star reviews, add-ons, no walkouts at the active location, operating net over 90% of the 3-day average, or keep the active location's rating (rounded down to 0.05). Third: five-stars or add-ons, answer N events (when cards are waiting and auto-huddle is off), start a campaign (when one is possible), or a hands-on goal when you staff a chair in hands mode. Net, walkout and rating goals are judged at the close. `Goal.kind` includes the owner kinds 'campaign', 'noWalkouts', 'net', 'events', 'rating'.
- **Pay policy and pauses.** `settings.autoRaise` (off by default) approves raise asks up to +15% at the close (DESIGN 8.5); an Office Manager does the same at their location without it. `settings.autoPause` belongs to the UI (pause on key events; `undefined` means on); `migrate` keeps a saved boolean and otherwise leaves it undefined.
- **Debug hook.** `sim.offerPerks(state, clinicIndex, staffId)` offers a perk choice now with the level-up rules (two perks of the role not owned yet, auto-picked after 2 days); an offer already waiting is kept.
