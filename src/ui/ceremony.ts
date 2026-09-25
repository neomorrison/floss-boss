// End game ceremonies (DESIGN 11.2, 11.3): the promotion ceremony on every title change, the ribbon
// cutting after opening or moving an office, city milestone cards, the parade at 100%, the Golden Molar
// Gala (card, showcase clean, result), the credits, the Legacy page and the Retire / Keep running choice.
// `checkCeremonies` runs from the hub frame and queues whatever the save says was not celebrated yet.
import { EMPLOYER_BOSS } from '../core/constants';
import { deleteSave } from '../core/save';
import { money } from '../core/format';
import { store } from '../core/store';
import type { DistrictId, GameState, OfficeTierId } from '../core/types';
import { DISTRICTS } from '../data/city';
import { OFFICES } from '../data/offices';
import { currentScreen, go } from './app';
import { officeArt } from './art';
import { setGalaStarter } from './city';
import { h } from './dom';
import { cityStatus, completeGala, galaSetup, galaStatus, retire } from './endgame';
import { creditNames, grantsFor, milestoneLabel, milestoneView, promotionLine, TITLE_BLURB, TITLE_ORDER, titleRank, unseenMilestones } from './endlogic';
import { confetti, music, sfx } from './fx';
import { playerTitle } from './game';
import { hubBridge, isCleaning, runClean } from './handson';
import { icon, toothMarkSvg } from './icons';
import { legacyView } from './legacy';
import { fmtSeconds, noDash } from './logic';
import { bus } from '../core/bus';
import { logo } from './logo';
import { confirmModal, enqueue, modals, openModal } from './modal';
import { bossPortrait, patientPortrait } from './portrait';
import { reducedMotion } from './settings';
import { attempt } from './safe';
import { toast } from './toasts';
import { btn, chip } from './widgets';

const flags = (s: GameState): Record<string, boolean> => (s.flags ??= {});
/** Enter and Space answer the main button of a full-screen moment. */
const focusSoon = (b: HTMLElement) => setTimeout(() => { try { b.focus({ preventScroll: true }); } catch { /* ignore */ } }, 120);

// ---------------------------------------------------------------- watcher

let finaleRunning = false;
let galaBusy = false;
let galaOffered = -1;

/** Queue the ceremonies the save has earned but the player has not seen (hub frame, nothing open). */
export function checkCeremonies(): void {
  if (!store.loaded || isCleaning() || modals.count || finaleRunning || galaBusy) return;
  if (currentScreen()?.name !== 'hub') return;
  const s = store.state;
  if (s.phase === 'school') return;
  const f = flags(s);
  let dirty = false;
  // titles: the first look marks what the save already had; later promotions get the ceremony
  const title = playerTitle(s);
  const rank = titleRank(title);
  if (!f.ui_titles_init) {
    for (let r = 0; r <= rank; r++) f[`ui_title_${r}`] = true;
    f.ui_titles_init = true;
  } else if (rank >= 0 && !f[`ui_title_${rank}`]) {
    for (let r = 0; r <= rank; r++) f[`ui_title_${r}`] = true;
    dirty = true;
    enqueue(() => showPromotion(title));
  }
  // city milestones
  const reached = Array.isArray(s.finale?.milestones) ? s.finale.milestones : [];
  if (!f.ui_ms_init) {
    for (const p of reached) f[`ui_ms_${p}`] = true;
    f.ui_ms_init = true;
  } else {
    const fresh = unseenMilestones(reached, (x) => !!f[`ui_ms_${x}`]);
    const grants = grantsFor(fresh, s.ledger);
    for (const p of fresh) {
      f[`ui_ms_${p}`] = true;
      dirty = true;
      if (p >= 100) { galaOffered = s.day; enqueue(() => { void showMilestone(p, grants.get(p)).then(() => showParade()).then(() => showGalaCard()); }); }
      else enqueue(() => { void showMilestone(p, grants.get(p)); });
    }
  }
  // a win whose choice was never made (reload during the credits)
  if (s.finale?.won && !s.finale.retired && !f.ui_finale_choice) {
    f.ui_finale_choice = true;
    dirty = true;
    enqueue(() => showRetireChoice());
  }
  // the gala waits: offer the card once a day (the hub card and Smile City keep the way in open)
  if (s.phase === 'owner' && s.finale?.galaUnlocked && !s.finale.won && galaOffered !== s.day && !s.dayOver && galaStatus(s).ready) {
    galaOffered = s.day;
    enqueue(() => { void showGalaCard(); });
  }
  // a reload must not replay what was just celebrated
  if (dirty) store.saveNow();
}

