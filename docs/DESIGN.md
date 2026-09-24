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

Last `npm run balance` (median of 9 seeds). Bots clean hands-on at 100 s plus 15 s of hub time per clean, use 2x while they have hands-on work and 4x otherwise, and as owners clean 3 patients a day at T1, 2 at T2, 1 from T3 on (the rest by Quick clean).

| Milestone | Median (q 0.85) | Casual (q 0.70) | Expert (q 0.95) | Greedy expander | Idle owner |
|---|---|---|---|---|---|
| Tutorial done | 4.8 min | 4.8 min | 4.8 min | 4.8 min | 4.8 min |
| First tool affordable | cleaning 2 | 2 | 2 | 2 | 2 |
| Level 4 | cleaning 12 | 14 | 10 | 12 | 12 |
| Practice opened | cleaning 24, 49.5 min | 24, 50.3 min | 20, 42 min | 24, 49.5 min | 24, 49.5 min |
| First hire | owner day 1 | 1 | 1 | 1 | 1 |
| Office T2 | 2.40 h (owner day 16) | 2.71 h | 2.27 h | 1.77 h | 1.03 h (day 22) |
| Office T3 | 3.87 h (day 35) | 4.12 h | 3.74 h | 2.50 h | 1.29 h (day 47) |
| Second location | 4.86 h (day 59) | 5.20 h | 4.69 h | 3.09 h | 1.47 h (day 68) |
| Floss Boss | 8.46 h (day 144) | 8.74 h | 7.98 h | 7.53 h | 3.03 h (day 201) |

Degenerate checks (A/B runs from one forked state): a second operatory plus a hygienist at T1 pays back in 8 to 17 days; at T1 a cleaning price of 1.0 nets $858/day vs $847 at 1.2 and $819 at 1.5, at T2 $3,471 vs $3,242 vs $1,294 (a whole game at 1.5 takes 11.5 h instead of 8.5 h); paying every employee the 75% floor for 30 days loses $170 to $1,580 a day to quits; a loan round trip moves no money and the bank refuses anything over the limit; cash always equals the ledger.

Known tension: the idle owner (chair on autopilot, 4x clock, no hands-on) needs more game days than the median (201 vs 144) but each of its days costs about 37 s of real time against 2.5 to 6 min for a player who cleans, so it reaches Floss Boss in about 3 h. Hands-on cleaning is the fun, not the fastest route to money. Levers if that matters: cap the clock at 2x on days with no hands-on clean, or pay a "boss on the floor" bonus (rating or demand) for hands-on cleans.

A game day (8:00 to 17:00, 540 game minutes) lasts 108 s real time at 1x (1 game min = 0.2 s). Speeds: pause, 1x, 2x, 4x. Hands-on cleaning **freezes the clinic clock**; on completion the clinic fast-forwards `HANDS_ON_MINUTES[service]` (cleaning 45, deep 75) and the UI shows "While you were cleaning" with the events of that window.

## 3. Career phases (`state.phase`)

### 3.1 `school`
Hygiene school practical. Two guided cleanings on "Dennis the Dummy" (a training mannequin, archetype `mannequin`), with tutorial prompts in the clean scene. No pay, XP only. Then graduation card and hire at Bright Smiles Dental.

### 3.2 `employee`
You work at **Bright Smiles Dental**, owned by **Dr. Ruth Canal**. The employer clinic is a T2 layout with 4 operatories; 3 are run by NPC colleagues (display only, their revenue is not yours), one is **your chair**.

- Shift size: 4 patients (level 1 to 3), 5 (level 4 to 6), 6 (level 7+). Appointment i at `510 + i * floor(450 / n)` minutes.
- A patient in your chair waits for you. Start it hands-on (full pay + tips) or **Quick clean** (auto quality, no tip, half XP, 60 game minutes of clock).
- Pay per patient: `rate(title) * (0.4 + 0.8 * quality) + tip`. rate: Staff Hygienist $75, Senior Hygienist $95 (level 4), Lead Hygienist $120 (level 7).
- Graduation: Dr. Canal pays a $250 signing bonus (enough for Floss Picks right away).
- Tip: `fee * tipRate(archetype) * max(0, (quality - 0.6) / 0.4) * (1 + 0.5 * speedBonus) * tipMult(skills)`, `fee = 120`, `speedBonus = clamp((par - seconds) / par, 0, 1)`.
- Shift bonus: $40 if every shift patient was seen.
- 5 five-star cleanings in a row: "Dr. Canal is impressed" bonus of $150.
- Open your own practice when `level >= 4` and `cash >= tierPrice(T1) - maxLoan` ($2,000 down on the $5,000 Strip Mall Suite).

