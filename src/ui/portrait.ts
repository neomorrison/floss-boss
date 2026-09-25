// Portraits: the real art (webp) when it loads, otherwise a seeded cartoon face drawn in SVG,
// so a missing file never shows a broken image.
import type { ArchetypeId, Staff } from '../core/types';
import { swapInImage } from './img';
import { avatarUrl, BOSS_URL, portraitUrl, staffPortraitUrl, type Mood } from '../data/assets';
import { STAFF_PORTRAITS } from '../data/staff';
import { h } from './dom';

export function hashStr(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
  return x >>> 0;
}

const SKIN = ['#FFD9C0', '#F5C19E', '#E3A77F', '#C98A5E', '#9E6641', '#74462A'];
const HAIR = ['#2E2320', '#5B3A24', '#9A5B2E', '#E3B04B', '#C8553D', '#3B3F5C', '#E8E4DC'];
const BG = ['#D3F6EC', '#FFF1C9', '#FFE0EB', '#DDF2FD', '#ECE8FF', '#E6F7F2'];
const SHIRT = ['#3DD6B5', '#FF7AA8', '#5BBEF5', '#8E7CF3', '#FFD166', '#0E8F8A', '#FF9F6B'];

export interface FaceOpts {
  seed: string;
  mood?: Mood;
  archetype?: ArchetypeId | 'boss' | 'staff' | 'avatar';
  scrubs?: string;
}

