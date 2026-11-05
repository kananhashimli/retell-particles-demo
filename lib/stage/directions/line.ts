// Direction B — Line
// Everything is drawn: thin ink lines and accent strokes on the grid, like a technical drawing
// standing in isometric space. Rings of simple waves carry sound around the orb; straight paths
// along the grid show reasoning. Labels are mono.
//
// Every scene declares its settings (`params`); the controls panel edits them live.

import * as THREE from "three";
import type { Direction, ParamDefs, ParamValues, SceneContext, SceneDef } from "../types";
import type { FatLine } from "../kit";
import { clamp, easeInOut, easeOut, lerp, resample, smooth, speech, TAU, win } from "../util";
import { pop, screenAxes, TURN_DURATION, TURNS, voiceAt, VOICES } from "./shared";

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ helpers

/** Writes a closed ring of radius r on the floor whose height is y0 + f(angle). f must be 2π-periodic. */
function ring(out: Float32Array, n: number, r: number, y0: number, f: (a: number) => number) {
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1)) * TAU;
    out[i * 3] = Math.cos(a) * r;
    out[i * 3 + 1] = y0 + f(a);
    out[i * 3 + 2] = Math.sin(a) * r;
  }
}

/**
 * Tallest wave that keeps concentric rings `spacing` apart from touching on screen. Seen from a low
 * camera, neighbouring rings are only spacing × sin(elevation) apart, so wave height follows that.
 */
function waveRoom(ctx: SceneContext, spacing: number) {
  const sinEl = Math.max(0.05, screenAxes(ctx.camera).toViewer.y);
  return 0.46 * spacing * sinEl;
}

/** set a line's colour between two hex colours */
const tint = (l: FatLine, a: string, b: string, t: number) => l.material.color.set(a).lerp(new THREE.Color(b), clamp(t));

/** the base width the shared line look is authored against */
const BASE_WIDTH = 1.3;
/**
 * Apply the shared line look (config.lines) to every stroke a scene owns: ink strokes take the muted
 * colour, accent strokes the active one, and widths scale with the shared width. Strokes a scene
 * styles itself are flagged with userData.ownWidth / userData.ownColor.
 */
function styleLines(ctx: SceneContext) {
  const L = ctx.lines;
  const k = L.width / BASE_WIDTH;
  ctx.group.traverse((o) => {
    const l = o as FatLine;
    if (!(l as unknown as { isLine2?: boolean }).isLine2) return;
    const u = l.userData;
    if (!u.ownColor && u.role) l.material.color.set(u.role === "active" ? L.active : L.muted);
    if (!u.ownWidth && u.baseWidth) l.material.linewidth = u.baseWidth * k;
  });
}
/** mark strokes the scene styles itself */
const own = (l: FatLine, width = true, color = true) => {
  if (width) l.userData.ownWidth = true;
  if (color) l.userData.ownColor = true;
  return l;
};

/** draw only the first u (0..1) of a polyline */
function partial(pts: THREE.Vector3[], u: number) {
  const n = Math.max(2, Math.round(pts.length * clamp(u)));
  return u <= 0.001 ? [] : pts.slice(0, n);
}

const params = <T extends ParamDefs>(ctx: SceneContext) => ctx.params as ParamValues<T>;

// ------------------------------------------------------------------ Listen · Denoising
// Rings of sound close in on the orb. Far out they carry room noise; by the time they reach the
// agent, only a plain, clean wave is left.
const DENOISE = {
  rings: { value: 3, min: 1, max: 6, step: 1 },
  passes: { value: 1, min: 1, max: 4, step: 1, label: "passes / loop" },
  outer: { value: 3, min: 1.6, max: 4.5, step: 0.05, label: "outer radius" },
  inner: { value: 1.15, min: 1, max: 2, step: 0.01, label: "inner radius ×orb" },
  height: { value: 1, min: 0, max: 3, step: 0.01, label: "wave height" },
  noiseFreq: { value: 17, min: 2, max: 90, step: 1, label: "noise freq A" },
  noiseFreq2: { value: 29, min: 2, max: 90, step: 1, label: "noise freq B" },
  noiseMix: { value: 0.45, min: 0, max: 1, step: 0.01, label: "noise B mix" },
  cleanFreq: { value: 16, min: 2, max: 60, step: 1, label: "clean freq" },
  cleanHeight: { value: 0.55, min: 0, max: 1.5, step: 0.01, label: "clean height" },
  cleanFrom: { value: 0.3, min: 0, max: 1, step: 0.01, label: "clean from" },
  cleanTo: { value: 0.68, min: 0, max: 1, step: 0.01, label: "clean to" },
  drift: { value: 2, min: -8, max: 8, step: 1, label: "drift / loop" },
  noisyOpacity: { value: 0.4, min: 0, max: 1, step: 0.01, label: "noisy opacity" },
  cleanOpacity: { value: 0.95, min: 0, max: 1, step: 0.01, label: "clean opacity" },
  fadeIn: { value: 0.2, min: 0, max: 0.5, step: 0.01, label: "fade in" },
  fadeOut: { value: 0.15, min: 0, max: 0.5, step: 0.01, label: "fade out" },
} satisfies ParamDefs;

