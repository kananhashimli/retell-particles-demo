// Direction C — Particles
// Crisp particles around the orb: dust, streaks and rings of dots. Size, density, scatter, the idle
// wiggle and the colours are shared by every scene (config.particles), so the scenes read as one
// system; each scene's own settings only shape what it does.

import * as THREE from "three";
import type { Direction, ParamDefs, ParamValues, ParticleLook, SceneContext, SceneDef } from "../types";
import { clamp, easeInOut, easeOut, hash, lerp, rng, shiftHue, smooth, speech, TAU, win } from "../util";
import { orbEdge, showBetween, TURN_CARDS, TURN_DURATION, TURNS, typeBetween, voiceAt, VOICES } from "./shared";

type RGB = readonly number[];
const mix3 = (a: RGB, b: RGB, t: number): number[] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const params = <T extends ParamDefs>(ctx: SceneContext) => ctx.params as ParamValues<T>;
/** inside the orb: never draw particles over its face */
const inOrb = (x: number, y: number, z: number, R: number) => x * x + (y - R) * (y - R) + z * z < R * R * 1.02;

/** the shared particle colours (config.particles), as sRGB for the particle shaders; read every frame so edits are live */
function palette(ctx: SceneContext) {
  const { kit, particles: L, hueShift } = ctx;
  // lit particles take the orb's tint along with it
  return { ink: kit.srgb(L.muted), accent: kit.srgb(shiftHue(L.active, hueShift)), high: kit.srgb(shiftHue(L.highlight, hueShift)) };
}

// ------------------------------------------------------------------ shared particle look
/** dots per unit of ring at density 1 — the Retell LLM rings, the reference for every scene */
const DOTS_PER_UNIT = 42;
/**
 * Per-scene overrides of the shared particle look. Each setting has an "own" switch: off follows
 * "Particles · all scenes", on uses the value next to it. The stage merges them into ctx.particles.
 */
const LOOK_GROUP = "Particle look · this scene";
const LOOK = {
  own_size: { value: false, label: "own dot size", group: LOOK_GROUP },
  p_size: { value: 1.5, min: 0.5, max: 5, step: 0.05, label: "dot size", group: LOOK_GROUP },
  own_emphasis: { value: false, label: "own lit / crest ×", group: LOOK_GROUP },
  p_emphasis: { value: 1.6, min: 1, max: 3, step: 0.05, label: "lit / crest ×", group: LOOK_GROUP },
  own_density: { value: false, label: "own density", group: LOOK_GROUP, rebuild: true },
  p_density: { value: 1, min: 0.2, max: 3, step: 0.05, label: "density", group: LOOK_GROUP, rebuild: true },
  own_scatter: { value: false, label: "own scatter", group: LOOK_GROUP },
  p_scatter: { value: 0.025, min: 0, max: 0.15, step: 0.001, label: "scatter", group: LOOK_GROUP },
  own_idle: { value: false, label: "own idle movement", group: LOOK_GROUP },
  p_idle: { value: 0.012, min: 0, max: 0.08, step: 0.001, label: "idle movement", group: LOOK_GROUP },
  own_idleSpeed: { value: false, label: "own idle speed", group: LOOK_GROUP },
  p_idleSpeed: { value: 3, min: 0, max: 12, step: 1, label: "idle wiggles / loop", group: LOOK_GROUP },
  own_muted: { value: false, label: "own muted colour", group: LOOK_GROUP },
  p_muted: { value: "#1A1C22", label: "muted colour", group: LOOK_GROUP },
  own_active: { value: false, label: "own active colour", group: LOOK_GROUP },
  p_active: { value: "#3E6AEF", label: "active colour", group: LOOK_GROUP },
  own_highlight: { value: false, label: "own highlight colour", group: LOOK_GROUP },
  p_highlight: { value: "#3E8CF7", label: "highlight colour", group: LOOK_GROUP },
} satisfies ParamDefs;
const ringCount = (ctx: SceneContext, r: number) => Math.max(12, Math.round(TAU * r * DOTS_PER_UNIT * ctx.particles.density));

/** Per-dot randoms, fixed at creation: size jitter, scatter direction, idle phase. */
interface Grain {
  s: number;
  sr: number;
  sy: number;
  ph: number;
}
const grain = (seed: number): Grain => ({
  s: 0.75 + hash(seed * 1.31) * 0.5,
  sr: hash(seed * 2.17 + 3) - 0.5,
  sy: hash(seed * 3.71 + 7),
  ph: hash(seed * 5.03 + 11) * TAU,
});

/**
 * Idle movement + scatter for one dot: returns [radial, vertical] offsets in world units.
 * Whole wiggles per loop keep every scene seamless.
 */
function wiggle(L: ParticleLook, g: Grain, t: number, D: number, out: number[]) {
  const n = Math.max(0, Math.round(L.idleSpeed));
  const w = (TAU * n * t) / D;
  out[0] = L.scatter * 2 * g.sr + L.idle * Math.sin(w + g.ph);
  out[1] = L.scatter * g.sy + L.idle * 0.7 * (1 + Math.sin((TAU * (n + 1) * t) / D + g.ph * 2));
  return out;
}

