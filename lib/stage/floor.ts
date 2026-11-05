// The isometric floor: grid (lines / dots / crosses), the orb's contact shadow and light pool, plus
// effects scenes can request each frame — ripples that light up the grid, highlighted tiles.

import * as THREE from "three";
import { srgb } from "./util";

export const MAX_RIPPLES = 16;
export const MAX_TILES = 24;

export type GridStyle = "lines" | "dots" | "cross";

export interface FloorLook {
  style: GridStyle;
  color: string;
  opacity: number;
  cell: number;
  width: number;
  major: number; // every n cells a stronger line (0 = off)
  fadeInner: number;
  fadeOuter: number;
  glowColor: string;
  glow: number;
  shadow: number;
  shadowColor: string;
  accent: string;
}

/** Ripple kinds: 0 = lights up the grid lines it passes, 1 = thin drawn ring, 2 = soft filled band */
export interface Ripple {
  radius: number;
  strength: number;
  width: number;
  kind?: 0 | 1 | 2;
  x?: number;
  z?: number;
}

export interface Tile {
  x: number;
  z: number;
  strength: number;
  size?: number;
}

const vert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */ `
precision highp float;
varying vec3 vWorld;
uniform float uCell, uWidth, uOpacity, uMajor, uStyle;
uniform vec3 uLine, uAccent, uGlowColor, uShadowColor;
uniform vec2 uFade;
uniform float uGlow, uShadow, uOrbR, uGlobal;
uniform vec2 uViewR, uViewF;   // floor axes facing the camera: across the screen, and into it
uniform float uSquash;
uniform vec4 uRip[${MAX_RIPPLES}];
uniform vec2 uRipXZ[${MAX_RIPPLES}];
uniform float uRipKind[${MAX_RIPPLES}];
uniform int uRipN;
uniform vec4 uTile[${MAX_TILES}];
uniform int uTileN;

// premultiplied "over"
void over(inout vec4 acc, vec3 c, float a) {
  a = clamp(a, 0.0, 1.0);
  acc.rgb = c * a + acc.rgb * (1.0 - a);
  acc.a = a + acc.a * (1.0 - a);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 xz = vWorld.xz;
  float d = length(xz);
  vec2 fw = fwidth(xz);
  float pxw = max(0.5 * (fw.x + fw.y), 1e-5);   // world units per pixel
  float fade = 1.0 - smoothstep(uFade.x, uFade.y, d);

  // ---- grid
  vec2 g = xz / uCell;
  vec2 gd = abs(fract(g - 0.5) - 0.5) * uCell / pxw;    // px to nearest line
  float lines = 1.0 - smoothstep(uWidth * 0.5 - 0.5, uWidth * 0.5 + 0.5, min(gd.x, gd.y));
  if (uMajor > 0.5) {
    vec2 gm = abs(fract(g / uMajor - 0.5) - 0.5) * uCell * uMajor / pxw;
    float maj = 1.0 - smoothstep(uWidth * 0.5, uWidth * 0.5 + 1.0, min(gm.x, gm.y));
    lines = max(lines * 0.7, maj);
  }
  // offset to the nearest intersection, converted to screen px with the inverse screen→world jacobian
  vec2 qw = (fract(g + 0.5) - 0.5) * uCell;
  vec2 jx = dFdx(xz), jy = dFdy(xz);
  float det = jx.x * jy.y - jy.x * jx.y;
  vec2 cellP = abs(det) > 1e-12 ? vec2(jy.y * qw.x - jy.x * qw.y, -jx.y * qw.x + jx.x * qw.y) / det : qw / pxw;
  float dots = 1.0 - smoothstep(uWidth * 0.9, uWidth * 0.9 + 1.0, length(cellP));
  float arm = 4.0 + uWidth * 2.0;
  float cross = max(
    (1.0 - smoothstep(uWidth * 0.5 - 0.5, uWidth * 0.5 + 0.5, abs(cellP.x))) * step(abs(cellP.y), arm),
    (1.0 - smoothstep(uWidth * 0.5 - 0.5, uWidth * 0.5 + 0.5, abs(cellP.y))) * step(abs(cellP.x), arm));
  float grid = uStyle < 0.5 ? lines : (uStyle < 1.5 ? dots : cross);

  // ---- ripples
  float boost = 0.0, ring = 0.0, band = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (i >= uRipN) break;
    vec4 rp = uRip[i];
    float rd = length(xz - uRipXZ[i]);
    float k = uRipKind[i];
    if (k < 0.5) {
      float b = exp(-pow((rd - rp.x) / max(rp.z, 1e-3), 2.0)) * rp.y;
      boost += b;
      band += b * 0.12;
    } else if (k < 1.5) {
      ring += (1.0 - smoothstep(0.6, 1.6, abs(rd - rp.x) / pxw / max(rp.z, 0.2))) * rp.y;
    } else {
      band += exp(-pow((rd - rp.x) / max(rp.z, 1e-3), 2.0)) * rp.y;
    }
  }

  // ---- tiles
  float tileFill = 0.0, tileEdge = 0.0;
  for (int i = 0; i < ${MAX_TILES}; i++) {
    if (i >= uTileN) break;
    vec4 t = uTile[i];
    float hs = 0.5 * t.w;
    float sd = sdRoundBox(xz - t.xy, vec2(hs - 0.03), hs * 0.22);
    tileFill += (1.0 - smoothstep(-pxw, pxw, sd)) * t.z;
    tileEdge += (1.0 - smoothstep(0.0, 1.2, abs(sd) / pxw)) * t.z;
  }

  vec4 acc = vec4(0.0);
  // light pool of the orb
  float pool = uGlow * (exp(-pow(d / (uOrbR * 1.6), 2.0)) * 0.55 + 0.45 / (1.0 + pow(d / (uOrbR * 1.1), 2.0) * 1.6));
  over(acc, uGlowColor, pool * 0.55);
  over(acc, uAccent, clamp(band, 0.0, 1.0) * 0.5 * fade);
  // grid, brightened and tinted where a ripple passes
  float gl = grid * uOpacity * fade * (1.0 + boost * 3.0);
  vec3 lc = mix(uLine, uAccent, clamp(boost * 1.4, 0.0, 1.0));
  over(acc, lc, gl);
  over(acc, uAccent, clamp(tileFill, 0.0, 1.0) * 0.16);
  over(acc, uAccent, clamp(tileEdge, 0.0, 1.0) * 0.7);
  over(acc, uAccent, clamp(ring, 0.0, 1.0) * 0.8);
  // contact shadow: light passes through the orb, so this is only a soft tinted breath where it meets the floor
  vec2 sv = vec2(dot(xz, uViewR), dot(xz, uViewF) / uSquash);
  float su = length(sv) / (uOrbR * 0.9);
  float sh = exp(-su * su * 3.0);
  over(acc, uShadowColor, sh * uShadow);

  acc *= uGlobal;
  if (acc.a < 0.001) discard;
  gl_FragColor = vec4(acc.rgb / acc.a, acc.a);
}`;

