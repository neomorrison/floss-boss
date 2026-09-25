// Smile City (DESIGN 11.1, 11.2): the stylised map of the six districts (grey to colour by Smile Index,
// your locations as pins, the Smile Van), the city percentage, the next milestone and what it unlocks,
// the district cards and the milestone track. Employee phase: a read-only preview (Downtown rises from
// your cleans at Bright Smiles). Also the district picker used when opening a practice or a location.
import { EMPLOYER_NAME } from '../core/constants';
import { store } from '../core/store';
import type { DistrictId, GameState } from '../core/types';
import { CITY_MILESTONES, DISTRICTS, DISTRICT_ORDER } from '../data/city';
import { escapeHtml, h, svgEl } from './dom';
import { sfx } from './fx';
import { cityStatus, type CityView, type DistrictView } from './endgame';
import { districtFill, milestoneLabel, milestoneView, smileCurve } from './endlogic';
import { icon, iconSvg } from './icons';
import type { PanelCtx, PanelInst } from './panelhost';
import { bar, btn, chip, sectionTitle } from './widgets';

// ---------------------------------------------------------------- map geometry (viewBox 640 x 420)

interface Shape { d: string; label: [number, number]; deco: string }

// Board-game style regions with rounded corners (white roads between them come from the stroke).
const SHAPES: Record<DistrictId, Shape> = {
  university: {
    d: 'M34 44 C90 30 180 26 262 34 L276 150 C230 160 190 166 150 168 L34 160 Z',
    label: [150, 98],
    deco: dome(214, 132) + tree(62, 136) + tree(80, 142) + tower(236, 70, 16, 34),
  },
  maple: {
    d: 'M284 34 C380 26 500 28 606 42 L606 168 C540 166 480 162 432 160 L292 150 Z',
    label: [446, 96],
    deco: house(326, 124) + house(352, 132) + tree(540, 128) + tree(560, 136) + tree(582, 126) + house(508, 64),
  },
  oldtown: {
    d: 'M34 172 L150 180 C190 178 214 174 236 170 L254 282 C210 296 170 302 128 302 L34 272 Z',
    label: [140, 236],
    deco: house(70, 276) + house(94, 282) + house(196, 272) + clock(222, 200),
  },
  downtown: {
    d: 'M248 164 L432 170 L444 292 C400 306 370 312 344 312 C310 306 284 298 266 290 Z',
    label: [346, 236],
    deco: tower(270, 186, 18, 50) + tower(292, 176, 16, 60) + tower(402, 184, 18, 54) + tower(422, 196, 12, 40),
  },
  uptown: {
    d: 'M446 172 L606 180 L606 334 L472 334 C462 318 458 304 456 292 Z',
    label: [528, 252],
    deco: tower(566, 196, 16, 70) + tower(586, 212, 12, 54) + tower(478, 300, 14, 26),
  },
  harbor: {
    d: 'M34 286 L128 316 C170 318 216 314 262 304 C296 316 322 324 346 326 C390 324 430 340 466 346 L476 372 C340 378 190 380 34 376 Z',
    label: [252, 350],
    deco: boat(92, 398) + boat(410, 404) + crane(440, 330),
  },
};