const denoise: SceneDef = {
  duration: 8,
  orb: "listening",
  params: DENOISE,
  create(ctx) {
    const { kit, group, look } = ctx;
    const R = ctx.orbRadius;
    const D = 8;
    const MAX = 6;
    const N = 480;
    const rings = Array.from({ length: MAX }, () => {
      const l = own(kit.line(N, { width: 1.3, color: look.ink }));
      group.add(l);
      return l;
    });
    const pos = new Float32Array(N * 3);

    return {
      update({ t, presence }) {
        const P = params<typeof DENOISE>(ctx);
        const n = Math.round(P.rings);
        const rIn = R * P.inner, rOut = Math.max(P.outer, rIn + 0.1);
        const amp = waveRoom(ctx, (rOut - rIn) / n) * P.height;
        const spin = (TAU * t * P.drift) / D;
        rings.forEach((l, i) => {
          if (i >= n) {
            l.opacity = 0;
            return;
          }
          const u = ((t * P.passes) / D + i / n) % 1; // 0 = far out, 1 = at the orb
          const r = lerp(rOut, rIn, u);
          const clean = smooth(P.cleanFrom, Math.max(P.cleanFrom + 0.001, P.cleanTo), u);
          ring(pos, N, r, 0.015, (a) => {
            const noisy = (1 - P.noiseMix) * Math.sin(P.noiseFreq * a + spin + i) + P.noiseMix * Math.sin(P.noiseFreq2 * a - 1.5 * spin + 2 * i);
            const voice = P.cleanHeight * Math.sin(P.cleanFreq * a - spin + i);
            return amp * lerp(noisy, voice, clean);
          });
          l.setPoints(pos);
          tint(l, ctx.lines.muted, ctx.lines.active, clean);
          l.material.linewidth = ctx.lines.width * lerp(1, ctx.lines.emphasis, clean);
          l.opacity = win(u, 0, 1, P.fadeIn, P.fadeOut) * lerp(P.noisyOpacity, P.cleanOpacity, clean) * presence;
        });
        styleLines(ctx);
        ctx.orb.listen = 0.25 + 0.75 * speech(t, 3);
      },
    };
  },
};

// ------------------------------------------------------------------ Listen · Turn-taking
// One ring is the conversation. The playhead writes the caller's voice in grey and the agent's in
// blue; they take turns with quiet gaps between them.
const TURNS_P = {
  rotation: { value: 0, min: -180, max: 180, step: 1, label: "rotation °" },
  spin: { value: 3, min: -30, max: 30, step: 0.5, label: "spin °/s" },
  radius: { value: 1.95, min: 1.2, max: 3.5, step: 0.01, label: "radius ×orb" },
  height: { value: 0.26, min: 0, max: 0.8, step: 0.005, label: "wave height" },
  cycles: { value: 64, min: 8, max: 200, step: 1, label: "wave cycles" },
  wordLength: { value: 0.4, min: 0.1, max: 1.2, step: 0.01, label: "word length s" },
  wordGap: { value: 0.2, min: 0, max: 1, step: 0.01, label: "word gap s" },
  pauses: { value: 0.15, min: 0, max: 0.8, step: 0.01, label: "pause chance" },
  guide: { value: true, label: "guide ring" },
  guideOpacity: { value: 0.2, min: 0, max: 1, step: 0.01, label: "guide opacity" },
  playhead: { value: true },
  playheadLength: { value: 0.3, min: 0.05, max: 1, step: 0.01, label: "playhead length" },
  playheadWidth: { value: 1.3, min: 0.5, max: 6, step: 0.05, label: "playhead width" },
  playheadColor: { value: "#1A1C22", label: "playhead colour" },
  playheadOpacity: { value: 0.45, min: 0, max: 1, step: 0.01, label: "playhead opacity" },
  markers: { value: true, label: "hand-off ticks" },
  markerLength: { value: 0.22, min: 0.05, max: 1, step: 0.01, label: "tick length" },
  markerWidth: { value: 1.1, min: 0.5, max: 6, step: 0.05, label: "tick width" },
  markerColor: { value: "#1A1C22", label: "tick colour" },
  markerOpacity: { value: 0.4, min: 0, max: 1, step: 0.01, label: "tick opacity" },
} satisfies ParamDefs;

