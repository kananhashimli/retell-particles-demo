// Vector export of the current frame: the grid, every stroke and particle a scene draws, floor
// highlights, as plain SVG shapes that stay editable in Figma.
//
// The orb and the background are left out (the SVG is transparent). The orb is see-through and hides
// nothing, so placing the orb image *over* this SVG reproduces the render.

import * as THREE from "three";
import type { InterleavedBufferAttribute } from "three";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Ripple, Tile } from "./floor";
import type { StageConfig } from "./types";
import { smooth } from "./util";

export interface SceneSVGInput {
  camera: THREE.OrthographicCamera;
  w: number;
  h: number;
  dpr: number;
  config: StageConfig;
  /** scene groups to export (all active scenes, including one fading out) */
  groups: THREE.Object3D[];
  ripples: Ripple[];
  tiles: Tile[];
}

type Pt = [number, number];
const f = (v: number) => (Math.round(v * 100) / 100).toString();
const hex = (c: THREE.Color) => `#${c.getHexString()}`;
const STEP = 0.02; // world units per sub-segment when cutting strokes against the orb / dashes

/** Ramer–Douglas–Peucker, so finely sampled strokes become compact paths */
function simplify(pts: Pt[], eps = 0.12): Pt[] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  // closed shapes start and end on the same point: simplify each half
  if (Math.hypot(bx - ax, by - ay) < 1e-6) {
    const m = Math.floor(pts.length / 2);
    return [...simplify(pts.slice(0, m + 1), eps).slice(0, -1), ...simplify(pts.slice(m), eps)];
  }
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
  let max = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}
const pathD = (pts: Pt[]) => simplify(pts).map((p, i) => `${i ? "L" : "M"}${f(p[0])} ${f(p[1])}`).join("");

