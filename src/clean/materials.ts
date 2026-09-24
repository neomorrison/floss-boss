// Materials for the clean scene. The tooth material is a MeshPhysicalMaterial patched with
// onBeforeCompile: it samples a per-tooth RGBA dirt texture (R plaque, G stain, B polish) using
// cylindrical coordinates computed per fragment from the object-space position, so there is no UV
// seam and no reliance on the model's own UVs.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DIRT_GU, DIRT_GV } from '../core/constants';

/** Uniforms shared by every tooth (one object, referenced by all materials). */
export interface SharedToothUniforms {
  uTime: { value: number };
  uDisclose: { value: number };     // 0..1 plaque tinted magenta
  uEagle: { value: number };        // 0..1 dirt outline pulse
  uPlaqueBoost: { value: number };  // headlamp: plaque easier to see
  uBrush: { value: THREE.Vector4 }; // loupes: world pos + radius (w <= 0 off)
  uPlaqueA: { value: THREE.Color }; uPlaqueB: { value: THREE.Color };
  uStainA: { value: THREE.Color }; uStainB: { value: THREE.Color };
  uDiscloseCol: { value: THREE.Color };
  uEagleCol: { value: THREE.Color };
}

export function makeSharedToothUniforms(): SharedToothUniforms {
  return {
    uTime: { value: 0 }, uDisclose: { value: 0 }, uEagle: { value: 0 }, uPlaqueBoost: { value: 0 },
    uBrush: { value: new THREE.Vector4(0, 0, 0, 0) },
    uPlaqueA: { value: new THREE.Color('#F1D56A') }, uPlaqueB: { value: new THREE.Color('#DDB744') },
    uStainA: { value: new THREE.Color('#8A5A2B') }, uStainB: { value: new THREE.Color('#6A4019') },
    uDiscloseCol: { value: new THREE.Color('#F0339A') },
    uEagleCol: { value: new THREE.Color('#FF5FB0') },
  };
}

export interface ToothMat {
  material: THREE.MeshPhysicalMaterial;
  texture: THREE.DataTexture;     // R plaque, G stain, B polish, A prophy paste
  data: Uint8Array;
  caseTex: THREE.DataTexture;     // R gel / sealant
  caseData: Uint8Array;
  highlight: { value: number };   // 0..1 tutorial / focus pulse
  flash: { value: number };       // 0..1 white flash when the tooth snaps
  wet: { value: number };         // 0..1 extra shine right after rinsing (the reveal wave)
  shade: { value: number };       // 0 (shade 1, brightest) .. 1 (shade 16)
  gold: { value: number };        // 1 = gold crown (pirate)
  lamp: { value: number };        // 0..1 UV lamp glow on this tooth
  gelCol: { value: THREE.Color }; // whitening gel or sealant colour
}