const turns: SceneDef = {
  duration: TURN_DURATION,
  orb: "listening",
  params: TURNS_P,
  create(ctx) {
    const { kit, group, look } = ctx;
    const R = ctx.orbRadius;
    const D = TURN_DURATION;
    // the ring's start angle; the rotation setting turns the whole ring
    let a0 = Math.PI * 0.75;
    const angle = (t: number) => a0 + (t / D) * TAU;
    const at = (rr: number, a: number, y = 0.015) => v3(Math.cos(a) * rr, y, Math.sin(a) * rr);

    const guide = kit.line(240, { width: 1, color: look.ink, opacity: 0.2, dashed: true, dash: 0.05, gap: 0.07 });
    const gp = new Float32Array(240 * 3);
    group.add(guide);

    const STEPS = 1600;
    const wave = own(kit.line(STEPS, { width: 1.5, vertexColors: true }));
    group.add(wave);
    const level = new Float32Array(STEPS);
    const col = new Float32Array(STEPS * 3);
    const pos = new Float32Array(STEPS * 3);
    let levelsKey = "";
    const sampleLevels = (len: number, gap: number, pauses: number) => {
      // colours come from the shared line look, so a colour change resamples too
      const inkL = kit.linear(ctx.lines.muted), accL = kit.linear(ctx.lines.active);
      const key = `${len}|${gap}|${pauses}|${ctx.lines.muted}|${ctx.lines.active}`;
      if (key === levelsKey) return;
      levelsKey = key;
      for (let i = 0; i < STEPS; i++) {
        const ti = (i / STEPS) * D;
        const c = voiceAt(ti, "caller", len, gap, pauses), g = voiceAt(ti, "agent", len, gap, pauses);
        level[i] = Math.max(c, g);
        col.set(g > c ? accL : inkL, i * 3);
      }
    };

    const head = own(kit.line(2, { width: 1.3, color: look.ink, opacity: 0.5 }));
    group.add(head);
    const marks = [
      { t: 3.0, title: "End of turn" },
      { t: 4.25, title: "Backchannel" },
      { t: 5.45, title: "Interrupt → yield" },
      { t: 8.0, title: "End of turn" },
    ].map((m) => {
      const l = own(kit.line(2, { width: 1.1, color: look.ink, opacity: 0.4 }));
      group.add(l);
      return { ...m, l };
    });

    return {
      update({ t, age, presence }) {
        const P = params<typeof TURNS_P>(ctx);
        // slow continuous spin on scene time (not loop time), so it never jumps when the loop restarts
        a0 = Math.PI * 0.75 + THREE.MathUtils.degToRad(P.rotation + P.spin * age);
        const r = P.radius * R;
        sampleLevels(P.wordLength, P.wordGap, P.pauses);
        const fadeAll = 1 - smooth(9.45, 9.95, t);
        const upto = Math.min(STEPS, Math.floor((t / D) * STEPS) + 1);
        for (let i = 0; i < upto; i++) {
          const a = angle((i / STEPS) * D);
          const h = level[i] * P.height * Math.sin(Math.round(P.cycles) * (a - a0));
          pos[i * 3] = Math.cos(a) * r;
          pos[i * 3 + 1] = 0.015 + h;
          pos[i * 3 + 2] = Math.sin(a) * r;
        }
        wave.setPoints(pos.subarray(0, upto * 3), col.subarray(0, upto * 3));
        wave.material.linewidth = ctx.lines.width * ctx.lines.emphasis;
        wave.opacity = presence * fadeAll;

        ring(gp, 240, r, 0.015, () => 0);
        guide.setPoints(gp);
        guide.opacity = P.guide ? P.guideOpacity * presence : 0;
        const ha = angle(t);
        head.setPoints([at(r - P.playheadLength, ha), at(r + P.playheadLength, ha)]);
        head.material.linewidth = P.playheadWidth;
        head.material.color.set(P.playheadColor);
        head.opacity = P.playhead ? P.playheadOpacity * presence : 0;
        marks.forEach((m) => {
          const w = t > m.t ? fadeAll * presence * easeOut((t - m.t) / 0.3) : 0;
          m.l.setPoints([at(r + 0.12, angle(m.t)), at(r + 0.12 + P.markerLength, angle(m.t))]);
          m.l.material.linewidth = P.markerWidth;
          m.l.material.color.set(P.markerColor);
          m.l.opacity = P.markers ? P.markerOpacity * w : 0;
        });

        styleLines(ctx);
        const caller = voiceAt(t, "caller", P.wordLength, P.wordGap, P.pauses);
        const agent = voiceAt(t, "agent", P.wordLength, P.wordGap, P.pauses);
        const agentTurn = TURNS.some((s) => s.who === "agent" && t >= s.a && t <= Math.min(s.b, 5.52));
        ctx.orb.state = agent > 0 || agentTurn ? "speaking" : "listening";
        ctx.orb.listen = caller;
        ctx.orb.speak = agent;
      },
    };
  },
};