// ------------------------------------------------------------------ Listen · Denoising (dust → streaks)
// The room is a grey cloud of jittering dust. A clearing front leaves the orb; behind it the dust
// settles onto the floor and flows round in calm blue lanes.
const DENOISE = {
  outer: { value: 3.6, min: 2, max: 5, step: 0.05, label: "field radius", rebuild: true },
  cloud: { value: 1.6, min: 0.2, max: 3, step: 0.05, label: "cloud height", rebuild: true },
  lanes: { value: 0.14, min: 0.05, max: 0.5, step: 0.01, label: "lane spacing", rebuild: true },
  jitter: { value: 0.08, min: 0, max: 0.4, step: 0.005, label: "noise jitter" },
  bob: { value: 0.14, min: 0, max: 0.6, step: 0.005, label: "noise vertical" },
  waveStart: { value: 1.6, min: 0, max: 6, step: 0.05, label: "clear at s" },
  waveTime: { value: 2.8, min: 0.3, max: 6, step: 0.05, label: "clear over s" },
  front: { value: 0.6, min: 0.05, max: 2, step: 0.05, label: "front softness" },
  flow: { value: 0.35, min: 0, max: 2, step: 0.01, label: "lane speed" },
  trail: { value: 0.45, min: 0, max: 2, step: 0.01, label: "trail s" },
  dotOpacity: { value: 0.38, min: 0, max: 1, step: 0.01, label: "dust opacity" },
  streakOpacity: { value: 0.85, min: 0, max: 1, step: 0.01, label: "streak opacity" },
  tail: { value: 0, min: 0, max: 1, step: 0.01, label: "tail opacity" },
  ...LOOK,
} satisfies ParamDefs;

const denoise: SceneDef = {
  duration: 9,
  orb: "listening",
  params: DENOISE,
  create(ctx) {
    const { kit, group } = ctx;
    const R = ctx.orbRadius;
    const D = 9;
    const P0 = params<typeof DENOISE>(ctx);
    const N = Math.max(100, Math.round(2600 * ctx.particles.density));
    const dust = kit.particles(N);
    const streaks = kit.streaks(N);
    group.add(dust, streaks);
    const rand = rng(3);
    const parts = Array.from({ length: N }, (_, i) => {
      const r = Math.sqrt(lerp((R * 1.25) ** 2, P0.outer ** 2, rand()));
      const rl = R * 1.25 + Math.round((r - R * 1.25) / P0.lanes) * P0.lanes;
      return { r, rl, a: rand() * TAU, y: 0.05 + Math.pow(rand(), 1.7) * P0.cloud, f: 0.7 + rand() * 1.4, g: grain(i) };
    });
    const off = [0, 0];
    const listen = ctx.cards.add({ anchor: orbEdge(ctx, 200), x: -14, align: "right", icon: "spinner", title: "Listening to the caller…", meta: "Agent", time: "Now" });
    const clean = ctx.cards.add({ anchor: orbEdge(ctx, 20, 0.2), x: 14, align: "left", icon: "check", title: "Background noise removed", accent: true, meta: "Denoising", time: "Now" });
    const noisy = ctx.cards.add({ anchor: orbEdge(ctx, 20, 0.2), x: 14, align: "left", icon: "wave", title: "Traffic, TV, chatter…", meta: "Noise detected", time: "Now" });

    return {
      update({ t, presence }) {
        const C = palette(ctx);
        const P = params<typeof DENOISE>(ctx);
        const L = ctx.particles;
        const W = t < P.waveStart ? 0 : R * 1.1 + easeOut((t - P.waveStart) / P.waveTime) * (P0.outer + P.front + 0.2 - R * 1.1);
        const fade = win(t, 0, D, 0.5, 0.7) * presence;
        for (let i = 0; i < N; i++) {
          const p = parts[i];
          const c = easeInOut(smooth(p.r - P.front * 0.3, p.r + P.front * 0.7, W));
          // noise: jitter around a home point
          const jt = t * p.f, ph = p.g.ph * 16;
          const ca = p.a + Math.sin(jt * 1.3 + ph) * 0.1;
          const cr = p.r + Math.sin(jt * 2.1 + ph * 1.7) * P.jitter * 2;
          const cx = Math.cos(ca) * cr + Math.sin(jt * 5.3 + ph) * P.jitter;
          const cz = Math.sin(ca) * cr + Math.cos(jt * 4.7 + ph) * P.jitter;
          const cy = p.y + Math.sin(jt * 3.1 + ph * 2.3) * P.bob;
          // calm: lanes flowing round just above the floor, with the shared idle wiggle
          wiggle(L, p.g, t, D, off);
          const rl = p.rl + off[0], ly = 0.02 + off[1];
          const w = P.flow / p.rl;
          const ha = p.a - t * w, ta = ha + w * P.trail;
          const x = lerp(cx, Math.cos(ha) * rl, c), y = lerp(cy, ly, c), z = lerp(cz, Math.sin(ha) * rl, c);
          const tx = lerp(x, Math.cos(ta) * rl, c), tz = lerp(z, Math.sin(ta) * rl, c);
          const vis = inOrb(x, y, z, R) ? 0 : 1;
          const near = 1 - smooth(R * 1.2, P0.outer, p.rl);
          dust.set(i, x, y, z, L.size * p.g.s, C.ink, (1 - c) * P.dotOpacity * fade * vis * (0.75 + 0.25 * Math.sin(jt * 7 + ph)));
          streaks.set(i, tx, ly, tz, x, y, z, L.size * p.g.s, mix3(C.accent, C.high, near * 0.6), c * P.streakOpacity * fade * vis * (0.55 + 0.45 * near));
        }
        streaks.tail = P.tail;
        dust.commit();
        streaks.commit();
        ctx.orb.listen = speech(t, 3) * 0.8;
        showBetween(listen, t, 0.2, 8.8, 0.5, 0.4);
        showBetween(noisy, t, 0.5, P.waveStart + 0.6, 0.4, 0.3);
        showBetween(clean, t, P.waveStart + 1.4, 8.4, 0.4, 0.5);
      },
    };
  },
};