const GLSL_NOISE = /* glsl */`
float fbHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fbNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fbHash(i), fbHash(i + vec3(1,0,0)), f.x), mix(fbHash(i + vec3(0,1,0)), fbHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fbHash(i + vec3(0,0,1)), fbHash(i + vec3(1,0,1)), f.x), mix(fbHash(i + vec3(0,1,1)), fbHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

function dataTex(data: Uint8Array): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, DIRT_GU, DIRT_GV, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function makeToothMaterial(height: number, shared: SharedToothUniforms, tipBlue: number): ToothMat {
  const data = new Uint8Array(DIRT_GU * DIRT_GV * 4);
  const texture = dataTex(data);
  const caseData = new Uint8Array(DIRT_GU * DIRT_GV * 4);
  const caseTex = dataTex(caseData);

  const material = new THREE.MeshPhysicalMaterial({
    color: '#FFFCF3', roughness: 0.26, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.1,
    envMapIntensity: 1.0, sheen: 0,
  });
  const highlight = { value: 0 };
  const flash = { value: 0 };
  const wet = { value: 0 };
  const shade = { value: 0.2 };
  const gold = { value: 0 };
  const lamp = { value: 0 };
  const gelCol = { value: new THREE.Color('#8FE3FF') };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, {
      uDirt: { value: texture }, uCase: { value: caseTex }, uH: { value: height }, uTipBlue: { value: tipBlue },
      uHighlight: highlight, uFlash: flash, uWet: wet, uShade: shade, uGold: gold, uLamp: lamp, uGelCol: gelCol,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFbLocal;\nvarying vec3 vFbWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFbLocal = position;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFbWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFbLocal;
varying vec3 vFbWorld;
uniform sampler2D uDirt;
uniform sampler2D uCase;
uniform float uH, uTime, uDisclose, uEagle, uPlaqueBoost, uTipBlue, uHighlight, uFlash, uWet, uShade, uGold, uLamp;
uniform vec4 uBrush;
uniform vec3 uPlaqueA, uPlaqueB, uStainA, uStainB, uDiscloseCol, uEagleCol, uGelCol;
float fbPlaque = 0.0; float fbStain = 0.0; float fbPolish = 0.0; float fbEdge = 0.0; float fbPaste = 0.0; float fbGel = 0.0; float fbV = 0.0;
${GLSL_NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  float fu = atan(vFbLocal.x, vFbLocal.z) * 0.15915494 + 0.5;
  float fv = clamp(vFbLocal.y / uH, 0.0, 1.0);
  // soft 5-tap sample hides the 32 x 24 grid, noise breaks the edges up
  vec2 tx = vec2(1.0 / ${DIRT_GU}.0, 1.0 / ${DIRT_GV}.0) * 0.6;
  vec4 d = texture2D(uDirt, vec2(fu, fv)) * 0.4
         + texture2D(uDirt, vec2(fu + tx.x, fv)) * 0.15 + texture2D(uDirt, vec2(fu - tx.x, fv)) * 0.15
         + texture2D(uDirt, vec2(fu, fv + tx.y)) * 0.15 + texture2D(uDirt, vec2(fu, fv - tx.y)) * 0.15;
  float n1 = fbNoise(vFbLocal * 16.0) * 0.7 + fbNoise(vFbLocal * 41.0) * 0.3;
  float n2 = fbNoise(vFbLocal * 38.0 + 7.0) * 0.7 + fbNoise(vFbLocal * 9.0 + 3.0) * 0.3;
  vec3 enamel = diffuseColor.rgb;
  enamel *= mix(vec3(0.93, 0.86, 0.74), vec3(1.0), smoothstep(-0.05, 0.4, fv));          // warmer at the neck
  enamel = mix(enamel, enamel * vec3(0.9, 0.96, 1.06), smoothstep(0.78, 1.0, fv) * uTipBlue); // translucent edge
  enamel = mix(enamel, enamel * vec3(0.9, 0.77, 0.55), uShade);                           // shade guide tint
  // gold crown: dull and brownish until buffed, then bright
  vec3 goldCol = mix(vec3(0.74, 0.58, 0.28), vec3(1.0, 0.8, 0.3), smoothstep(0.0, 0.9, d.b));
  enamel = mix(enamel, goldCol * (0.92 + 0.16 * fbNoise(vFbLocal * 22.0)), uGold);
  float pRaw = d.r + (n1 - 0.5) * 0.42;
  float pm = smoothstep(0.2, 0.44, pRaw);
  float sm = smoothstep(0.2, 0.44, d.g + (n2 - 0.5) * 0.4);
  vec3 plaqueCol = mix(uPlaqueA, uPlaqueB, n2 * 0.8 + uPlaqueBoost * 0.3);
  plaqueCol = mix(plaqueCol, uDiscloseCol * (0.8 + 0.3 * n2), uDisclose);
  vec3 stainCol = mix(uStainA, uStainB, n1);
  vec3 col = mix(enamel, stainCol, sm * 0.94);
  col = mix(col, plaqueCol, pm);
  fbEdge = pm * (1.0 - pm) * 4.0;
  col *= 1.0 - 0.3 * fbEdge;                           // fuzzy rim reads as thickness
  col *= 1.0 - 0.08 * pm * smoothstep(0.55, 0.9, n1);  // speckle
  // gritty pink prophy paste (only rinse removes it)
  float pa = smoothstep(0.12, 0.5, d.a + (n1 - 0.5) * 0.35);
  vec3 pasteCol = mix(vec3(0.95, 0.46, 0.62), vec3(0.88, 0.36, 0.54), smoothstep(0.35, 0.8, n2));
  float grit = smoothstep(0.62, 0.9, fbNoise(vFbLocal * 80.0));
  pasteCol = mix(pasteCol, vec3(1.0, 0.86, 0.9), grit * 0.7);
  col = mix(col, pasteCol, pa * 0.92);
  // whitening gel / sealant: a glossy coat
  vec4 cs = texture2D(uCase, vec2(fu, fv));
  float gl = smoothstep(0.15, 0.55, cs.r + (n2 - 0.5) * 0.2);
  col = mix(col, uGelCol, gl * 0.5);
  diffuseColor.rgb = col;
  fbPlaque = pm; fbStain = sm; fbPolish = d.b * (1.0 - pm) * (1.0 - sm) * (1.0 - pa); fbPaste = pa; fbGel = gl; fbV = fv;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.72, fbPlaque);
roughnessFactor = mix(roughnessFactor, 0.5, fbStain * 0.6);
roughnessFactor = mix(roughnessFactor, 0.06, max(fbPolish, uWet * 0.6));
roughnessFactor = mix(roughnessFactor, 0.85, fbPaste);
roughnessFactor = mix(roughnessFactor, 0.04, fbGel);
roughnessFactor = mix(roughnessFactor, mix(0.55, 0.12, fbPolish), uGold);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.9, uGold);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
material.clearcoat *= (1.0 - 0.85 * fbPlaque) * (1.0 - 0.5 * fbStain) * (1.0 - 0.8 * fbPaste);
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float tw = fbNoise(vFbLocal * 46.0 + vec3(0.0, uTime * 2.1, uTime * 1.3));
  float sparkle = pow(tw, 16.0) * 9.0 * fbPolish * (1.0 + 1.5 * uGold);
  totalEmissiveRadiance += vec3(1.0, 0.97, 0.88) * sparkle;
  totalEmissiveRadiance += vec3(1.0, 0.99, 0.95) * fbPolish * 0.05;
  float dirt = max(fbPlaque, fbStain);
  float rim = max(fbEdge, fbStain * (1.0 - fbStain) * 4.0);
  totalEmissiveRadiance += uEagleCol * (rim * 0.9 + dirt * 0.25) * uEagle;
  if (uBrush.w > 0.0) {
    float bd = distance(vFbWorld, uBrush.xyz);
    float ring = 1.0 - smoothstep(uBrush.w * 0.6, uBrush.w * 1.8, bd);
    totalEmissiveRadiance += uEagleCol * rim * ring * 0.55;
  }
  totalEmissiveRadiance += vec3(0.3, 0.95, 0.82) * uHighlight * (0.18 + 0.12 * sin(uTime * 6.0));
  totalEmissiveRadiance += vec3(1.0, 0.98, 0.9) * uFlash * 0.9;
  // the rinse reveal: a bright band sweeping up a freshly washed tooth
  float wave = smoothstep(0.18, 0.0, abs(fbV - (1.15 - uWet * 1.3))) * step(0.02, uWet);
  totalEmissiveRadiance += vec3(1.0, 1.0, 0.96) * wave * (0.25 + 0.6 * fbPolish);
  totalEmissiveRadiance += vec3(0.45, 0.35, 1.0) * uLamp * (0.25 + 0.5 * fbGel);
}`);
  };
  material.customProgramCacheKey = () => 'fbTooth2';
  return { material, texture, data, caseTex, caseData, highlight, flash, wet, shade, gold, lamp, gelCol };
}

