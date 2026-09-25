// Title: Continue / Load game, the Saves picker, New game and Settings over the title art (CSS gradient
// fallback). Up to SLOT_COUNT careers live side by side (src/core/save.ts); this screen is the only place
// that switches which one is active.
import { probeImage } from '../img';
import { money } from '../../core/format';
import { activeSlot, deleteSave, listSlots, type SlotId, type SlotInfo } from '../../core/save';
import { store } from '../../core/store';
import { TITLE_BG_URL } from '../../data/assets';
import { DIFFICULTIES } from '../../data/difficulty';
import { audio } from '../../audio';
import { go, type Screen } from '../app';
import { h, replace } from '../dom';
import { music } from '../fx';
import { continueGame, loadSlot } from '../flow';
import { playerTitle } from '../game';
import { icon, toothMarkSvg } from '../icons';
import { logo } from '../logo';
import { relativeTime, titleButtonState } from '../logic';
import { confirmModal, openModal, type ModalHandle } from '../modal';
import { openSettingsModal } from '../panels/settings';
import { avatarPortrait } from '../portrait';
import { btn } from '../widgets';

let preloaded = false;
function preload(): void {
  if (preloaded) return;
  preloaded = true;
  const safe = (fn: () => Promise<unknown>) => { try { fn().catch(() => undefined); } catch { /* not built */ } };
  // the clinic diorama and the clean scene load as separate chunks: fetch them while the title shows
  safe(() => import('../../clinic').then((m) => m.preloadClinic()));
  safe(() => import('../../clean').then((m) => m.preloadClean()));
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

function diffLabel(id: string): string {
  return (DIFFICULTIES as Record<string, { name: string } | undefined>)[id]?.name ?? id;
}

interface SlotCardHandlers {
  onLoad(slot: SlotId): void;
  onDelete(slot: SlotId): void;
  onNew(slot: SlotId): void;
}

/** One card in the Saves picker: a filled career (Load, Delete) or an empty slot (New game). */
function slotCard(info: SlotInfo, mode: 'manage' | 'newgame', on: SlotCardHandlers): HTMLElement {
  if (!info.exists || !info.head) {
    return h('div.slot-card.slot-card-empty',
      h('div.slot-empty-mark', icon('plus')),
      h('div.slot-empty-label', `Slot ${info.slot}`),
      h('div.grow'),
      btn('New game', { variant: 'primary', block: true, icon: 'plus', onClick: () => on.onNew(info.slot) }),
    );
  }
  const head = info.head;
  return h('div.slot-card',
    h('div.slot-card-top',
      avatarPortrait(head.avatar, head.name, 52),
      h('div.grow',
        h('div.slot-name', head.name, head.goldenMolar ? h('span.slot-gold', { title: 'Golden Molar won' }, icon('trophy')) : null),
        h('div.slot-sub.small.muted', head.phase === 'school' ? 'Hygiene school' : head.title),
      ),
    ),
    h('div.slot-stats',
      h('div.slot-stat', h('span.slot-stat-label', 'Day'), h('span.num', String(head.day))),
      h('div.slot-stat', h('span.slot-stat-label', 'Cash'), h('span.num', money(head.cash))),
      head.cityPct !== null ? h('div.slot-stat', h('span.slot-stat-label', 'City'), h('span.num', `${head.cityPct}%`)) : null,
      h('div.slot-stat', h('span.slot-stat-label', 'Mode'), h('span.num', diffLabel(head.difficulty))),
    ),
    h('div.slot-played.tiny.faint', icon('clock'), relativeTime(info.savedAt)),
    h('div.grow'),
    h('div.row.gap-6.slot-actions',
      btn('Load', { variant: 'primary', block: true, icon: 'playFill', onClick: () => on.onLoad(info.slot) }),
      btn('Delete', { variant: 'danger', block: true, icon: 'trash', onClick: () => on.onDelete(info.slot) }),
    ),
    mode === 'newgame' ? btn('New game here', { variant: 'ghost', size: 'sm', icon: 'refresh', block: true, onClick: () => on.onNew(info.slot) }) : null,
  );
}

/** The Saves picker: three slot cards. 'manage' just loads or deletes; 'newgame' (all three slots full)
 * also lets the player overwrite one to start over. `onChange` fires after a delete or an overwrite so
 * the title screen behind the modal can redraw its own buttons (a deleted active slot drops Continue). */
export function openSavesModal(opts: { mode?: 'manage' | 'newgame'; onChange?: () => void } = {}): void {
  const mode = opts.mode ?? 'manage';
  const grid = h('div.slot-grid');
  let m: ModalHandle | null = null;

  const render = (): void => {
    grid.replaceChildren(...listSlots().map((info) => slotCard(info, mode, {
      onLoad: (slot) => { m?.close(); loadSlot(slot); },
      onDelete: (slot) => { void handleDelete(slot); },
      onNew: (slot) => { void handleNew(slot); },
    })));
  };
  const handleDelete = async (slot: SlotId): Promise<void> => {
    const info = listSlots().find((s) => s.slot === slot);
    const name = info?.head?.name ?? `Slot ${slot}`;
    const ok = await confirmModal({
      title: 'Delete this save?',
      text: `${name}'s save is gone for good. This cannot be undone.`,
      confirm: 'Delete', danger: true, icon: 'trash',
    });
    if (!ok) return;
    deleteSave(slot);
    if (store.loaded && activeSlot() === slot) store.set(null);
    render();
    opts.onChange?.();
  };
  const handleNew = async (slot: SlotId): Promise<void> => {
    const info = listSlots().find((s) => s.slot === slot);
    if (info?.exists) {
      const ok = await confirmModal({
        title: 'Start over in this slot?',
        text: `This replaces ${info.head?.name ?? 'this save'}'s career with a new one. This cannot be undone.`,
        confirm: 'New game', danger: true, icon: 'refresh',
      });
      if (!ok) return;
      deleteSave(slot);
      if (store.loaded && activeSlot() === slot) store.set(null);
      opts.onChange?.();
    }
    m?.close();
    go('newgame', { slot });
  };

  render();
  m = openModal({
    icon: 'box',
    eyebrow: 'Saves',
    title: mode === 'newgame' ? 'Choose a slot to start over' : 'Your saves',
    body: grid,
    size: 'lg',
    cls: 'modal-saves',
  });
}

export function titleScreen(): Screen {
  music('music_title');
  preload();
  const actions = h('div.title-actions');

  // rebuilt whenever the Saves picker changes a slot, so a delete or overwrite made from the picker is
  // never left showing a stale Continue underneath it
  const renderActions = (): void => {
    const state = titleButtonState(listSlots(), activeSlot(), store.loaded);
    const s = state.showContinue ? store.state : null;

    const primaryBtn = s
      ? btn('Continue', {
        variant: 'primary', size: 'lg', block: true, icon: 'playFill',
        sub: s.phase === 'school' ? 'Hygiene school' : `Day ${s.day}  ·  ${playerTitle(s)}  ·  ${money(s.cash)}`,
        onClick: () => continueGame(),
      })
      : state.showLoadGame
        ? btn('Load game', { variant: 'primary', size: 'lg', block: true, icon: 'playFill', onClick: () => openSavesModal({ mode: 'manage', onChange: renderActions }) })
        : null;

    const savesBtn = state.showSaves
      ? btn('Saves', { variant: 'ghost', size: 'lg', block: true, icon: 'box', onClick: () => openSavesModal({ mode: 'manage', onChange: renderActions }) })
      : null;

    const newGame = btn('New game', {
      variant: primaryBtn ? 'ghost' : 'primary', size: 'lg', block: true, icon: 'plus',
      onClick: () => {
        if (state.newGameSlot !== null) go('newgame', { slot: state.newGameSlot });
        else openSavesModal({ mode: 'newgame', onChange: renderActions });
      },
    });
    const settingsBtn = btn('Settings', { variant: 'ghost', size: 'lg', block: true, icon: 'settings', onClick: () => openSettingsModal() });

    replace(actions, primaryBtn, newGame, savesBtn, settingsBtn);
  };
  renderActions();

  const el = h('div.title-screen',
    titleBackdrop(),
    h('div.title-center',
      h('div.title-logo', logo('lg')),
      h('p.title-tagline', 'Scrape tartar. Polish smiles. Build a dental empire.'),
      actions,
    ),
    h('div.title-foot', 'Floss Boss  ·  v1.0'),
  );
  return { name: 'title', el, dispose() { /* static */ } };
}
