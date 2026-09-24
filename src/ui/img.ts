// Image swap-in helper: known-good URLs appear instantly (no fade) so re-rendered panels never flicker,
// and fallbacks are drawn only once a URL is known to be missing (no "different face" swap on load).
import { probeImage } from '../core/assets';
import { h } from './dom';

const good = new Set<string>();
const bad = new Set<string>();

/**
 * Append <img src=url> to `el` once it is known to load; call `onMissing` if it does not.
 * Returns true if the image was added synchronously.
 */
export function swapInImage(el: HTMLElement, url: string, readyClass = 'has-img', onMissing?: () => void): boolean {
  const add = (instant: boolean) => {
    const img = h('img', { src: url, alt: '', draggable: false, class: instant ? 'is-ready' : '' });
    el.appendChild(img);
    if (readyClass) el.classList.add(readyClass);
    if (!instant) requestAnimationFrame(() => img.classList.add('is-ready'));
  };
  if (good.has(url)) { add(true); return true; }
  if (bad.has(url)) { onMissing?.(); return false; }
  probeImage(url).then((ok) => {
    if (ok) { good.add(url); add(false); }
    else { bad.add(url); onMissing?.(); }
  });
  return false;
}