/** Write a tooth's layers into its texture bytes. */
export function uploadDirt(tm: ToothMat, plaque: Float32Array, stain: Float32Array, polish: Float32Array, paste?: Float32Array, gel?: Float32Array) {
  const d = tm.data;
  for (let i = 0, n = plaque.length; i < n; i++) {
    const o = i * 4;
    d[o] = plaque[i] * 255;
    d[o + 1] = stain[i] * 255;
    d[o + 2] = polish[i] * 255;
    d[o + 3] = paste ? paste[i] * 255 : 0;
  }
  tm.texture.needsUpdate = true;
  if (gel) {
    const c = tm.caseData;
    for (let i = 0, n = gel.length; i < n; i++) c[i * 4] = gel[i] * 255;
    tm.caseTex.needsUpdate = true;
  }
}

/** Dispose a tooth material and both of its data textures. */
export function disposeToothMat(tm: ToothMat) {
  tm.texture.dispose();
  tm.caseTex.dispose();
  tm.material.dispose();
}

// ------------------------------------------------------------------ water

export interface WaterMat { material: THREE.MeshStandardMaterial; time: { value: number }; level: { value: number } }

export function makeWaterMaterial(): WaterMat {
  const time = { value: 0 };
  const level = { value: 0 };
  const material = new THREE.MeshStandardMaterial({
    color: '#3FB2E8', transparent: true, opacity: 0.5, roughness: 0.03, metalness: 0.0, envMapIntensity: 1.6,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uLevel = level;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec2 vWxz;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWxz = position.xz;
float w1 = sin(position.x * 2.3 + uTime * 2.6) * 0.035 + sin(position.z * 3.1 - uTime * 2.1) * 0.03;
transformed.y += w1;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uLevel;\nvarying vec2 vWxz;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 p = vWxz;
  float dx = cos(p.x * 2.3 + uTime * 2.6) * 0.08 + cos(p.x * 7.0 + p.y * 3.0 + uTime * 3.4) * 0.05;
  float dz = -sin(p.y * 3.1 - uTime * 2.1) * 0.09 + cos(p.y * 6.0 - p.x * 2.0 - uTime * 2.8) * 0.05;
  normal = normalize(normal + vec3(dx, 0.0, dz));
}`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
{
  float er = length(vec2(vWxz.x / 5.4, (vWxz.y + 0.35) / 3.3));
  diffuseColor.a *= 1.0 - smoothstep(0.72, 0.98, er);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float foam = smoothstep(0.82, 1.0, sin(vWxz.x * 5.0 + uTime * 1.5) * sin(vWxz.y * 4.0 - uTime * 1.1));
  float glint = smoothstep(0.93, 1.0, sin(vWxz.x * 11.0 - uTime * 2.3 + sin(vWxz.y * 7.0)) * sin(vWxz.y * 9.0 + uTime * 1.7));
  totalEmissiveRadiance += vec3(0.9, 0.98, 1.0) * (foam * 0.22 + glint * 0.5);
  totalEmissiveRadiance += vec3(0.1, 0.35, 0.5) * 0.25;
}`);
  };
  material.customProgramCacheKey = () => 'fbWater1';
  return { material, time, level };
}

