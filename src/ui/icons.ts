// Inline SVG icon set (no emoji in the interface). 24x24, round strokes in currentColor.
// Filled glyphs use fill="currentColor". icon(name) returns a <span class="icon"> wrapper.
import { h } from './dom';

const S = (d: string) => `<path d="${d}"/>`;
const TOOTH = 'M7.2 3.2C4.6 3.2 3 5.2 3 8.1c0 3 1.5 5 2.3 8.4.5 2.3 1.2 4.3 2.7 4.3 1.9 0 1.9-3 2.4-5 .3-1.1.8-1.7 1.6-1.7s1.3.6 1.6 1.7c.5 2 .5 5 2.4 5 1.5 0 2.2-2 2.7-4.3C19.5 13.1 21 11.1 21 8.1c0-2.9-1.6-4.9-4.2-4.9-2 0-3 1.1-4.8 1.1S9.2 3.2 7.2 3.2z';

const PATHS: Record<string, string> = {
  tooth: S(TOOTH),
  clinic: S('M3.5 10.5 12 4l8.5 6.5') + S('M5.5 9v11h13V9') + S('M12 12.5v5M9.5 15h5'),
  tools: S('M4 20l8.2-8.2') + S('M12.2 11.8c.9-2.4 2.6-5.2 4.9-6.6 1.4-.8 3 .6 2.3 2-1.3 2.4-4.1 4.1-6.5 5') + S('M13.5 10.5l-1.5-1.5'),
  skills: S('M12 3.5l2.1 5.4 5.4 2.1-5.4 2.1L12 18.5l-2.1-5.4L4.5 11l5.4-2.1z') + S('M19 16.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z'),
  staff: `<circle cx="9" cy="8" r="3.4"/>` + S('M2.8 20c.8-3.6 3.3-5.6 6.2-5.6s5.4 2 6.2 5.6') + `<circle cx="17.2" cy="9" r="2.6"/>` + S('M17.6 14.3c2.2.3 3.6 1.9 4 4.4'),
  office: `<rect x="4.5" y="3.5" width="15" height="17" rx="2"/>` + S('M8.5 7.5h2M13.5 7.5h2M8.5 11.5h2M13.5 11.5h2M10 20.5v-4h4v4'),
  finance: S('M4 19.5h16') + S('M4.5 15.5l4.5-4.5 3.5 3 6-6.5') + S('M14.5 7.5h4v4'),
  goals: S('M8 4h8v5.2a4 4 0 0 1-8 0z') + S('M8 5.8H5.2a3 3 0 0 0 3.2 4.1M16 5.8h2.8a3 3 0 0 1-3.2 4.1') + S('M12 13.2v3.3M8.5 20.5h7M9.7 20.5l.6-4h3.4l.6 4'),
  settings: S('M4 7h9M17.5 7H20M4 17h3M11.5 17H20') + `<circle cx="15.2" cy="7" r="2.3"/><circle cx="9.2" cy="17" r="2.3"/>`,
  close: S('M6.5 6.5l11 11M17.5 6.5l-11 11'),
  check: S('M5 12.5l4.5 4.5L19 7.5'),
  lock: `<rect x="5" y="10.5" width="14" height="10" rx="2.5"/>` + S('M8 10.5V8a4 4 0 0 1 8 0v2.5'),
  plus: S('M12 5v14M5 12h14'),
  minus: S('M5 12h14'),
  arrowRight: S('M5 12h14M13 6l6 6-6 6'),
  arrowLeft: S('M19 12H5M11 6l-6 6 6 6'),
  arrowUp: S('M12 19V5M6 11l6-6 6 6'),
  arrowDown: S('M12 5v14M6 13l6 6 6-6'),
  chevronRight: S('M9.5 6l6 6-6 6'),
  chevronLeft: S('M14.5 6l-6 6 6 6'),
  chevronDown: S('M6 9.5l6 6 6-6'),
  heart: S('M12 19.8s-7-4.3-8.9-8.8C1.9 8 3.8 4.7 7.1 4.7c2 0 3.5 1.1 4.9 2.8 1.4-1.7 2.9-2.8 4.9-2.8 3.3 0 5.2 3.3 4 6.3-1.9 4.5-8.9 8.8-8.9 8.8z'),
  clock: `<circle cx="12" cy="12" r="8.5"/>` + S('M12 7.5V12l3 2'),
  timer: `<circle cx="12" cy="13.5" r="7.5"/>` + S('M12 10v3.5l2.3 1.4M9.5 2.8h5M18.5 6.2l1.3-1.3'),
  bolt: S('M13.2 2.8 5 13.6h6.2l-1 7.6 8.3-10.8h-6.3z'),
  user: `<circle cx="12" cy="8" r="4"/>` + S('M4.5 20.5c1-4.2 4-6.6 7.5-6.6s6.5 2.4 7.5 6.6'),
  userPlus: `<circle cx="10" cy="8" r="3.8"/>` + S('M3 20.5c.9-4 3.7-6.3 7-6.3 1.6 0 3 .5 4.2 1.4M18.5 13v6M15.5 16h6'),
  door: S('M13.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4.5') + S('M9.5 16.5 5 12l4.5-4.5M5 12h10.5'),
  alert: S('M12 4.2 21 19.5H3z') + S('M12 10v4') + `<circle cx="12" cy="16.8" r=".6" fill="currentColor"/>`,
  info: `<circle cx="12" cy="12" r="8.5"/>` + S('M12 11v5.2') + `<circle cx="12" cy="7.8" r=".6" fill="currentColor"/>`,
  sparkle: S('M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z') + S('M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z') + S('M5.5 15.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z'),
  volume: S('M4 9.2h3.8L13 5v14l-5.2-4.2H4z') + S('M16.5 8.8a4.6 4.6 0 0 1 0 6.4M19 6.3a8.2 8.2 0 0 1 0 11.4'),
  music: S('M9 17.5V5.5l10.5-2v12') + `<circle cx="6.5" cy="17.5" r="2.6"/><circle cx="17" cy="15.5" r="2.6"/>`,
  export: S('M12 14.5V3.5M7.5 8l4.5-4.5L16.5 8') + S('M4.5 14.5v3.5a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-3.5'),
  import: S('M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5') + S('M4.5 14.5v3.5a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-3.5'),
  trash: S('M4.5 7h15M10 11v6M14 11v6M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7M9.5 7V4.5h5V7'),
  chair: S('M6.5 4.5c1.3 0 2 .9 2 2.2V12h7.2l3.8 3.5H21') + S('M4.5 12h4M5 12v2.5a2 2 0 0 0 2 2h7.5M11 16.5v3.5M8 20h6'),
  pin: S('M12 21s-6.8-6-6.8-11.4a6.8 6.8 0 0 1 13.6 0C18.8 15 12 21 12 21z') + `<circle cx="12" cy="9.6" r="2.4"/>`,
  megaphone: S('M3.5 10.5v3a1 1 0 0 0 1 1h2.5l8.5 4.5v-14L7 9.5H4.5a1 1 0 0 0-1 1z') + S('M18.5 9a4 4 0 0 1 0 6M7.5 14.5l1.2 5h3l-1-4.2'),
  bank: S('M3.5 9 12 4.2 20.5 9') + S('M5.5 10v8M10 10v8M14 10v8M18.5 10v8M3.5 20h17'),
  trendUp: S('M4 17l5.5-5.5 3.5 3.5 7-7.5') + S('M15 7.5h5v5'),
  trendDown: S('M4 7l5.5 5.5 3.5-3.5 7 7.5') + S('M15 16.5h5v-5'),
  report: `<rect x="5" y="4.5" width="14" height="16.5" rx="2.2"/>` + S('M9 4.5V3h6v1.5M8.8 10h6.4M8.8 13.5h6.4M8.8 17h3.6'),
  bulb: S('M9.3 17.5h5.4M10.3 20.5h3.4') + S('M12 3.5a5.8 5.8 0 0 0-3.4 10.5c.8.6 1.2 1.4 1.2 2.3v.4h4.4v-.4c0-.9.4-1.7 1.2-2.3A5.8 5.8 0 0 0 12 3.5z'),
  graduation: S('M2.5 9.2 12 4.5l9.5 4.7L12 14z') + S('M6.5 11.2v4.6c3 2.4 8 2.4 11 0v-4.6M21.5 9.2v5.3'),
  auto: S('M19.5 12a7.5 7.5 0 1 1-2.2-5.3') + S('M19.8 4.5v4.3h-4.3'),
  hand: S('M8 13V6.2a1.5 1.5 0 0 1 3 0V11M11 10.5V4.8a1.5 1.5 0 0 1 3 0V11M14 10.8V6.2a1.5 1.5 0 0 1 3 0v6.3') + S('M17 11.5a1.5 1.5 0 0 1 3 0v2.3c0 4-2.7 6.7-6.6 6.7-2.6 0-4-1-5.4-2.9L5 13.8a1.5 1.5 0 0 1 2.4-1.8L8 13'),
  calendar: `<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/>` + S('M3.5 10h17M8 3v4M16 3v4'),
  copy: `<rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/>` + S('M15.5 8.5V6a2.2 2.2 0 0 0-2.2-2.2H6A2.2 2.2 0 0 0 3.8 6v7.3A2.2 2.2 0 0 0 6 15.5h2.5'),
  edit: S('M4 20h4.2L19 9.2a2.1 2.1 0 0 0 0-3l-1.2-1.2a2.1 2.1 0 0 0-3 0L4 15.8z') + S('M13.5 6.5l4 4'),
  medal: `<circle cx="12" cy="15" r="5.2"/>` + S('M8.6 3.5l2.2 6.8M15.4 3.5l-2.2 6.8') + S('M12 12.8l.8 1.5 1.6.2-1.2 1.1.3 1.6-1.5-.8-1.5.8.3-1.6-1.2-1.1 1.6-.2z'),
  scaler: S('M4 20.5l9.5-9.5') + S('M13.5 11c.4-2.5 1.8-5.6 4-7 1-.6 2.3.3 1.8 1.4-.9 2-2.4 3.4-4.1 4.2') + S('M11.5 9l3.5 3.5'),
  polisher: `<circle cx="16" cy="8" r="4.3"/>` + S('M16 5.8v4.4M13.8 8h4.4') + S('M12.9 11.1 4 20'),
  floss: S('M6.5 3.5v17M17.5 3.5v17') + S('M6.5 8c3.7 2.4 7.3 2.4 11 0'),
  suction: S('M4 20l9-9') + S('M13 11l3.2-3.2a2.8 2.8 0 0 1 4 4L17 15') + S('M15 9l1.5 1.5'),
  rinse: S('M12 3.5s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z') + S('M9 15a3 3 0 0 0 3 3'),
  gel: S('M8.5 3.5h7l-.8 3.6H9.3z') + S('M9.3 7.1v10.4a2.7 2.7 0 0 0 5.4 0V7.1') + S('M9.3 11.5h5.4'),
  bell: S('M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z') + S('M10 20.5a2 2 0 0 0 4 0'),
  eye: S('M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z') + `<circle cx="12" cy="12" r="2.8"/>`,
  crown: S('M3.5 8l4.3 4 4.2-6.5 4.2 6.5 4.3-4-1.8 10H5.3z') + S('M5.5 20.5h13'),
  receipt: S('M6 3.5h12v17l-2.4-1.5-2.4 1.5-2.4-1.5-2.4 1.5L6 20.5z') + S('M9 8.5h6M9 12h6M9 15.5h3.5'),
  play: S('M8 5.5v13l10.5-6.5z'),
  refresh: S('M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9') + S('M18.8 3.5v3.8H15M5.2 20.5v-3.8H9'),
  home: S('M4 11 12 4.5 20 11v9H4z') + S('M9.5 20v-5h5v5'),
  smile: `<circle cx="12" cy="12" r="8.5"/>` + S('M8.3 13.8c1 1.6 2.3 2.4 3.7 2.4s2.7-.8 3.7-2.4') + `<circle cx="9" cy="9.8" r=".7" fill="currentColor"/><circle cx="15" cy="9.8" r=".7" fill="currentColor"/>`,
  meh: `<circle cx="12" cy="12" r="8.5"/>` + S('M8.5 15h7') + `<circle cx="9" cy="9.8" r=".7" fill="currentColor"/><circle cx="15" cy="9.8" r=".7" fill="currentColor"/>`,
  frown: `<circle cx="12" cy="12" r="8.5"/>` + S('M8.3 16.2c1-1.6 2.3-2.4 3.7-2.4s2.7.8 3.7 2.4') + `<circle cx="9" cy="9.8" r=".7" fill="currentColor"/><circle cx="15" cy="9.8" r=".7" fill="currentColor"/>`,
  broom: S('M19.5 4.5 12 12') + S('M12 12c-2.8-.8-5.8.4-7.5 3.5l4 4c3.1-1.7 4.3-4.7 3.5-7.5z') + S('M7 16.8l2.2 2.2'),
  droplet: S('M12 3.5s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z'),
  wallet: `<rect x="3.5" y="6" width="17" height="13.5" rx="2.5"/>` + S('M3.5 9.5h17M16 14.5h1.5') + S('M6 6l9.5-2.5 1 2.5'),
  building2: `<rect x="3.5" y="8" width="7" height="12.5" rx="1.5"/><rect x="10.5" y="3.5" width="10" height="17" rx="1.5"/>` + S('M14 8h3M14 11.5h3M14 15h3M6 12h2M6 15.5h2'),
  gift: `<rect x="4" y="9" width="16" height="11.5" rx="2"/>` + S('M3 9h18M12 9v11.5') + S('M12 9C10.5 5.5 7 5 7 7.2 7 9 12 9 12 9zM12 9c1.5-3.5 5-4 5-1.8C17 9 12 9 12 9z'),
  star: `<path fill="currentColor" stroke="none" d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 17.4l-5.8 3 1.1-6.4-4.7-4.6 6.5-.9z"/>`,
  starLine: S('M12 3.4l2.6 5.4 5.9.8-4.3 4.2 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.2 5.9-.8z'),
  pause: `<rect x="6.2" y="5" width="4.2" height="14" rx="1.3" fill="currentColor" stroke="none"/><rect x="13.6" y="5" width="4.2" height="14" rx="1.3" fill="currentColor" stroke="none"/>`,
  playFill: `<path fill="currentColor" stroke="none" d="M8 4.8c0-.8.9-1.3 1.6-.9l10 6.2c.7.4.7 1.4 0 1.8l-10 6.2c-.7.4-1.6-.1-1.6-.9z"/>`,
  dot: `<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>`,

  // ---- case icons (DESIGN 5.5). Scaled groups keep the 2.1 stroke weight of the set.
  caseRoutine: `<g transform="translate(.5 5) scale(.74)" stroke-width="2.84">${S(TOOTH)}</g>` + S('M18.5 1.8l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z'),
  caseCandy: `<circle cx="9" cy="16" r="3.9"/>` + S('M5.3 14.6 1.9 12.4v7.2l3.4-2.2M12.7 14.6l3.4-2.2v7.2l-3.4-2.2') + S('M7.6 18.6c.4-1.9 1.4-3.6 3-4.8')
    + `<circle cx="18.2" cy="7.4" r="2.7"/>` + S('M15.6 6l-1.5-.8M15.6 8.8l-1.5.8M20.8 6l1.5-.8M20.8 8.8l1.5.8M17.3 4.9l-.7-1.9M19.1 4.9l.7-1.9'),
  caseWhitening: `<g transform="translate(4.6 7.6) scale(.62)" stroke-width="3.39">${S(TOOTH)}</g>` + S('M12 1.8v2.4M5 4.3l1.6 1.6M19 4.3l-1.6 1.6M2.4 10.2h2.2M21.6 10.2h-2.2'),
  caseBraces: `<rect x="3.2" y="4.5" width="7.6" height="15" rx="3.4"/><rect x="13.2" y="4.5" width="7.6" height="15" rx="3.4"/>` + S('M1.8 12h20.4')
    + `<rect x="5.3" y="10" width="3.4" height="4" rx=".8" fill="currentColor"/><rect x="15.3" y="10" width="3.4" height="4" rx=".8" fill="currentColor"/>`,
  casePirate: S('M5 14.2C5 9 8.1 5 12 5s7 4 7 9.2') + S('M2.4 12.8c2.6 2.8 5.9 4.2 9.6 4.2s7-1.4 9.6-4.2') + `<circle cx="12" cy="10.6" r="2.1" fill="currentColor" stroke="none"/>` + S('M9.6 20.5h4.8M12 17v3.5'),
  caseDeep: S('M6.2 13.5V8.6c0-3 1.8-5 3.9-5 .8 0 1.3.4 1.9.4s1.1-.4 1.9-.4c2.1 0 3.9 2 3.9 5v4.9') + S('M2.5 15.5c1.6-1.5 3.2-1.5 4.8 0s3.2 1.5 4.8 0 3.2-1.5 4.8 0 3.2 1.5 4.8 0') + S('M2.5 20c1.6-1.5 3.2-1.5 4.8 0s3.2 1.5 4.8 0 3.2-1.5 4.8 0 3.2 1.5 4.8 0'),
  shade: `<rect x="3.5" y="4" width="5" height="16" rx="2.2"/><rect x="9.5" y="4" width="5" height="16" rx="2.2"/><rect x="15.5" y="4" width="5" height="16" rx="2.2" fill="currentColor"/>`,
  twist: S('M4 8.5c2.5-3 5.5-3 8 0s5.5 3 8 0') + S('M4 15.5c2.5-3 5.5-3 8 0s5.5 3 8 0'),

  // ---- manager layer (DESIGN 10): event art, focus, campaigns, perks
  clipboard: `<rect x="5" y="4.5" width="14" height="16.5" rx="2.2"/>` + S('M9 4.5V3h6v1.5') + S('M8.8 11.5l2 2 4.4-4.4M8.8 17h6.4'),
  box: S('M3.8 7.8 12 3.5l8.2 4.3v8.4L12 20.5l-8.2-4.3z') + S('M3.8 7.8 12 12l8.2-4.2M12 12v8.5') + S('M7.9 5.6l8.2 4.3'),
  cake: `<rect x="4" y="11.5" width="16" height="9" rx="2"/>` + S('M4 15.2c1.3 1.2 2.7 1.2 4 0s2.7-1.2 4 0 2.7 1.2 4 0 2.7-1.2 4 0') + S('M8 11.5V8.5M12 11.5V8.5M16 11.5V8.5') + S('M8 6.2c-.8-.8-.3-2 0-2.7.3.7.8 1.9 0 2.7zM12 6.2c-.8-.8-.3-2 0-2.7.3.7.8 1.9 0 2.7zM16 6.2c-.8-.8-.3-2 0-2.7.3.7.8 1.9 0 2.7z'),
  thermo: S('M10 13.8V5a2 2 0 0 1 4 0v8.8a4 4 0 1 1-4 0z') + S('M12 9v7.5') + `<circle cx="12" cy="17" r="1.4" fill="currentColor"/>`,
  camera: `<rect x="3" y="7" width="13" height="11" rx="2.4"/>` + S('M16 11l5-3v9l-5-3') + `<circle cx="7.5" cy="10.5" r="1.3" fill="currentColor" stroke="none"/>`,
  bus: `<rect x="4.5" y="3.5" width="15" height="14" rx="3"/>` + S('M4.5 11h15M8 17.5v2.5M16 17.5v2.5M8.5 7h7') + `<circle cx="8" cy="14.3" r="1" fill="currentColor"/><circle cx="16" cy="14.3" r="1" fill="currentColor"/>`,
  flag: S('M5.5 21V3.5') + S('M5.5 4.5c3-1.8 5.5 1.5 8.5 0s4.5-.5 5 0v8.5c-.5-.5-2-1.5-5 0s-5.5-1.8-8.5 0') + `<circle cx="12" cy="8.6" r="1.6"/>`,
  drop: S('M12 3.5s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z') + S('M9 15a3 3 0 0 0 3 3'),
  shop: S('M4 9.5 5.5 4h13L20 9.5') + S('M4 9.5c0 1.5 1.1 2.5 2.7 2.5s2.6-1 2.6-2.5c0 1.5 1.1 2.5 2.7 2.5s2.7-1 2.7-2.5c0 1.5 1 2.5 2.6 2.5S20 11 20 9.5') + S('M5.5 12v8.5h13V12M10 20.5v-5h4v5'),
  paw: `<ellipse cx="7" cy="10" rx="1.9" ry="2.4"/><ellipse cx="17" cy="10" rx="1.9" ry="2.4"/><ellipse cx="10" cy="5.8" rx="1.8" ry="2.3"/><ellipse cx="14" cy="5.8" rx="1.8" ry="2.3"/>` + S('M12 12.5c-2.8 0-5.2 3.4-5.2 5.4 0 2.2 2.4 2.1 5.2 1.5 2.8.6 5.2.7 5.2-1.5 0-2-2.4-5.4-5.2-5.4z'),
  tag: S('M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0z') + `<circle cx="8" cy="8" r="1.6"/>`,
  shield: S('M12 3.2 19.5 6v5.5c0 4.6-3.2 8-7.5 9.3-4.3-1.3-7.5-4.7-7.5-9.3V6z') + S('M8.8 12l2.3 2.3 4.3-4.6'),
  wand: S('M4 20 15 9') + S('M13.2 7.2l3.6 3.6') + S('M17.5 2.8l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM8 3.8l.5 1.2 1.2.5-1.2.5L8 7.2l-.5-1.2-1.2-.5 1.2-.5zM19.5 12.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z'),
  sun: `<circle cx="12" cy="12" r="4.2"/>` + S('M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6'),
  glasses: `<circle cx="6.8" cy="14" r="3.6"/><circle cx="17.2" cy="14" r="3.6"/>` + S('M10.4 13.4c1-.8 2.2-.8 3.2 0M3.2 13.2 4.8 7.5M20.8 13.2l-1.6-5.7'),
  mic: `<rect x="9" y="3" width="6" height="11" rx="3"/>` + S('M5.8 11a6.2 6.2 0 0 0 12.4 0M12 17.2v3.3M8.5 20.5h7'),
  coins: `<ellipse cx="9" cy="7" rx="5.5" ry="2.5"/>` + S('M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V7') + S('M9.5 15.3c.6 1.3 2.9 2.2 5.5 2.2 3 0 5.5-1.1 5.5-2.5v-4c0-1.2-1.8-2.2-4.3-2.4') + S('M9.5 15.3v3.2c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V15'),
  grad: S('M2.5 9.2 12 4.5l9.5 4.7L12 14z') + S('M6.5 11.2v4.6c3 2.4 8 2.4 11 0v-4.6M21.5 9.2v5.3'),
  balloon: S('M12 14.2c-3.2 0-5.5-2.9-5.5-6.1a5.5 5.5 0 0 1 11 0c0 3.2-2.3 6.1-5.5 6.1z') + S('M11 14.2h2l-.3 1.5h-1.4z') + S('M12 15.7c-1.3 1.6 1.3 2.6 0 4.8'),
  target: `<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>`,
  ribbon: S('M3.5 9.5h17') + S('M12 9.5c-1.8-3.5-6-4.4-6-2.2 0 1.8 3.4 2.2 6 2.2zM12 9.5c1.8-3.5 6-4.4 6-2.2 0 1.8-3.4 2.2-6 2.2z') + S('M12 9.5 8.5 16l1.7-.3.8 1.6zM12 9.5l3.5 6.5-1.7-.3-.8 1.6z') + S('M5 20.5h14'),
  question: `<circle cx="12" cy="12" r="8.5"/>` + S('M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.8-2.4 2.2-2.4 3.8') + `<circle cx="12" cy="16.9" r=".7" fill="currentColor"/>`,
  handshake: S('M2.5 11.5 6 8l3 1 3-2 3.5 1.5L21.5 11') + S('M6 8v7.5l4 3.5c.7.6 1.6.5 2.1-.2l.4-.5.4.3c.7.5 1.6.3 2-.4l.1-.2.3.1c.8.3 1.6-.2 1.7-1 .1-.6-.2-1.1-.6-1.4L12 12l-2 1.3') + S('M18 8.5v6.8'),
  lungs: S('M12 3.5v7.5M12 11c-1.2 1.4-3 2-3 2M12 11c1.2 1.4 3 2 3 2') + S('M8.8 7.5C6 7.5 4 11 3.5 15c-.4 3.2 1 5 3 5 2.3 0 3-1.6 3-4V9.2c0-.9-.2-1.7-.7-1.7zM15.2 7.5c2.8 0 4.8 3.5 5.3 7.5.4 3.2-1 5-3 5-2.3 0-3-1.6-3-4V9.2c0-.9.2-1.7.7-1.7z'),
};