function tower(x: number, y: number, w: number, hgt: number): string {
  let win = '';
  for (let yy = y + 6; yy < y + hgt - 6; yy += 9) win += `<path d="M${x + 4} ${yy}h${w - 8}"/>`;
  return `<g class="cm-deco"><rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="3"/><g class="cm-win">${win}</g></g>`;
}
function house(x: number, y: number): string {
  return `<g class="cm-deco"><path d="M${x - 9} ${y}v-11l9-8 9 8v11z"/></g>`;
}
function tree(x: number, y: number): string {
  return `<g class="cm-deco"><circle cx="${x}" cy="${y - 10}" r="8"/><path d="M${x} ${y - 4}v6" class="cm-trunk"/></g>`;
}
function dome(x: number, y: number): string {
  return `<g class="cm-deco"><path d="M${x - 16} ${y}v-12h32v12z"/><path d="M${x - 12} ${y - 12}a12 12 0 0 1 24 0z"/></g>`;
}
function clock(x: number, y: number): string {
  return `<g class="cm-deco"><rect x="${x - 7}" y="${y}" width="14" height="36" rx="2"/><circle cx="${x}" cy="${y + 8}" r="4.5" class="cm-face"/></g>`;
}
function boat(x: number, y: number): string {
  return `<g class="cm-boat"><path d="M${x - 16} ${y}h32l-6 7h-20z"/><path d="M${x} ${y}v-16l10 12z" class="cm-sail"/></g>`;
}
function crane(x: number, y: number): string {
  return `<g class="cm-deco"><path d="M${x} ${y}v-36h22M${x} ${y - 30}l18 -6" class="cm-crane"/></g>`;
}

/** The little face on a district: frown at 0, a big grin near 100%. */
function faceMarkup(x: number, y: number, index: number, r = 11): string {
  const c = smileCurve(index);
  const my = y + r * 0.34;
  const w = r * 0.55;
  const bend = c * r * 0.42;
  return `<g class="cm-smile"><circle cx="${x}" cy="${y}" r="${r}"/><circle cx="${x - r * 0.36}" cy="${y - r * 0.2}" r="${r * 0.12}" class="cm-eye"/><circle cx="${x + r * 0.36}" cy="${y - r * 0.2}" r="${r * 0.12}" class="cm-eye"/><path d="M${x - w} ${my - bend / 2}q${w} ${bend * 1.4} ${w * 2} 0" class="cm-mouth"/></g>`;
}

function pinMarkup(x: number, y: number, cls: string, title: string): string {
  return `<g class="cm-pin ${cls}" transform="translate(${x} ${y})"><title>${escapeHtml(title)}</title><path d="M0 0c-7-9-12-14-12-21a12 12 0 0 1 24 0c0 7-5 12-12 21z"/><circle cx="0" cy="-21" r="5" class="cm-pin-dot"/></g>`;
}

export interface MapOpts {
  selected?: DistrictId | null;
  onPick?: (id: DistrictId) => void;
  preview?: boolean;         // employee phase: only Downtown is yours to move
  locationNames?: Partial<Record<DistrictId, string[]>>;
}

