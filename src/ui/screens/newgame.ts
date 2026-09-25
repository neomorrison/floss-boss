// New game: name, one of four avatars, the difficulty (Relaxed / Standard / Veteran, DESIGN 11.5) and,
// after a retirement, the Legacy shop and the perks to bring into the run (DESIGN 11.4). Then hygiene school.
import { loadLegacy } from '../../core/legacy';
import type { SlotId } from '../../core/save';
import type { Difficulty } from '../../core/types';
import { AVATAR_COUNT } from '../../data/assets';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../../data/difficulty';
import { go, type Screen } from '../app';
import { h } from '../dom';
import { sfx } from '../fx';
import { startNewGame } from '../flow';
import { icon } from '../icons';
import { legacyShop } from '../legacy';
import { avatarPortrait } from '../portrait';
import { titleBackdrop } from './title';
import { btn } from '../widgets';

const NAME_IDEAS = ['Alex', 'Sam', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Quinn', 'Robin'];

const DIFF_ICON: Record<Difficulty, string> = { relaxed: 'heart', standard: 'target', veteran: 'bolt' };

export function newGameScreen(params: Record<string, unknown> = {}): Screen {
  // the title screen picks the slot this run saves into (an empty one, or the one a retired career just left)
  const targetSlot = params.slot as SlotId | undefined;
  let avatar = 0;
  let difficulty: Difficulty = 'standard';
  const legacy = loadLegacy();
  const input = h('input.input', {
    type: 'text', maxLength: 16, placeholder: 'Your name', autocomplete: 'off', spellcheck: false,
    value: '', 'aria-label': 'Your name',
  }) as HTMLInputElement;
  const tiles = Array.from({ length: AVATAR_COUNT }, (_, i) => {
    const t = h('button.avatar-tile', { type: 'button', 'aria-label': `Avatar ${i + 1}`, class: { 'is-on': i === avatar } },
      avatarPortrait(i, 'You', 96),
      h('span.avatar-check', icon('check')),
    );
    t.addEventListener('click', () => {
      avatar = i;
      sfx('ui_tab');
      tiles.forEach((x, j) => x.classList.toggle('is-on', j === i));
    });
    return t;
  });

  const diffCards = DIFFICULTY_ORDER.map((id) => {
    const d = DIFFICULTIES[id];
    const gold = id === 'veteran' && legacy.veteranUnlocked;
    const b = h('button.diff-card', { type: 'button', role: 'radio', 'aria-checked': String(id === difficulty), class: [`diff-${id}`, { 'is-on': id === difficulty }] },
      h('span.diff-icon', icon(DIFF_ICON[id])),
      h('span.diff-name', d.name, gold ? h('span.diff-gold', { title: 'Golden Molar won' }, icon('trophy')) : null),
      h('span.diff-text', d.text),
      h('span.diff-check', icon('check')),
    );
    b.addEventListener('click', () => {
      if (difficulty === id) return;
      difficulty = id;
      sfx('ui_tab');
      diffCards.forEach((x, j) => { const on = DIFFICULTY_ORDER[j] === id; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', String(on)); });
    });
    return b;
  });

  const shop = legacyShop();
  const start = btn('Start school', { variant: 'primary', size: 'lg', iconRight: 'arrowRight', class: 'grow', onClick: () => begin() });
  const back = btn('Back', { variant: 'ghost', size: 'lg', icon: 'arrowLeft', onClick: () => go('title') });
  const begin = () => {
    const name = input.value.trim().replace(/\s+/g, ' ').slice(0, 16) || NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)];
    start.disabled = true;
    startNewGame(name, avatar, { difficulty, legacyPerks: shop?.perks() ?? [], slot: targetSlot });
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); begin(); } });

  const el = h('div.newgame-screen',
    titleBackdrop(),
    h('div.newgame-wrap.scroll',
      h('div.card.newgame-card.anim-rise', { class: { 'has-legacy': !!shop } },
        h('div.eyebrow', legacy.runs > 0 ? `New career ${legacy.runs + 1}` : 'New game'),
        h('h2', 'Hygiene school starts today'),
        h('div.field', h('label', 'Name'), input),
        h('div.field', h('span.label', 'Look'), h('div.avatar-grid', ...tiles)),
        h('div.field', h('span.label', 'Difficulty'), h('div.diff-grid', { role: 'radiogroup', 'aria-label': 'Difficulty' }, ...diffCards)),
        shop ? h('div.field', shop.el) : null,
        h('div.row.newgame-actions', back, start),
      ),
    ),
  );
  setTimeout(() => { if (matchMedia('(pointer: fine)').matches) input.focus(); }, 300);
  return { name: 'newgame', el, dispose() { /* static */ } };
}