export function buildSceneSVG(o: SceneSVGInput) {
  const { camera, w, h, config } = o;
  camera.updateMatrixWorld();
  const tmp = new THREE.Vector3();

  const project = (p: THREE.Vector3): Pt => {
    tmp.copy(p).project(camera);
    return [(tmp.x * 0.5 + 0.5) * w, (-tmp.y * 0.5 + 0.5) * h];
  };

  const defs: string[] = [];
  let gid = 0;

  // ---------------------------------------------------------------- grid
  const grid: string[] = [];
  {
    const g = config.grid;
    const fade = (d: number) => 1 - smooth(g.fadeInner, g.fadeOuter, d);
    const K = Math.ceil(g.fadeOuter / g.cell);
    const isMajor = (k: number) => g.major > 0.5 && k % Math.round(g.major) === 0;
    if (g.style === "lines") {
      for (const axis of ["x", "z"] as const)
        for (let k = -K; k <= K; k++) {
          const c = k * g.cell;
          if (Math.abs(c) >= g.fadeOuter) continue;
          const half = Math.sqrt(g.fadeOuter ** 2 - c * c);
          const n = Math.max(2, Math.ceil((2 * half) / 0.05));
          const run: THREE.Vector3[] = [];
          for (let i = 0; i <= n; i++) {
            const s = -half + (2 * half * i) / n;
            run.push(axis === "x" ? new THREE.Vector3(c, 0, s) : new THREE.Vector3(s, 0, c));
          }
          const runs = [run];
          const major = isMajor(k);
          for (const run of runs) {
            const a = run[0], b = run[run.length - 1];
            const [x1, y1] = project(a), [x2, y2] = project(b);
            const id = `g${gid++}`;
            const stops: string[] = [];
            const S = 14;
            for (let i = 0; i <= S; i++) {
              const p = a.clone().lerp(b, i / S);
              stops.push(`<stop offset="${f(i / S)}" stop-color="${g.color}" stop-opacity="${f(fade(Math.hypot(p.x, p.z)))}"/>`);
            }
            defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}">${stops.join("")}</linearGradient>`);
            grid.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="url(#${id})" stroke-opacity="${f(g.opacity * (g.major > 0.5 && !major ? 0.7 : 1))}" stroke-width="${f(major ? g.width + 1 : g.width)}"/>`);
          }
        }
    } else {
      const arm = 4 + g.width * 2;
      for (let i = -K; i <= K; i++)
        for (let j = -K; j <= K; j++) {
          const p = new THREE.Vector3(i * g.cell, 0, j * g.cell);
          const d = Math.hypot(p.x, p.z);
          const a = fade(d) * g.opacity;
          if (d >= g.fadeOuter || a < 0.004) continue;
          const [x, y] = project(p);
          if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
          if (g.style === "dots") grid.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(g.width * 0.9 + 0.5)}" fill="${g.color}" fill-opacity="${f(a)}"/>`);
          else grid.push(`<path d="M${f(x - arm)} ${f(y)}H${f(x + arm)}M${f(x)} ${f(y - arm)}V${f(y + arm)}" stroke="${g.color}" stroke-opacity="${f(a)}" stroke-width="${f(g.width)}" fill="none"/>`);
        }
    }
  }

  // ---------------------------------------------------------------- floor highlights
  const floor: string[] = [];
  for (const t of o.tiles) {
    const size = t.size ?? config.grid.cell;
    const hs = size / 2 - 0.03, r = (size / 2) * 0.22;
    const pts: Pt[] = [];
    const corners: [number, number, number][] = [
      [hs - r, hs - r, 0],
      [-hs + r, hs - r, Math.PI / 2],
      [-hs + r, -hs + r, Math.PI],
      [hs - r, -hs + r, (3 * Math.PI) / 2],
    ];
    for (const [cx, cz, a0] of corners)
      for (let i = 0; i <= 8; i++) {
        const a = a0 + (i / 8) * (Math.PI / 2);
        pts.push(project(new THREE.Vector3(t.x + cx + Math.cos(a) * r, 0, t.z + cz + Math.sin(a) * r)));
      }
    const s = Math.min(1, t.strength);
    floor.push(`<path d="${pts.map((p, i) => `${i ? "L" : "M"}${f(p[0])} ${f(p[1])}`).join("")}Z" fill="${config.accent}" fill-opacity="${f(0.16 * s)}" stroke="${config.accent}" stroke-opacity="${f(0.7 * s)}" stroke-width="1"/>`);
  }
  for (const rp of o.ripples) {
    if ((rp.kind ?? 0) !== 1) continue; // only drawn rings are strokes; glows are left out
    const n = Math.max(48, Math.ceil((rp.radius * Math.PI * 2) / STEP));
    const runs: Pt[][] = [];
    const ring: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      ring.push(project(new THREE.Vector3((rp.x ?? 0) + Math.cos(a) * rp.radius, 0, (rp.z ?? 0) + Math.sin(a) * rp.radius)));
    }
    runs.push(ring);
    for (const run of runs) floor.push(`<path d="${pathD(run)}" fill="none" stroke="${config.accent}" stroke-opacity="${f(Math.min(1, rp.strength) * 0.8)}" stroke-width="${f(Math.max(1, rp.width))}"/>`);
  }

  // ---------------------------------------------------------------- strokes and particles
  const lines: string[] = [];
  const dots: string[] = [];
  const isVisible = (obj: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = obj; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), mid = new THREE.Vector3();
  const ca = new THREE.Color(), cb = new THREE.Color(), cm = new THREE.Color();

  for (const root of o.groups)
    root.traverse((obj) => {
      if (!isVisible(obj)) return;
      // fat lines
      if ((obj as THREE.Mesh & { isLine2?: boolean }).isLine2 || (obj as { isLineSegments2?: boolean }).isLineSegments2) {
        const mesh = obj as THREE.Mesh;
        const m = mesh.material as LineMaterial;
        const geo = mesh.geometry as THREE.InstancedBufferGeometry;
        const n = geo.instanceCount;
        if (!n || n === Infinity || m.opacity < 0.003) return;
        const pa = (geo.attributes.instanceStart as InterleavedBufferAttribute).data.array as Float32Array;
        const cArr = m.vertexColors ? ((geo.attributes.instanceColorStart as InterleavedBufferAttribute).data.array as Float32Array) : null;
        const period = m.dashSize + m.gapSize;
        const runs: { pts: Pt[]; color: string }[] = [];
        let cur: { pts: Pt[]; color: string } | null = null;
        let dist = 0;
        for (let i = 0; i < n; i++) {
          a.fromArray(pa, i * 6).applyMatrix4(mesh.matrixWorld);
          b.fromArray(pa, i * 6 + 3).applyMatrix4(mesh.matrixWorld);
          const len = a.distanceTo(b);
          if (cArr) {
            ca.setRGB(cArr[i * 6], cArr[i * 6 + 1], cArr[i * 6 + 2]);
            cb.setRGB(cArr[i * 6 + 3], cArr[i * 6 + 4], cArr[i * 6 + 5]);
          }
          const steps = Math.max(1, Math.ceil(len / STEP));
          for (let s = 0; s < steps; s++) {
            p0.lerpVectors(a, b, s / steps);
            p1.lerpVectors(a, b, (s + 1) / steps);
            mid.lerpVectors(p0, p1, 0.5);
            const dm = dist + (len * (s + 0.5)) / steps;
            const inDash = !m.dashed || (((dm + m.dashOffset) % period) + period) % period <= m.dashSize;
            if (!inDash) {
              if (cur) runs.push(cur);
              cur = null;
              continue;
            }
            const color = cArr ? hex(cm.copy(ca).lerp(cb, (s + 0.5) / steps).multiply(m.color)) : hex(m.color);
            if (!cur || cur.color !== color) {
              if (cur) runs.push(cur);
              cur = { pts: [project(p0)], color };
            }
            cur.pts.push(project(p1));
          }
          dist += len;
        }
        if (cur) runs.push(cur);
        for (const r of runs)
          lines.push(`<path d="${pathD(r.pts)}" fill="none" stroke="${r.color}" stroke-opacity="${f(m.opacity)}" stroke-width="${f(m.linewidth)}" stroke-linecap="round" stroke-linejoin="round"/>`);
        return;
      }
      // streaks: capsules from tail to head, the tail fading to uTail
      if (obj.userData.kind === "streaks") {
        const mesh = obj as THREE.Mesh;
        const geo = mesh.geometry as THREE.InstancedBufferGeometry;
        const mat = mesh.material as THREE.ShaderMaterial;
        const st = geo.attributes.aStart as THREE.InstancedBufferAttribute;
        const en = geo.attributes.aEnd as THREE.InstancedBufferAttribute;
        const col = geo.attributes.aColor as THREE.InstancedBufferAttribute;
        const wd = geo.attributes.aWidth as THREE.InstancedBufferAttribute;
        const op = mat.uniforms.uOpacity.value as number;
        const tail = mat.uniforms.uTail.value as number;
        for (let i = 0; i < geo.instanceCount; i++) {
          const alpha = col.getW(i) * op;
          if (alpha < 0.01) continue;
          a.fromBufferAttribute(st, i).applyMatrix4(mesh.matrixWorld);
          b.fromBufferAttribute(en, i).applyMatrix4(mesh.matrixWorld);
          const [x1, y1] = project(a), [x2, y2] = project(b);
          if (Math.max(x1, x2) < -10 || Math.max(y1, y2) < -10 || Math.min(x1, x2) > w + 10 || Math.min(y1, y2) > h + 10) continue;
          const c = hex(new THREE.Color().setRGB(col.getX(i), col.getY(i), col.getZ(i), THREE.SRGBColorSpace));
          const width = f(wd.getX(i));
          if (Math.hypot(x2 - x1, y2 - y1) < 0.5 || tail >= 0.99) {
            dots.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${c}" stroke-opacity="${f(alpha)}" stroke-width="${width}" stroke-linecap="round"/>`);
            continue;
          }
          const id = `s${gid++}`;
          defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"><stop offset="0" stop-color="${c}" stop-opacity="${f(alpha * tail)}"/><stop offset="1" stop-color="${c}" stop-opacity="${f(alpha)}"/></linearGradient>`);
          dots.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="url(#${id})" stroke-width="${width}" stroke-linecap="round"/>`);
        }
        return;
      }
      // particles (round dots from kit.particles)
      if ((obj as THREE.Points).isPoints) {
        const pts = obj as THREE.Points;
        const mat = pts.material as THREE.ShaderMaterial;
        const pos = pts.geometry.attributes.position as THREE.BufferAttribute;
        const size = pts.geometry.attributes.aSize as THREE.BufferAttribute | undefined;
        const col = pts.geometry.attributes.aColor as THREE.BufferAttribute | undefined;
        if (!size || !col) return;
        const scale = (mat.uniforms.uScale?.value as number) ?? 1;
        const op = (mat.uniforms.uOpacity?.value as number) ?? 1;
        for (let i = 0; i < pos.count; i++) {
          const alpha = col.getW(i) * op;
          if (alpha < 0.01) continue;
          a.fromBufferAttribute(pos, i).applyMatrix4(pts.matrixWorld);
          const [x, y] = project(a);
          if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
          const diameter = (size.getX(i) * scale) / o.dpr;
          const c = new THREE.Color().setRGB(col.getX(i), col.getY(i), col.getZ(i), THREE.SRGBColorSpace);
          dots.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(Math.max(0.25, diameter / 2))}" fill="${hex(c)}" fill-opacity="${f(alpha)}"/>`);
        }
      }
    });

  // ---------------------------------------------------------------- assemble
  const R = config.orb.radius;
  const centre = new THREE.Vector3(0, R, 0);
  const [ox, oy] = project(centre);
  const [ex] = project(centre.clone().addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize(), R));
  const W = Math.round(w), H = Math.round(h);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<defs><clipPath id="frame"><rect width="${W}" height="${H}"/></clipPath>${defs.join("")}</defs>`,
    `<g clip-path="url(#frame)">`,
    `<g id="grid">${grid.join("")}</g>`,
    `<g id="floor">${floor.join("")}</g>`,
    // where the orb goes: place the orb image under this SVG, centred on this circle
    `<circle id="orb-position" cx="${f(ox)}" cy="${f(oy)}" r="${f(Math.abs(ex - ox))}" fill="none" stroke="none"/>`,
    `<g id="lines">${lines.join("")}</g>`,
    `<g id="particles">${dots.join("")}</g>`,
    `</g></svg>`,
  ].join("");
}
