// Settings: volumes, quality, reduced motion, haptics, hints, save export/import, reset.
import { deleteSave, exportSave, importSave, saveGame } from '../../core/save';
import { store } from '../../core/store';
import { go } from '../app';
import { h } from '../dom';
import { sfx } from '../fx';
import { loadState } from '../flow';
import { persist } from '../game';
import { icon } from '../icons';
import { confirmModal, openModal } from '../modal';
import type { PanelCtx, PanelInst } from '../panelhost';
import { settings, updateSettings } from '../settings';
import { toast } from '../toasts';
import { btn, sectionTitle, seg, slider, toggle } from '../widgets';

function row(iconName: string, title: string, sub: string, control: HTMLElement): HTMLElement {
  return h('div.list-row', icon(iconName), h('div.list-label', h('b', title), sub ? h('span', sub) : null), control);
}

function volume(key: 'master' | 'music' | 'sfx'): HTMLElement {
  const val = h('span.num.vol-val', `${Math.round(settings()[key] * 100)}`);
  const r = slider({
    min: 0, max: 1, step: 0.05, value: settings()[key], label: key,
    onInput: (v) => { val.textContent = String(Math.round(v * 100)); updateSettings({ [key]: v }); },
    onChange: () => { if (key !== 'music') sfx('ui_click'); },
  });
  return h('div.vol', r, val);
}

export function settingsContent(inGame: boolean, rerender: () => void): HTMLElement {
  const st = settings();
  let exportBox: HTMLElement | null = null;
  const importArea = h('textarea.input', { placeholder: 'Paste a save code', rows: 3, spellcheck: false, 'aria-label': 'Save code' }) as HTMLTextAreaElement;

  const doExport = () => {
    if (!store.loaded) return;
    persist();
    const code = exportSave(store.state);
    const area = h('textarea.input', { readOnly: true, rows: 4, 'aria-label': 'Your save code' }, code) as HTMLTextAreaElement;
    const copy = btn('Copy', { variant: 'primary', size: 'sm', icon: 'copy', onClick: async () => {
      try { await navigator.clipboard.writeText(code); toast({ text: 'Save code copied', kind: 'good', key: 'copy' }); }
      catch { area.select(); document.execCommand?.('copy'); toast({ text: 'Save code selected', kind: 'info', key: 'copy' }); }
    } });
    exportBox?.replaceChildren(area, h('div.row.row-end', copy));
    area.focus();
    area.select();
  };
  const doImport = async () => {
    const code = importArea.value.trim();
    if (!code) { sfx('error'); toast({ text: 'Paste a save code first', kind: 'bad', key: 'import' }); return; }
    const state = importSave(code);
    if (!state) { sfx('error'); toast({ text: 'That save code is not valid', kind: 'bad', key: 'import' }); return; }
    if (store.loaded) {
      const ok = await confirmModal({ title: 'Load this save?', text: 'It replaces the game you are playing now.', confirm: 'Load save', danger: true, icon: 'import' });
      if (!ok) return;
    }
    loadState(state);
    saveGame(store.state);
    toast({ text: `Loaded ${state.player.name}, day ${state.day}`, kind: 'good' });
    go(state.phase === 'school' ? 'school' : 'hub');
  };
  const doReset = async () => {
    const ok = await confirmModal({ title: 'Delete your save?', text: 'Your practice, team and cash are gone for good. This cannot be undone.', confirm: 'Delete save', danger: true, icon: 'trash' });
    if (!ok) return;
    deleteSave();
    store.set(null);
    go('title');
  };

  exportBox = h('div.col.gap-6');
  return h('div.settings-panel',
    sectionTitle('Sound', 'volume'),
    h('div.list',
      row('volume', 'Master', '', volume('master')),
      row('music', 'Music', '', volume('music')),
      row('sparkle', 'Effects', '', volume('sfx')),
    ),
    sectionTitle('Display', 'eye'),
    h('div.list',
      row('sparkle', 'Quality', 'Low saves battery on older iPads', seg([{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }], st.quality, (v) => updateSettings({ quality: v as 'low' | 'high' }))),
      row('refresh', 'Reduced motion', 'No camera shake, fewer effects', toggle(st.reducedMotion, (v) => updateSettings({ reducedMotion: v }), 'Reduced motion')),
      row('hand', 'Haptics', 'Small buzzes on supported devices', toggle(st.haptics, (v) => updateSettings({ haptics: v }), 'Haptics')),
      row('bulb', 'Hints', 'Tip line under the clock', toggle(st.showHints, (v) => updateSettings({ showHints: v }), 'Hints')),
    ),
    sectionTitle('Save', 'export', h('span.small.muted', 'Saved on this device automatically')),
    h('div.list',
      inGame ? h('div.list-row.list-col',
        h('div.row.row-between.row-wrap', h('div.list-label', h('b', 'Export'), h('span', 'Copy a code to move your game to another device')), btn('Show code', { variant: 'ghost', size: 'sm', icon: 'export', onClick: doExport })),
        exportBox,
      ) : null,
      h('div.list-row.list-col',
        h('div.list-label', h('b', 'Import'), h('span', 'Paste a code from another device')),
        importArea,
        h('div.row.row-end', btn('Load save', { variant: 'ghost', size: 'sm', icon: 'import', onClick: doImport })),
      ),
    ),
    inGame ? h('div.settings-actions',
      btn('Title screen', { variant: 'ghost', icon: 'home', onClick: () => { persist(); go('title'); } }),
      btn('Delete save', { variant: 'danger', icon: 'trash', onClick: doReset }),
    ) : null,
    h('div.settings-foot.tiny.faint', 'Floss Boss v1.0  ·  Made with three.js'),
  );
}

export function settingsPanel(ctx: PanelCtx): PanelInst {
  let built: HTMLElement | null = null;
  return {
    title: 'Settings',
    icon: 'settings',
    // settings do not depend on the game state: build once so typing and sliders are never interrupted
    key: () => 'settings',
    render() { return built ?? (built = settingsContent(true, () => ctx.rerender())); },
  };
}

export function openSettingsModal(): void {
  openModal({
    icon: 'settings',
    title: 'Settings',
    body: settingsContent(store.loaded, () => undefined),
    size: 'md',
    blocking: true,
    cls: 'modal-settings',
  });
}
