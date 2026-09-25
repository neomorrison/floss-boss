// Shared materials, colors and procedural canvas textures for the clinic diorama.
// Everything is cached at module level so every clinic view (and every rebuild) reuses the same GPU
// resources: one material per color, one texture per floor style.
import * as THREE from 'three';

export const C = {
  mint: '#3DD6B5', teal: '#0E8F8A', bubblegum: '#FF7AA8', sunshine: '#FFD166', enamel: '#FFFDF7', ink: '#16323A',
  wall: '#FFF7EC', wainscot: '#D4F2E9', cap: '#2A9C93', wood: '#E7C08F', woodDark: '#C9955E',
  tileA: '#F3FBF8', tileB: '#E2F4EE', grout: '#CFE6DF', staffA: '#EEF2F7', staffB: '#E1E8F0',
  sidewalk: '#E4DED3', curb: '#CFC7B8', asphalt: '#6E7B83', base: '#F6EBDC', baseSide: '#E3CFB4',
  glass: '#BFE9F5', coral: '#FF8F70', lilac: '#B79CF0', sky: '#8FD3FF', leaf: '#5CC98A', leafDark: '#3FA86E',
  pot: '#F08A5D', white: '#FFFFFF', steel: '#C9D3DA', dark: '#3A4A52',
};

const matCache = new Map<string, THREE.MeshStandardMaterial>();

/** A shared standard material. Never dispose these: they live for the whole session. */
export function mat(color: string, rough = 0.78, metal = 0, emissive?: string, emissiveIntensity = 0.6): THREE.MeshStandardMaterial {
  const key = `${color}|${rough}|${metal}|${emissive ?? ''}|${emissiveIntensity}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = emissiveIntensity; }
    matCache.set(key, m);
  }
  return m;
}

const special = new Map<string, THREE.Material>();
function once<T extends THREE.Material>(key: string, make: () => T): T {
  let m = special.get(key) as T | undefined;
  if (!m) { m = make(); special.set(key, m); }
  return m;
}

export const glassMat = () => once('glass', () => new THREE.MeshStandardMaterial({
  color: C.glass, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false,
}));
export const waterMat = () => once('water', () => new THREE.MeshStandardMaterial({
  color: '#7FD8F0', roughness: 0.1, transparent: true, opacity: 0.55, depthWrite: false,
}));
export const hitMat = () => once('hit', () => new THREE.MeshBasicMaterial({ visible: false }));
export const ghostMat = () => once('ghost', () => new THREE.MeshBasicMaterial({
  color: C.teal, transparent: true, opacity: 0.1, depthWrite: false,
}));
export const shadowBlobMat = () => once('blob', () => new THREE.MeshBasicMaterial({
  map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.32,
}));

// ------------------------------------------------------------------ canvas textures

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

const texCache = new Map<string, THREE.Texture>();
function cachedTex(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = texCache.get(key);
  if (!t) { t = make(); texCache.set(key, t); }
  return t;
}

function finish(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Checker tile floor. One texture tile = 2 x 2 floor tiles = 1.2 m. */
export function tileTexture(a: string, b: string, grout: string): THREE.Texture {
  return cachedTex(`tile|${a}|${b}`, () => {
    const [c, g] = canvas(256, 256);
    const s = 128;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      g.fillStyle = (i + j) % 2 ? b : a;
      g.fillRect(i * s, j * s, s, s);
      // soft sheen in the corner of each tile
      const gr = g.createLinearGradient(i * s, j * s, i * s + s, j * s + s);
      gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(i * s, j * s, s, s);
    }
    g.strokeStyle = grout; g.lineWidth = 4;
    for (let k = 0; k <= 2; k++) {
      g.beginPath(); g.moveTo(k * s, 0); g.lineTo(k * s, 256); g.stroke();
      g.beginPath(); g.moveTo(0, k * s); g.lineTo(256, k * s); g.stroke();
    }
    return finish(c);
  });
}

/** Warm wood planks. One texture tile = 1.6 m. */
export function woodTexture(): THREE.Texture {
  return cachedTex('wood', () => {
    const [c, g] = canvas(256, 256);
    const rows = 8; const h = 256 / rows;
    for (let r = 0; r < rows; r++) {
      const shade = [0, 6, -4, 3, -6, 5, -2, 4][r];
      g.fillStyle = shadeHex(C.wood, shade); g.fillRect(0, r * h, 256, h);
      // grain
      g.strokeStyle = 'rgba(160,110,60,0.13)'; g.lineWidth = 1.5;
      for (let k = 0; k < 3; k++) {
        const y = r * h + 6 + k * 9;
        g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x * 0.05 + r * 2 + k) * 1.5);
        g.stroke();
      }
      // plank seams
      g.fillStyle = 'rgba(140,90,45,0.35)'; g.fillRect(0, r * h + h - 2, 256, 2);
      const off = (r * 97) % 256;
      g.fillRect(off, r * h, 2, h);
      g.fillRect((off + 128) % 256, r * h, 2, h);
    }
    return finish(c);
  });
}

/** Sidewalk slabs. One tile = 1.5 m. */
export function concreteTexture(): THREE.Texture {
  return cachedTex('concrete', () => {
    const [c, g] = canvas(128, 128);
    g.fillStyle = C.sidewalk; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(${150 + (i * 37) % 60},${140 + (i * 53) % 50},${120 + (i * 29) % 40},0.12)`;
      g.fillRect((i * 71) % 128, (i * 43) % 128, 2, 2);
    }
    g.strokeStyle = '#CFC7B8'; g.lineWidth = 3;
    g.strokeRect(0, 0, 128, 128);
    return finish(c);
  });
}