### 3.3 `owner`
You own one or more clinics (`state.locations`). Revenue is yours, costs are yours. You can staff your own chair (hands-on or autopilot) or stay off the floor.

## 4. Player progression

### 4.1 XP and levels
- Hands-on XP: `10 + 30 * quality + (stars == 5 ? 5 : 0)`. Quick clean / autopilot: half.
- Owner phase: +2 XP per patient any staff member serves (so the owner keeps levelling while idle).
- `xpToNext(L) = round(60 * L^1.4)`. Level-up: +1 skill point, full comfort heal jingle, toast.
- Titles: Hygiene Student (school), Staff Hygienist (L1), Senior Hygienist (L4), Lead Hygienist (L7), Practice Owner (owner, T1), Clinic Director (T2 or 2 locations), Dental Mogul (T3 or 3 locations), Floss Boss (5 locations or valuation >= $5M).

### 4.2 Auto quality (Quick clean and autopilot)
`autoQuality = min(0.9, 0.5 + 0.025 * level + toolBonus)`, `toolBonus = 0.02 * ((scalerTier - 1) + (polisherTier - 1) + (ultrasonic ? 1 : 0))`, capped at 0.1.

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

## 5. The hands-on clean (`src/clean`)

### 5.1 Mouth
28 teeth (no wisdom teeth), upper arch indices 0 to 13 left to right as seen by the player, lower 14 to 27. Types per arch position: `M M P P C I I I I C P P M M` (molar, premolar, canine, incisor). Teeth sit on the shared arch curve in `src/core/mouth.ts`. Missing teeth leave a gap (seniors).

Camera looks into a wide-open cartoon mouth framed by lips. Views: Front, Left, Right, Upper, Lower (buttons + swipe/drag on empty space to orbit within limits, pinch/wheel to zoom). A mini-map of 28 teeth colored by dirt lets you tap a tooth to focus it.

### 5.2 Dirt model (pure logic in `src/clean/dirt.ts`)
Each tooth has a grid in tooth-local cylindrical space: `u` around the tooth (0.5 = facing out toward the lips/cheek, 0 and 1 = the back, tongue side), `v` from gumline (0) to biting edge (1). Grid `DIRT_GU x DIRT_GV = 32 x 24`. Layers per cell (0..1): `plaque`, `stain`, `polish`. Only cells with `u` in [0.18, 0.82] or `v >= 0.86` (the biting surface of premolars and molars) can hold dirt: the reachable region.

Spawn (seeded, from `CleanSetup.dirt`):
- Plaque: soft yellow film, concentrated near the gumline (`v < 0.35`) and the sides (`u` near 0.22 and 0.78). Total coverage fraction ~ `dirt.plaque * 0.45`.
- Stain: brown blotches on the outward face (`u` in 0.35..0.65) and molar biting surfaces. Coverage ~ `dirt.stain * 0.35`. Coffee and smokers get front-tooth bands.
- Tartar: `dirt.tartarCount` discrete deposits `{tooth, u, v, size, hp}` at the gumline (`v` 0.03..0.25), weighted toward lower front incisors and upper molars. `hp = size * TARTAR_HP (1.0)`.
- Debris: `dirt.debrisCount` food bits lodged in gaps between neighbouring teeth `{gap, kind, hp}`. kinds: popcorn, spinach, seed, candy.
- Loose bits: created when tartar pops (1 to 3 each); they drop onto the tongue/lower arch and count as mess until rinsed and suctioned.
- Water level 0..1: rises from ultrasonic, air polisher, water flosser and rinse; drained by suction. Above 0.6 the lower teeth are harder to see and comfort drains.

