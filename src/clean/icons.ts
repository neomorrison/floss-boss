// Inline SVG icons for the clean HUD (24 x 24, stroke = currentColor).
import type { SlotId } from './slots';

const svg = (body: string, fill = false) =>
  `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const TOOL_ICONS: Record<SlotId, string> = {
  scaler: svg('<path d="M4 21l8.5-8.5"/><path d="M12.5 12.5c1.6-1.6 2.6-3.3 3.3-5.1.5-1.3 1.5-2.6 2.8-3.1.9-.3 1.7.5 1.3 1.4-.6 1.2-1.8 1.6-2.9 1.3"/><path d="M6.5 18.5l-1.5-1.5"/><path d="M8.5 16.5l-1.5-1.5"/>'),
  polisher: svg('<path d="M3 21l7-7"/><path d="M10 14l2.5-2.5"/><circle cx="15.5" cy="8.5" r="4"/><path d="M13.5 8.5a2 2 0 0 1 4 0"/>'),
  floss: svg('<path d="M6 3v7c0 1.5 1 2.5 2 2.5"/><path d="M18 3v7c0 1.5-1 2.5-2 2.5"/><path d="M8 12.5h8"/><path d="M12 12.5V21"/>'),
  suction: svg('<path d="M5 21c0-6 2-9 6-11 3-1.5 4-3.5 4-6"/><path d="M15 4h4"/><circle cx="9" cy="17" r="1" fill="currentColor"/><circle cx="12" cy="14.5" r=".8" fill="currentColor"/>'),
  rinse: svg('<path d="M4 20l6-6"/><rect x="9" y="6" width="5" height="9" rx="1.5" transform="rotate(45 11.5 10.5)"/><path d="M16 5l1.5-1.5"/><path d="M19 8.5h2.5"/><path d="M19 4.5l1.8-1.8"/><path d="M15.5 2.5V1"/>'),
  gel: svg('<path d="M4 20l8-8"/><path d="M12 12l2.5-2.5"/><path d="M14.5 9.5c1-2.5 3-4.5 5.5-5.5-1 2.5-3 4.5-5.5 5.5z" fill="currentColor"/><path d="M6.5 17.5l-1.5-1.5"/>'),
  lamp: svg('<path d="M4 20l6-6"/><rect x="9" y="7" width="6" height="7" rx="1.5" transform="rotate(45 12 10.5)"/><path d="M17 3.5l-.8 2"/><path d="M20.5 7l-2 .8"/><path d="M20.5 3.5l-1.8 1.8"/>'),
};

export const ICONS = {
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  heartFill: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>', true),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  drop: svg('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
  clock: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9.5 2.5h5"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>', true),
  eye: svg('<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  skip: svg('<path d="M6 5l7 7-7 7"/><path d="M14 5l7 7-7 7"/>'),
};
