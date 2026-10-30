// Building blocks scenes share: fat lines that can be rewritten every frame without reallocating,
// crisp round particles, and streaks (particles drawn with a fading tail).

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { InterleavedBufferAttribute, InterleavedBuffer } from "three";
import type { Look } from "./types";
import { srgb } from "./util";

export interface LineOpts {
  color?: string;
  width?: number;
  opacity?: number;
  dashed?: boolean;
  dash?: number;
  gap?: number;
  vertexColors?: boolean;
}

/** A polyline with a fixed capacity whose points can change every frame. */
export class FatLine extends Line2 {
  readonly cap: number;
  private pos: Float32Array;
  private col: Float32Array;
  private dist: Float32Array;
  declare material: LineMaterial;

  constructor(cap: number, material: LineMaterial) {
    const g = new LineGeometry();
    g.setPositions(new Float32Array(cap * 3));
    g.setColors(new Float32Array(cap * 3).fill(1));
    super(g, material);
    this.computeLineDistances();
    this.cap = cap;
    this.pos = (g.attributes.instanceStart as InterleavedBufferAttribute).data.array as Float32Array;
    this.col = (g.attributes.instanceColorStart as InterleavedBufferAttribute).data.array as Float32Array;
    this.dist = (g.attributes.instanceDistanceStart as InterleavedBufferAttribute).data.array as Float32Array;
    this.frustumCulled = false;
    this.renderOrder = 3;
    g.instanceCount = 0;
  }

  /** points: flat xyz array or Vector3 list; colors (optional): per point linear rgb */
  setPoints(points: ArrayLike<number> | THREE.Vector3[], colors?: ArrayLike<number>) {
    const flat = Array.isArray(points) && points[0] instanceof THREE.Vector3;
    const n = Math.min(this.cap, flat ? points.length : (points as ArrayLike<number>).length / 3);
    const P = (i: number, k: number) => (flat ? (points as THREE.Vector3[])[i].getComponent(k) : (points as ArrayLike<number>)[i * 3 + k]);
    let d = 0;
    for (let i = 0; i < n - 1; i++) {
      const o = i * 6;
      for (let k = 0; k < 3; k++) {
        this.pos[o + k] = P(i, k);
        this.pos[o + 3 + k] = P(i + 1, k);
        if (colors) {
          this.col[o + k] = colors[i * 3 + k];
          this.col[o + 3 + k] = colors[(i + 1) * 3 + k];
        }
      }
      const dx = this.pos[o + 3] - this.pos[o], dy = this.pos[o + 4] - this.pos[o + 1], dz = this.pos[o + 5] - this.pos[o + 2];
      this.dist[i * 2] = d;
      d += Math.sqrt(dx * dx + dy * dy + dz * dz);
      this.dist[i * 2 + 1] = d;
    }
    const g = this.geometry;
    ((g.attributes.instanceStart as InterleavedBufferAttribute).data as InterleavedBuffer).needsUpdate = true;
    if (colors) ((g.attributes.instanceColorStart as InterleavedBufferAttribute).data as InterleavedBuffer).needsUpdate = true;
    ((g.attributes.instanceDistanceStart as InterleavedBufferAttribute).data as InterleavedBuffer).needsUpdate = true;
    g.instanceCount = Math.max(0, n - 1);
    return d;
  }

  get opacity() {
    return this.material.opacity;
  }
  set opacity(v: number) {
    this.material.opacity = v;
    this.visible = v > 0.003;
  }
}