// ------------------------------------------------------------------ Think · shared flowchart parts
// Nodes are square plates lying in the grid; paths run straight along grid lines into the point
// where the orb touches the floor.
const Y = 0.014;
const THINK = {
  distance: { value: 3, min: 1.6, max: 4.5, step: 0.05, label: "node distance", rebuild: true },
  plate: { value: 1, min: 0.3, max: 2, step: 0.01, label: "plate size", rebuild: true },
  corner: { value: 0.1, min: 0, max: 0.5, step: 0.01, label: "plate corner", rebuild: true },
  plateOpacity: { value: 0.55, min: 0, max: 1, step: 0.01, label: "plate opacity" },
  stems: { value: true, label: "stems" },
  stemHeight: { value: 0.32, min: 0.05, max: 1.5, step: 0.01, label: "stem height", rebuild: true },
  guideOpacity: { value: 0.3, min: 0, max: 1, step: 0.01, label: "guide opacity" },
  dash: { value: 0.08, min: 0.01, max: 0.5, step: 0.005, label: "flow dash" },
  gap: { value: 0.12, min: 0.01, max: 0.5, step: 0.005, label: "flow gap" },
  flowSpeed: { value: 1, min: 0, max: 4, step: 0.05, label: "flow speed" },
  highlight: { value: 0.6, min: 0, max: 1, step: 0.01, label: "tile highlight" },
} satisfies ParamDefs;
type ThinkP = ParamValues<typeof THINK>;

/** rounded square aligned with the grid, centred on c */
function squarePts(c: THREE.Vector3, s: number, r: number) {
  const pts: THREE.Vector3[] = [];
  r = Math.min(r, s / 2);
  const h = s / 2 - r;
  const corners: [number, number, number][] = [
    [h, h, 0],
    [-h, h, Math.PI / 2],
    [-h, -h, Math.PI],
    [h, -h, (3 * Math.PI) / 2],
  ];
  for (const [x, z, a0] of corners)
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push(v3(c.x + x + Math.cos(a) * r, Y, c.z + z + Math.sin(a) * r));
    }
  pts.push(pts[0].clone());
  return pts;
}

interface Node {
  p: THREE.Vector3;
  base: FatLine;
  lit: FatLine;
  stem: FatLine;
}

/** a node on a grid axis: dir is ±x or ±z */
function makeNode(ctx: SceneContext, P: ThinkP, dir: THREE.Vector3, dashed = false): Node {
  const { kit, group, look } = ctx;
  const p = dir.clone().multiplyScalar(P.distance);
  const pts = squarePts(p, P.plate, P.corner);
  const base = kit.line(pts.length, { width: 1.2, color: look.ink, opacity: 0.55, dashed, dash: 0.06, gap: 0.05 });
  base.setPoints(pts);
  const lit = kit.line(pts.length, { width: 1.6, color: look.accent, opacity: 0 });
  lit.setPoints(pts);
  const stem = kit.line(2, { width: 1, color: look.ink, opacity: 0.3 });
  stem.setPoints([p.clone().setY(Y), p.clone().setY(P.stemHeight)]);
  group.add(base, lit, stem);
  return { p, base, lit, stem };
}

