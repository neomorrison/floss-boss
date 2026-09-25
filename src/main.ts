// Entry point. Owner: UI builder.
// Bootstrap: settings, audio, app shell, event reactions, debug hooks, load the save, show the Title.
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/hud.css';
import './styles/screens.css';
import './styles/panels.css';
import './styles/modals.css';
import './styles/manager.css';
import './styles/endgame.css';

import { audio } from './audio';
import { loadGame } from './core/save';
import { go, initApp, registerScreen } from './ui/app';
import { installDebug } from './ui/debug';
import { initEventReactions } from './ui/events';
import { loadState } from './ui/flow';
import { persist } from './ui/game';
import { hubScreen } from './ui/hub';
import { newGameScreen } from './ui/screens/newgame';
import { schoolScreen } from './ui/screens/school';
import { titleScreen } from './ui/screens/title';
import { applySettings } from './ui/settings';

function installGuards(): void {
  const editable = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  };
  // iOS Safari ignores user-scalable=no: block pinch zoom and the long-press callout on game surfaces
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (e) => { if (!editable(e.target)) e.preventDefault(); });
  // double-tap zoom is off through touch-action (none on the stage, manipulation on controls)
}

function boot(): void {
  applySettings();
  try { audio.init(); } catch (e) { console.warn('[ui] audio init', e); }
  installGuards();
  const root = document.getElementById('app')!;
  initApp(root);
  registerScreen('title', titleScreen);
  registerScreen('newgame', newGameScreen);
  registerScreen('school', schoolScreen);
  registerScreen('hub', hubScreen);
  initEventReactions();
  installDebug();

  const saved = loadGame();
  if (saved) loadState(saved);
  go('title');

  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  window.addEventListener('pagehide', () => persist());
}

boot();