/** Offer the gala card now (counts as today's offer). */
export function offerGalaCard(): void {
  if (store.loaded) galaOffered = store.state.day;
  enqueue(() => { void showGalaCard(); });
}

// ---------------------------------------------------------------- promotion

/** Full-screen promotion: the title badge, confetti, Dr. Ruth Canal, the promotion sound. */
export function showPromotion(title: string): Promise<void> {
  const rank = Math.max(0, titleRank(title));
  const owner = rank >= 3;
  const ladder = h('div.promo-ladder', ...TITLE_ORDER.map((t, i) => h('span.promo-step', { class: { 'is-got': i < rank, 'is-now': i === rank }, title: t })));
  const badge = h('div.promo-badge',
    h('div.promo-medal', h('div.promo-medal-inner', icon(rank >= 6 ? 'crown' : owner ? 'office' : 'tooth'))),
    h('div.promo-ribbon', h('span', 'Promoted')),
  );
  const next = btn('Continue', { variant: 'sun', size: 'lg', iconRight: 'arrowRight' });
  const m = openModal({
    body: h('div.ceremony.promo',
      h('div.ceremony-rays'),
      h('div.ceremony-inner',
        h('div.eyebrow.ceremony-eyebrow', 'Promotion'),
        badge,
        h('h1.ceremony-title', title),
        h('p.ceremony-sub', TITLE_BLURB[title] ?? ''),
        ladder,
        h('div.speaker.ceremony-speaker',
          bossPortrait(64, 'ring', 'happy'),
          h('div.grow', h('div.who', EMPLOYER_BOSS), h('div.bubble', promotionLine(title))),
        ),
        next,
      ),
    ),
    size: 'xl',
    cls: 'modal-ceremony',
    dismissable: false,
    closeButton: false,
  });
  next.addEventListener('click', () => { sfx('ui_click'); m.close(); });
  focusSoon(next);
  sfx('promotion');
  if (!reducedMotion()) {
    requestAnimationFrame(() => confetti(badge, 120));
    setTimeout(() => { if (m.open) confetti({ x: innerWidth * 0.2, y: innerHeight * 0.35 }, 50); }, 500);
    setTimeout(() => { if (m.open) confetti({ x: innerWidth * 0.8, y: innerHeight * 0.35 }, 50); }, 800);
  }
  return m.closed;
}

// ---------------------------------------------------------------- ribbon cutting

export interface RibbonOpts { kind: 'practice' | 'location' | 'move'; name: string; tier: OfficeTierId; district?: DistrictId | null }

/** The clinic view's own ribbon ceremony (camera sweep to the door, prop_ribbon snaps, balloons, a small
 * crowd) when the view is mounted. */
function viewCeremony(): (() => void) | null {
  const view = hubBridge()?.view?.() as unknown as { ceremony?: (kind: 'ribbon') => void } | null | undefined;
  if (!view || typeof view.ceremony !== 'function') return null;
  return () => view.ceremony!('ribbon');
}

/** Confetti near the trophy wall after a milestone (ClinicView.celebrate). */
function viewCelebrate(): void {
  const v = hubBridge()?.view?.() as unknown as { celebrate?: () => void } | null | undefined;
  if (v && typeof v.celebrate === 'function') attempt(() => v.celebrate!(), undefined, 'celebrate');
}

/** Ribbon cutting after opening a practice or a location or moving up: the diorama's ceremony when the
 * clinic view has one, with a title card over it; otherwise a UI overlay with the ribbon and scissors. */