// ------------------------------------------------------------------ ring helpers
/** closed ring of radius r whose height is y0 + f(angle); f must be 2π-periodic */
function ringPts(out: Float32Array, n: number, r: number, y0: number, f: (a: number) => number) {
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1)) * TAU;
    out[i * 3] = Math.cos(a) * r;
    out[i * 3 + 1] = y0 + f(a);
    out[i * 3 + 2] = Math.sin(a) * r;
  }
}

// ------------------------------------------------------------------ Listen · Turn-taking (one ring: caller line, agent particles)
// As in Line: one ring is the conversation and a playhead writes it as it happens. The caller's
// voice is a grey wave line; the agent's voice is the same kind of wave, drawn in blue particles.
// Quiet stretches stay flat. Rotate the ring to put the hand-offs where they read best.
const TURNS_P = {
  rotation: { value: 0, min: -180, max: 180, step: 1, label: "rotation °" },
  spin: { value: 3, min: -30, max: 30, step: 0.5, label: "spin °/s" },
  radius: { value: 1.95, min: 1.2, max: 3.5, step: 0.01, label: "radius ×orb" },
  height: { value: 0.26, min: 0, max: 0.8, step: 0.005, label: "wave height" },
  cycles: { value: 64, min: 8, max: 200, step: 1, label: "wave cycles" },
  wordLength: { value: 0.4, min: 0.1, max: 1.2, step: 0.01, label: "word length s" },
  wordGap: { value: 0.2, min: 0, max: 1, step: 0.01, label: "word gap s" },
  pauses: { value: 0.15, min: 0, max: 0.8, step: 0.01, label: "pause chance" },
  lineWidth: { value: 1.4, min: 0.5, max: 4, step: 0.05, label: "caller line width" },
  lineOpacity: { value: 0.85, min: 0, max: 1, step: 0.01, label: "caller opacity" },
  dotOpacity: { value: 1, min: 0, max: 1, step: 0.01, label: "agent opacity" },
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
  ...LOOK,
} satisfies ParamDefs;