/** straight path along the node's grid axis, between the plate and the orb's contact point */
function makePath(ctx: SceneContext, P: ThinkP, node: Node, outward: boolean) {
  const { kit, group, look } = ctx;
  const dir = node.p.clone().normalize();
  const edge = dir.clone().multiplyScalar(P.distance - P.plate / 2 - 0.06).setY(Y);
  const orb = v3(0, Y, 0);
  const pts = resample(outward ? [orb, edge] : [edge, orb], 100);
  const guide = kit.line(pts.length, { width: 1, color: look.ink, opacity: 0.3, dashed: true, dash: 0.05, gap: 0.06 });
  guide.setPoints(pts);
  const trace = kit.line(pts.length, { width: 1.8, color: look.accent, opacity: 0 });
  const flow = kit.line(pts.length, { width: 1.8, color: look.accent, opacity: 0, dashed: true, dash: 0.08, gap: 0.12 });
  group.add(guide, trace, flow);
  return { pts, guide, trace, flow };
}
type Path = ReturnType<typeof makePath>;

/** apply the live look settings to nodes and paths: plates at the shared width, traces emphasised */
function styleThink(ctx: SceneContext, P: ThinkP, nodes: Node[], paths: Path[], presence: number) {
  const p = easeOut(presence);
  const L = ctx.lines;
  nodes.forEach((n) => {
    n.base.material.linewidth = L.width;
    n.lit.material.linewidth = L.width * L.emphasis;
    n.base.userData.ownWidth = n.lit.userData.ownWidth = true;
    n.stem.opacity = P.stems ? 0.3 * p : 0;
  });
  paths.forEach((q) => {
    q.guide.opacity = P.guideOpacity * p;
    q.trace.material.linewidth = q.flow.material.linewidth = L.width * L.emphasis * 1.15;
    q.trace.userData.ownWidth = q.flow.userData.ownWidth = true;
    q.flow.material.dashSize = P.dash;
    q.flow.material.gapSize = P.gap;
  });
}

const X = v3(1, 0, 0), Z = v3(0, 0, 1);

// ------------------------------------------------------------------ Think · Retell LLM
// Context converges on the orb — the live transcript, the knowledge base, a calendar lookup — and
// the reply streams out token by token.
const llm: SceneDef = {
  duration: 9,
  orb: "thinking",
  params: THINK,
  create(ctx) {
    const P0 = params<typeof THINK>(ctx);
    const nodes = {
      transcript: makeNode(ctx, P0, Z),
      knowledge: makeNode(ctx, P0, X.clone().negate()),
      calendar: makeNode(ctx, P0, Z.clone().negate()),
      reply: makeNode(ctx, P0, X),
    };
    const paths = {
      transcript: makePath(ctx, P0, nodes.transcript, false),
      knowledge: makePath(ctx, P0, nodes.knowledge, false),
      calendar: makePath(ctx, P0, nodes.calendar, false),
      reply: makePath(ctx, P0, nodes.reply, true),
    };
    const inputs = [
      { k: "transcript" as const, start: 0.2 },
      { k: "knowledge" as const, start: 0.7 },
      { k: "calendar" as const, start: 1.2 },
    ];

    return {
      update({ t, presence }) {
        const P = params<typeof THINK>(ctx);
        const end = 1 - smooth(8.4, 8.95, t);
        styleThink(ctx, P, Object.values(nodes), Object.values(paths), presence);
        Object.values(nodes).forEach((n, i) => {
          n.base.opacity = P.plateOpacity * pop(presence, i, 4);
        });

        // inputs draw in, then keep flowing while the orb reads them
        for (const { k, start } of inputs) {
          const q = paths[k];
          const u = easeInOut((t - start) / 1.1);
          q.trace.setPoints(partial(q.pts, u));
          q.trace.opacity = win(t, start, 4.6, 0.05, 0.6) * (u < 1 ? 1 : 0.35) * presence;
          q.flow.setPoints(q.pts);
          q.flow.opacity = win(t, start + 1.1, 4.6, 0.3, 0.6) * presence;
          q.flow.material.dashOffset = -t * 0.9 * P.flowSpeed;
          nodes[k].lit.opacity = win(t, start, 4.6, 0.2, 0.6) * presence;
        }

        // the reply streams out
        const q = paths.reply;
        const ur = easeInOut((t - 4.4) / 1.4);
        q.trace.setPoints(partial(q.pts, ur));
        q.trace.opacity = (ur < 1 ? 1 : 0.35) * end * presence;
        q.flow.setPoints(partial(q.pts, ur));
        q.flow.opacity = (t > 4.4 ? 1 : 0) * end * presence;
        q.flow.material.dashOffset = -t * 1.4 * P.flowSpeed;
        const lit = smooth(5.6, 6.0, t) * end;
        nodes.reply.lit.opacity = lit * presence;
        ctx.floor.tile({ x: nodes.reply.p.x, z: nodes.reply.p.z, strength: P.highlight * lit, size: P0.plate * 0.86 });
        styleLines(ctx);
      },
    };
  },
};