/** The stylised city map. */
export function cityMap(v: CityView, o: MapOpts = {}): HTMLElement {
  const parts: string[] = [];
  parts.push(`<defs><pattern id="cm-waves" width="36" height="14" patternUnits="userSpaceOnUse"><path d="M0 8q9-6 18 0t18 0" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2"/></pattern></defs>`);
  // land and sea
  parts.push(`<rect x="0" y="0" width="640" height="420" rx="28" class="cm-land"/>`);
  parts.push(`<path d="M0 372 C120 386 260 390 380 384 C460 380 540 368 640 360 L640 420 L0 420 Z" class="cm-sea"/><path d="M0 372 C120 386 260 390 380 384 C460 380 540 368 640 360 L640 420 L0 420 Z" fill="url(#cm-waves)"/>`);
  for (const d of v.districts) {
    const sh = SHAPES[d.id];
    const dim = o.preview && d.id !== 'downtown';
    const sel = o.selected === d.id;
    parts.push(`<g class="cm-district${sel ? ' is-selected' : ''}${dim ? ' is-dim' : ''}" data-id="${d.id}" style="--dc:${d.color}">`
      + `<path d="${sh.d}" class="cm-shape" fill="${districtFill(d.color, d.index)}"/>${sh.deco}</g>`);
  }
  // labels on top of every region
  for (const d of v.districts) {
    const [x, y] = SHAPES[d.id].label;
    const w = Math.max(92, d.name.length * 8.6 + 34);
    parts.push(`<g class="cm-label" data-id="${d.id}">`
      + faceMarkup(x - w / 2 + 2, y - 8, d.index, 12)
      + `<text x="${x - w / 2 + 20}" y="${y - 3}" class="cm-name">${d.name}</text>`
      + `<rect x="${x - w / 2 + 20}" y="${y + 4}" width="46" height="19" rx="9.5" class="cm-pill"/><text x="${x - w / 2 + 43}" y="${y + 18}" class="cm-pct">${d.pct}%</text>`
      + `</g>`);
  }
  // pins: your locations (and Bright Smiles in the employee phase), the Smile Van
  for (const d of v.districts) {
    const [x, y] = SHAPES[d.id].label;
    const names = o.locationNames?.[d.id] ?? [];
    const n = d.employer ? 1 : d.locations;
    for (let i = 0; i < n; i++) {
      const px = x + 46 + i * 18;
      const py = y - 18 - (i % 2) * 4;
      parts.push(pinMarkup(px, py, d.employer ? 'is-employer' : '', d.employer ? EMPLOYER_NAME : names[i] ?? 'Your location'));
    }
    if (v.vanDistrict === d.id) {
      parts.push(`<g class="cm-van" transform="translate(${x - 60} ${y + 22})"><title>Smile Van</title><rect x="-16" y="-12" width="32" height="18" rx="5"/><rect x="6" y="-9" width="7" height="7" rx="1.5" class="cm-van-win"/><circle cx="-8" cy="7" r="4" class="cm-wheel"/><circle cx="8" cy="7" r="4" class="cm-wheel"/><path d="M-9 -4q5 5 10 0" class="cm-van-smile"/></g>`);
    }
  }
  const svg = svgEl(`<svg class="city-map-svg" viewBox="0 0 640 420" role="img" aria-label="Map of Smile City">${parts.join('')}</svg>`);
  if (o.onPick) {
    svg.querySelectorAll<SVGGElement>('[data-id]').forEach((g) => {
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => {
        const id = g.getAttribute('data-id') as DistrictId;
        if (id) o.onPick!(id);
      });
    });
  }
  return h('div.city-map', svg);
}

// ---------------------------------------------------------------- gauge and milestone track

function gauge(pct: number, size = 132): HTMLElement {
  const r = 52;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, pct / 100));
  const svg = svgEl(`<svg viewBox="0 0 132 132" class="city-gauge-svg" aria-hidden="true"><circle cx="66" cy="66" r="${r}" class="cg-track"/><circle cx="66" cy="66" r="${r}" class="cg-fill" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 66 66)"/></svg>`);
  return h('div.city-gauge', { class: { 'is-full': pct >= 100 }, style: { '--gz': size + 'px' } }, svg, h('div.city-gauge-num', h('b.num', `${pct}%`), h('span', 'smiling')));
}

function milestoneTrack(v: CityView): HTMLElement {
  const nextPct = v.next?.milestone.pct ?? null;
  return h('div.ms-track',
    ...CITY_MILESTONES.map((m) => {
      const got = v.reached.includes(m.pct);
      const next = m.pct === nextPct;
      const mv = milestoneView(m.pct)!;
      return h('div.ms-stop', { class: { 'is-got': got, 'is-next': next, 'is-big': [50, 70, 90, 100].includes(m.pct) }, title: mv.unlock ? `${m.title}. ${mv.unlock}` : m.title },
        h('span.ms-dot', icon(got ? 'check' : m.pct === 100 ? 'trophy' : [50, 70, 90].includes(m.pct) ? 'star' : 'dot')),
        h('span.ms-pct.num', `${m.pct}%`),
        h('span.ms-name', m.pct === 100 ? 'Gala' : m.pct === 50 ? 'Smile Van' : m.pct === 70 ? 'Nominated' : m.pct === 90 ? 'Gala planned' : 'Grant'),
      );
    }),
  );
}

