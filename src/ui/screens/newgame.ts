// New game: name and one of four avatars, then hygiene school.
import { AVATAR_COUNT } from '../../data/assets';
import { go, type Screen } from '../app';
import { h } from '../dom';
import { sfx } from '../fx';
import { startNewGame } from '../flow';
import { icon } from '../icons';
import { avatarPortrait } from '../portrait';
import { titleBackdrop } from './title';
import { btn } from '../widgets';

const NAME_IDEAS = ['Alex', 'Sam', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Quinn', 'Robin'];

export function newGameScreen(): Screen {
  let avatar = 0;
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
  const start = btn('Start school', { variant: 'primary', size: 'lg', iconRight: 'arrowRight', class: 'grow', onClick: () => begin() });
  const back = btn('Back', { variant: 'ghost', size: 'lg', icon: 'arrowLeft', onClick: () => go('title') });
  const begin = () => {
    const name = input.value.trim().replace(/\s+/g, ' ').slice(0, 16) || NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)];
    start.disabled = true;
    startNewGame(name, avatar);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); begin(); } });

  const el = h('div.newgame-screen',
    titleBackdrop(),
    h('div.newgame-wrap.scroll',
      h('div.card.newgame-card.anim-rise',
        h('div.eyebrow', 'New game'),
        h('h2', 'Hygiene school starts today'),
        h('div.field', h('label', 'Name'), input),
        h('div.field', h('span.label', 'Look'), h('div.avatar-grid', ...tiles)),
        h('div.row.newgame-actions', back, start),
      ),
    ),
  );
  setTimeout(() => { if (matchMedia('(pointer: fine)').matches) input.focus(); }, 300);
  return { name: 'newgame', el, dispose() { /* static */ } };
}
