// Draw-call reduction.
// batchStatic: merges every static opaque mesh under a root into one mesh per material look, in the
//   root's space. The office shell and the operatories go from ~1,500 meshes to a few dozen.
// bakePart: turns a GLB rig part (several primitives, one per material) into a single vertex-colored
//   mesh, so a person costs six draw calls whatever the art uses.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const lookCache = new Map<string, THREE.Material>();

function colorKey(c: THREE.Color | undefined): string { return c ? c.getHexString() : '-'; }

/** Materials that look the same share one instance (GLBs each bring their own copies of Mint, Enamel...). */
function lookKey(m: THREE.Material): string | null {
  const s = m as THREE.MeshStandardMaterial;
  if (!(s as any).isMeshStandardMaterial && !(m as any).isMeshBasicMaterial && !(m as any).isMeshLambertMaterial) return null;
  return [m.type, colorKey(s.color), s.roughness ?? '', s.metalness ?? '', colorKey(s.emissive), s.emissiveIntensity ?? '',
    s.map?.uuid ?? '', s.vertexColors ? 1 : 0, m.side, s.flatShading ? 1 : 0, s.normalMap?.uuid ?? ''].join('|');
}

function sharedLook(m: THREE.Material): THREE.Material {
  const k = lookKey(m);
  if (!k) return m;
  let v = lookCache.get(k);
  if (!v) { v = m; lookCache.set(k, v); }
  return v;
}

function attrSig(g: THREE.BufferGeometry): string {
  const names = Object.keys(g.attributes).filter((n) => n === 'position' || n === 'normal' || n === 'uv' || n === 'color').sort();
  return names.map((n) => n + g.getAttribute(n).itemSize).join(',');
}

const tmpM = new THREE.Matrix4();
const inv = new THREE.Matrix4();

/**
 * Merge static meshes under `root`. Meshes with transparent or invisible materials, skinned meshes,
 * multi-material meshes and anything under an object with userData.noBatch stay as they are.
 * The merged meshes are added to `root`; the originals are removed. Returns the merged meshes
 * (their geometry is owned: dispose it when the root is rebuilt).
 */
export function batchStatic(root: THREE.Object3D): THREE.Mesh[] {
  root.updateMatrixWorld(true);
  inv.copy(root.matrixWorld).invert();
  const groups = new Map<string, { mat: THREE.Material; items: THREE.Mesh[]; cast: boolean; recv: boolean }>();
  const skip = new Set<THREE.Object3D>();
  root.traverse((o) => { if (o.userData.noBatch) o.traverse((c) => skip.add(c)); });
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || skip.has(m) || (m as any).isSkinnedMesh || (m as any).isInstancedMesh) return;
    if (Array.isArray(m.material)) return;
    const mat = m.material as THREE.Material;
    if (!mat || mat.transparent || mat.visible === false || m.userData.hit) return;
    if (!m.geometry.getAttribute('position') || !m.geometry.getAttribute('normal')) return;
    const look = sharedLook(mat);
    const key = look.uuid + '#' + attrSig(m.geometry) + '#' + (m.geometry.index ? 'i' : 'n');
    let g = groups.get(key);
    if (!g) { g = { mat: look, items: [], cast: false, recv: false }; groups.set(key, g); }
    g.items.push(m);
    g.cast ||= m.castShadow; g.recv ||= m.receiveShadow;
  });
  const out: THREE.Mesh[] = [];
  for (const g of groups.values()) {
    if (g.items.length < 2) continue;
    const geos: THREE.BufferGeometry[] = [];
    for (const m of g.items) {
      const src = m.geometry;
      const c = new THREE.BufferGeometry();
      for (const n of ['position', 'normal', 'uv', 'color']) { const a = src.getAttribute(n); if (a) c.setAttribute(n, a.clone()); }
      if (src.index) c.setIndex(src.index.clone());
      tmpM.multiplyMatrices(inv, m.matrixWorld);
      c.applyMatrix4(tmpM);
      geos.push(c);
    }
    const merged = mergeGeometries(geos, false);
    for (const x of geos) x.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, g.mat);
    mesh.castShadow = g.cast; mesh.receiveShadow = g.recv;
    mesh.userData.ownGeo = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'batched';
    for (const m of g.items) m.removeFromParent();
    root.add(mesh);
    out.push(mesh);
  }
  // drop groups that became empty
  const empties: THREE.Object3D[] = [];
  root.traverse((o) => { if (o !== root && !(o as THREE.Mesh).isMesh && o.children.length === 0 && !o.userData.keep) empties.push(o); });
  for (const e of empties) e.removeFromParent();
  return out;
}