function districtCard(d: DistrictView, v: CityView, preview: boolean): HTMLElement {
  const van = v.vanDistrict === d.id;
  return h('div.district-card', { class: { 'is-dim': preview && d.id !== 'downtown' }, style: { '--dc': d.color, '--df': districtFill(d.color, d.index) } },
    h('div.district-card-head',
      h('span.district-face', { html: `<svg viewBox="0 0 30 30" aria-hidden="true">${faceMarkup(15, 15, d.index, 13)}</svg>` }),
      h('div.grow', h('div.district-name', d.name), h('div.district-blurb', d.blurb)),
      h('b.district-pct.num', `${d.pct}%`),
    ),
    bar(d.index, 'district', 'sm'),
    h('div.row.row-wrap.gap-6.district-chips',
      d.employer ? chip(EMPLOYER_NAME, 'teal', 'pin') : null,
      d.locations ? chip(d.locations === 1 ? 'Your location' : `${d.locations} of your locations`, 'teal', 'pin') : null,
      van ? chip('Smile Van', 'gum', 'bus') : null,
      h('span.small.faint', d.served === 1 ? '1 patient' : `${d.served.toLocaleString('en-US')} patients`),
    ),
  );
}

// ---------------------------------------------------------------- the panel

export function cityPanel(ctx: PanelCtx): PanelInst {
  let selected: DistrictId | null = null;
  return {
    title: 'Smile City',
    icon: 'city',
    key: () => {
      const s = store.state;
      const v = cityStatus(s);
      return JSON.stringify([selected, s.phase, v.pct, v.districts.map((d) => [d.pct, d.locations, d.served]), v.reached, v.vanDistrict, v.galaUnlocked, v.won]);
    },
    render() {
      const s = store.state;
      const v = cityStatus(s);
      const preview = s.phase !== 'owner';
      const names: Partial<Record<DistrictId, string[]>> = {};
      if (!preview) for (const c of s.locations) (names[c.district ?? 'downtown'] ??= []).push(c.name);
      const nx = v.next;
      const hero = h('div.city-hero',
        gauge(v.pct),
        h('div.city-hero-text',
          h('div.eyebrow', preview ? 'Preview' : v.won ? 'Golden Molar winner' : 'Smile Index'),
          h('h3', v.pct >= 100 ? 'Smile City smiles' : `Smile City is ${v.pct}% smiling`),
          preview
            ? h('div.small.muted', `Downtown rises with every clean you do at ${EMPLOYER_NAME}. Open your own practice to reach the rest of the city.`)
            : h('div.small.muted', 'Every patient your team serves moves their district. A clean below 50% quality moves it back.'),
          nx ? h('div.city-next',
            h('div.row.row-between.gap-6', h('span.bold', `Next: ${milestoneLabel(nx.milestone)}`), h('span.num.small.bold', `${v.pct}% of ${nx.milestone.pct}%`)),
            bar(nx.frac, 'sun', 'sm'),
            h('div.city-next-unlock.small', icon('gift'), h('span', nx.milestone.unlock ? `City grant. ${nx.milestone.unlock}` : 'City grant')),
          ) : h('div.city-next.is-done', icon('trophy'), h('span.bold', 'Every milestone reached')),
        ),
      );
      const map = cityMap(v, {
        selected, preview, locationNames: names,
        onPick: (id) => { sfx('ui_tab'); selected = selected === id ? null : id; ctx.rerender(); },
      });
      const legend = h('div.city-legend',
        h('span.legend-item', h('i.legend-pin'), preview ? EMPLOYER_NAME : 'Your locations'),
        v.vanDistrict ? h('span.legend-item', h('i.legend-van'), 'Smile Van') : null,
        h('span.legend-item', h('i.legend-ramp'), 'Grey to full colour as a district smiles'),
      );
      const order = selected ? [selected, ...DISTRICT_ORDER.filter((x) => x !== selected)] : DISTRICT_ORDER;
      const cards = order.map((id) => districtCard(v.districts.find((d) => d.id === id)!, v, preview));
      const gala = !preview && v.galaUnlocked && !v.won ? galaEntry() : null;
      const trophy = v.won ? h('div.city-trophy', icon('trophy'), h('div.grow', h('div.bold', 'Golden Molar'), h('div.small.muted', 'Won at the Golden Molar Gala. It stays on the wall of every office.'))) : null;
      return h('div.city-panel',
        gala,
        trophy,
        h('div.city-top',
          h('div.city-map-card', map, legend),
          h('div.city-side',
            hero,
            h('div.city-ms-card', sectionTitle('Milestones', 'flag', h('span.small.muted', 'Each pays a city grant')), milestoneTrack(v)),
          ),
        ),
        sectionTitle('Districts', 'pin', preview ? chip('Preview', 'sky', 'eye') : null),
        h('div.grid.grid-auto-lg.district-grid', ...cards),
      );
    },
  };
}

