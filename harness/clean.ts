// Clean scene test bed. URL params:
//   case=routine|candy|whitening|braces|pirate|deep   case type (default routine)
//   lvl=3             player level (problem teeth and amounts, DESIGN 5.5)
//   tw=chatty,hiccups twists (chatty, fidget, gagger, sensitive, hiccups, sleepy)
//   bonus=combo       bonus objective (noSlips, fast, combo, spotless, treasure)
//   first=1           first time for this case: the intro explains it and waits for Start
//   a=smoker          archetype (default: the case's usual patient)
//   tut=1             tutorial mode (school practical)
//   tools=4,2,2,2,1   tiers for scaler, polisher, floss, suction, rinse
//   seed=123          dirt seed
//   skills=power,eagleEye       skill ids
//   extras=disclosing,loupes    extras owned
//   gel=1 proc=1 (force procedural models, ignore GLBs) low=1 (low quality)
import { startClean, preloadClean } from '../src/clean';
import { buildSetup } from '../src/clean/setup';
import { cleanOptions } from '../src/clean/session';
import { audio } from '../src/audio';
import { getRenderer } from '../src/core/renderer';
import { loadSettings, saveSettings } from '../src/core/save';
import type { ArchetypeId, BonusId, CaseType, ExtraId, SkillId, TwistId } from '../src/core/types';

const q = new URLSearchParams(location.search);
const stage = document.getElementById('stage')!;
const result = document.getElementById('result')!;
cleanOptions.procedural = q.get('proc') === '1';
if (q.has('low')) saveSettings({ ...loadSettings(), quality: q.get('low') === '1' ? 'low' : 'high' });
try { audio.init(); } catch { /* audio module may still be a stub */ }

const CASES: CaseType[] = ['routine', 'candy', 'whitening', 'braces', 'pirate', 'deep'];

function run(seed: number) {
  result.style.display = 'none';
  const tiers = (q.get('tools') || '1,1,1,1,1').split(',').map((x) => Math.max(1, Number(x) || 1));
  const c = q.get('case') as CaseType | null;
  const setup = buildSetup({
    caseType: c && CASES.includes(c) ? c : 'routine',
    level: Number(q.get('lvl') || 1),
    twists: (q.get('tw') || '').split(',').filter(Boolean) as TwistId[],
    bonus: (q.get('bonus') || null) as BonusId | null,
    firstOfCase: q.get('first') === '1',
    archetype: (q.get('a') || undefined) as ArchetypeId | undefined,
    seed,
    tutorial: q.get('tut') === '1',
    tools: { scaler: tiers[0], polisher: tiers[1], floss: tiers[2], suction: tiers[3], rinse: tiers[4] },
    extras: (q.get('extras') || '').split(',').filter(Boolean) as ExtraId[],
    skills: (q.get('skills') || '').split(',').filter(Boolean) as SkillId[],
    gel: q.get('gel') === '1',
  });
  (window as any).__setup = setup;
  (window as any).__result = null;
  const session = startClean(stage, setup);
  session.done.then((r) => {
    (window as any).__result = r;
    session.dispose();
    document.getElementById('rtitle')!.textContent = r.quit === 'walkout' ? 'Walked out' : r.quit === 'abort' ? 'Left early' : `${r.stars} stars${r.perfect ? ', perfect' : ''}`;
    const shown = { ...r, before: r.before ? `${Math.round(r.before.length / 1024)} KB jpeg` : null, after: r.after ? `${Math.round(r.after.length / 1024)} KB jpeg` : null };
    document.getElementById('rjson')!.textContent = JSON.stringify(shown, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 2);
    const ba = document.getElementById('ba')!;
    ba.innerHTML = '';
    for (const src of [r.before, r.after]) if (src) { const img = document.createElement('img'); img.src = src; ba.appendChild(img); }
    result.style.display = 'grid';
  });
}

/** Renderer memory counters (textures and geometries must stay flat across cleans). */
(window as any).__mem = () => { const r = getRenderer(); return { ...r.info.memory, programs: r.info.programs?.length ?? 0 }; };

document.getElementById('again')!.addEventListener('click', () => run(Math.floor(Math.random() * 1e6)));
void preloadClean();
run(Number(q.get('seed') || 12345));
