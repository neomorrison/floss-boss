// The "Floss Boss" wordmark: CSS lettering with the tooth mark, swapped for LOGO_URL art when it exists.
import { probeImage } from './img';
import { LOGO_URL } from '../data/assets';
import { h } from './dom';
import { toothMarkSvg } from './icons';

export function logo(size: 'lg' | 'md' | 'sm' = 'lg'): HTMLElement {
  const el = h('div.logo', { class: `logo-${size}`, role: 'img', 'aria-label': 'Floss Boss' },
    h('div.logo-mark', { html: toothMarkSvg() }),
    h('div.logo-word', h('span.logo-floss', 'Floss'), h('span.logo-boss', 'Boss')),
  );
  if (size === 'lg') {
    probeImage(LOGO_URL).then((ok) => {
      if (!ok) return;
      const img = h('img.logo-img', { src: LOGO_URL, alt: 'Floss Boss', draggable: false });
      el.replaceChildren(img);
      el.classList.add('has-img');
    });
  }
  return el;
}
