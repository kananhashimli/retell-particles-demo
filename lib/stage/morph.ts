// Scene-to-scene morph for particle scenes: every dot on screen when the scene changes flies to a
// dot of the next scene, round the orb rather than through it, drawing a short fading trail. The dots
// in flight use the same shader as the scenes' own particles, so nothing changes when they hand over.
//
// Both ends are read live every frame: the old scene keeps running underneath (hidden), so its dots
// leave with the speed they had, and the next scene's dots are where they land. A morph cut short
// by another scene change starts the next one from a frozen snapshot of what was in flight. While
// the morph runs, the target dots it carries are hidden in their own fields, and dots of the next
// scene that it does not carry fade in.

import * as THREE from "three";
import { Particles, Streaks } from "./kit";
import { clamp, easeInOut, hash, lerp, smooth } from "./util";

export interface MorphLook {
  /** seconds */
  duration: number;
  /** trail length, as a share of each dot's flight */
  trail: number;
  /** how far dots sweep round the orb on the way, radians at the midpoint */
  swirl: number;
}

/** share of the flight over which dots set off, inner rings first */
const STAGGER = 0.3;
/** radius bands: inner dots go to inner dots, outer to outer */
const BANDS = 10;
const VISIBLE = 0.01;

type Field = Particles | Streaks;

/** the particle fields under a scene group */
export function fieldsOf(root: THREE.Object3D): Field[] {
  const out: Field[] = [];
  root.traverse((o) => {
    if (o instanceof Particles || o instanceof Streaks) out.push(o);
  });
  return out;
}

/** one dot as drawn: head position, css px size, sRGB colour + alpha */
interface Dot {
  x: number;
  y: number;
  z: number;
  s: number;
  c: number[];
}
const dot = (): Dot => ({ x: 0, y: 0, z: 0, s: 0, c: [0, 0, 0, 0] });

/** a set of dots the morph can read every frame */
export interface Dots {
  readonly n: number;
  read(i: number, pxScale: number, out: Dot): Dot;
}

function readField(f: Field, i: number, pxScale: number, out: Dot) {
  const o = i * 3, q = i * 4;
  const p = f instanceof Particles ? f.pos : f.end;
  out.x = p[o];
  out.y = p[o + 1];
  out.z = p[o + 2];
  out.s = f instanceof Particles ? Math.max(f.size[i] * pxScale, 0.5) : f.width[i];
  out.c[0] = f.color[q];
  out.c[1] = f.color[q + 1];
  out.c[2] = f.color[q + 2];
  out.c[3] = f.visible ? f.color[q + 3] * f.opacity : 0;
  return out;
}

/** the dots of some fields, live: whatever they hold when read */
export function liveDots(fields: Field[]): Dots & { fields: Field[]; field: Uint16Array; local: Uint32Array } {
  const n = fields.reduce((s, f) => s + f.count, 0);
  const field = new Uint16Array(n), local = new Uint32Array(n);
  let k = 0;
  fields.forEach((f, fi) => {
    for (let i = 0; i < f.count; i++, k++) {
      field[k] = fi;
      local[k] = i;
    }
  });
  return { n, fields, field, local, read: (i, px, out) => readField(fields[field[i]], local[i], px, out) };
}

/** the visible dots of some fields, frozen as they are now */
export function frozenDots(fields: Field[], pxScale: number): Dots {
  const live = liveDots(fields), d = dot();
  const pos: number[] = [], size: number[] = [], col: number[] = [];
  for (let i = 0; i < live.n; i++) {
    live.read(i, pxScale, d);
    if (d.c[3] < VISIBLE) continue;
    pos.push(d.x, d.y, d.z);
    size.push(d.s);
    col.push(...d.c);
  }
  return {
    n: size.length,
    read(i, _px, out) {
      out.x = pos[i * 3];
      out.y = pos[i * 3 + 1];
      out.z = pos[i * 3 + 2];
      out.s = size[i];
      for (let c = 0; c < 4; c++) out.c[c] = col[i * 4 + c];
      return out;
    },
  };
}

/** visible dots of a set, with the radius and angle round the orb that pairing sorts by */
function visible(d: Dots, pxScale: number) {
  const tmp = dot(), idx: number[] = [], r: number[] = [], a: number[] = [];
  for (let i = 0; i < d.n; i++) {
    d.read(i, pxScale, tmp);
    if (tmp.c[3] < VISIBLE) continue;
    idx.push(i);
    r.push(Math.hypot(tmp.x, tmp.z));
    a.push(Math.atan2(tmp.z, tmp.x));
  }
  return { idx, r: Float64Array.from(r), a: Float64Array.from(a) };
}

export class Morph {
  /** draws the dots in flight; add it to the scene */
  readonly group = new THREE.Group();
  private dots: Particles | null = null;
  private trails: Streaks | null = null;
  private p = 0;
  private links: {
    n: number;
    s: Uint32Array;
    t: Uint32Array;
    /** whether this link is the one that keeps the source / target dot (the others fade out / in) */
    sKeep: Uint8Array;
    tKeep: Uint8Array;
    delay: Float32Array;
  } | null = null;
  /** per target dot: whether a link carries it */
  private carried = new Uint8Array(0);
  private target: ReturnType<typeof liveDots>;
  private sd = dot();
  private td = dot();

  constructor(
    private src: Dots,
    target: Field[],
    private look: MorphLook,
    private resolution: THREE.Vector2,
    private pointScale: { value: number },
  ) {
    this.target = liveDots(target);
    this.group.name = "morph";
  }