/** Street with a dashed center line (U along the street). One tile = 4 m of street. */
export function streetTexture(): THREE.Texture {
  return cachedTex('street', () => {
    const [c, g] = canvas(256, 128);
    g.fillStyle = C.asphalt; g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 200; i++) {
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
      g.fillRect((i * 67) % 256, (i * 41) % 128, 3, 2);
    }
    g.fillStyle = '#FFE08A';
    g.fillRect(20, 60, 100, 8);
    g.fillRect(148, 60, 100, 8);
    return finish(c);
  });
}

/** Soft round shadow blob (people cast these even when shadows are off). */
export function blobTexture(): THREE.Texture {
  return cachedTex('blob', () => {
    const [c, g] = canvas(64, 64);
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(30,50,60,0.9)'); gr.addColorStop(0.6, 'rgba(30,50,60,0.45)'); gr.addColorStop(1, 'rgba(30,50,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return finish(c, false);
  });
}

/** Vertical background gradient for the scene. */
export function backgroundTexture(top: string, bottom: string): THREE.Texture {
  const [c, g] = canvas(4, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  return finish(c, false);
}

/** Rounded dashed outline used for empty operatory slots and the selection glow. */
export function outlineTexture(color: string, dashed: boolean): THREE.Texture {
  return cachedTex(`outline|${color}|${dashed}`, () => {
    const [c, g] = canvas(256, 256);
    if (!dashed) {
      // soft glow under a crisp line
      g.strokeStyle = color; g.globalAlpha = 0.25; g.lineWidth = 22;
      roundRect(g, 14, 14, 228, 228, 32); g.stroke();
      g.globalAlpha = 1;
    }
    g.strokeStyle = color; g.lineWidth = dashed ? 7 : 9; g.lineCap = 'round';
    if (dashed) g.setLineDash([18, 16]);
    roundRect(g, 14, 14, 228, 228, 32); g.stroke();
    return finish(c, false);
  });
}

/** Floor number painted in front of each operatory. */
export function numberTexture(n: number): THREE.Texture {
  return cachedTex(`num|${n}`, () => {
    const [c, g] = canvas(128, 128);
    g.fillStyle = 'rgba(14,143,138,0.85)';
    g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#FFFFFF';
    g.font = `800 76px "Baloo 2", "Nunito", system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), 64, 70);
    return finish(c, false);
  });
}

/** Street billboard showing the city-wide Smile Index (DESIGN 11.1), shown once it reaches 50%. */
export function billboardTexture(pct: number): THREE.Texture {
  return cachedTex(`billboard|${pct}`, () => {
    const [c, g] = canvas(512, 256);
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, C.sunshine); gr.addColorStop(1, C.bubblegum);
    g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(255,255,255,0.94)';
    roundRect(g, 20, 20, 472, 216, 28); g.fill();
    g.fillStyle = C.ink;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 118px "Baloo 2", "Nunito", system-ui, sans-serif`;
    g.fillText(`${pct}%`, 256, 118);
    g.font = `800 34px "Baloo 2", "Nunito", system-ui, sans-serif`;
    g.fillStyle = C.teal;
    g.fillText('SMILE CITY', 256, 196);
    return finish(c, false);
  });
}

/** Storefront sign panel with the clinic name. Not cached (names change); caller disposes. */
export function signTexture(name: string): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 256);
  const draw = () => {
    g.clearRect(0, 0, 1024, 256);
    g.fillStyle = C.teal; roundRect(g, 0, 0, 1024, 256, 60); g.fill();
    g.fillStyle = C.mint; roundRect(g, 14, 14, 996, 228, 50); g.fill();
    g.fillStyle = '#FFFFFF'; roundRect(g, 28, 28, 968, 200, 40); g.fill();
    // tooth logo
    drawTooth(g, 128, 128, 74);
    g.fillStyle = C.ink;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    let size = 104;
    const maxW = 740;
    do {
      g.font = `800 ${size}px "Baloo 2", "Nunito", system-ui, sans-serif`;
      if (g.measureText(name).width <= maxW) break;
      size -= 4;
    } while (size > 40);
    g.fillText(name, 222, 138);
    t.needsUpdate = true;
  };
  const t = finish(c, false);
  draw();
  if (typeof document !== 'undefined' && (document as any).fonts?.load) {
    (document as any).fonts.load('800 80px "Baloo 2"').then(draw).catch(() => {});
  }
  return t;
}