/** Hooked by the ceremony module: "Take the stage" from the city screen and the hub card. */
let galaStarter: (() => void) | null = null;
export function setGalaStarter(fn: (() => void) | null): void {
  galaStarter = fn;
}

function galaEntry(): HTMLElement {
  return h('div.city-gala',
    h('div.city-gala-rays'),
    h('div.city-gala-icon', icon('trophy')),
    h('div.grow', h('div.eyebrow', 'Tonight'), h('div.bold.city-gala-title', 'The Golden Molar Gala'), h('div.small', 'A showcase clean on stage. 4 stars or more wins the Golden Molar.')),
    btn('Take the stage', { variant: 'sun', icon: 'mic', onClick: () => galaStarter?.() }),
  );
}

// ---------------------------------------------------------------- district picker (open practice, open location)

export interface PickerOpts {
  selected: DistrictId;
  onPick(id: DistrictId): void;
  compact?: boolean;
}

/** Six district cards with the current index, blurb and colour, and which already hold your locations. */
export function districtPicker(s: GameState, o: PickerOpts): HTMLElement {
  const v = cityStatus(s);
  let current = o.selected;
  const wrap = h('div.district-picker', { class: { 'is-compact': !!o.compact }, role: 'radiogroup', 'aria-label': 'District' });
  const note = h('div.district-note.small');
  const btns = new Map<DistrictId, HTMLElement>();
  const paintNote = () => {
    const d = v.districts.find((x) => x.id === current)!;
    note.replaceChildren(icon(d.locations ? 'info' : 'pin'), h('span', d.locations
      ? `${d.name} already has ${d.locations === 1 ? 'one of your locations' : `${d.locations} of your locations`}. Another one here adds half as much to its smile.`
      : `${d.name}: ${DISTRICTS[d.id].blurb} Most patients come from here, the rest from next door.`));
  };
  for (const d of v.districts) {
    const b = h('button.district-opt', { type: 'button', role: 'radio', 'aria-checked': String(d.id === current), class: { 'is-on': d.id === current }, style: { '--dc': d.color, '--df': districtFill(d.color, d.index) } },
      h('span.district-opt-swatch', { html: `<svg viewBox="0 0 30 30" aria-hidden="true">${faceMarkup(15, 15, d.index, 13)}</svg>` }),
      h('span.district-opt-body',
        h('span.district-opt-name', d.name),
        h('span.district-opt-meta', h('b.num', `${d.pct}%`), d.locations ? h('span.district-opt-have', { html: iconSvg('pin') }, String(d.locations)) : null),
        bar(d.index, 'district', 'sm'),
      ),
      h('span.district-opt-check', icon('check')),
    );
    b.addEventListener('click', () => {
      if (current === d.id) return;
      sfx('ui_tab');
      current = d.id;
      btns.forEach((x, id) => { x.classList.toggle('is-on', id === d.id); x.setAttribute('aria-checked', String(id === d.id)); });
      paintNote();
      o.onPick(d.id);
    });
    btns.set(d.id, b);
    wrap.appendChild(b);
  }
  paintNote();
  return h('div.district-field', wrap, note);
}
