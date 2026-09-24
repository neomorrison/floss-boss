// Tiny DOM builder. h('div.card.big', { onClick }, child, ...) -> HTMLElement.
// Props: class (string | record | array), style (string | record, '--vars' allowed), on<Event> handlers,
// html (innerHTML), and any other key becomes a property (if the element has it) or an attribute.

export type Child = Node | string | number | null | undefined | false | Child[];
export type ClassValue = string | null | undefined | false | Record<string, boolean | undefined> | ClassValue[];
export interface Props {
  class?: ClassValue;
  style?: string | Record<string, string | number | null | undefined>;
  html?: string;
  [key: string]: unknown;
}

function isProps(x: unknown): x is Props {
  return !!x && typeof x === 'object' && !(x instanceof Node) && !Array.isArray(x);
}

export function cx(...v: ClassValue[]): string {
  const out: string[] = [];
  const walk = (c: ClassValue) => {
    if (!c) return;
    if (typeof c === 'string') out.push(c);
    else if (Array.isArray(c)) c.forEach(walk);
    else for (const k of Object.keys(c)) if (c[k]) out.push(k);
  };
  v.forEach(walk);
  return out.join(' ');
}

export function append(el: Node, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, ...c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function h(sel: string, props?: Props | Child, ...children: Child[]): HTMLElement {
  let tag = 'div';
  const classes: string[] = [];
  let id = '';
  const m = sel.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (m) tag = m[0];
  const rest = sel.slice(m ? m[0].length : 0);
  rest.replace(/([.#])([^.#]+)/g, (_s, kind: string, name: string) => {
    if (kind === '.') classes.push(name);
    else id = name;
    return '';
  });
  const el = document.createElement(tag);
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  if (isProps(props)) applyProps(el, props);
  else if (props !== undefined) children.unshift(props as Child);
  append(el, ...children);
  return el;
}

function applyProps(el: HTMLElement, props: Props): void {
  for (const key of Object.keys(props)) {
    const v = props[key];
    if (v === undefined) continue;
    if (key === 'class') {
      const c = cx(v as ClassValue);
      if (c) el.className = el.className ? el.className + ' ' + c : c;
    } else if (key === 'style') {
      if (typeof v === 'string') el.style.cssText += v;
      else if (v && typeof v === 'object') {
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          if (val === null || val === undefined) continue;
          if (k.startsWith('--')) el.style.setProperty(k, String(val));
          else (el.style as unknown as Record<string, string>)[k] = String(val);
        }
      }
    } else if (key === 'html') {
      el.innerHTML = String(v);
    } else if (key.startsWith('on') && typeof v === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), v as EventListener);
    } else if (key.startsWith('data-') || key.startsWith('aria-') || key === 'role' || key === 'for') {
      if (v === false || v === null) continue;
      el.setAttribute(key, String(v));
    } else if (key in el) {
      (el as unknown as Record<string, unknown>)[key] = v;
    } else if (v === true) {
      el.setAttribute(key, '');
    } else if (v !== false && v !== null) {
      el.setAttribute(key, String(v));
    }
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function replace(el: Element, ...children: Child[]): void {
  clear(el);
  append(el, ...children);
}

/** Parse an SVG string into an element (for icons, charts). */
export function svgEl(markup: string): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as SVGSVGElement;
}

export function qs<T extends Element = HTMLElement>(root: ParentNode, sel: string): T | null {
  return root.querySelector(sel) as T | null;
}

/** Restart a CSS animation class on an element (bump, shake). */
export function replay(el: Element | null | undefined, cls: string): void {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