const turns: SceneDef = {
  duration: TURN_DURATION,
  orb: "listening",
  params: TURNS_P,
  create(ctx) {
    const { kit, group, look } = ctx;
    const R = ctx.orbRadius;
    const D = TURN_DURATION;
    const at = (rr: number, a: number, y = 0.015) => new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr);

    const guide = kit.line(240, { width: 1, color: look.ink, opacity: 0.2, dashed: true, dash: 0.05, gap: 0.07 });
    const gp = new Float32Array(240 * 3);
    group.add(guide);

    // samples round the ring; the agent's dots sit on these, so density sets how many
    const STEPS = Math.max(400, Math.round(1600 * ctx.particles.density));
    const MAXRUNS = 24;
    const runs = Array.from({ length: MAXRUNS }, () => {
      const l = kit.line(STEPS, { width: 1.4, color: look.ink });
      group.add(l);
      return l;
    });
    const dots = kit.particles(STEPS);
    group.add(dots);
    const grains = Array.from({ length: STEPS }, (_, i) => grain(i));
    const level = new Float32Array(STEPS);
    const agent = new Uint8Array(STEPS);
    let callerRuns: [number, number][] = [];
    let levelsKey = "";
    const sample = (len: number, gap: number, pauses: number) => {
      const key = `${len}|${gap}|${pauses}`;
      if (key === levelsKey) return;
      levelsKey = key;
      for (let i = 0; i < STEPS; i++) {
        const ti = (i / STEPS) * D;
        const c = voiceAt(ti, "caller", len, gap, pauses), g = voiceAt(ti, "agent", len, gap, pauses);
        level[i] = Math.max(c, g);
        agent[i] = g > c ? 1 : 0;
      }
      // the line runs everywhere the agent isn't speaking
      callerRuns = [];
      let s = -1;
      for (let i = 0; i <= STEPS; i++) {
        const isLine = i < STEPS && !agent[i];
        if (isLine && s < 0) s = i;
        if (!isLine && s >= 0) {
          callerRuns.push([s, i]);
          s = -1;
        }
      }
    };
    const pos = new Float32Array(STEPS * 3);
    const off = [0, 0];
    const head = kit.line(2, { width: 1.3, color: look.ink, opacity: 0.5 });
    group.add(head);
    const marks = [
      { t: 3.0, title: "End of turn" },
      { t: 4.25, title: "Backchannel" },
      { t: 5.45, title: "Interrupt → yield" },
      { t: 8.0, title: "End of turn" },
    ].map((m) => {
      const l = kit.line(2, { width: 1.1, color: look.ink, opacity: 0.4 });
      group.add(l);
      return { ...m, l, card: ctx.cards.add({ anchor: new THREE.Vector3(), kind: "label", title: m.title, y: -14, align: "center", accent: m.title.startsWith("Interrupt") }) };
    });
    const status = TURN_CARDS.map((c) => ctx.cards.add({ anchor: orbEdge(ctx, 205, 0.15), x: -12, align: "right", icon: c.icon, title: c.title, accent: c.accent, meta: c.meta, time: "Now" }));

    return {
      update({ t, age, presence }) {
        const C = palette(ctx);
        const P = params<typeof TURNS_P>(ctx);
        const L = ctx.particles;
        // slow continuous spin on scene time (not loop time), so it never jumps when the loop restarts
        const a0 = Math.PI * 0.75 + THREE.MathUtils.degToRad(P.rotation + P.spin * age);
        const angle = (tt: number) => a0 + (tt / D) * TAU;
        const r = P.radius * R;
        sample(P.wordLength, P.wordGap, P.pauses);
        const fadeAll = 1 - smooth(9.45, 9.95, t);
        const upto = Math.min(STEPS, Math.floor((t / D) * STEPS) + 1);
        const cyc = Math.round(P.cycles);
        for (let i = 0; i < upto; i++) {
          const a = angle((i / STEPS) * D);
          pos[i * 3] = Math.cos(a) * r;
          pos[i * 3 + 1] = 0.015 + level[i] * P.height * Math.sin(cyc * (a - a0));
          pos[i * 3 + 2] = Math.sin(a) * r;
        }
        // caller + quiet: wave line, one run per stretch between agent turns
        callerRuns.forEach(([s, e], k) => {
          if (k >= MAXRUNS) return;
          const l = runs[k];
          const stop = Math.min(e + 1, upto);
          if (stop - s < 2) {
            l.opacity = 0;
            return;
          }
          l.setPoints(pos.subarray(s * 3, stop * 3));
          l.material.linewidth = P.lineWidth;
          l.opacity = P.lineOpacity * presence * fadeAll;
        });
        for (let k = callerRuns.length; k < MAXRUNS; k++) runs[k].opacity = 0;
        // agent: the same wave, drawn in particles with the shared size, scatter and idle wiggle
        for (let i = 0; i < STEPS; i++) {
          if (i >= upto || !agent[i]) {
            dots.color[i * 4 + 3] = 0;
            continue;
          }
          const g = grains[i];
          wiggle(L, g, t, D, off);
          const a = angle((i / STEPS) * D);
          dots.set(i, Math.cos(a) * (r + off[0]), pos[i * 3 + 1] + off[1], Math.sin(a) * (r + off[0]), L.size * g.s, mix3(C.accent, C.high, 0.15), P.dotOpacity * presence * fadeAll);
        }
        dots.commit();

        ringPts(gp, 240, r, 0.015, () => 0);
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
          m.card.anchor = at(r + 0.23 + P.markerLength, angle(m.t), 0.02);
          m.card.opacity = w;
          m.l.opacity = P.markers ? P.markerOpacity * w : 0;
        });

        const caller = voiceAt(t, "caller", P.wordLength, P.wordGap, P.pauses);
        const ag = voiceAt(t, "agent", P.wordLength, P.wordGap, P.pauses);
        const agentTurn = TURNS.some((s) => s.who === "agent" && t >= s.a && t <= Math.min(s.b, 5.52));
        ctx.orb.state = ag > 0 || agentTurn ? "speaking" : "listening";
        ctx.orb.listen = caller;
        ctx.orb.speak = ag;
        ctx.orb.bands = [ag, ag * 0.8, ag * 0.5];
        TURN_CARDS.forEach((c, i) => showBetween(status[i], t, c.a, c.b, 0.25, 0.2));
      },
    };
  },
};

// ------------------------------------------------------------------ Think · Retell LLM (particle orbits)
// Rings of particles fly round the orb on tilted orbits, like a gyroscope; bright comets run along
// them as the model reasons. This scene sets the reference density for the direction.
const LLM_P = {
  rings: { value: 5, min: 1, max: 9, step: 1, rebuild: true },
  inner: { value: 1.35, min: 1.05, max: 2.5, step: 0.01, label: "inner radius ×orb", rebuild: true },
  spacing: { value: 0.2, min: 0.05, max: 0.6, step: 0.01, label: "ring spacing", rebuild: true },
  tilt: { value: 24, min: 0, max: 60, step: 1, label: "max tilt °", rebuild: true },
  speed: { value: 1, min: 0, max: 4, step: 1, label: "turns / loop" },
  comets: { value: 1, min: 0, max: 4, step: 1, label: "comets per ring" },
  cometSpeed: { value: 3, min: 1, max: 8, step: 1, label: "comet turns / loop" },
  comet: { value: 0.9, min: 0.1, max: 3, step: 0.05, label: "comet length" },
  opacity: { value: 0.42, min: 0, max: 1, step: 0.01, label: "ring opacity" },
  cometOpacity: { value: 1, min: 0, max: 1, step: 0.01, label: "comet opacity" },
  ...LOOK,
} satisfies ParamDefs;

