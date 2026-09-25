// The Legacy screen (DESIGN 11.2, 11.4): career stats, the timeline, case masteries and Smile City.
// Always reachable from Goals; also the credits' final page. Plus the Legacy shop on the New Game screen.
import { money } from '../core/format';
import { loadLegacy, saveLegacy, type LegacyState } from '../core/legacy';
import type { GameState, LegacyPerkId } from '../core/types';
import { CASE_ORDER, CASES } from '../data/cases';
import { DIFFICULTIES } from '../data/difficulty';
import { LEGACY_ORDER, LEGACY_PERKS } from '../data/legacy';
import { caseTile, tierMedal } from './casebits';
import { cityMap } from './city';
import { h } from './dom';
import { sfx } from './fx';
import { cityStatus, legacyPreview } from './endgame';
import { buyPerk, canBuyPerk, careerStats, difficultyOf, TIMELINE_ICON, timelineView } from './endlogic';
import { playerTitle } from './game';
import { icon } from './icons';
import { masteryInfo, noDash } from './logic';
import { avatarPortrait } from './portrait';
import { btn, chip, sectionTitle } from './widgets';

/** The whole career on one page. `onRetire` shows the Retire button (after the Golden Molar). */
export function legacyView(s: GameState, o: { onRetire?: () => void } = {}): HTMLElement {
  const v = cityStatus(s);
  const diff = DIFFICULTIES[difficultyOf(s)];
  const won = !!s.finale?.won;
  const head = h('div.legacy-head',
    avatarPortrait(s.player.avatar ?? 0, s.player.name, 76, 'ring'),
    h('div.grow',
      h('div.eyebrow', 'Career'),
      h('h3.legacy-name', s.player.name),
      h('div.row.row-wrap.gap-6',
        chip(playerTitle(s), 'teal', 'bolt'),
        chip(diff.name, s.difficulty === 'veteran' ? 'coral' : s.difficulty === 'relaxed' ? 'sky' : 'mint', 'target'),
        chip(`Day ${s.day}`, '', 'calendar'),
        won ? chip('Golden Molar', 'sun', 'trophy') : null,
      ),
    ),
  );

  const stats = h('div.legacy-stats', ...careerStats(s, money).map((x) => h('div.legacy-stat', h('span.legacy-stat-icon', icon(x.icon)), h('div', h('div.legacy-stat-value.num', x.value), h('div.legacy-stat-label', x.label)))));

  const mastery = s.player.mastery ?? {};
  const masteries = h('div.legacy-masteries', ...CASE_ORDER.map((ct) => {
    const info = masteryInfo(mastery[ct] ?? 0);
    return h('div.legacy-mastery', { title: `${CASES[ct].name}: ${info.tier ? `${info.name} mastery` : 'Unranked'}` },
      caseTile(ct, 40),
      tierMedal(info.tier, 26, 'legacy-medal'),
      h('div.legacy-mastery-name', CASES[ct].name),
      h('div.tiny.bold.faint', info.tier ? info.name : `${info.count} cleans`),
    );
  }));

  const tl = timelineView(s.timeline);
  const timeline = tl.length
    ? h('ol.legacy-timeline', ...tl.map((e) => h('li.tl-item', { class: `kind-${e.kind}` },
      h('span.tl-dot', icon(TIMELINE_ICON[e.kind] ?? 'dot')),
      h('div.grow', h('div.tl-text', noDash(e.text)), h('div.tl-day.tiny.bold.faint', `Day ${e.day}`)),
    )))
    : h('div.small.muted.legacy-empty', icon('info'), 'Promotions, openings and city milestones show up here.');

  const city = h('div.legacy-city',
    cityMap(v, { preview: s.phase !== 'owner' }),
    h('div.legacy-city-facts',
      h('div.legacy-city-pct.num', `${v.pct}%`),
      h('div.small.muted', v.pct >= 100 ? 'Every district is smiling' : 'of Smile City is smiling'),
      h('div.row.row-wrap.gap-6', ...v.reached.map((p) => chip(`${p}%`, 'mint', 'check'))),
    ),
  );

  let retire: HTMLElement | null = null;
  if (o.onRetire && won && !s.finale?.retired) {
    const pts = legacyPreview(s);
    retire = h('div.legacy-retire',
      h('div.legacy-retire-icon', icon('gift')),
      h('div.grow',
        h('div.bold', `Retiring now earns ${pts.total} Legacy point${pts.total === 1 ? '' : 's'}`),
        h('div.small.muted', pts.parts.map((p) => `${p.label} ${p.points}`).join(', ') || 'Spend them on perks for your next career.'),
      ),
      btn('Retire', { variant: 'sun', icon: 'sparkle', onClick: () => o.onRetire?.() }),
    );
  }

  return h('div.legacy-view',
    head,
    retire,
    sectionTitle('Career', 'report'),
    stats,
    sectionTitle('Smile City', 'city'),
    city,
    sectionTitle('Case mastery', 'medal'),
    masteries,
    sectionTitle('Timeline', 'clock', tl.length ? chip(`${tl.length}`, 'teal') : null),
    timeline,
  );
}

// ---------------------------------------------------------------- the Legacy shop (New Game screen)

export interface LegacyShop { el: HTMLElement; perks(): LegacyPerkId[]; legacy(): LegacyState }

/** Buy perks with Legacy points and pick which owned perks to bring into the new run. Null when there is nothing to show. */
export function legacyShop(): LegacyShop | null {
  let l = loadLegacy();
  if (l.points <= 0 && !l.owned.length) return null;
  const picked = new Set<LegacyPerkId>(l.owned);
  const el = h('div.legacy-shop');
  const render = () => {
    const pts = h('span.legacy-points', icon('sparkle'), h('b.num', String(l.points)), l.points === 1 ? ' point' : ' points');
    el.replaceChildren(
      h('div.row.row-between.row-wrap.gap-6', h('span.label', 'Legacy'), pts),
      h('div.legacy-perks', ...LEGACY_ORDER.map((id) => {
        const def = LEGACY_PERKS[id];
        const owned = l.owned.includes(id);
        const on = owned && picked.has(id);
        const can = canBuyPerk(l, id);
        let action: HTMLElement;
        if (owned) {
          action = h('span.perk-bring', { class: { 'is-on': on } }, icon(on ? 'check' : 'plus'), on ? 'Bringing' : 'Bring');
        } else {
          action = btn('Buy', {
            variant: 'sun', size: 'sm', sub: `${def.cost} ${def.cost === 1 ? 'pt' : 'pts'}`, disabled: !can.ok, title: can.ok ? '' : can.reason,
            onClick: () => {
              const next = buyPerk(l, id);
              if (next === l) return;
              l = next;
              saveLegacy(l);
              picked.add(id);
              sfx('purchase');
              render();
            },
          });
        }
        const card = h(owned ? 'button.perk-card' : 'div.perk-card', { class: { 'is-owned': owned, 'is-on': on }, type: owned ? 'button' : undefined, 'aria-pressed': owned ? String(on) : false },
          h('div.grow', h('div.perk-name', def.name), h('div.perk-text', def.text)),
          action,
        );
        if (owned) card.addEventListener('click', () => { sfx('ui_tab'); if (picked.has(id)) picked.delete(id); else picked.add(id); render(); });
        return card;
      })),
    );
  };
  render();
  return {
    el,
    perks: () => LEGACY_ORDER.filter((id) => l.owned.includes(id) && picked.has(id)),
    legacy: () => l,
  };
}