export function ribbonCutting(o: RibbonOpts): Promise<void> {
  // the ceremony happens in the diorama: close any panel over it
  if (currentScreen()?.name === 'hub') go('clinic');
  return new Promise((resolve) => {
    enqueue(() => {
      const vc = viewCeremony();
      if (vc) attempt(() => vc(), undefined, 'view ceremony');
      const eyebrow = o.kind === 'move' ? 'Moving day' : 'Grand opening';
      const title = o.kind === 'move' ? `Welcome to your ${OFFICES[o.tier].name}` : `Now open: ${o.name}`;
      const district = o.district && DISTRICTS[o.district] ? DISTRICTS[o.district] : null;
      const ribbonL = h('div.ribbon-half.is-l');
      const ribbonR = h('div.ribbon-half.is-r');
      const scissors = h('div.ribbon-scissors', icon('scissors'));
      const done = btn('Continue', { variant: 'sun', size: 'lg', iconRight: 'arrowRight' });
      const card = h('div.ribbon-card',
        h('div.eyebrow', eyebrow),
        h('h2.ribbon-title', title),
        h('div.row.row-wrap.gap-6.ribbon-chips',
          chip(OFFICES[o.tier].name, 'teal', 'office'),
          district ? chip(district.name, '', 'pin') : null,
        ),
        done,
      );
      // with the diorama's own ribbon at the door, only the title card shows over it
      const stage = h('div.ribbon-stage', { class: { 'has-view': !!vc } },
        vc ? null : h('div.ribbon-office', officeArt(o.tier, 220)),
        vc ? null : h('div.ribbon-band', ribbonL, h('div.ribbon-bow'), ribbonR),
        vc ? null : scissors,
        vc ? null : h('div.ribbon-balloons', ...[0, 1, 2, 3, 4, 5].map((i) => h('i.ribbon-balloon', { style: { '--i': String(i) } }))),
        card,
      );
      const m = openModal({ body: stage, size: 'xl', cls: 'modal-ceremony modal-ribbon', dismissable: true, closeButton: false, onClose: () => resolve() });
      done.addEventListener('click', () => { sfx('ui_click'); m.close(); });
      const snipAt = reducedMotion() ? 50 : 900;
      setTimeout(() => {
        if (!m.open) return;
        stage.classList.add('is-cut');
        sfx('ribbon_snip');
        setTimeout(() => { if (m.open) { sfx('crowd_cheer'); confetti(card, 90); } }, reducedMotion() ? 0 : 260);
      }, snipAt);
    });
  });
}

// ---------------------------------------------------------------- city milestones

export function showMilestone(pct: number, grant = 0): Promise<void> {
  const mv = milestoneView(pct);
  if (!mv || !store.loaded) return Promise.resolve();
  const s = store.state;
  const v = cityStatus(s);
  const cityBtn = btn('Smile City', { variant: 'ghost', icon: 'city', onClick: () => { m.close(); if (pct < 100) go('city'); } });
  const ok = btn('Done', { variant: 'primary', iconRight: 'check', onClick: () => m.close() });
  const hero = h('div.ms-hero',
    h('div.ms-hero-rays'),
    h('div.ms-hero-badge', h('b.num', `${pct}%`), h('span', 'Smile City')),
  );
  const m = openModal({
    hero,
    eyebrow: 'City milestone',
    title: mv.title,
    body: h('div.col.gap-14',
      h('p.ms-text', mv.text),
      h('div.ms-rewards',
        h('div.ms-reward', h('span.ms-reward-icon', icon('coins')), h('div', h('div.bold', grant ? `City grant ${money(grant)}` : 'City grant'), h('div.small.muted', 'Paid into your cash'))),
        MILESTONE_UNLOCKS_BIG.includes(pct) ? h('div.ms-reward.is-unlock', h('span.ms-reward-icon', icon(pct === 50 ? 'bus' : 'trophy')), h('div', h('div.bold', mv.unlock), h('div.small.muted', pct === 50 ? 'Buy it on the Office screen' : pct === 70 ? 'The Dental Association is watching' : 'Reach 100% to hold it'))) : null,
        pct >= 100 ? h('div.ms-reward.is-unlock', h('span.ms-reward-icon', icon('trophy')), h('div', h('div.bold', mv.unlock), h('div.small.muted', 'The parade starts now'))) : null,
      ),
      v.next && pct < 100 ? h('div.small.muted.row.gap-6', icon('flag'), `Next: ${milestoneLabel(v.next.milestone)}`) : null,
    ),
    actions: [cityBtn, ok],
    size: 'sm',
    cls: 'modal-milestone',
  });
  sfx('milestone');
  viewCelebrate();
  requestAnimationFrame(() => confetti(hero, 80));
  return m.closed;
}
const MILESTONE_UNLOCKS_BIG = [50, 70, 90];