const llm: SceneDef = {
  duration: 9,
  orb: "thinking",
  params: LLM_P,
  create(ctx) {
    const { kit, group } = ctx;
    const R = ctx.orbRadius;
    const D = 9;
    const P0 = params<typeof LLM_P>(ctx);
    const NR = Math.round(P0.rings);
    const rand = rng(17);
    let total = 0;
    const rings = Array.from({ length: NR }, (_, i) => {
      const tilt = THREE.MathUtils.degToRad(P0.tilt) * (0.35 + 0.65 * hash(i * 3.7 + 1));
      const yaw = (i / NR) * Math.PI + hash(i * 1.9) * 0.6;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, 0, "YXZ"));
      const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q), ay = new THREE.Vector3(0, 0, 1).applyQuaternion(q), n = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const r = R * P0.inner + i * P0.spacing;
      const M = ringCount(ctx, r);
      const dots = Array.from({ length: M }, (_, j) => ({ a: (j / M) * TAU + (rand() - 0.5) * (TAU / M), g: grain(total + j) }));
      total += M;
      return { ax, ay, n, r, dir: i % 2 ? -1 : 1, phase: hash(i * 5.3) * TAU, dots };
    });
    const field = kit.particles(total);
    group.add(field);
    const tmp = new THREE.Vector3();
    const off = [0, 0];
    const note = ctx.cards.add({ kind: "note", anchor: orbEdge(ctx, 160, 0.4), x: -10, align: "right", icon: "spark", title: "Retell LLM", lines: ["Caller wants to move Tuesday’s visit.", "Checking open slots for Thursday…"] });
    const chip = ctx.cards.add({ anchor: orbEdge(ctx, -25, 0.4), x: 12, align: "left", icon: "check", title: "Thursday 3:00 pm is open", accent: true, meta: "Retell LLM", time: "Now" });

    return {
      update({ t, presence }) {
        const C = palette(ctx);
        const P = params<typeof LLM_P>(ctx);
        const L = ctx.particles;
        const nc = Math.round(P.comets);
        let i = 0;
        rings.forEach((ring, ri) => {
          const spin = (ring.dir * (TAU * t * Math.round(P.speed) * (1 + (ri % 2)))) / D;
          const head = ring.phase + (ring.dir * (TAU * t * Math.round(P.cometSpeed))) / D;
          for (const d of ring.dots) {
            const a = d.a + spin;
            wiggle(L, d.g, t, D, off);
            const rr = ring.r * lerp(0.85, 1, easeOut(presence)) + off[0];
            tmp.set(0, R, 0).addScaledVector(ring.ax, Math.cos(a) * rr).addScaledVector(ring.ay, Math.sin(a) * rr).addScaledVector(ring.n, off[1] - L.scatter * 0.5);
            // brightness behind each comet head, along the direction of travel
            let k = 0;
            for (let c = 0; c < nc; c++) {
              const behind = ((((head + (c * TAU) / Math.max(1, nc) - a) * ring.dir) % TAU) + TAU) % TAU;
              k = Math.max(k, Math.exp(-behind / (P.comet * 0.35)));
            }
            const vis = smooth(0, 0.12, tmp.y) * (inOrb(tmp.x, tmp.y, tmp.z, R) ? 0 : 1) * presence;
            field.set(i++, tmp.x, tmp.y, tmp.z, L.size * lerp(1, L.emphasis, k) * d.g.s, mix3(C.ink, mix3(C.accent, C.high, k), Math.min(1, 0.35 + k)), lerp(P.opacity, P.cometOpacity, k) * vis);
          }
        });
        field.commit();
        showBetween(note, t, 0.6, 7.8, 0.4, 0.4);
        typeBetween(note, t, 1.0, 4.4);
        showBetween(chip, t, 5.2, 8.4, 0.35, 0.35);
      },
    };
  },
};

// ------------------------------------------------------------------ Think · Conversation flow (progress rings)
// Each ring around the orb is a step of the call. A comet runs round the current ring until it
// closes — the outcome is checked — then the next ring starts: the call moves forward.
// The dots drift slowly round their rings; the lit progress stays put while they pass through it.
const FLOW_STEPS = ["Greet", "Verify caller", "Find a slot", "Book visit", "Confirm", "Wrap up"];
const FLOW_P = {
  steps: { value: 4, min: 2, max: 6, step: 1, rebuild: true },
  inner: { value: 1.4, min: 1.05, max: 2.5, step: 0.01, label: "inner radius ×orb", rebuild: true },
  spacing: { value: 0.5, min: 0.15, max: 1.2, step: 0.01, label: "ring spacing", rebuild: true },
  start: { value: 135, min: 0, max: 360, step: 1, label: "start angle °" },
  drift: { value: 1, min: 0, max: 4, step: 1, label: "drift turns / loop" },
  opacity: { value: 0.32, min: 0, max: 1, step: 0.01, label: "ring opacity" },
  litOpacity: { value: 0.95, min: 0, max: 1, step: 0.01, label: "comet opacity" },
  doneOpacity: { value: 0.7, min: 0, max: 1, step: 0.01, label: "done opacity" },
  comet: { value: 0.5, min: 0.05, max: 2, step: 0.01, label: "comet length" },
  flash: { value: 0.6, min: 0, max: 2, step: 0.01, label: "check flash" },
  ...LOOK,
} satisfies ParamDefs;