// ------------------------------------------------------------------ people

let bakedMat: THREE.MeshStandardMaterial | null = null;
export function bakedPersonMaterial(): THREE.MeshStandardMaterial {
  if (!bakedMat) bakedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0 });
  return bakedMat;
}

const lin = new THREE.Color();
/**
 * Replace the meshes directly attached to a rig part (not its child parts) by one vertex-colored mesh.
 * `colorFor(material)` returns the (working, linear) color to bake for each source material and
 * `slotFor(material)` an optional tint slot written to a "tint" attribute (0 = keep the color).
 * Returns the new mesh (owned geometry) or null when the part has nothing to bake.
 */
export function bakePart(part: THREE.Object3D, colorFor: (m: THREE.Material) => THREE.Color, slotFor?: (m: THREE.Material) => number): THREE.Mesh | null {
  part.updateMatrixWorld(true);
  inv.copy(part.matrixWorld).invert();
  const meshes: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (c.userData.rigPart) continue;          // another rig part (arm under body): baked separately
      if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh);
      visit(c);
    }
  };
  if ((part as THREE.Mesh).isMesh) meshes.push(part as THREE.Mesh);
  visit(part);
  if (!meshes.length) return null;
  const geos: THREE.BufferGeometry[] = [];
  for (const m of meshes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const src = m.geometry;
    const base = src.index ? src.toNonIndexed() : src.clone();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', base.getAttribute('position'));
    if (base.getAttribute('normal')) g.setAttribute('normal', base.getAttribute('normal'));
    else { g.computeVertexNormals(); }
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const tint = new Float32Array(n);
    const groupsList = src.groups.length && Array.isArray(m.material) ? src.groups : [{ start: 0, count: src.index ? src.index.count : n, materialIndex: 0 }];
    for (const gr of groupsList) {
      const mm = mats[gr.materialIndex ?? 0] ?? mats[0];
      lin.copy(colorFor(mm));
      const slot = slotFor ? slotFor(mm) : 0;
      for (let i = gr.start; i < Math.min(n, gr.start + gr.count); i++) { col[i * 3] = lin.r; col[i * 3 + 1] = lin.g; col[i * 3 + 2] = lin.b; tint[i] = slot; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('tint', new THREE.BufferAttribute(tint, 1));
    tmpM.multiplyMatrices(inv, m.matrixWorld);
    g.applyMatrix4(tmpM);
    geos.push(g);
    base.dispose();
  }
  const merged = mergeGeometries(geos, false);
  for (const x of geos) x.dispose();
  if (!merged) return null;
  merged.computeBoundingSphere();
  // remove the old meshes (keep child rig parts)
  for (const m of meshes) {
    if (m === part) continue;
    m.removeFromParent();
  }
  const mesh = new THREE.Mesh(merged, bakedPersonMaterial());
  mesh.castShadow = true;
  mesh.userData.ownGeo = true;
  if ((part as THREE.Mesh).isMesh) {
    // the part itself was a mesh: hide its own draw, keep it as the pivot
    (part as THREE.Mesh).geometry = EMPTY;
  }
  part.add(mesh);
  return mesh;
}

const EMPTY = new THREE.BufferGeometry();