const PARTICLE_VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
varying float vPx;
void main() {
  vColor = aColor;
  vPx = max(aSize * uScale, 0.5);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = vPx + 2.0; // room for the anti-aliased edge
  gl_Position = projectionMatrix * mv;
}`;
const PARTICLE_FRAG = /* glsl */ `
varying vec4 vColor;
varying float vPx;
uniform float uOpacity;
uniform float uSoft;
void main() {
  float d = length(gl_PointCoord - 0.5) * (vPx + 2.0); // device px from the centre
  float r = vPx * 0.5;
  float crisp = clamp(r - d + 0.5, 0.0, 1.0);
  float soft = exp(-d * d / (r * r * 0.7));
  float a = mix(crisp, soft, uSoft) * vColor.a * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

/**
 * CPU-driven round dots with a pixel-exact anti-aliased edge (or a soft falloff with `soft`).
 * Write positions, sizes (css px) and colours (sRGB + alpha) every frame, then commit().
 */
export class Particles extends THREE.Points {
  readonly count: number;
  readonly pos: Float32Array;
  readonly size: Float32Array;
  readonly color: Float32Array;
  declare material: THREE.ShaderMaterial;

  constructor(count: number, scaleRef: { value: number }, soft = 0) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const color = new Float32Array(count * 4);
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(color, 4).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: { uScale: scaleRef, uOpacity: { value: 1 }, uSoft: { value: soft } },
      transparent: true,
      depthWrite: false,
    });
    super(g, m);
    this.count = count;
    this.pos = pos;
    this.size = size;
    this.color = color;
    this.frustumCulled = false;
    this.renderOrder = 3;
  }

  /** write one dot */
  set(i: number, x: number, y: number, z: number, size: number, c: readonly number[], a: number) {
    const o = i * 3, q = i * 4;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.size[i] = size;
    this.color[q] = c[0];
    this.color[q + 1] = c[1];
    this.color[q + 2] = c[2];
    this.color[q + 3] = a;
  }

  commit() {
    const a = this.geometry.attributes;
    a.position.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aColor.needsUpdate = true;
  }

  set soft(v: number) {
    this.material.uniforms.uSoft.value = v;
  }

  get opacity() {
    return this.material.uniforms.uOpacity.value as number;
  }
  set opacity(v: number) {
    this.material.uniforms.uOpacity.value = v;
    this.visible = v > 0.003;
  }
}

const STREAK_VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec4 aColor;
attribute float aWidth;
uniform vec2 uRes;
varying vec4 vColor;
varying vec2 vLocal;
varying float vLen;
varying float vHw;
void main() {
  vec4 a = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
  vec4 b = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);
  vec2 sa = a.xy / a.w * 0.5 * uRes;
  vec2 sb = b.xy / b.w * 0.5 * uRes;
  vec2 d = sb - sa;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hw = aWidth * 0.5;
  float pad = hw + 1.0;
  float along = position.x * len + (position.x * 2.0 - 1.0) * pad;
  vec2 p = sa + dir * along + nrm * position.y * pad;
  vLocal = vec2(along, position.y * pad);
  vLen = len;
  vHw = hw;
  vColor = aColor;
  gl_Position = vec4(p / (0.5 * uRes), mix(a.z / a.w, b.z / b.w, position.x), 1.0);
}`;
const STREAK_FRAG = /* glsl */ `
uniform float uTail;
uniform float uOpacity;
varying vec4 vColor;
varying vec2 vLocal;
varying float vLen;
varying float vHw;
void main() {
  float t = clamp(vLocal.x, 0.0, vLen);
  float dist = length(vec2(vLocal.x - t, vLocal.y));
  float a = clamp(vHw - dist + 0.5, 0.0, 1.0);
  a *= mix(uTail, 1.0, vLen > 0.0 ? t / vLen : 1.0); // fades toward the tail
  a *= vColor.a * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

/**
 * Moving particles drawn as capsules from where they were (tail) to where they are (head), with
 * the tail fading out. Widths in css px; colours sRGB + alpha.
 */
export class Streaks extends THREE.Mesh {
  readonly count: number;
  readonly start: Float32Array;
  readonly end: Float32Array;
  readonly color: Float32Array;
  readonly width: Float32Array;
  declare material: THREE.ShaderMaterial;
  declare geometry: THREE.InstancedBufferGeometry;

  constructor(count: number, resolution: THREE.Vector2, tail = 0) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const start = new Float32Array(count * 3), end = new Float32Array(count * 3), color = new Float32Array(count * 4), width = new Float32Array(count);
    const inst = (arr: Float32Array, n: number) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aStart", inst(start, 3));
    g.setAttribute("aEnd", inst(end, 3));
    g.setAttribute("aColor", inst(color, 4));
    g.setAttribute("aWidth", inst(width, 1));
    g.instanceCount = count;
    const m = new THREE.ShaderMaterial({
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      uniforms: { uRes: { value: resolution }, uTail: { value: tail }, uOpacity: { value: 1 } },
      transparent: true,
      depthWrite: false,
    });
    super(g, m);
    this.count = count;
    this.start = start;
    this.end = end;
    this.color = color;
    this.width = width;
    this.frustumCulled = false;
    this.renderOrder = 3;
    this.userData.kind = "streaks";
  }

  /** write one streak from (x0,y0,z0) to (x1,y1,z1) */
  set(i: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, c: readonly number[], a: number) {
    const o = i * 3, q = i * 4;
    this.start[o] = x0;
    this.start[o + 1] = y0;
    this.start[o + 2] = z0;
    this.end[o] = x1;
    this.end[o + 1] = y1;
    this.end[o + 2] = z1;
    this.width[i] = width;
    this.color[q] = c[0];
    this.color[q + 1] = c[1];
    this.color[q + 2] = c[2];
    this.color[q + 3] = a;
  }

  commit() {
    const a = this.geometry.attributes;
    a.aStart.needsUpdate = true;
    a.aEnd.needsUpdate = true;
    a.aColor.needsUpdate = true;
    a.aWidth.needsUpdate = true;
  }

  set tail(v: number) {
    this.material.uniforms.uTail.value = v;
  }

  get opacity() {
    return this.material.uniforms.uOpacity.value as number;
  }
  set opacity(v: number) {
    this.material.uniforms.uOpacity.value = v;
    this.visible = v > 0.003;
  }
}