// ------------------------------------------------------------------ misc materials

export const gumMaterial = () => new THREE.MeshPhysicalMaterial({
  vertexColors: true, roughness: 0.42, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.25, side: THREE.DoubleSide,
  emissive: '#ff0000', emissiveIntensity: 0,
});
export const tongueMaterial = () => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.35 });
export const cavityMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.BackSide });
export const throatMaterial = () => new THREE.MeshBasicMaterial({ vertexColors: true });
export const lipsMaterial = () => new THREE.MeshPhysicalMaterial({ color: '#EE6F80', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
export const skinMaterial = (color: string) => new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.62 });

// ------------------------------------------------------------------ environment (cached for the page)

let envTex: THREE.Texture | null = null;
export function getEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (envTex) return envTex;
  const pm = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  envTex = pm.fromScene(room, 0.04).texture;
  room.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  pm.dispose();
  return envTex;
}

// ------------------------------------------------------------------ sprite textures (cached)

let starTex: THREE.Texture | null = null;
/** A soft four-point star used by the sparkle particles. */
export function getStarTexture(): THREE.Texture {
  if (starTex) return starTex;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.12, 'rgba(255,255,255,0.5)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.08)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  const cx = s / 2, r = s / 2, w = 2.4;
  g.moveTo(cx, 0); g.quadraticCurveTo(cx + w, cx - w, s, cx); g.quadraticCurveTo(cx + w, cx + w, cx, s);
  g.quadraticCurveTo(cx - w, cx + w, 0, cx); g.quadraticCurveTo(cx - w, cx - w, cx, 0);
  g.fill();
  void r;
  starTex = new THREE.CanvasTexture(c);
  starTex.colorSpace = THREE.SRGBColorSpace;
  return starTex;
}

let dropTex: THREE.Texture | null = null;
export function getDropTexture(): THREE.Texture {
  if (dropTex) return dropTex;
  const s = 32;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s * 0.42, s * 0.4, 1, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(210,240,255,0.9)');
  grd.addColorStop(0.8, 'rgba(120,200,240,0.5)');
  grd.addColorStop(1, 'rgba(120,200,240,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
  dropTex = new THREE.CanvasTexture(c);
  dropTex.colorSpace = THREE.SRGBColorSpace;
  return dropTex;
}

let ringTex: THREE.Texture | null = null;
/** A soft glowing ring (floss gap markers, problem-tooth rings). Cached for the page. */
export function getRingTexture(): THREE.Texture {
  if (ringTex) return ringTex;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, s * 0.18, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.15)');
  grd.addColorStop(0.62, 'rgba(255,255,255,1)');
  grd.addColorStop(0.78, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  ringTex = new THREE.CanvasTexture(c);
  ringTex.colorSpace = THREE.SRGBColorSpace;
  return ringTex;
}

let glowTex: THREE.Texture | null = null;
/** A soft round glow (sensitive gums). Cached for the page. */
export function getGlowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.4)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