### 5.3 Tools
Pointer ray hits a tooth mesh: the hit gives `(tooth, u, v)` via the mesh UV (cylindrical UVs computed at load time from vertex positions). Tools act inside an elliptical brush in (u, v).
- **Scaler** (hand tiers): damage is proportional to **stroke distance** (you must scrape, not hold). Tartar: `hp -= tartarPower * strokeLen * 6`. Plaque: `-= plaquePower * strokeLen * 3` per cell. Each hit spawns flakes, a crunch sound with pitch jitter and a small hitch. At `hp <= 0` the chunk pops: flies off with spin and gravity, crack sound, sparkle, loose bits, combo +1.
- **Ultrasonic** (scaler tiers 4 and 5): time based while touching; buzz loop; vibrates the deposit; water rises.
- **Polisher**: time based, slow spin even when still, faster when moving. Removes plaque and stain; raises `polish` only on cells whose plaque and stain are below 0.15. Polished cells sparkle.
- **Floss**: drag across a gap (a swipe that crosses the gap midpoint on screen) removes one debris hp per swipe times floss power. Also removes interproximal plaque. Popped debris flies out.
- **Suction**: hold anywhere in the mouth: drains water, collects loose bits within its radius (slurp).
- **Rinse**: hold to spray: water rises, loose bits in the spray get washed into the water (they then vanish when suctioned).
- **Reassure** button (12 s cooldown): `comfort += 12 * reassureMult`.

Gum contact: when the active tool is scaler/ultrasonic and the ray hits gum tissue (or a tooth cell with `v < 0.02`) for 0.15 s, comfort drops `8 * gumRisk * gumSensitivity * (1 - gumSkill)` per second of contact, gums flash red, the patient winces, "Ow" bubble.

### 5.4 Comfort, gag, fidget, chat
- Comfort 0..100, starts at `traits.comfortStart`. Passive drain `0.35 * comfortDrain * (1 - headphones 0.25) * (1 - smallTalk 0.2)` per second. Water level > 0.6: `-3/s`.
- Gag (gagger trait): continuous work on a molar for more than `2.5 s (+2 with Gag Guru)`: gag event, jaws close for 1.2 s (tools disabled, camera shake), comfort -15.
- Fidget (kids): the mouth drifts slightly (small sine sway), amplitude `traits.fidget`.
- Chatty: every 18 to 30 s the patient "has a question": jaws close for 2 s, speech bubble with a line, comfort +3.
- Comfort 0: the patient walks out. Result `quit = 'walkout'`, quality capped at 0.25.
- Portrait in the HUD shows happy (comfort > 60), neutral (30..60) or pain (< 30 or just hurt).

### 5.5 Scoring (`scoreClean` in `src/clean/dirt.ts`)
Fractions removed (0..1): `tartar` (hp removed / total hp), `plaque`, `stain`, `debris`, `polish` (mean polish over the reachable region of present teeth), `mess` (loose bits left / bits created, blended with final water level).
```
clean   = 0.35*tartar + 0.25*plaque + 0.20*stain + 0.10*debris + 0.10*polish - 0.10*mess
quality = clamp(0.82*clean + 0.18*(comfort/100), 0, 1)       (walkout: min(quality, 0.25))
stars   = quality >= 0.92 ? 5 : >= 0.80 ? 4 : >= 0.65 ? 3 : >= 0.45 ? 2 : 1
par     = (25 + 3.2*tartarCount*tartarSize + 30*plaque + 25*stain + 4*debrisCount) * parMult
```
The player presses **Done** whenever they like. A tooth that reaches zero dirt gets a sparkle and a ding; a perfect clean (clean >= 0.97) triggers the "Sparkling Smile" finale.

### 5.6 Juice checklist
Crunch with pitch jitter, chunk pop with spin and gravity, flake particles, combo counter ("Tartar x5"), tooth-clean ding and sparkle, polish shimmer, water ripple, slurp, portrait reactions, speech bubbles, screen hitch on big chunks (off with reduced motion), `navigator.vibrate(8)` where supported, final star count-up with coins flying to the cash counter.

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

Add-on acceptance: `base * priceMult^-2 * (1 + upseller 0.15) * (intraoral camera ? 1.1 : 1)`. Bases: fluoride 0.45, sealant 0.6 (kids only), xray 0.35, exam 0.7, whitening = archetype interest (default 0.08, influencer 0.5, coffee 0.25, smoker 0.2). The front desk stops selling exams while 3 exams per dentist are already pending.

In the hands-on clean the scene is the cleaning only; add-ons are applied by the sim after the clean (they add minutes to the chair and revenue).

## 8. Clinic simulation (`src/sim/clinic.ts`)

Pure, deterministic, tick-based in game minutes. `tick(state, minutes)` advances all locations (and the employer clinic in the employee phase) and returns `SimEvent[]`.

