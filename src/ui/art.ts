// Flat cartoon storefronts per office tier (practice flow, Office panel, move up, new location).
// Ink outlines and the DESIGN 9 palette, matching the tooth mark.
import type { OfficeTierId } from '../core/types';
import { h } from './dom';

const INK = '#16323A';
const SW = 'stroke="#16323A" stroke-width="3" stroke-linejoin="round"';

function toothSign(cx: number, cy: number, s = 1): string {
  return `<g transform="translate(${cx} ${cy}) scale(${s})"><rect x="-17" y="-14" width="34" height="28" rx="8" fill="#FFFDF7" ${SW}/><path d="M-7-7c-3 0-5 2-5 5 0 4 2 5 3 9 .5 2 1.2 3 2.3 3 1.8 0 1.8-3 2.4-5 .3-1 1-1.5 1.8-1.5s1.5.5 1.8 1.5c.6 2 .6 5 2.4 5 1.1 0 1.8-1 2.3-3 1-4 3-5 3-9 0-3-2-5-5-5-2.2 0-3 1.2-4.5 1.2S-4.8-7-7-7z" fill="#3DD6B5" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/></g>`;
}

function awning(x: number, y: number, w: number, stripes = 7): string {
  const sw = w / stripes;
  let s = '';
  for (let i = 0; i < stripes; i++) s += `<rect x="${x + i * sw}" y="${y}" width="${sw}" height="12" fill="${i % 2 ? '#FFFDF7' : '#3DD6B5'}"/>`;
  let scallop = `M${x} ${y + 12}`;
  for (let i = 0; i < stripes; i++) scallop += ` q${sw / 2} 9 ${sw} 0`;
  return `<g>${s}<path d="${scallop} V${y}H${x}z" fill="none"/>${Array.from({ length: stripes }, (_, i) => `<path d="M${x + i * sw} ${y + 12} q${sw / 2} 9 ${sw} 0" fill="${i % 2 ? '#FFFDF7' : '#3DD6B5'}" stroke="${INK}" stroke-width="2.4"/>`).join('')}<rect x="${x}" y="${y}" width="${w}" height="12" fill="none" ${SW}/></g>`;
}

function win(x: number, y: number, w: number, hgt: number, glass = '#CFEFFB'): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="3" fill="${glass}" ${SW}/><path d="M${x + 4} ${y + hgt - 5} l${w * 0.35} -${hgt * 0.45}" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>`;
}

export function officeSvg(tier: OfficeTierId): string {
  let body = '';
  switch (tier) {
    case 't1':
      body = `
<rect x="18" y="46" width="124" height="54" rx="4" fill="#FFFDF7" ${SW}/>
<rect x="14" y="38" width="132" height="12" rx="4" fill="#0E8F8A" ${SW}/>
${awning(30, 58, 100, 8)}
${win(30, 78, 30, 20)}${win(100, 78, 30, 20)}
<rect x="68" y="74" width="24" height="26" rx="3" fill="#FF7AA8" ${SW}/><circle cx="87" cy="88" r="1.8" fill="${INK}"/>
${toothSign(80, 26, 0.9)}`;
      break;
    case 't2':
      body = `
<path d="M24 100V40l56-18 56 18v60z" fill="#FFE0EB" ${SW}/>
<rect x="36" y="44" width="22" height="18" rx="3" fill="#CFEFFB" ${SW}/><rect x="102" y="44" width="22" height="18" rx="3" fill="#CFEFFB" ${SW}/>
${toothSign(80, 50, 0.8)}
${awning(32, 66, 96, 8)}
${win(36, 82, 26, 18)}${win(98, 82, 26, 18)}
<rect x="68" y="78" width="24" height="22" rx="3" fill="#0E8F8A" ${SW}/><circle cx="87" cy="90" r="1.8" fill="#FFFDF7"/>`;
      break;
    case 't3':
      body = `
<rect x="30" y="22" width="100" height="78" rx="5" fill="#DDF2FD" ${SW}/>
${[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => `<rect x="${38 + c * 22}" y="${30 + r * 18}" width="16" height="12" rx="2" fill="#9FDDF7" stroke="${INK}" stroke-width="2"/>`).join('')).join('')}
<rect x="24" y="84" width="112" height="16" rx="3" fill="#3DD6B5" ${SW}/>
<rect x="66" y="84" width="28" height="16" rx="2" fill="#CFEFFB" ${SW}/>
${toothSign(80, 12, 0.7)}`;
      break;
    default:
      body = `
<rect x="52" y="20" width="56" height="80" rx="5" fill="#FFFDF7" ${SW}/>
${[0, 1, 2, 3, 4].map((r) => [0, 1, 2].map((c) => `<rect x="${59 + c * 16}" y="${28 + r * 12}" width="10" height="8" rx="2" fill="#CFEFFB" stroke="${INK}" stroke-width="1.8"/>`).join('')).join('')}
<rect x="20" y="64" width="34" height="36" rx="4" fill="#DDF2FD" ${SW}/><rect x="106" y="58" width="34" height="42" rx="4" fill="#FFE0EB" ${SW}/>
<rect x="70" y="86" width="20" height="14" rx="2" fill="#0E8F8A" ${SW}/>
${toothSign(80, 10, 0.8)}
<path d="M101 6l1.6 3.6 3.6 1.6-3.6 1.6-1.6 3.6-1.6-3.6-3.6-1.6 3.6-1.6z" fill="#FFD166" stroke="${INK}" stroke-width="1.6"/>`;
      break;
  }
  return `<svg viewBox="0 0 160 116" aria-hidden="true"><ellipse cx="80" cy="104" rx="70" ry="8" fill="rgba(14,80,80,.14)"/>
<path d="M8 100h144" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
<circle cx="14" cy="88" r="10" fill="#5DD3A0" ${SW}/><rect x="12" y="94" width="4" height="7" fill="#9A5B2E"/>
<circle cx="148" cy="90" r="8" fill="#5DD3A0" ${SW}/><rect x="146" y="95" width="4" height="6" fill="#9A5B2E"/>
${body}</svg>`;
}

export function officeArt(tier: OfficeTierId, size = 120, cls = ''): HTMLElement {
  return h('div.office-art', { class: cls, style: { '--oz': size + 'px' }, html: officeSvg(tier) });
}