  get done() {
    return this.p >= 1;
  }

  /** pair the source dots with the target dots, both as drawn this frame */
  private link(pxScale: number) {
    const S = visible(this.src, pxScale), T = visible(this.target, pxScale);
    const nS = S.idx.length, nT = T.idx.length;
    // positions in the visible lists, sorted by a key
    const order = (n: number, key: Float64Array) => Array.from({ length: n }, (_, i) => i).sort((x, y) => key[x] - key[y]);
    const byR = { s: order(nS, S.r), t: order(nT, T.r) };
    const K = Math.max(1, Math.min(BANDS, nS, nT));
    const s: number[] = [], t: number[] = [], sKeep: number[] = [], tKeep: number[] = [], delay: number[] = [];
    if (nS && nT) {
      for (let b = 0; b < K; b++) {
        const sb = byR.s.slice(Math.floor((b * nS) / K), Math.floor(((b + 1) * nS) / K)).sort((x, y) => S.a[x] - S.a[y]);
        const tb = byR.t.slice(Math.floor((b * nT) / K), Math.floor(((b + 1) * nT) / K)).sort((x, y) => T.a[x] - T.a[y]);
        const M = Math.max(sb.length, tb.length);
        for (let k = 0; k < M; k++) {
          const js = Math.floor((k * sb.length) / M), jt = Math.floor((k * tb.length) / M);
          s.push(S.idx[sb[js]]);
          t.push(T.idx[tb[jt]]);
          // when one side has fewer dots, several links share a dot; only the first keeps it
          sKeep.push(k === 0 || Math.floor(((k - 1) * sb.length) / M) !== js ? 1 : 0);
          tKeep.push(k === 0 || Math.floor(((k - 1) * tb.length) / M) !== jt ? 1 : 0);
          delay.push(STAGGER * (0.7 * (K > 1 ? b / (K - 1) : 0) + 0.3 * hash(s.length * 0.731)));
        }
      }
    }
    const n = s.length;
    this.links = { n, s: Uint32Array.from(s), t: Uint32Array.from(t), sKeep: Uint8Array.from(sKeep), tKeep: Uint8Array.from(tKeep), delay: Float32Array.from(delay) };
    this.carried = new Uint8Array(this.target.n);
    for (const i of t) this.carried[i] = 1;
    if (n) {
      this.trails = new Streaks(n, this.resolution, 0);
      this.dots = new Particles(n, this.pointScale);
      this.group.add(this.trails, this.dots);
    }
  }

  /** advance by dt and draw; call once both scenes have written their fields for this frame */
  update(dt: number, pxScale: number, orbRadius: number) {
    if (!this.links) this.link(pxScale);
    this.p = Math.min(1, this.p + dt / Math.max(0.05, this.look.duration));
    if (this.done) return;
    const L = this.links!, { src, target, sd, td } = this;
    const R = orbRadius, swirl = this.look.swirl, trail = this.look.trail;
    const head = [0, 0, 0], tail = [0, 0, 0], col = [0, 0, 0];
    // a point on the way at eased progress e: polar, so dots sweep round the orb instead of through it
    const at = (out: number[], e: number) => {
      const sa = Math.atan2(sd.z, sd.x), sr = Math.hypot(sd.x, sd.z);
      const ta = Math.atan2(td.z, td.x), tr = Math.hypot(td.x, td.z);
      let da = ta - sa;
      da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI;
      const a = sa + da * e + swirl * Math.sin(Math.PI * e);
      const r = lerp(sr, tr, e);
      out[0] = Math.cos(a) * r;
      out[1] = lerp(sd.y, td.y, e);
      out[2] = Math.sin(a) * r;
    };
    const { dots, trails } = this;
    if (dots && trails) {
      for (let k = 0; k < L.n; k++) {
        src.read(L.s[k], pxScale, sd);
        target.read(L.t[k], pxScale, td);
        const u = clamp((this.p - L.delay[k]) / (1 - STAGGER));
        const e = easeInOut(u);
        at(head, e);
        at(tail, easeInOut(u - trail));
        for (let c = 0; c < 3; c++) col[c] = lerp(sd.c[c], td.c[c], e);
        const alpha = lerp(sd.c[3] * L.sKeep[k], td.c[3] * L.tKeep[k], e);
        const a = head[0] * head[0] + (head[1] - R) ** 2 + head[2] * head[2] < R * R * 1.02 ? 0 : alpha;
        const size = lerp(sd.s, td.s, e);
        dots.set(k, head[0], head[1], head[2], size / pxScale, col, a);
        // the trail only shows while the dot moves, so it never thickens a resting dot
        const run = Math.hypot(head[0] - tail[0], head[1] - tail[1], head[2] - tail[2]);
        trails.set(k, tail[0], tail[1], tail[2], head[0], head[1], head[2], size, col, a * 0.7 * smooth(0, 0.08, run));
      }
      dots.commit();
      trails.commit();
    }
    // the target's own dots: the carried ones are drawn above, the rest fade in
    const reveal = easeInOut(this.p);
    for (let i = 0; i < target.n; i++) target.fields[target.field[i]].color[target.local[i] * 4 + 3] *= this.carried[i] ? 0 : reveal;
    for (const f of target.fields) f.commit();
  }

  dispose() {
    this.group.removeFromParent();
    for (const o of [this.dots, this.trails]) {
      o?.geometry.dispose();
      o?.material.dispose();
    }
  }
}
