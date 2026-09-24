# Floss Boss: Architecture

Vite + TypeScript (strict) + three.js. Static site deployed to GitHub Pages from `dist/` by `.github/workflows/pages.yml` (runs `npm test` and `npm run build`). No backend. Saves go to cookies with a localStorage mirror (`src/core/save.ts`).

## Commands

| Command | What |
|---|---|
| `npm run dev` | dev server on :5181 (index.html plus harness pages under /harness/) |
| `npm run typecheck` | `tsc --noEmit`, must pass before any hand-off |
| `npm test` | vitest (`tests/**/*.test.ts`) |
| `npm run build` | typecheck + production build to `dist/` |
| `npm run balance` | headless economy simulation with bot strategies (`tools/balance.ts`) |
| `node tools/snap.mjs --path "/harness/clean.html" --wait 4000 --shot out/clean.png` | headless Chrome screenshot (WebGL and rAF work). Read the PNG to see it. See the header of tools/snap.mjs for step files (`--steps tools/steps/x.json`), `--mobile` (390x844 touch) and `--size WxH`. |
| `"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup --python art/blender/<set>/build.py` | headless Blender model build |

The in-app Browser pane does not composite frames (no rAF, no screenshots). Use `tools/snap.mjs` for visual checks.

## Module ownership

Each module has one owner during the parallel build. Never edit a file you do not own; if a contract must change, adapt locally and report the change you need. Do not run git commands (the orchestrator commits).

| Path | Owner | Contents |
|---|---|---|
| `src/core/*` | orchestrator | shared types, constants, mouth geometry, RNG, save, store, bus, format, renderer, asset loader |
| `src/data/*` | orchestrator (sim may retune numbers and text, never ids, keys or types) | catalogs |
| `src/sim/*`, `tools/balance.ts`, `tests/sim*.test.ts` | sim builder | all game rules, pure TS |
| `src/clean/*`, `harness/clean.*`, `tests/clean*.test.ts` | clean builder | the hands-on 3D cleaning scene |
| `src/clinic/*`, `harness/clinic.*`, `tests/clinic*.test.ts` | clinic builder | the 3D office diorama and its layouts |
| `src/ui/*`, `src/main.ts`, `src/styles/*`, `index.html`, `tests/ui*.test.ts` | UI builder | app shell, game loop, every screen and modal, design system |
| `src/audio/*`, `public/audio/*`, `art/audio/*` | audio builder | Web Audio engine, SFX and music files |
| `art/blender/mouth/*`, mouth + tool models in `public/models/`, their thumbs | art-mouth builder | teeth, gums, tongue, mouth frame, tartar, debris, tools |
| `art/blender/clinic/*`, clinic + people models in `public/models/`, their thumbs | art-clinic builder | furniture, equipment, people |
| `public/img/*` except `thumbs/`, `art/2d/*` | art-2d builder | portraits, staff, avatars, boss, title art |

## Dependency rules

```
ui ──> sim (index.ts only), clean (index.ts), clinic (index.ts), audio (index.ts), core, data
clean ──> core, data, audio (index.ts)          (never sim, never store)
clinic ──> core, data, audio (index.ts)         (never sim; reads Clinic objects passed in)
sim ──> core (not renderer/assets), data
```
- `src/sim` is pure: no DOM, no `window`, no three.js, no `Math.random()` (use `core/rng` seeded from `state.rng`, write the state back). It must run in Node (tests, balance tool).
- `src/clean/dirt.ts` (the dirt model and scoring) is pure too, so it can be unit tested.
- Every module must survive missing art: a GLB that 404s becomes a procedural placeholder, a missing portrait becomes a CSS avatar with initials, a missing sound is silent or synthesized.
- One WebGL renderer: use `core/renderer.ts` (`getRenderer`, `attachRenderer`). The clinic view and the clean scene take turns owning the canvas.

## State flow

```
store.state (GameState) <── sim functions mutate it ── UI handlers
      │
      ├── game loop (ui): each frame, if the hub is visible and speed > 0 and !dayOver:
      │      minutes = dt / REAL_SEC_PER_GAME_MIN * speed; events = sim.tick(state, minutes)
      │      bus.emit('sim:events', events)   -> audio, toasts, clinicView.events(events)
      │      clinicView.frame(activeClinic, state.minute, dt)
      │      HUD numbers update directly (no full re-render per frame)
      └── store.commit() on user actions and meaningful events (not every frame) ─> 'state:changed'
             ─> screens re-render, debounced saveGame(); also save every ~10 s of play and on visibilitychange
```
Hands-on: UI calls `sim.beginHandsOn` -> `clean.startClean(container, setup)` -> await `done` -> `sim.completeHandsOn` -> result modal (payout + "while you were cleaning" events) -> back to the hub. The clinic clock is frozen during the clean (the loop does not tick).

## Screen map