export function drawTooth(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = C.mint;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#FFFFFF';
  const s = r / 60;
  g.beginPath();
  g.moveTo(-30 * s, -30 * s);
  g.bezierCurveTo(-44 * s, -44 * s, -18 * s, -48 * s, 0, -36 * s);
  g.bezierCurveTo(18 * s, -48 * s, 44 * s, -44 * s, 30 * s, -30 * s);
  g.bezierCurveTo(40 * s, -10 * s, 30 * s, 12 * s, 24 * s, 36 * s);
  g.bezierCurveTo(20 * s, 50 * s, 10 * s, 46 * s, 7 * s, 30 * s);
  g.bezierCurveTo(4 * s, 16 * s, -4 * s, 16 * s, -7 * s, 30 * s);
  g.bezierCurveTo(-10 * s, 46 * s, -20 * s, 50 * s, -24 * s, 36 * s);
  g.bezierCurveTo(-30 * s, 12 * s, -40 * s, -10 * s, -30 * s, -30 * s);
  g.fill();
  g.fillStyle = C.sunshine;
  star(g, 26 * s, -34 * s, 11 * s);
  g.restore();
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rr = i % 2 ? r * 0.38 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function shadeHex(hex: string, pct: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)));
  const r = f((n >> 16) & 255), gg = f((n >> 8) & 255), b = f(n & 255);
  return '#' + ((r << 16) | (gg << 8) | b).toString(16).padStart(6, '0');
}

/** Deterministic hash of a string id into [0, 1). */
export function hash01(id: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function pickBy<T>(arr: readonly T[], id: string, salt: number): T {
  return arr[Math.floor(hash01(id, salt) * arr.length) % arr.length];
}