/** A cartoon face (100x100 SVG). Deterministic per seed. */
export function faceSvg(o: FaceOpts): string {
  const r = hashStr(o.seed + '|' + (o.archetype ?? ''));
  const pick = <T,>(arr: T[], k: number) => arr[(r >>> k) % arr.length];
  const mood = o.mood ?? 'neutral';
  const arch = o.archetype;
  let skin = pick(SKIN, 1);
  let hair = pick(HAIR, 5);
  let style = (r >>> 9) % 5;
  let shirt = o.scrubs ?? pick(SHIRT, 13);
  const bg = pick(BG, 17);
  let extra = '';
  if (arch === 'mannequin') { skin = '#D5DEE0'; style = 5; shirt = '#9FB3B8'; }
  if (arch === 'senior') { hair = '#E8E4DC'; style = (r >>> 3) % 2 ? 3 : 0; }
  if (arch === 'kid') style = (r >>> 3) % 2 ? 4 : 2;
  if (arch === 'influencer') { hair = (r >>> 3) % 2 ? '#FF7AA8' : '#E3B04B'; style = 1; }
  if (arch === 'boss') { skin = '#F5C19E'; hair = '#8C4A6B'; style = 2; shirt = '#FFFFFF'; }
  // the rap star (DESIGN 11.6): dark skin, dreadlocks, gold shades, a chain and a diamond grill
  if (arch === 'rapper') { skin = '#5E3B24'; hair = '#2B1D16'; style = 6; shirt = '#3B2F5C'; }
  const shade = 'rgba(22,50,58,.10)';

  const hairTop = 'M27 46C24 27 35 17 50 17s26 10 23 29c-5-10-13-15-23-15s-18 5-23 15z';
  let hairSvg = '';
  let hairBack = '';
  switch (style) {
    case 0: hairSvg = `<path d="${hairTop}" fill="${hair}"/>`; break;
    case 1:
      hairBack = `<path d="M25 44c0-18 10-27 25-27s25 9 25 27v28c-4 3-9 3-11 0V44H36v28c-2 3-7 3-11 0z" fill="${hair}"/>`;
      hairSvg = `<path d="${hairTop}" fill="${hair}"/>`; break;
    case 2: hairSvg = `<circle cx="50" cy="15" r="9" fill="${hair}"/><path d="${hairTop}" fill="${hair}"/>`; break;
    case 3: hairSvg = `<path d="M26 50c-2-6 0-11 4-13 1 5 1 9 0 13zM74 50c2-6 0-11-4-13-1 5-1 9 0 13z" fill="${hair}"/>`; break;
    case 4: hairSvg = [30, 38, 46, 54, 62, 70].map((x, i) => `<circle cx="${x}" cy="${i % 2 ? 22 : 26}" r="8" fill="${hair}"/>`).join('') + `<path d="${hairTop}" fill="${hair}"/>`; break;
    case 6:
      // dreadlocks: long locs down both sides, knobbly crown, a gold cuff on two of them
      hairBack = [[22, 34, -8], [27, 31, -4], [32, 30, -2], [68, 30, 2], [73, 31, 4], [78, 34, 8]].map(([x, y, r]) =>
        `<rect x="${x - 3.2}" y="${y}" width="6.4" height="${46 - Math.abs(r)}" rx="3.2" fill="${hair}" transform="rotate(${r} ${x} ${y})"/>`).join('')
        + `<rect x="21.2" y="62" width="6" height="3.2" rx="1.2" fill="#FFD166" transform="rotate(-8 22 34)"/><rect x="72.8" y="60" width="6" height="3.2" rx="1.2" fill="#FFD166" transform="rotate(8 78 34)"/>`;
      hairSvg = [[29, 33], [34, 26], [41, 22], [50, 20], [59, 22], [66, 26], [71, 33]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6.4" fill="${hair}"/>`).join('')
        + `<path d="${hairTop}" fill="${hair}"/>`
        + `<path d="M34 26c2 3 3 6 3 9M41 22c1 3 2 6 2 9M59 22c-1 3-2 6-2 9M66 26c-2 3-3 6-3 9" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2" stroke-linecap="round"/>`;
      break;
    default: break;
  }

  // eyes
  let eyes = '';
  const ink = '#16323A';
  if (mood === 'happy') eyes = `<path d="M36 47q4-5 8 0M56 47q4-5 8 0" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`;
  else if (mood === 'pain') eyes = `<path d="M36 43l7 4-7 4M64 43l-7 4 7 4" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  else if (mood === 'wow') eyes = `<circle cx="40" cy="46" r="5.2" fill="#fff" stroke="${ink}" stroke-width="2"/><circle cx="60" cy="46" r="5.2" fill="#fff" stroke="${ink}" stroke-width="2"/><circle cx="40.5" cy="46.5" r="2.6" fill="${ink}"/><circle cx="60.5" cy="46.5" r="2.6" fill="${ink}"/>`;
  else eyes = `<circle cx="40" cy="47" r="3.2" fill="${ink}"/><circle cx="60" cy="47" r="3.2" fill="${ink}"/><circle cx="41" cy="46" r="1" fill="#fff"/><circle cx="61" cy="46" r="1" fill="#fff"/>`;
  if (arch === 'mannequin') eyes = `<circle cx="40" cy="47" r="3" fill="#6B7F84"/><circle cx="60" cy="47" r="3" fill="#6B7F84"/>`;

  // mouth
  let mouth = '';
  if (mood === 'happy') mouth = `<path d="M40 57q10 11 20 0z" fill="#fff" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/>`;
  else if (mood === 'pain') mouth = `<rect x="41" y="56" width="18" height="8" rx="3" fill="#fff" stroke="${ink}" stroke-width="2.4"/><path d="M47 56v8M53 56v8" stroke="${ink}" stroke-width="1.6"/>`;
  else if (mood === 'wow') mouth = `<ellipse cx="50" cy="60" rx="5" ry="6" fill="#7A2E3A" stroke="${ink}" stroke-width="2.4"/>`;
  else mouth = `<path d="M43 59q7 4 14 0" fill="none" stroke="${ink}" stroke-width="2.8" stroke-linecap="round"/>`;
  if (arch === 'mannequin') mouth = `<path d="M43 59h14" stroke="#6B7F84" stroke-width="2.6" stroke-linecap="round"/><path d="M50 22v8M48 26h4" stroke="#9FB3B8" stroke-width="1.6"/>`;

  if (arch === 'rapper') {
    // gold-rimmed shades over the eyes; the mood shows in the brows and the grill
    const brow = mood === 'pain' ? 'M31 38l14 3M69 38l-14 3' : mood === 'wow' ? 'M32 35q7-4 13 0M55 35q7-4 13 0' : 'M32 38q7-2 13 0M55 38q7-2 13 0';
    eyes = `<path d="${brow}" fill="none" stroke="${hair}" stroke-width="2.6" stroke-linecap="round"/>`
      + `<rect x="30.5" y="41" width="17" height="11" rx="4.5" fill="#16323A" stroke="#E9AF38" stroke-width="1.6"/><rect x="52.5" y="41" width="17" height="11" rx="4.5" fill="#16323A" stroke="#E9AF38" stroke-width="1.6"/>`
      + `<path d="M47.5 45h5" stroke="#E9AF38" stroke-width="1.8"/><path d="M34 44.5l4.5-1.8M56 44.5l4.5-1.8" stroke="rgba(255,255,255,.6)" stroke-width="1.8" stroke-linecap="round"/>`;
    const gems = (y: number, xs: number[]) => xs.map((x) => `<path d="M${x} ${y - 1.9}l1.9 1.9-1.9 1.9-1.9-1.9z" fill="#CFF3FF" stroke="#5BBEF5" stroke-width=".7"/>`).join('');
    if (mood === 'happy') mouth = `<path d="M39 56q11 12 22 0z" fill="#FFF6D6" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/><path d="M40.5 57h19" stroke="#E9AF38" stroke-width="2.6"/>${gems(57.6, [44, 48, 52, 56])}`;
    else if (mood === 'wow') mouth = `<ellipse cx="50" cy="60" rx="6" ry="6.5" fill="#7A2E3A" stroke="${ink}" stroke-width="2.4"/><path d="M44.8 57.2h10.4v2.6H44.8z" fill="#FFD166" stroke="#B98217" stroke-width=".8"/>${gems(58.5, [47.6, 52.4])}`;
    else if (mood === 'pain') mouth = `<rect x="40" y="56" width="20" height="8" rx="3" fill="#FFF6D6" stroke="${ink}" stroke-width="2.4"/><path d="M40.5 58.6h19" stroke="#E9AF38" stroke-width="2.2"/>${gems(58.8, [45, 50, 55])}`;
    else mouth = `<path d="M42 58q8 5 16-1" fill="#FFF6D6" stroke="${ink}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>${gems(59.2, [50, 54])}`;
    extra += `<path d="M34 75q16 16 32 0" fill="none" stroke="#E9AF38" stroke-width="3.6" stroke-linecap="round"/><path d="M34 75q16 16 32 0" fill="none" stroke="#FFD166" stroke-width="2" stroke-dasharray="2.6 1.8"/>`
      + `<circle cx="50" cy="88" r="5" fill="#FFD166" stroke="#B98217" stroke-width="1.4"/><path d="M50 85.5l1 1.9 2 .3-1.5 1.4.4 2-1.9-1-1.9 1 .4-2-1.5-1.4 2-.3z" fill="#fff" opacity=".85"/>`
      + `<path d="M76 20l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" fill="#FFD166"/>`;
  }
  if (arch === 'boss') extra +=`<g fill="none" stroke="${ink}" stroke-width="2.4"><circle cx="40" cy="47" r="7.5"/><circle cx="60" cy="47" r="7.5"/><path d="M47.5 47h5"/></g><path d="M36 74l14 12 14-12" fill="none" stroke="#CDEDEA" stroke-width="4"/>`;
  if (arch === 'athlete') extra += `<path d="M28 36c14-6 30-6 44 0v6c-14-6-30-6-44 0z" fill="#FF7AA8"/>`;
  if (arch === 'nervous') extra += `<path d="M73 30c-3 4-3 7 0 8 3-1 3-4 0-8z" fill="#8FD3F5" stroke="#3E9BCB" stroke-width="1.2"/>`;
  if (arch === 'kid') extra += `<g fill="#C98A5E" opacity=".45"><circle cx="35" cy="53" r="1.2"/><circle cx="38" cy="55" r="1.2"/><circle cx="62" cy="55" r="1.2"/><circle cx="65" cy="53" r="1.2"/></g>`;
  if (arch === 'staff' || o.scrubs) extra += `<path d="M40 74l10 8 10-8" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="3" stroke-linejoin="round"/>`;

  return `<svg viewBox="0 0 100 100" aria-hidden="true">
<rect width="100" height="100" fill="${bg}"/>
${hairBack}
<path d="M12 104c3-19 19-29 38-29s35 10 38 29z" fill="${shirt}"/>
<rect x="43" y="62" width="14" height="15" rx="5" fill="${skin}"/><rect x="43" y="62" width="14" height="6" fill="${shade}"/>
<circle cx="28" cy="50" r="5.5" fill="${skin}"/><circle cx="72" cy="50" r="5.5" fill="${skin}"/>
<ellipse cx="50" cy="47" rx="22.5" ry="24.5" fill="${skin}"/>
${hairSvg}
<ellipse cx="34" cy="55" rx="4.2" ry="2.6" fill="#FF7AA8" opacity=".35"/><ellipse cx="66" cy="55" rx="4.2" ry="2.6" fill="#FF7AA8" opacity=".35"/>
${eyes}${mouth}${extra}
</svg>`;
}