export class Kit {
  /** css px of the stage, shared by all line materials */
  readonly resolution: THREE.Vector2;
  /** particle size scale (device px per css px × user scale) */
  readonly pointScale: { value: number };
  constructor(public look: Look, resolution: THREE.Vector2, pointScale: { value: number }) {
    this.resolution = resolution;
    this.pointScale = pointScale;
  }

  lineMaterial(o: LineOpts = {}) {
    const m = new LineMaterial({
      // with vertex colours the material colour multiplies them, so keep it white
      color: o.vertexColors ? 0xffffff : new THREE.Color(o.color ?? this.look.ink).getHex(),
      linewidth: o.width ?? 1.25,
      transparent: true,
      opacity: o.opacity ?? 1,
      dashed: !!o.dashed,
      dashSize: o.dash ?? 0.08,
      gapSize: o.gap ?? 0.08,
      vertexColors: !!o.vertexColors,
      depthWrite: false,
    });
    m.uniforms.resolution.value = this.resolution; // shared reference: resizes apply everywhere
    return m;
  }

  line(cap: number, o: LineOpts = {}) {
    const l = new FatLine(cap, this.lineMaterial(o));
    // remembered so a shared line look can restyle it: base width, and whether it is an ink or accent stroke
    l.userData.baseWidth = o.width ?? 1.25;
    if (!o.vertexColors) l.userData.role = (o.color ?? this.look.ink).toLowerCase() === this.look.accent.toLowerCase() ? "active" : "muted";
    return l;
  }

  /** crisp round dots; soft 0..1 blends toward a gaussian falloff */
  particles(count: number, soft = 0) {
    return new Particles(count, this.pointScale, soft);
  }

  /** capsule streaks from tail to head; tail 0..1 is the opacity left at the tail end */
  streaks(count: number, tail = 0) {
    return new Streaks(count, this.resolution, tail);
  }

  /** linear rgb (for vertex colours on LineMaterial, which converts to sRGB itself) */
  linear(hex: string) {
    const c = new THREE.Color(hex);
    return [c.r, c.g, c.b] as const;
  }
  /** raw sRGB (for the particle shader, which writes display colours directly) */
  srgb(hex: string) {
    const v = srgb(hex);
    return [v.x, v.y, v.z] as const;
  }
}