// ---------------------------------------------------------------- the parade (100%)

export function showParade(): Promise<void> {
  const still = reducedMotion();
  const floats = h('div.parade-floats', { class: { 'is-still': still } },
    h('div.parade-float.is-banner', h('span', 'Smile City Smiles')),
    h('div.parade-float.is-tooth', { html: toothMarkSvg() }),
    h('div.parade-float.is-band', icon('music'), icon('music')),
    h('div.parade-float.is-balloons', ...[0, 1, 2].map((i) => h('i.ribbon-balloon', { style: { '--i': String(i) } }))),
    h('div.parade-float.is-van', icon('bus'), h('span', 'Smile Van')),
    h('div.parade-float.is-tooth.is-small', { html: toothMarkSvg() }),
    h('div.parade-float.is-trophy', icon('trophy')),
  );
  const go2 = btn('Continue', { variant: 'sun', size: 'lg', iconRight: 'arrowRight' });
  const m = openModal({
    body: h('div.ceremony.parade',
      h('div.ceremony-inner.parade-inner',
        h('div.eyebrow.ceremony-eyebrow', 'Smile City 100%'),
        h('h1.ceremony-title', 'Smile City smiles'),
        h('p.ceremony-sub', 'Every district is smiling. The whole city came out to say thanks.'),
        go2,
      ),
      floats,
    ),
    size: 'xl',
    cls: 'modal-ceremony modal-parade',
    dismissable: false,
    closeButton: false,
  });
  go2.addEventListener('click', () => { sfx('ui_click'); m.close(); });
  focusSoon(go2);
  sfx('fanfare_gala');
  setTimeout(() => sfx('crowd_cheer'), 400);
  if (!still) {
    let n = 0;
    const burst = () => {
      if (!m.open || n++ > 8) return;
      confetti({ x: innerWidth * (0.15 + Math.random() * 0.7), y: innerHeight * 0.25 }, 40);
      setTimeout(burst, 900);
    };
    burst();
  }
  return m.closed;
}

// ---------------------------------------------------------------- the gala

const HEADLINER = 'Lil Molar';

export function showGalaCard(): Promise<void> {
  return new Promise((resolve) => {
    if (!store.loaded) { resolve(); return; }
    const s = store.state;
    const st = galaStatus(s);
    const tries = st.attempts;
    const later = btn('Later', { variant: 'ghost', onClick: () => m.close() });
    const stage = btn('Take the stage', { variant: 'sun', size: 'lg', icon: 'mic', disabled: !st.ready, title: st.ready ? '' : st.reason, onClick: () => { m.close(); void startGala(); } });
    const hero = h('div.gala-hero',
      h('i.gala-spot.is-l'), h('i.gala-spot.is-r'),
      h('div.gala-crowd'),
      patientPortrait({ name: HEADLINER, archetype: 'rapper' }, 'happy', 128, 'gala-star ring'),
    );
    const m = openModal({
      hero,
      eyebrow: 'The Golden Molar Gala',
      title: 'Tonight on stage',
      body: h('div.col.gap-14',
        h('p.gala-text', `The Golden Molar Gala is tonight. Headliner ${HEADLINER} needs his grill show-ready.`),
        h('div.row.row-wrap.gap-6', chip('Grill Glow-Up', 'sun', 'caseGrillz'), chip('Every twist', 'grape', 'twist'), chip('The crowd is watching', 'gum', 'mic')),
        h('div.gala-rule', icon('trophy'), h('span', h('b', '4 stars or more wins the Golden Molar.'), tries ? ` Fewer, and you can try again tomorrow. Attempts so far: ${tries}.` : ' Fewer, and you can try again tomorrow.')),
      ),
      actions: [later, stage],
      size: 'md',
      cls: 'modal-gala',
      onClose: () => resolve(),
    });
    sfx('crowd_cheer', { volume: 0.6 });
  });
}

