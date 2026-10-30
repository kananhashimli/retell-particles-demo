import * as THREE from "three";

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const fract = (v: number) => v - Math.floor(v);
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
export const easeInOut = (t: number) => {
  t = clamp(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const backOut = (t: number, s = 1.6) => {
  t = clamp(t) - 1;
  return t * t * ((s + 1) * t + s) + 1;
};

/** Trapezoid window: 0 before a, ramps to 1 over `fin`, holds, ramps to 0 over `fout` ending at b. */
export function win(t: number, a: number, b: number, fin = 0.3, fout = 0.3) {
  if (t <= a || t >= b) return 0;
  return Math.min(easeInOut((t - a) / fin), easeInOut((b - t) / fout), 1);
}

/** Deterministic hash → 0..1 */
export const hash = (n: number) => fract(Math.sin(n * 12.9898 + 78.233) * 43758.5453);

export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic speech-like envelope (0..1): ~6 syllables a second, grouped into words with
 * short pauses. Same t always gives the same value, so exports are repeatable.
 */
export function speech(t: number, seed = 0) {
  const syl = 0.17;
  const k = Math.floor(t / syl);
  const f = t / syl - k;
  const word = Math.floor(t / 0.62 + hash(seed * 3.1) * 7);
  if (hash(word * 1.7 + seed) < 0.18) return 0; // pause between words
  const amp = 0.45 + 0.55 * hash(k * 0.73 + seed * 11.3);
  return amp * Math.pow(Math.sin(Math.PI * f), 0.7);
}

/** Raw sRGB triplet for custom shaders (they write display-referred colours, no conversion). */
export function srgb(hex: string, out = new THREE.Vector3()) {
  const c = new THREE.Color();
  c.setStyle(hex, THREE.SRGBColorSpace);
  const s = c.clone().convertLinearToSRGB();
  return out.set(s.r, s.g, s.b);
}

const hueTmp = new THREE.Color();
const hsl = { h: 0, s: 0, l: 0 };
/** hue of an sRGB colour, 0..1 */
export function hueOf(r: number, g: number, b: number) {
  return hueTmp.setRGB(r, g, b, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace).h;
}
/** the colour with its hue turned by dh (1 = a full turn) */
export function shiftHue(hex: string, dh: number) {
  if (Math.abs(dh) < 1e-4) return hex;
  hueTmp.setStyle(hex, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
  return `#${hueTmp.setHSL((((hsl.h + dh) % 1) + 1) % 1, hsl.s, hsl.l, THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace)}`;
}

export function mixHex(a: string, b: string, t: number) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return "#" + ca.lerp(cb, t).getHexString();
}

export const TAU = Math.PI * 2;

/** Point on a polyline at normalised distance u (0..1). */
export function samplePolyline(pts: THREE.Vector3[], u: number, out = new THREE.Vector3()) {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = pts[i].distanceTo(pts[i - 1]);
    lens.push(l);
    total += l;
  }
  let d = clamp(u) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) return out.lerpVectors(pts[i], pts[i + 1], lens[i] ? clamp(d / lens[i]) : 0);
    d -= lens[i];
  }
  return out.copy(pts[pts.length - 1]);
}

export function polylineLength(pts: THREE.Vector3[]) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1]);
  return total;
}

/** Rounds the corners of an orthogonal polyline (for paths drawn along grid lines). */
export function roundCorners(pts: THREE.Vector3[], radius: number, steps = 8) {
  if (pts.length < 3) return pts.map((p) => p.clone());
  const out: THREE.Vector3[] = [pts[0].clone()];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const r = Math.min(radius, a.distanceTo(b) / 2, b.distanceTo(c) / 2);
    const p0 = b.clone().add(a.clone().sub(b).normalize().multiplyScalar(r));
    const p1 = b.clone().add(c.clone().sub(b).normalize().multiplyScalar(r));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // quadratic bezier through the corner
      const q = p0.clone().multiplyScalar((1 - t) * (1 - t)).add(b.clone().multiplyScalar(2 * (1 - t) * t)).add(p1.clone().multiplyScalar(t * t));
      out.push(q);
    }
  }
  out.push(pts[pts.length - 1].clone());
  return out;
}

/** Densify a polyline so it can be partially drawn smoothly. */
export function resample(pts: THREE.Vector3[], n: number) {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) out.push(samplePolyline(pts, i / (n - 1)));
  return out;
}