// ------------------------------------------------------------------ Think · Conversation flow
// A step is verified, the agent checks both next steps, and commits to the one that meets the goal.
const flow: SceneDef = {
  duration: 10,
  orb: "thinking",
  params: THINK,
  create(ctx) {
    const { kit, group, look } = ctx;
    const P0 = params<typeof THINK>(ctx);
    const nA = makeNode(ctx, P0, Z);
    const nC = makeNode(ctx, P0, X);
    const nD = makeNode(ctx, P0, Z.clone().negate(), true);
    const pA = makePath(ctx, P0, nA, false);
    const pC = makePath(ctx, P0, nC, true);
    const pD = makePath(ctx, P0, nD, true);
    const probe = { c: kit.line(pC.pts.length, { width: 1.5, color: look.accent, opacity: 0 }), d: kit.line(pD.pts.length, { width: 1.5, color: look.accent, opacity: 0 }) };
    group.add(probe.c, probe.d);

    return {
      update({ t, presence }) {
        const P = params<typeof THINK>(ctx);
        const end = 1 - smooth(9.2, 9.9, t);
        const chosen = smooth(4.8, 5.2, t) * end;
        styleThink(ctx, P, [nA, nC, nD], [pA, pC, pD], presence);
        nA.base.opacity = P.plateOpacity * pop(presence, 0, 3);
        nC.base.opacity = P.plateOpacity * pop(presence, 1, 3);
        nD.base.opacity = P.plateOpacity * 0.82 * pop(presence, 2, 3) * (1 - 0.45 * chosen);

        // the caller is verified
        const u1 = easeInOut((t - 0.3) / 1.3);
        pA.trace.setPoints(partial(pA.pts, u1));
        pA.trace.opacity = end * presence;
        nA.lit.opacity = smooth(0.2, 0.6, t) * end * presence;
        // both next steps are checked
        const pu = Math.sin(clamp((t - 1.9) / 1.6) * Math.PI) * 0.6;
        probe.c.setPoints(partial(pC.pts, t < 3.5 ? pu : 0));
        probe.d.setPoints(partial(pD.pts, pu));
        probe.c.opacity = probe.d.opacity = 0.55 * presence;
        // commit to booking
        const u2 = easeInOut((t - 3.7) / 1.3);
        pC.trace.setPoints(partial(pC.pts, t > 3.7 ? u2 : 0));
        pC.trace.opacity = end * presence;
        nC.lit.opacity = chosen * presence;

        ctx.floor.tile({ x: nC.p.x, z: nC.p.z, strength: P.highlight * chosen, size: P0.plate * 0.86 });
        styleLines(ctx);
      },
    };
  },
};