### 8.1 Patient flow
`scheduled -> entering (WALK_MIN) -> checkin -> waiting -> toChair (WALK_MIN) -> inChair -> toDesk (WALK_MIN) -> checkout (CHECKOUT_MIN) -> exiting (WALK_MIN) -> gone`
Side exits: `noshow` (never appears), `walkout` (waiting too long, or comfort walkout: walks from seat or chair to the door, WALK_MIN, then gone).
- `WALK_MIN = 1.5`, `CHECKOUT_MIN = 2`. Check-in: 3 min with a receptionist (`* (1.2 - 0.4 * skill/100)`), 7 min without (the front desk is you or nobody). Only one check-in at a time per receptionist (or one total without).
- Waiting: patience in minutes from archetype `* (espresso 1.25)`. The patience clock starts at the appointment time (early arrivals wait for free). If `waited > patience` the patient walks out (1-star review, rating hit).
- Assignment: first waiting patient (appointment order) to the first free, staffed operatory that can serve the service. Player's chair in hands-on mode: the patient sits and waits for the player (`awaitingPlayer`), still using patience (x1.5 while seated).
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
rating = (prior*3 + sum(stars*weight)) / (3 + sum(weight))   over the last 40 reviews, prior 3.5 (3.6 with a Fish Tank)
```
An average NPC clean (skill 50, basic chair) lands at 3 stars, a good hygienist in a comfort chair at 4, a strong hands-on clean at 5.
```
```

### 8.4 Demand and booking (start of each day)
```
awareness      = 0.5 + 0.5*(1 - exp(-served/150))
ratingFactor   = 0.6 + 0.16*rating
priceFactor    = cleaningMult^-2.2
marketing      = [1, 1.2, 1.45, 1.75][level], cost/day [0, 60, 180, 420] * tierScale
weekday        = [1.1, 1.0, 1.0, 1.0, 1.15]   (Mon..Fri, weekends skipped)
lambda         = baseDemand(tier) * awareness * ratingFactor * priceFactor * marketing * (1 + marketer 0.12) * (online booking 1.1) * weekday
demand         = poisson(lambda)
capacity       = sum over serving operatories of floor(510 / expectedDuration)
                 expectedDuration = (45 + expected add-on minutes) * speed factors * 1.12 (mean difficulty) + 9 min turnover