/** The showcase clean: sim.galaSetup, the clean scene, sim.completeGala, the result, and on a win the finale. */
export async function startGala(): Promise<void> {
  if (galaBusy || isCleaning() || !store.loaded) return;
  const s = store.state;
  const g = galaSetup(s);
  if (!g.ok) { sfx('error'); toast({ text: g.reason, kind: 'bad', key: 'gala' }); return; }
  galaBusy = true;
  const hub = hubBridge();
  try {
    hub?.setClinicVisible(false);
    const result = await runClean(g.setup);
    hub?.setClinicVisible(true);
    music('music_clinic', true);
    const out = completeGala(s, result);
    store.commit({ saveNow: true });
    if (out.events.length) bus.emit('sim:events', out.events.filter((e) => !(e.type === 'toast' && /golden molar/i.test(e.text))));
    if (result.quit === 'abort') { toast({ text: out.lines[0] ?? 'The gala is back on tomorrow', kind: 'info', key: 'gala' }); return; }
    await showGalaResult(out.stars, result.quality, result.seconds, out.won, out.lines, g.setup.patient.name, out.prize);
    if (out.won) await runFinale();
  } finally {
    galaBusy = false;
  }
}

export function showGalaResult(stars: number, quality: number, seconds: number, won: boolean, lines: string[], star: string, prize = 0): Promise<void> {
  const n = Math.max(1, Math.min(5, Math.round(stars)));
  const starEls = Array.from({ length: 5 }, (_, i) => h('span.result-star', { class: { 'is-on': i < n } }, icon('star')));
  const hero = h('div.gala-result-hero', { class: { 'is-won': won } },
    h('div.ceremony-rays'),
    won ? h('div.gala-trophy', icon('trophy')) : patientPortrait({ name: star, archetype: 'rapper' }, 'neutral', 96, 'ring'),
    h('div.result-stars', ...starEls),
  );
  const next = btn(won ? 'Continue' : 'Done', { variant: won ? 'sun' : 'primary', size: 'lg', iconRight: 'arrowRight' });
  const m = openModal({
    hero,
    eyebrow: 'The Golden Molar Gala',
    title: won ? 'You won the Golden Molar' : 'The crowd wants an encore',
    body: h('div.col.gap-14',
      h('p.gala-text', won
        ? `${star} flashes the brightest grill in Smile City and the whole hall is on its feet. The Golden Molar is yours.`
        : `${star} still loves the grill, but the judges want more shine. Try again tomorrow.`),
      h('div.row.row-wrap.gap-6', chip(`Quality ${Math.round(quality * 100)}%`, 'mint', 'sparkle'), chip(fmtSeconds(seconds), '', 'timer'), won ? chip('Golden Molar', 'sun', 'trophy') : chip('4 stars wins', '', 'star')),
      prize > 0 ? h('div.money-line.gala-prize', h('span.row.gap-6', icon('coins'), 'Gala prize'), h('span.num', money(prize))) : null,
      ...lines.slice(0, 3).map((t) => h('div.wyc-row.good', icon('sparkle'), h('span', noDash(t)))),
    ),
    actions: [next],
    size: 'md',
    cls: 'modal-gala',
    dismissable: false,
    closeButton: false,
  });
  next.addEventListener('click', () => { sfx('ui_click'); m.close(); });
  focusSoon(next);
  if (won) { sfx('fanfare_gala'); setTimeout(() => sfx('crowd_cheer'), 300); requestAnimationFrame(() => confetti(hero, 140)); }
  else sfx('event_bad', { volume: 0.7 });
  return m.closed;
}