const flow: SceneDef = {
  duration: 10,
  orb: "thinking",
  params: FLOW_P,
  create(ctx) {
    const { kit, group } = ctx;
    const R = ctx.orbRadius;
    const D = 10;
    const P0 = params<typeof FLOW_P>(ctx);
    const S = Math.round(P0.steps);
    const radii = Array.from({ length: S }, (_, i) => R * P0.inner + i * P0.spacing);
    const pts: { ring: number; a: number; g: Grain }[] = [];
    radii.forEach((r, ring) => {
      const n = ringCount(ctx, r);
      for (let j = 0; j < n; j++) pts.push({ ring, a: (j / n) * TAU, g: grain(pts.length) });
    });
    const field = kit.particles(pts.length);
    group.add(field);
    const span = 8.4 / S;
    const off = [0, 0];
    const labels = radii.map((_, i) => ctx.cards.add({ kind: "label", anchor: new THREE.Vector3(), y: -12, align: "center", title: `${String(i + 1).padStart(2, "0")}  ${FLOW_STEPS[i]}` }));
    const status = ctx.cards.add({ anchor: orbEdge(ctx, 35, 0.1), x: 14, align: "left", icon: "spinner", title: "Checking outcomes…", meta: "Conversation flow", time: "Now" });
    const done = ctx.cards.add({ anchor: orbEdge(ctx, 35, 0.1), x: 14, align: "left", icon: "check", title: "Goal met — moving on", accent: true, meta: "Conversation flow", time: "Now" });

    return {
      update({ t, presence }) {
        const C = palette(ctx);
        const P = params<typeof FLOW_P>(ctx);
        const L = ctx.particles;
        const a0 = THREE.MathUtils.degToRad(P.start);
        const end = 1 - smooth(9.2, 9.9, t);
        // per step: run round (65%), then a check flash
        const state = radii.map((_, i) => {
          const s0 = 0.3 + i * span;
          const run = easeInOut((t - s0) / (span * 0.65));
          const flash = t > s0 + span * 0.65 ? Math.exp(-(t - s0 - span * 0.65) / 0.25) : 0;
          return { run, flash, active: t >= s0 && t < s0 + span * 0.65 };
        });
        for (let i = 0; i < pts.length; i++) {
          const { ring, g } = pts[i];
          const s = state[ring];
          // drift round the ring (alternating direction); whole turns keep the loop seamless
          const a = pts[i].a + ((ring % 2 ? -1 : 1) * TAU * Math.round(P.drift) * t) / D;
          wiggle(L, g, t, D, off);
          const r = radii[ring] + off[0];
          const along = ((((a - a0) % TAU) + TAU) % TAU) / TAU; // 0..1 from the start angle
          const lit = along <= s.run ? 1 : 0;
          const ahead = s.run - along;
          const head = s.active && ahead >= 0 ? Math.exp(-ahead / (P.comet * 0.12)) : 0;
          const k = Math.max(head, lit * (s.run >= 1 ? 1 : 0.55));
          const pulse = s.flash * P.flash;
          const size = L.size * lerp(1, L.emphasis, Math.max(head, lit * 0.5)) * g.s * (1 + pulse * 0.4);
          const op = Math.max(P.opacity, lit * (s.run >= 1 ? P.doneOpacity : P.doneOpacity * 0.8), head * P.litOpacity) * (1 + pulse * 0.4);
          const col = k > 0.02 ? mix3(C.accent, C.high, head * 0.5) : C.ink;
          field.set(i, Math.cos(a) * r, 0.02 + off[1] + pulse * 0.05, Math.sin(a) * r, size, col, Math.min(1, op) * end * presence);
        }
        field.commit();
        radii.forEach((r, i) => {
          labels[i].anchor = new THREE.Vector3(Math.cos(a0) * r, 0.05, Math.sin(a0) * r);
          labels[i].opacity = presence * (0.4 + 0.6 * clamp(state[i].run * 2));
          labels[i].accent = state[i].run >= 1 && end > 0.5;
        });
        showBetween(status, t, 0.3, 8.6, 0.3, 0.3);
        showBetween(done, t, 8.7, 9.6, 0.2, 0.3);
      },
    };
  },
};

// ------------------------------------------------------------------ Speak · Colloquial (dot surface)
// The floor around the orb is a field of dots that rolls as the voice leaves the orb. Every wave is
// a round ring with a soft, rounded crest. Written text sounds flat and even, so the first waves
// are identical; spoken replies swell and settle in phrases, with real pauses between them.
const COLLOQUIAL = {
  spacing: { value: 0.14, min: 0.05, max: 0.4, step: 0.005, label: "ring spacing", rebuild: true },
  inner: { value: 1.2, min: 1, max: 2, step: 0.01, label: "inner radius ×orb", rebuild: true },
  outer: { value: 3.7, min: 2, max: 5.5, step: 0.05, label: "outer radius", rebuild: true },
  height: { value: 0.3, min: 0, max: 0.8, step: 0.005, label: "wave height" },
  waves: { value: 5, min: 1, max: 16, step: 1, label: "waves / loop" },
  wavelength: { value: 0.55, min: 0.15, max: 2, step: 0.01 },
  hold: { value: 0.55, min: 0.05, max: 0.95, step: 0.01, label: "crest hold" },
  crestColor: { value: 1, min: 0, max: 1, step: 0.01, label: "crest colour" },
  phrase: { value: 1.5, min: 0.3, max: 4, step: 0.05, label: "phrase s" },
  pause: { value: 0.5, min: 0, max: 2, step: 0.05, label: "pause s" },
  swell: { value: 0.35, min: 0, max: 1, step: 0.01, label: "phrase variation" },
  drift: { value: 1, min: 0, max: 4, step: 1, label: "drift turns / loop" },
  spokenFrom: { value: 2.2, min: 0, max: 9, step: 0.1, label: "spoken from s" },
  spokenTo: { value: 3.6, min: 0, max: 9, step: 0.1, label: "spoken by s" },
  decay: { value: 0.5, min: 0, max: 1, step: 0.01, label: "height decay" },
  opacity: { value: 0.3, min: 0, max: 1, step: 0.01, label: "rest opacity" },
  crestOpacity: { value: 0.95, min: 0, max: 1, step: 0.01, label: "crest opacity" },
  ...LOOK,
} satisfies ParamDefs;

