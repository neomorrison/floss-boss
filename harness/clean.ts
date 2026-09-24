// Clean scene test bed. URL params:
//   a=smoker          archetype (default regular)
//   tut=1             tutorial mode
//   tools=4,2,2,2,1   tiers for scaler, polisher, floss, suction, rinse
//   seed=123          dirt seed
//   skills=power,eagleEye       skill ids
//   extras=disclosing,loupes    extras owned
//   gel=1 service=deep proc=1 (force procedural models, ignore GLBs) low=1 (low quality)
import { startClean, preloadClean } from '../src/clean';
import { buildSetup } from '../src/clean/setup';
import { cleanOptions } from '../src/clean/session';
import { audio } from '../src/audio';
import { loadSettings, saveSettings } from '../src/core/save';
import type { ArchetypeId, ExtraId, SkillId } from '../src/core/types';

const q = new URLSearchParams(location.search);
const stage = document.getElementById('stage')!;
const result = document.getElementById('result')!;
cleanOptions.procedural = q.get('proc') === '1';
if (q.has('low')) saveSettings({ ...loadSettings(), quality: q.get('low') === '1' ? 'low' : 'high' });
try { audio.init(); } catch { /* audio module may still be a stub */ }

function run(seed: number) {
  result.style.display = 'none';
  const tiers = (q.get('tools') || '1,1,1,1,1').split(',').map((x) => Math.max(1, Number(x) || 1));
  const setup = buildSetup({
    archetype: (q.get('a') || 'regular') as ArchetypeId,
    seed,
    tutorial: q.get('tut') === '1',
    tools: { scaler: tiers[0], polisher: tiers[1], floss: tiers[2], suction: tiers[3], rinse: tiers[4] },
    extras: (q.get('extras') || '').split(',').filter(Boolean) as ExtraId[],
    skills: (q.get('skills') || '').split(',').filter(Boolean) as SkillId[],
    gel: q.get('gel') === '1',
    service: q.get('service') === 'deep' ? 'deep' : 'cleaning',
  });
  (window as any).__setup = setup;
  const session = startClean(stage, setup);
  session.done.then((r) => {
    (window as any).__result = r;
    session.dispose();
    document.getElementById('rtitle')!.textContent = r.quit === 'walkout' ? 'Walked out' : r.quit === 'abort' ? 'Left early' : `${r.stars} stars`;
    document.getElementById('rjson')!.textContent = JSON.stringify(r, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 2);
    result.style.display = 'grid';
  });
}

document.getElementById('again')!.addEventListener('click', () => run(Math.floor(Math.random() * 1e6)));
void preloadClean();
run(Number(q.get('seed') || 12345));