booked         = min(demand, capacity + 1); turnedAway = demand - booked
noShow         = 0.12 * (receptionist ? 0.6 : 1) * (online booking ? 0.5 : 1)
walkIns        = poisson(0.12 * lambda), arrive at random open times, only if a seat is free
```
Appointments are spread across 8:00..16:00 by operatory lanes. `turnedAway` shows in the day report as the clearest hint to hire.

### 8.5 Staff (`src/data/staff.ts`)
Roles: `hygienist`, `receptionist`, `assistant`, `dentist`, `manager`.
- Candidates: 6 per day (mix of roles weighted to what the office lacks), stats 15..95 (normal around 50, better with office tier), traits 0 to 2.
- Salary ask per day: hygienist `200 + 4*avg(skill,speed,bedside)`, receptionist `120 + 1.5*skill`, assistant `110 + 1.4*skill`, dentist `800 + 6*skill`, manager `350 + 3*skill` (rounded to $5). Negotiator -10%. Hiring fee = 1 day of salary.
- Traits: Perfectionist (+0.05 quality, -10% speed), Speedy (+15% speed, -0.03 quality), Charmer (+0.1 comfort), Clumsy (5% chance of a bad clean: quality -0.3), Night Owl (morale +, slow first hour), Loyal (never quits), Ambitious (levels 2x, asks raises 2x).
- Morale 0..100, daily: `+2 - 3*max(0, patientsToday - overwork) + (break room 3) + (leader 1) + (manager 2) - round(30*(1 - salary/ask)) when underpaid - (cash < 0 ? 2 : 0)`. Overwork threshold: hygienist 7, assistant 9, dentist 18, receptionist 40. Morale < 25: 20% daily quit chance (Loyal never). Morale affects quality (above) and speed (`+-10%`). Salaries can be set from 75% to 200% of the ask; at the floor staff lose about 6 morale a day and quit within two weeks, so underpaying loses money unless morale boosters (break room, manager, Leader) cover it.
- Staff XP: +1 per patient; level up every `25*level` patients: skill +3, speed +2, bedside +2, ask +8% (raise request event if paid below ask).
- Training course: $1,500, the staff member is off for the next day, skill +8.
- Firing: pay 1 day severance.

### 8.6 Offices (`src/data/offices.ts`)
| tier | Name | op slots | seats | rent/day | price | baseDemand | appeal |
|---|---|---|---|---|---|---|---|
| t1 | Strip Mall Suite | 2 | 4 | $180 | $5,000 | 15 | 1.0 |
| t2 | Main Street Office | 4 | 8 | $700 | $28,000 | 28 | 1.25 |
| t3 | Medical Plaza | 6 | 12 | $1,800 | $120,000 | 36 | 1.5 |
| t4 | Smile Tower | 8 | 16 | $3,600 | $400,000 | 50 | 1.8 |

- The first operatory is included in the price. More operatories: $4,000 each.
- Moving up: pay the new tier price minus 50% of the current tier price (trade-in); operatories, chairs and equipment move with you (up to the new slot count).
- New location: requires owning at least one T2+ location; pay the tier price in full plus a franchise license of `$78,000 * 2.25^(locations owned - 1)` ($78k, $176k, $395k, $888k). Max 5 locations. A location without a manager runs at -15% demand (nobody minding the store) when it is not the active one.
- Bank loan: up to 60% of the next purchase; 0.25% interest per day on principal; auto payment 1% of principal per day; repay any time. Outside a purchase the bank lends up to 60% of the next move (or of the next location) minus what you already owe.

### 8.7 Upgrades (`src/data/upgrades.ts`)
Operatory: Comfort Chair $2,500, Deluxe Massage Chair $9,000, Ceiling TV $1,200, Whitening Lamp $6,000, Intraoral Camera $3,000.
Office: Deep Cleaning Certification $2,000, X-Ray Suite $8,000, Sterilizer Pro $3,500, Ultrasonic Kits $5,000, Espresso Machine $1,500, Fish Tank $2,500 (rating prior +0.1), Kids Corner $2,000, Online Booking $4,000, Break Room $3,000 (t2+).

### 8.8 Day close
```
revenue  = fees + add-ons + dentist work (+ tips when you cleaned hands-on)
costs    = salaries + rent + supplies*(1 - leanOps 0.2) + marketing + loan interest + loan payment
net      = revenue - costs
```
Day report: patients served, turned away, walkouts, reviews, rating delta, revenue and cost lines, top staff, goals completed. Weekends are skipped (Fri -> Mon); rent and salaries are charged for 5 working days only.

### 8.9 Offline progress
On load, if `phase == 'owner'`, at least one hired hygienist and `now - lastSeen > 10 min`:
`credit = max(0, avgNet(last 3 days)) * min(hoursAway * 0.5, 6) * 0.6`. Shown in a "While you were away" card. No days advance.

### 8.10 Goals and achievements
Three daily goals from templates (remove N tartar chunks, N five-star reviews, serve N patients, clean in under N s, sell N add-ons, finish a perfect clean, hit an N-chunk combo). Each pays `max($100, 0.17 * avg net of the last 3 days)` as an owner (`$30 + $8 * level` as an employee) plus `15 + 5 * level` XP, so the three together are about half a day of net. Finished goals are claimed automatically at the day close if the player has not claimed them. About 24 achievements (first chunk, 100 chunks, first hire, T2, 5 locations, perfect clean, 10-combo, and so on).

### 8.11 Valuation
`sum(tierPrice*0.6 + equipmentValue*0.5) + max(0, avgNet7)*150 + cash - loan`. avgNet7 is the operating net (purchases, loans and hiring fees excluded) of the last 7 owner days.

## 9. Look and feel
- Light-first bright cartoon. Palette: mint `#3DD6B5`, teal `#0E8F8A`, bubblegum `#FF7AA8`, sunshine `#FFD166`, enamel white `#FFFDF7`, ink `#16323A`. Tartar is mustard `#D8B04A` with darker crust, plaque buttery `#F2DE8A`, stain coffee `#8A5A2B`.
- Fonts: Baloo 2 (display), Nunito (UI).
- 3D: low-poly, soft shading, gentle ambient + key light, no harsh blacks.
- Everything works by touch: no hover-only controls, 44 px targets, drag to scrape, two-finger drag or drag on empty space to orbit.