const colloquial: SceneDef = {
  duration: 10,
  orb: "speaking",
  params: COLLOQUIAL,
  create(ctx) {
    const { kit, group } = ctx;
    const R = ctx.orbRadius;
    const D = 10;
    const P0 = params<typeof COLLOQUIAL>(ctx);
    const r0 = R * P0.inner;
    const pts: { r: number; a: number; ring: number; g: Grain }[] = [];
    for (let r = r0, ring = 0; r <= P0.outer; r += P0.spacing, ring++) {
      const n = ringCount(ctx, r);
      const a0 = hash(r * 13.1) * TAU;
      for (let i = 0; i < n; i++) pts.push({ r, a: a0 + (i / n) * TAU, ring, g: grain(pts.length) });
    }
    const N = pts.length;
    const field = kit.particles(N);
    group.add(field);
    const off = [0, 0];
    const wNote = ctx.cards.add({ kind: "note", anchor: orbEdge(ctx, 200, 0.15), x: -10, align: "right", icon: "text", title: "Written", lines: ["Your appointment has been successfully", "rescheduled to Tuesday."] });
    const sNote = ctx.cards.add({ kind: "note", anchor: orbEdge(ctx, 20, 0.15), x: 12, align: "left", icon: "speaker", title: "Spoken", lines: ["Okay — you’re all set", "for Tuesday."], accent: true });

    return {
      update({ t, presence }) {
        const C = palette(ctx);
        const P = params<typeof COLLOQUIAL>(ctx);
        const L = ctx.particles;
        const spoken = (b: number) => smooth(P.spokenFrom, Math.max(P.spokenFrom + 0.01, P.spokenTo), b) * (1 - smooth(8.4, 9.8, b));
        const waves = Math.round(P.waves);
        const v = (waves * P.wavelength) / D; // speed so a whole number of waves leave per loop
        const span = P0.outer - r0;
        // spoken phrasing: smooth swells of P.phrase seconds with P.pause seconds of quiet between
        const period = P.phrase + P.pause;
        const phraseEnv = (b: number) => {
          const k = Math.floor(b / period), x = (b - k * period) / P.phrase;
          return x > 1 ? 0 : Math.pow(Math.sin(Math.PI * x), 0.9) * (1 - P.swell + P.swell * hash(k * 4.7 + 1));
        };
        const drift = (TAU * Math.round(P.drift) * t) / D;
        for (let i = 0; i < N; i++) {
          const { r: rBase, ring, g } = pts[i];
          const dr = rBase - r0;
          wiggle(L, g, t, D, off);
          const r = rBase + off[0];
          const a = pts[i].a + (ring % 2 ? -drift : drift) * (0.4 + 0.6 * (r0 / rBase));
          const phase = dr / P.wavelength - (waves * t) / D;
          const born = (((t - dr / v) % D) + D) % D;
          const m = spoken(born);
          // crest with a plateau: rings rise, hold up top for `hold` of the cycle, then settle
          const wave = 0.5 + 0.5 * Math.sin(TAU * phase);
          const pulse = smooth(1 - P.hold, 1 - P.hold * 0.35, wave);
          const k = lerp(0.75 * pulse, pulse * phraseEnv(born), m) * (1 - P.decay * (dr / span));
          const edge = smooth(0, 0.25, dr) * (1 - smooth(span * 0.7, span, dr));
          // lifted rings take the active colour, warming toward the highlight at the top and once spoken
          const lifted = mix3(C.accent, C.high, Math.min(1, pulse * 0.35 + m * 0.3));
          const col = mix3(C.ink, lifted, Math.min(1, k * 1.6) * P.crestColor);
          field.set(i, Math.cos(a) * r, 0.02 + off[1] + P.height * k, Math.sin(a) * r, L.size * lerp(1, L.emphasis, k) * g.s, col, lerp(P.opacity, P.crestOpacity, k) * edge * presence);
        }
        field.commit();
        const m = spoken(t);
        const s = lerp(0.5, speech(t, 5), m);
        ctx.orb.speak = s;
        ctx.orb.bands = [s, s * 0.8, s * 0.5];
        showBetween(wNote, t, 0.3, 9.5, 0.4, 0.4);
        typeBetween(wNote, t, 0.4, 1.8);
        wNote.strike = clamp((t - 2.3) / 0.7) * (1 - smooth(9.2, 9.9, t));
        wNote.opacity *= 1 - 0.4 * m;
        showBetween(sNote, t, 3.4, 9.2, 0.4, 0.4);
        typeBetween(sNote, t, 3.6, 4.6);
      },
    };
  },
};