/** After a win: the credits, the Legacy page, then Retire or Keep running. */
export async function runFinale(): Promise<void> {
  if (!store.loaded) return;
  finaleRunning = true;
  try {
    flags(store.state).ui_finale_choice = true;
    store.commit({ saveNow: true });
    await showCredits();
    await showLegacyPage(true);
  } finally {
    finaleRunning = false;
  }
  await showRetireChoice();
}

// ---------------------------------------------------------------- credits

export function showCredits(): Promise<void> {
  if (!store.loaded) return Promise.resolve();
  const s = store.state;
  const names = creditNames(s);
  const block = (role: string, ...lines: string[]) => lines.length ? h('div.credit-block', h('div.credit-role', role), ...lines.map((t) => h('div.credit-name', t))) : null;
  const still = reducedMotion();
  const roll = h('div.credits-roll', { class: { 'is-still': still } },
    h('div.credits-logo', logo('lg')),
    block('Starring', `${s.player.name} as the ${playerTitle(s)}`),
    block('Mentor', EMPLOYER_BOSS),
    block('Headliner', HEADLINER),
    block('Your team', ...names.staff.slice(0, 40)),
    block('Favourite patients', ...names.patients),
    block('Your offices', ...s.locations.map((c) => `${c.name}, ${DISTRICTS[c.district as DistrictId]?.name ?? 'Smile City'}`)),
    block('Special thanks', 'Dennis the Dummy, for never flinching', 'Every patient who said "Ow"', 'The sugar bugs, for the job security'),
    block('Built with', 'three.js, Vite and TypeScript'),
    block('Fonts', 'Baloo 2 and Nunito'),
    h('div.credit-end', h('div.credit-thanks', 'Thanks for playing'), h('div.credit-sub', 'Smile City will remember your name.')),
  );
  const count = roll.querySelectorAll('.credit-name').length;
  if (!still) roll.style.setProperty('--roll-ms', `${Math.max(18000, 9000 + count * 900)}ms`);
  const next = btn('Continue', { variant: 'sun', size: 'lg', iconRight: 'arrowRight' });
  const m = openModal({
    body: h('div.ceremony.credits', h('div.credits-stars'), h('div.credits-window', roll), h('div.credits-foot', next)),
    size: 'xl',
    cls: 'modal-ceremony modal-credits',
    dismissable: false,
    closeButton: false,
  });
  next.addEventListener('click', () => { sfx('ui_click'); m.close(); });
  focusSoon(next);
  music('music_title', true);
  return m.closed.then(() => { music('music_clinic', true); });
}

// ---------------------------------------------------------------- Legacy page and the choice

export function showLegacyPage(final = false): Promise<void> {
  if (!store.loaded) return Promise.resolve();
  const s = store.state;
  const close = btn(final ? 'Continue' : 'Done', { variant: 'primary', size: 'lg', iconRight: final ? 'arrowRight' : undefined });
  const m = openModal({
    icon: 'trophy',
    eyebrow: final ? 'The end of the credits' : 'Legacy',
    title: `${s.player.name}'s legacy`,
    body: legacyView(s),
    actions: [close],
    size: 'xl',
    cls: 'modal-legacy',
    dismissable: !final,
  });
  close.addEventListener('click', () => { sfx('ui_click'); m.close(); });
  return m.closed;
}

