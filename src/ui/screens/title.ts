// Title: Continue / New game / Settings over the title art (CSS gradient fallback).
import { probeImage } from '../../core/assets';
import { money } from '../../core/format';
import { deleteSave } from '../../core/save';
import { store } from '../../core/store';
import { TITLE_BG_URL } from '../../data/assets';
import * as clean from '../../clean';
import * as clinic from '../../clinic';
import { audio } from '../../audio';
import { go, type Screen } from '../app';
import { h } from '../dom';
import { music } from '../fx';
import { continueGame } from '../flow';
import { playerTitle } from '../game';
import { toothMarkSvg } from '../icons';
import { logo } from '../logo';
import { confirmModal } from '../modal';
import { openSettingsModal } from '../panels/settings';
import { btn } from '../widgets';

let preloaded = false;
function preload(): void {
  if (preloaded) return;
  preloaded = true;
  const safe = (fn: () => Promise<unknown>) => { try { fn().catch(() => undefined); } catch { /* not built */ } };
  safe(() => clinic.preloadClinic());
  safe(() => clean.preloadClean());
  safe(() => audio.preload());
}

export function titleBackdrop(): HTMLElement {
  const bg = h('div.title-bg',
    h('div.title-bubbles', ...Array.from({ length: 14 }, (_, i) => h('i', { style: {
      '--x': `${4 + ((i * 37) % 92)}%`,
      '--s': `${14 + ((i * 11) % 34)}px`,
      '--d': `${9 + ((i * 1.7) % 7)}s`,
      '--delay': `${-((i * 1.9) % 12)}s`,
    } }))),
    h('div.title-teeth', ...Array.from({ length: 6 }, (_, i) => h('div.title-tooth', { style: { '--i': String(i) }, html: toothMarkSvg() }))),
  );
  probeImage(TITLE_BG_URL).then((ok) => {
    if (!ok) return;
    const img = h('img.title-art', { src: TITLE_BG_URL, alt: '', draggable: false });
    bg.appendChild(img);
    bg.classList.add('has-art');
    requestAnimationFrame(() => img.classList.add('is-ready'));
  });
  return bg;
}

export function titleScreen(): Screen {
  music('music_title');
  preload();
  const hasSave = store.loaded;
  const s = hasSave ? store.state : null;
  const cont = s
    ? btn('Continue', {
      variant: 'primary', size: 'lg', block: true, icon: 'playFill',
      sub: s.phase === 'school' ? 'Hygiene school' : `Day ${s.day}  ·  ${playerTitle(s)}  ·  ${money(s.cash)}`,
      onClick: () => continueGame(),
    })
    : null;
  const newGame = btn('New game', {
    variant: hasSave ? 'ghost' : 'primary', size: 'lg', block: true, icon: 'plus',
    onClick: async () => {
      if (store.loaded) {
        const ok = await confirmModal({ title: 'Start over?', text: 'A new game replaces your current save.', confirm: 'New game', danger: true, icon: 'refresh' });
        if (!ok) return;
        deleteSave();
        store.set(null);
      }
      go('newgame');
    },
  });
  const settingsBtn = btn('Settings', { variant: 'ghost', size: 'lg', block: true, icon: 'settings', onClick: () => openSettingsModal() });

  const el = h('div.title-screen',
    titleBackdrop(),
    h('div.title-center',
      h('div.title-logo', logo('lg')),
      h('p.title-tagline', 'Scrape tartar. Polish smiles. Build a dental empire.'),
      h('div.title-actions', cont, newGame, settingsBtn),
    ),
    h('div.title-foot', 'Floss Boss  ·  v1.0'),
  );
  return { name: 'title', el, dispose() { /* static */ } };
}