export class Floor {
  readonly mesh: THREE.Mesh;
  private u: Record<string, THREE.IUniform>;
  private ripples: Ripple[] = [];
  private tiles: Tile[] = [];
  /** extra glow scenes add this frame */
  glowAdd = 0;

  constructor() {
    const ripVec = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4());
    this.u = {
      uCell: { value: 0.75 },
      uWidth: { value: 1 },
      uOpacity: { value: 0.1 },
      uMajor: { value: 0 },
      uStyle: { value: 0 },
      uLine: { value: new THREE.Vector3() },
      uAccent: { value: new THREE.Vector3() },
      uGlowColor: { value: new THREE.Vector3() },
      uShadowColor: { value: new THREE.Vector3() },
      uFade: { value: new THREE.Vector2(3, 7) },
      uGlow: { value: 0.3 },
      uShadow: { value: 0.3 },
      uOrbR: { value: 1 },
      uViewR: { value: new THREE.Vector2(1, 0) },
      uViewF: { value: new THREE.Vector2(0, 1) },
      uSquash: { value: 1 },
      uGlobal: { value: 1 },
      uRip: { value: ripVec },
      uRipXZ: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector2()) },
      uRipKind: { value: new Array(MAX_RIPPLES).fill(0) },
      uRipN: { value: 0 },
      uTile: { value: Array.from({ length: MAX_TILES }, () => new THREE.Vector4()) },
      uTileN: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.u,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = -2;
    this.mesh.name = "floor";
  }

  setLook(l: FloorLook, orbRadius: number) {
    const u = this.u;
    u.uStyle.value = { lines: 0, dots: 1, cross: 2 }[l.style];
    srgb(l.color, u.uLine.value);
    srgb(l.accent, u.uAccent.value);
    srgb(l.glowColor, u.uGlowColor.value);
    srgb(l.shadowColor, u.uShadowColor.value);
    u.uOpacity.value = l.opacity;
    u.uCell.value = l.cell;
    u.uWidth.value = l.width;
    u.uMajor.value = l.major;
    (u.uFade.value as THREE.Vector2).set(l.fadeInner, l.fadeOuter);
    u.uGlow.value = l.glow;
    u.uShadow.value = l.shadow;
    u.uOrbR.value = orbRadius;
    this.baseGlow = l.glow;
  }
  private baseGlow = 0.3;

  /** the contact shadow's colour this frame (it follows the orb's tint) */
  set shadowColor(hex: string) {
    srgb(hex, this.u.uShadowColor.value);
  }

  /** the light pool's colour this frame (it follows the orb's tint) */
  set glowColor(rgb: THREE.Vector3) {
    (this.u.uGlowColor.value as THREE.Vector3).copy(rgb);
  }

  /** camera azimuth / elevation in radians: keeps the contact shadow's on-screen shape fixed */
  setView(azimuth: number, elevation: number) {
    (this.u.uViewR.value as THREE.Vector2).set(Math.cos(azimuth), -Math.sin(azimuth));
    (this.u.uViewF.value as THREE.Vector2).set(Math.sin(azimuth), Math.cos(azimuth));
    // about 1 : 5 on screen; the floor already foreshortens by sin(elevation)
    this.u.uSquash.value = 0.2 / Math.max(0.05, Math.sin(elevation));
  }

  set opacity(v: number) {
    this.u.uGlobal.value = v;
  }

  beginFrame() {
    this.ripples.length = 0;
    this.tiles.length = 0;
    this.glowAdd = 0;
  }
  ripple(r: Ripple) {
    if (this.ripples.length < MAX_RIPPLES && r.strength > 0.002) this.ripples.push(r);
  }
  tile(t: Tile) {
    if (this.tiles.length < MAX_TILES && t.strength > 0.002) this.tiles.push(t);
  }

  endFrame(orbEnergy: number) {
    const u = this.u;
    const rv = u.uRip.value as THREE.Vector4[];
    const rx = u.uRipXZ.value as THREE.Vector2[];
    const rk = u.uRipKind.value as number[];
    this.ripples.forEach((r, i) => {
      rv[i].set(r.radius, r.strength, r.width, 0);
      rx[i].set(r.x ?? 0, r.z ?? 0);
      rk[i] = r.kind ?? 0;
    });
    u.uRipN.value = this.ripples.length;
    const tv = u.uTile.value as THREE.Vector4[];
    this.tiles.forEach((t, i) => tv[i].set(t.x, t.z, t.strength, t.size ?? (u.uCell.value as number)));
    u.uTileN.value = this.tiles.length;
    u.uGlow.value = this.baseGlow * (0.6 + 0.6 * orbEnergy) + this.glowAdd;
  }

  /** effects requested for the current frame (for vector export) */
  get frameEffects() {
    return { ripples: this.ripples.slice(), tiles: this.tiles.slice() };
  }

  get cell() {
    return this.u.uCell.value as number;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
