// Audio harness: every SFX and music key with a play button (and loop toggles for the four SFX
// loops), volume sliders wired to real Settings, and a decode check the orchestrator (or
// tools/snap.mjs) can read from window.__audioHarness. Owner: audio builder.
import { audio, debugContextState, type LoopHandle } from '../src/audio/index';
import { audioUrl, MUSIC_KEYS, SFX_KEYS, type MusicKey, type SfxKey } from '../src/data/assets';
import { bus } from '../src/core/bus';
import { loadSettings, saveSettings } from '../src/core/save';

const LOOP_KEYS: SfxKey[] = ['ultrasonic_loop', 'polish_loop', 'suction_loop', 'rinse_loop'];

interface HarnessResult {
  ready: boolean;
  total: number;
  checked: number;
  file: string[];
  synth: string[];
  failed: string[];
  errors: string[];
}
declare global {
  interface Window { __audioHarness: HarnessResult; __fbAudio: typeof audio }
}
window.__audioHarness = { ready: false, total: SFX_KEYS.length + MUSIC_KEYS.length, checked: 0, file: [], synth: [], failed: [], errors: [] };
window.__fbAudio = audio; // let snap.mjs / the orchestrator call play()/loop()/music() directly if useful

function log(msg: string): void {
  const el = document.getElementById('log');
  if (!el) return;
  el.textContent = `${el.textContent ?? ''}${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

audio.init();

const app = document.getElementById('app')!;
app.innerHTML = '';

// ---------------------------------------------------------------- top bar: context state + volumes
const bar = document.createElement('div');
bar.className = 'bar';
bar.innerHTML = `
  <label><span class="status-dot" id="ctxDot"></span> <span id="ctxState">unknown</span></label>
  <label>Master <input type="range" id="volMaster" min="0" max="1" step="0.01" /></label>
  <label>Music <input type="range" id="volMusic" min="0" max="1" step="0.01" /></label>
  <label>SFX <input type="range" id="volSfx" min="0" max="1" step="0.01" /></label>
  <button class="ghost" id="unlockBtn" type="button">Resume audio context</button>
  <button class="ghost" id="preloadBtn" type="button">Run decode check</button>
`;
app.appendChild(bar);

const settings = loadSettings();
const volMaster = bar.querySelector<HTMLInputElement>('#volMaster')!;
const volMusic = bar.querySelector<HTMLInputElement>('#volMusic')!;
const volSfx = bar.querySelector<HTMLInputElement>('#volSfx')!;
volMaster.value = String(settings.master);
volMusic.value = String(settings.music);
volSfx.value = String(settings.sfx);
function wireVolume(input: HTMLInputElement, field: 'master' | 'music' | 'sfx') {
  input.addEventListener('input', () => {
    const s = loadSettings();
    s[field] = Number(input.value);
    saveSettings(s);
    bus.emit('settings:changed', undefined);
  });
}
wireVolume(volMaster, 'master');
wireVolume(volMusic, 'music');
wireVolume(volSfx, 'sfx');

bar.querySelector('#unlockBtn')!.addEventListener('click', () => {
  audio.play('ui_click');
});

const ctxDot = bar.querySelector<HTMLElement>('#ctxDot')!;
const ctxState = bar.querySelector<HTMLElement>('#ctxState')!;
function pollState() {
  const state = debugContextState();
  ctxState.textContent = `AudioContext: ${state}`;
  ctxDot.className = `status-dot ${state}`;
  setTimeout(pollState, 300);
}
pollState();

// ---------------------------------------------------------------- music section
const musicSection = document.createElement('section');
musicSection.innerHTML = '<h2>Music (1.5 s crossfade)</h2>';
const musicRow = document.createElement('div');
musicRow.className = 'music-row';
let activeMusicBtn: HTMLButtonElement | null = null;
function musicButton(label: string, key: MusicKey | null) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', () => {
    audio.music(key);
    if (activeMusicBtn) activeMusicBtn.classList.remove('active');
    b.classList.add('active');
    activeMusicBtn = key ? b : null;
    log(`music(${key ?? 'null'})`);
  });
  musicRow.appendChild(b);
}
for (const key of MUSIC_KEYS) musicButton(key, key);
musicButton('Stop', null);
musicSection.appendChild(musicRow);
app.appendChild(musicSection);

// ---------------------------------------------------------------- SFX grid
const sfxSection = document.createElement('section');
sfxSection.innerHTML = '<h2>SFX (37 keys, 4 loopable)</h2>';
const grid = document.createElement('div');
grid.className = 'grid';
sfxSection.appendChild(grid);
app.appendChild(sfxSection);

const activeLoops = new Map<SfxKey, LoopHandle>();
const tags = new Map<string, HTMLElement>();

for (const key of SFX_KEYS) {
  const row = document.createElement('div');
  row.className = 'row';
  const tag = document.createElement('span');
  tag.className = 'tag pending';
  tag.textContent = '...';
  tags.set(key, tag);
  const label = document.createElement('span');
  label.className = 'key';
  label.textContent = key;
  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.textContent = 'Play';
  playBtn.addEventListener('click', () => { audio.play(key); log(`play(${key})`); });
  row.append(tag, label, playBtn);

  if (LOOP_KEYS.includes(key)) {
    const loopBtn = document.createElement('button');
    loopBtn.type = 'button';
    loopBtn.textContent = 'Loop';
    loopBtn.addEventListener('click', () => {
      const running = activeLoops.get(key);
      if (running) {
        running.stop();
        activeLoops.delete(key);
        loopBtn.textContent = 'Loop';
        loopBtn.classList.remove('loop-on');
        log(`loop(${key}).stop()`);
      } else {
        const handle = audio.loop(key);
        activeLoops.set(key, handle);
        loopBtn.textContent = 'Stop loop';
        loopBtn.classList.add('loop-on');
        log(`loop(${key}) started`);
      }
    });
    row.appendChild(loopBtn);
  }
  grid.appendChild(row);
}

// ---------------------------------------------------------------- log
const logSection = document.createElement('section');
logSection.innerHTML = '<h2>Log</h2><div id="log"></div>';
app.appendChild(logSection);

// ---------------------------------------------------------------- decode check
async function runDecodeCheck(): Promise<void> {
  log('running decode check...');
  const result = window.__audioHarness;
  result.checked = 0; result.file = []; result.synth = []; result.failed = []; result.errors = [];
  try {
    await audio.preload();
  } catch (e) {
    result.errors.push(String(e));
  }
  const allKeys: string[] = [...SFX_KEYS, ...MUSIC_KEYS];
  await Promise.all(allKeys.map(async (key) => {
    const tag = tags.get(key);
    try {
      const res = await fetch(audioUrl(key));
      const ok = res.ok;
      result.checked++;
      if (ok) result.file.push(key); else result.synth.push(key);
      if (tag) { tag.textContent = ok ? 'file' : 'synth'; tag.className = `tag ${ok ? 'file' : 'synth'}`; }
    } catch (e) {
      result.checked++;
      result.synth.push(key);
      if (tag) { tag.textContent = 'synth'; tag.className = 'tag synth'; }
      result.errors.push(`${key}: ${String(e)}`);
    }
  }));
  result.ready = true;
  log(`decode check done: ${result.file.length} real file(s), ${result.synth.length} synth fallback, ${result.failed.length} failed`);
}
bar.querySelector('#preloadBtn')!.addEventListener('click', () => { runDecodeCheck(); });
runDecodeCheck();