// ------------------------------------------------------------------ Speak · Colloquial
// The same rings as listening, now leaving the orb. Written text sounds flat and even, so the first
// rings carry a stiff, regular wave; spoken replies come in phrases with pauses between them.
const COLLOQUIAL = {
  rings: { value: 3, min: 1, max: 6, step: 1 },
  passes: { value: 2, min: 1, max: 5, step: 1, label: "passes / loop" },
  inner: { value: 1.15, min: 1, max: 2, step: 0.01, label: "inner radius ×orb" },
  outer: { value: 3, min: 1.6, max: 4.5, step: 0.05, label: "outer radius" },
  height: { value: 1, min: 0, max: 3, step: 0.01, label: "wave height" },
  decay: { value: 0.3, min: 0, max: 1, step: 0.01, label: "height decay" },
  writtenFreq: { value: 24, min: 2, max: 80, step: 1, label: "written freq" },
  writtenHeight: { value: 0.7, min: 0, max: 1.5, step: 0.01, label: "written height" },
  spokenFreq: { value: 18, min: 2, max: 80, step: 1, label: "spoken freq" },
  phrases: { value: 3, min: 1, max: 8, step: 1 },
  phraseShape: { value: 0.8, min: 0.2, max: 3, step: 0.05, label: "phrase shape" },
  spokenFrom: { value: 2.2, min: 0, max: 9, step: 0.1, label: "spoken from s" },
  spokenTo: { value: 3.6, min: 0, max: 9, step: 0.1, label: "spoken by s" },
  drift: { value: 2, min: -8, max: 8, step: 1, label: "drift / loop" },
  writtenOpacity: { value: 0.5, min: 0, max: 1, step: 0.01, label: "written opacity" },
  spokenOpacity: { value: 0.95, min: 0, max: 1, step: 0.01, label: "spoken opacity" },
  fadeIn: { value: 0.12, min: 0, max: 0.5, step: 0.01, label: "fade in" },
  fadeOut: { value: 0.25, min: 0, max: 0.5, step: 0.01, label: "fade out" },
} satisfies ParamDefs;

const colloquial: SceneDef = {
  duration: 10,
  orb: "speaking",
  params: COLLOQUIAL,
  create(ctx) {
    const { kit, group, look } = ctx;
    const R = ctx.orbRadius;
    const D = 10;
    const MAX = 6;
    const N = 480;
    const rings = Array.from({ length: MAX }, () => {
      const l = own(kit.line(N, { width: 1.3, color: look.ink }));
      group.add(l);
      return l;
    });
    const pos = new Float32Array(N * 3);

    return {
      update({ t, presence }) {
        const P = params<typeof COLLOQUIAL>(ctx);
        // how spoken a ring born at time b sounds: written first, then spoken, back again for the loop
        const spoken = (b: number) => smooth(P.spokenFrom, Math.max(P.spokenFrom + 0.01, P.spokenTo), b) * (1 - smooth(8.4, 9.8, b));
        const n = Math.round(P.rings);
        const travel = D / P.passes;
        const rIn = R * P.inner, rOut = Math.max(P.outer, rIn + 0.1);
        const amp = waveRoom(ctx, (rOut - rIn) / n) * P.height;
        const spin = (TAU * t * P.drift) / D;
        rings.forEach((l, i) => {
          if (i >= n) {
            l.opacity = 0;
            return;
          }
          const u = (t / travel + i / n) % 1; // 0 = at the orb, 1 = far out
          const born = (((t - u * travel) % D) + D) % D;
          const m = spoken(born);
          const r = lerp(rIn, rOut, u);
          ring(pos, N, r, 0.015, (a) => {
            const written = P.writtenHeight * Math.sin(P.writtenFreq * a + i);
            const phrase = Math.pow(Math.max(0, Math.sin(P.phrases * a - spin + i)), P.phraseShape);
            const said = Math.sin(P.spokenFreq * a + spin + i) * phrase;
            return amp * lerp(written, said, m) * (1 - P.decay * u);
          });
          l.setPoints(pos);
          tint(l, ctx.lines.muted, ctx.lines.active, m);
          l.material.linewidth = ctx.lines.width * lerp(1, ctx.lines.emphasis, m);
          l.opacity = win(u, 0, 1, P.fadeIn, P.fadeOut) * lerp(P.writtenOpacity, P.spokenOpacity, m) * presence;
        });
        const m = spoken(t);
        const s = lerp(0.5, speech(t, 5), m);
        ctx.orb.speak = s;
      },
    };
  },
};