export function showRetireChoice(): Promise<void> {
  return new Promise((resolve) => {
    if (!store.loaded) { resolve(); return; }
    const s = store.state;
    flags(s).ui_finale_choice = true;
    const keep = btn('Keep running', { variant: 'ghost', size: 'lg', icon: 'office', block: true });
    const ret = btn('Retire', { variant: 'sun', size: 'lg', icon: 'sparkle', block: true });
    const m = openModal({
      icon: 'trophy',
      eyebrow: 'Golden Molar winner',
      title: 'What next?',
      body: h('div.choice-grid',
        h('div.choice-card.is-retire',
          h('div.choice-icon', icon('sparkle')),
          h('div.bold.choice-title', 'Retire'),
          h('div.small.muted', 'End this career and start a new one. Your achievements turn into Legacy points to spend on perks.'),
          ret,
        ),
        h('div.choice-card',
          h('div.choice-icon', icon('office')),
          h('div.bold.choice-title', 'Keep running the chain'),
          h('div.small.muted', 'Keep playing this career. The Golden Molar stays on the wall.'),
          keep,
        ),
      ),
      size: 'md',
      cls: 'modal-choice',
      dismissable: false,
      closeButton: false,
      onClose: () => resolve(),
    });
    keep.addEventListener('click', () => {
      sfx('ui_click');
      m.close();
      store.commit({ saveNow: true });
      toast({ text: 'The Golden Molar stays on the wall', sub: 'Retire any time from Goals, Legacy', kind: 'gold', icon: 'trophy', ms: 5000 });
    });
    ret.addEventListener('click', async () => {
      sfx('ui_click');
      m.close();
      await retireFlow();
    });
  });
}

/** Confirm, retire through the sim, show the points, then the New Game screen with the Legacy shop. */
export async function retireFlow(): Promise<void> {
  if (!store.loaded) return;
  const ok = await confirmModal({ title: 'Retire?', text: 'This career ends and a new one starts from hygiene school. Legacy points and perks carry over.', confirm: 'Retire', icon: 'sparkle' });
  if (!ok || !store.loaded) return;
  const s = store.state;
  const r = retire(s);
  store.commit({ saveNow: true });
  await new Promise<void>((resolve) => {
    const start = btn('New career', { variant: 'sun', size: 'lg', iconRight: 'arrowRight', block: true });
    const m = openModal({
      hero: h('div.ms-hero', h('div.ms-hero-rays'), h('div.ms-hero-badge', h('b.num', `+${r.points}`), h('span', 'Legacy'))),
      eyebrow: 'Retired',
      title: `${s.player.name} hangs up the scaler`,
      body: h('div.col.gap-14',
        h('p.muted', `You earned ${r.points} Legacy point${r.points === 1 ? '' : 's'}. You have ${r.legacy.points} to spend on the New Game screen.`),
      ),
      actions: [start],
      size: 'sm',
      dismissable: false,
      closeButton: false,
      onClose: () => resolve(),
    });
    start.addEventListener('click', () => { sfx('ui_click'); m.close(); });
    sfx('level_up');
    requestAnimationFrame(() => confetti(m.el, 80));
  });
  deleteSave();
  store.set(null);
  go('newgame');
}

// ---------------------------------------------------------------- hub card: the gala waits

/** A card over the clinic while the Golden Molar Gala waits for you. */
export function createGalaCard(): { el: HTMLElement; sync(): void } {
  const el = h('div.gala-card.card', { style: { display: 'none' } });
  let shown = false;
  setGalaStarter(() => { go('clinic'); void startGala(); });
  let key = '';
  function sync(): void {
    if (!store.loaded) return;
    const s = store.state;
    const show = s.phase === 'owner' && !!s.finale?.galaUnlocked && !s.finale.won;
    const st = show ? galaStatus(s) : null;
    const k = show && st ? `${st.ready}|${st.attempts}|${st.reason}` : '';
    if (k === key && show === shown) return;
    key = k;
    shown = show;
    el.style.display = show ? '' : 'none';
    if (!show || !st) return;
    el.replaceChildren(
      h('div.gala-card-rays'),
      h('div.gala-card-top',
        patientPortrait({ name: HEADLINER, archetype: 'rapper' }, 'happy', 52, 'ring'),
        h('div.grow', h('div.eyebrow', st.ready ? 'Tonight' : 'Tomorrow night'), h('div.gala-card-title', 'The Golden Molar Gala'), h('div.small.muted', st.ready ? '4 stars or more wins' : st.reason)),
      ),
      btn('Take the stage', { variant: 'sun', icon: 'mic', block: true, disabled: !st.ready, title: st.ready ? '' : st.reason, onClick: () => void startGala() }),
    );
  }
  return { el, sync };
}