export type IconName = keyof typeof PATHS;

export function iconSvg(name: string, extraAttrs = ''): string {
  const body = PATHS[name] ?? PATHS.dot;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extraAttrs}>${body}</svg>`;
}

export function icon(name: string, cls = ''): HTMLElement {
  return h('span', { class: ['icon', cls], html: iconSvg(name) });
}

/** The chunky gold coin used for cash. */
export function coinSvg(): string {
  return `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="17.5" r="12.5" fill="#E9AF38"/><circle cx="16" cy="15.5" r="12.5" fill="#FFD166"/><circle cx="16" cy="15.5" r="9" fill="none" stroke="#E9AF38" stroke-width="2"/><path d="M16 9.5v12M19.2 11.8c-.6-1-1.8-1.6-3.2-1.6-1.9 0-3.1 1-3.1 2.3 0 3.1 6.4 1.7 6.4 4.9 0 1.4-1.3 2.4-3.3 2.4-1.6 0-2.9-.7-3.4-1.9" fill="none" stroke="#B98217" stroke-width="2" stroke-linecap="round"/><ellipse cx="11.5" cy="9.5" rx="3" ry="1.6" fill="#fff" opacity=".55" transform="rotate(-30 11.5 9.5)"/></svg>`;
}
export function coin(cls = ''): HTMLElement {
  return h('span', { class: ['coin', cls], html: coinSvg() });
}

/** The brand tooth mark (logo, splash, empty states). */
export function toothMarkSvg(): string {
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 9C10 9 6 15 6 23c0 9 4 14 6 22 1.5 7 3.5 12 7.5 12 5 0 5-8 6.5-13 1-3 3-4.5 6-4.5s5 1.5 6 4.5c1.5 5 1.5 13 6.5 13 4 0 6-5 7.5-12 2-8 6-13 6-22 0-8-4-14-12-14-6 0-8.5 3.5-14 3.5S24 9 18 9z" fill="#FFFDF7" stroke="#16323A" stroke-width="3.4" stroke-linejoin="round"/><path d="M12.5 21c.8-4 3.4-6.4 7-6.4" fill="none" stroke="#BFEDE3" stroke-width="3.6" stroke-linecap="round"/><circle cx="24.5" cy="26" r="2.7" fill="#16323A"/><circle cx="39.5" cy="26" r="2.7" fill="#16323A"/><path d="M26.5 32c3 3.6 8 3.6 11 0" fill="none" stroke="#16323A" stroke-width="3" stroke-linecap="round"/><ellipse cx="19" cy="31.5" rx="3.2" ry="2" fill="#FF7AA8" opacity=".6"/><ellipse cx="45" cy="31.5" rx="3.2" ry="2" fill="#FF7AA8" opacity=".6"/><path d="M53 4.5l1.8 4 4 1.8-4 1.8-1.8 4-1.8-4-4-1.8 4-1.8z" fill="#FFD166" stroke="#16323A" stroke-width="2" stroke-linejoin="round"/></svg>`;
}