```
Title (Continue, New game, Settings)
  └─ New game: name, avatar ──> School practical 1 (tutorial clean) ──> practical 2 ──> Graduation card
Hub = clinic view + HUD (cash, day and clock, speed, rating, level and XP, title, hint line)
  ├─ Your chair card: waiting patient -> Clean (hands-on) or Quick clean
  ├─ Tools (shop): tool tiers, extras, numbing gel
  ├─ Skills: three branches
  ├─ Staff (owner): team per location, hire board, assign, train, raise, fire
  ├─ Office (owner): operatories, chairs, op upgrades, equipment, move up, new location
  ├─ Finance (owner): prices, marketing, loan, day history chart, valuation
  ├─ Goals: daily goals, achievements
  └─ Settings: audio, quality, reduced motion, haptics, save export/import, reset
Modals: clean result, day report, level up, open practice, offline earnings, op panel, candidate card, confirm
Location tabs when more than one location.
```

## Debug hooks (for headless tests)

- `window.__fb` (main.ts, every build): `{ store, sim, debug: { newGame(), grant(cash), setLevel(n), skipSchool(), openPractice(), goto(screen), speed(n), fastForward(minutes), clean(patientId?) } }`.
- `window.__fbClean` while a clean is running: `{ summary(), cheat(fraction), finish(), setTool(slot) }`.
- `window.__fbClinic` while the clinic view is mounted: `{ camera, scene, pick(x, y) }`.

## Coordinate conventions

- **Mouth space** (clean scene, art-mouth): see `src/core/mouth.ts`. +Y up, camera at +Z looking -Z, 1 unit ~ 8 mm. Arch curve `x = 4.8 s`, `z = -1.8 + 4.4 (1 - s^2)` (lower arch scaled 0.95), upper gumline y = +2.0, lower y = -2.0.
- **Clinic space** (clinic view, art-clinic): meters, +Y up, model fronts face +Z, origins on the floor at the footprint center.
- Blender authoring is Z-up with the front facing -Y; the glTF exporter converts to +Y up / front +Z.

## Art contracts

### Mouth models (mouth units)
- `tooth_incisor|canine|premolar|molar`: one mesh each. Crown dimensions from `TOOTH_DIMS` (w along X, h along +Y, d along Z). Origin at the gumline center, crown toward +Y, a short root stub down to y = -0.35 (hidden in the gum), outward (labial) face toward +Z. Material `Enamel` (warm off-white). Rounded cartoon shapes: spade incisors, pointy canines, two-cusp premolars, four-cusp molars. 800 to 2,500 triangles, smooth shading, closed shell. UVs optional: the scene computes cylindrical UVs from vertex positions (`u = atan2(x, z)/2pi + 0.5`, `v = y / h`).
- `gum_upper`, `gum_lower`: built along the arch curve (mirror the `ARCH_*` constants in Python). Gumline plane at model y = 0 with a scalloped edge where teeth emerge; upper tissue extends +Y (with a palate roof), lower extends -Y (with a floor). Width about 1.6 across the curve, wrapping past the last molar. Material `Gum` (healthy pink). The scene places them at the gumline heights.
- `tongue`: authored in absolute mouth coordinates, resting inside the lower arch (top near y = -1.7, center z = -0.3). Material `Tongue`.
- `mouth_frame`: absolute mouth coordinates. Cartoon lips and cheeks framing an opening about x in [-5.4, 5.4], y in [-3.4, 3.4], lips around z = 3.2; a dark throat backdrop behind the arches around z = -3.5. Materials `Skin` (the scene tints it per patient), `Lips`, `Throat`.
- `tartar_a|b|c`: crusty lumps about 0.34 x 0.26 x 0.18, origin at the base center, +Y points out of the tooth surface. Material `Tartar` (mustard, darker crust).
- `debris_popcorn|spinach|seed|candy`: 0.15 to 0.4 across, origin at the center. Materials named after the item.
- Tools (`tool_*`, `extra_*`): tip at the origin, handle along +Y, about 9 units long, clearly different silhouettes per tier. Working-end detail near the tip. `extra_*` are shop thumbnails only.

### Clinic models (meters)
- Front faces +Z, origin on the floor at the footprint center. Low-poly, soft colors from the palette in DESIGN 9, closed shells.
- Chairs: headrest toward -Z, footrest toward +Z, seat height about 0.55, length about 1.9. Tintable material `Upholstery`.
- People (`char_*`): cartoon proportions (big head), adult about 1.6 m. Child nodes `Body`, `Head`, `LegL`, `LegR`, `ArmL`, `ArmR` with pivots at the hips, neck and shoulders, under one root at the floor. Tintable materials named exactly `Skin`, `Hair`, `Shirt`, `Pants`, `Shoes`, `Scrubs`, `Coat`.

### Thumbnails
`public/img/thumbs/<modelKey>.png`, 256 px, transparent background, 3/4 view. Needed for every tool and extra, the three chairs, the op upgrades and the equipment (`OP_UPGRADES[].model`, `EQUIPMENT[].model`).

### 2D
- Portraits: `public/img/portraits/<archetype>_<mood>.webp`, moods `happy`, `neutral`, `pain`, `wow`, 512 px square, flat pastel background.
- Staff: `public/img/staff/staff_<0..17>.webp`, 384 px square. Avatars: `public/img/avatars/avatar_<0..3>.webp`. Boss: `public/img/boss.webp`. Title art: `public/img/title_bg.webp` (1920x1080).