function build(url: string | null, face: string, size: number, cls = ''): HTMLElement {
  const el = h('div.portrait', { class: cls, style: { '--pz': size + 'px' } });
  const drawFace = () => { el.insertAdjacentHTML('afterbegin', face); el.classList.add('is-drawn'); };
  if (url) swapInImage(el, url, 'has-img', drawFace);
  else drawFace();
  return el;
}

export function patientPortrait(p: { name: string; archetype: ArchetypeId }, mood: Mood = 'neutral', size = 56, cls = ''): HTMLElement {
  return build(portraitUrl(p.archetype, mood), faceSvg({ seed: p.name, mood, archetype: p.archetype }), size, cls);
}

/** Staff portrait index from its key ("staff_7", "7") or a hash of the name. */
export function staffPortraitIndex(s: { portrait: string; name: string }): number {
  const m = String(s.portrait ?? '').match(/(\d+)/);
  if (m) return Number(m[1]) % STAFF_PORTRAITS;
  return hashStr(s.name) % STAFF_PORTRAITS;
}

export function staffPortrait(s: Pick<Staff, 'portrait' | 'name' | 'role'>, size = 56, cls = '', scrubs?: string): HTMLElement {
  if (s.portrait === 'boss') return bossPortrait(size, cls);
  const n = staffPortraitIndex(s);
  return build(staffPortraitUrl(n), faceSvg({ seed: s.name, mood: 'happy', archetype: 'staff', scrubs }), size, cls);
}

export function avatarPortrait(n: number, name = 'You', size = 56, cls = ''): HTMLElement {
  const seeds = ['sunny-avatar', 'mint-avatar', 'berry-avatar', 'sky-avatar'];
  const scrubs = ['#3DD6B5', '#FF7AA8', '#5BBEF5', '#8E7CF3'][n % 4];
  return build(avatarUrl(n), faceSvg({ seed: seeds[n % 4], mood: 'happy', archetype: 'avatar', scrubs }), size, cls);
}

export function bossPortrait(size = 72, cls = '', mood: Mood = 'happy'): HTMLElement {
  return build(BOSS_URL, faceSvg({ seed: 'ruth-canal', mood, archetype: 'boss' }), size, cls);
}