// ------------------------------------------------------------------ Speak · Retell voices
// One ring per voice, lying flat and muted. When a voice speaks, its own ring rises into a vertical
// sound wave with that voice's pattern; the rings never bend out of round. The orb takes the tint.
const VOICES_P = {
  inner: { value: 1.35, min: 1.05, max: 2.5, step: 0.01, label: "inner radius ×orb" },
  spacing: { value: 0.4, min: 0.1, max: 1, step: 0.01, label: "ring spacing" },
  height: { value: 0.24, min: 0, max: 0.8, step: 0.005, label: "wave height" },
  cycles: { value: 1, min: 0.25, max: 3, step: 0.05, label: "wave density" },
  phrasing: { value: 0.45, min: 0, max: 1, step: 0.01, label: "phrase variation" },
  drift: { value: 1, min: -4, max: 4, step: 1, label: "drift / loop" },
  fade: { value: 0.35, min: 0.05, max: 0.9, step: 0.01, label: "unmute s" },
  opacity: { value: 0.35, min: 0, max: 1, step: 0.01, label: "muted opacity" },
  activeOpacity: { value: 1, min: 0, max: 1, step: 0.01, label: "voice opacity" },
  tint: { value: true, label: "tint orb per voice" },
} satisfies ParamDefs;
/** each voice's sound: cycles round its ring and how many phrases break it up */
const LINE_VOICE_SHAPES = [
  { cycles: 40, phrases: 3 },
  { cycles: 56, phrases: 4 },
  { cycles: 30, phrases: 2 },
  { cycles: 68, phrases: 5 },
  { cycles: 46, phrases: 3 },
];

const voices: SceneDef = {
  duration: 10,
  orb: "speaking",
  params: VOICES_P,
  create(ctx) {
    const { kit, group, look } = ctx;
    const R = ctx.orbRadius;
    const D = 10;
    const NV = VOICES.length;
    const N = 720;
    const rings = Array.from({ length: NV }, () => {
      const l = own(kit.line(N, { width: 1.3, color: look.ink }));
      group.add(l);
      return l;
    });
    const step = D / NV;
    const pos = new Float32Array(N * 3);

    return {
      update({ t, presence }) {
        const P = params<typeof VOICES_P>(ctx);
        const L = ctx.lines;
        const vi = Math.floor(t / step) % NV;
        const local = t - vi * step;
        const spin = (TAU * t * Math.round(P.drift)) / D;
        rings.forEach((l, i) => {
          const r = (P.inner * R + i * P.spacing) * lerp(0.9, 1, easeOut(presence));
          const on = i === vi ? win(local, 0, step, P.fade, P.fade) : 0;
          const shape = LINE_VOICE_SHAPES[i % LINE_VOICE_SHAPES.length];
          const cyc = Math.max(1, Math.round(shape.cycles * P.cycles));
          const level = 0.35 + 0.65 * speech(t, i * 5);
          const dir = i % 2 ? -1 : 1;
          ring(pos, N, r, 0.015, (a) => {
            if (on <= 0.001) return 0;
            // phrases: smooth swells round the ring with quiet between them
            const phrase = 1 - P.phrasing + P.phrasing * Math.pow(Math.max(0, Math.sin(shape.phrases * a + dir * spin * 0.5 + i)), 0.8);
            return P.height * on * level * phrase * Math.sin(cyc * a - dir * spin);
          });
          l.setPoints(pos);
          l.material.color.set(L.muted).lerp(new THREE.Color(L.active), on);
          l.material.linewidth = L.width * lerp(1, L.emphasis, on);
          l.opacity = lerp(P.opacity, P.activeOpacity, on) * presence;
        });
        const s = speech(t, vi * 5) * win(local, 0, step, P.fade, P.fade);
        ctx.orb.speak = s;
        ctx.orb.tint = P.tint ? VOICES[vi] : null;
      },
    };
  },
};

export const line: Direction = {
  id: "line",
  name: "Line",
  tagline: "Drawn, precise, technical",
  description: "Thin ink strokes on the grid. Rings of waves carry sound around the orb; flowcharts on the floor show reasoning.",
  preset: {
    background: "#F6F6F8",
    grid: { style: "lines", color: "#1A1C22", opacity: 0.1, cell: 1, width: 1, major: 0, fadeInner: 3.4, fadeOuter: 8 },
    floorGlow: 0.22,
    contactShadow: 0.26,
    camera: { azimuth: 45, elevation: 12, zoom: 1, height: 1.25, panX: 0, panY: 0 },
  },
  scenes: { denoise, turns, llm, flow, colloquial, voices },
};