// ------------------------------------------------------------------ Speak · Retell voices (unmuted rings)
// One ring of particles per voice, all muted and flat. Each voice in turn unmutes its own ring,
// which rises into a sound wave made of dots, with its own pattern; the orb takes its tint.
const VOICES_P = {
  inner: { value: 1.35, min: 1.05, max: 2.5, step: 0.01, label: "inner radius ×orb", rebuild: true },
  spacing: { value: 0.4, min: 0.1, max: 1, step: 0.01, label: "ring spacing", rebuild: true },
  height: { value: 0.24, min: 0, max: 0.8, step: 0.005, label: "wave height" },
  cycles: { value: 1, min: 0.25, max: 3, step: 0.05, label: "wave density" },
  drift: { value: 1, min: -4, max: 4, step: 1, label: "drift / loop" },
  fade: { value: 0.35, min: 0.05, max: 0.9, step: 0.01, label: "unmute s" },
  opacity: { value: 0.32, min: 0, max: 1, step: 0.01, label: "muted opacity" },
  activeOpacity: { value: 1, min: 0, max: 1, step: 0.01, label: "voice opacity" },
  tint: { value: true, label: "tint orb per voice" },
  ...LOOK,
} satisfies ParamDefs;
/** each voice's wave: cycles around its ring and how peaked the crests are */
const VOICE_SHAPES = [
  { cycles: 18, peak: 1 },
  { cycles: 28, peak: 1.8 },
  { cycles: 12, peak: 0.8 },
  { cycles: 34, peak: 2.4 },
  { cycles: 22, peak: 1.3 },
];

const voices: SceneDef = {
  duration: 10,
  orb: "speaking",
  params: VOICES_P,
  create(ctx) {
    const { kit, group } = ctx;
    const R = ctx.orbRadius;
    const D = 10;
    const P0 = params<typeof VOICES_P>(ctx);
    const NV = VOICES.length;
    const radii = Array.from({ length: NV }, (_, i) => R * P0.inner + i * P0.spacing);
    const pts: { ring: number; a: number; g: Grain }[] = [];
    radii.forEach((r, ring) => {
      const n = ringCount(ctx, r);
      for (let j = 0; j < n; j++) pts.push({ ring, a: (j / n) * TAU, g: grain(pts.length) });
    });
    const field = kit.particles(pts.length);
    group.add(field);
    const step = D / NV;
    const off = [0, 0];
    const card = VOICES.map((v) => ctx.cards.add({ anchor: orbEdge(ctx, 200, 0.1), x: -14, align: "right", icon: "wave", title: `${v.name} · ${v.trait}`, meta: "Retell voices", time: "Speaking" }));

    return {
      update({ t, presence }) {
        const C = palette(ctx);
        const P = params<typeof VOICES_P>(ctx);
        const L = ctx.particles;
        const vi = Math.floor(t / step) % NV;
        const local = t - vi * step;
        const on = radii.map((_, i) => (i === vi ? win(local, 0, step, P.fade, P.fade) : 0));
        const level = radii.map((_, i) => 0.3 + 0.7 * speech(t, i * 5));
        const spin = (TAU * t * P.drift) / D;
        for (let i = 0; i < pts.length; i++) {
          const { ring, a, g } = pts[i];
          wiggle(L, g, t, D, off);
          const r = radii[ring] + off[0];
          const o = on[ring];
          const shape = VOICE_SHAPES[ring % VOICE_SHAPES.length];
          const w = 0.5 + 0.5 * Math.sin(Math.round(shape.cycles * P.cycles) * a - spin * (ring % 2 ? -1 : 1));
          const k = o * Math.pow(w, shape.peak) * level[ring];
          field.set(i, Math.cos(a) * r, 0.02 + off[1] + P.height * k, Math.sin(a) * r, L.size * lerp(1, L.emphasis, o * w) * g.s, mix3(C.ink, mix3(C.accent, C.high, k), o), lerp(P.opacity, P.activeOpacity, o * (0.45 + 0.55 * w)) * presence);
        }
        field.commit();
        const s = speech(t, vi * 5) * on[vi];
        ctx.orb.speak = s;
        ctx.orb.bands = [s, s * 0.8, s * 0.6];
        ctx.orb.tint = P.tint ? { mid: VOICES[vi].mid, high: VOICES[vi].high } : null;
        card.forEach((c, i) => (i === vi ? showBetween(c, local, 0.25, step - 0.05, 0.3, 0.2) : (c.opacity = 0)));
      },
    };
  },
};

export const particles: Direction = {
  id: "particles",
  name: "Particles",
  tagline: "Rings of particles",
  description: "Crisp particles around the orb: rings of dust, waves and dots that carry each model's job — clearing noise, taking turns, orbiting thought, stepping the call forward, speaking.",
  preset: {
    background: "#F6F6F8",
    grid: { style: "lines", color: "#1A1C22", opacity: 0.06, cell: 1, width: 1, major: 0, fadeInner: 3, fadeOuter: 7.5 },
    floorGlow: 0.3,
    contactShadow: 0.8,
    light: { orb: 6, key: 1.4, ambient: 1.6, shadows: 0.05 },
    cards: { show: false, style: "glass-dark", scale: 1 },
    camera: { azimuth: 45, elevation: 12, zoom: 1, height: 1.25, panX: 0, panY: 0 },
    particles: { size: 1.5, emphasis: 1.6, density: 1, scatter: 0.025, idle: 0.012, idleSpeed: 3, muted: "#1A1C22", active: "#3E6AEF", highlight: "#3E8CF7" },
  },
  scenes: { denoise, turns, llm, flow, colloquial, voices },
};
