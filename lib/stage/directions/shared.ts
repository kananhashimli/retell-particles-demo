import * as THREE from "three";
import type { Card } from "../cards";
import type { SceneContext } from "../types";
import { backOut, clamp, easeInOut, hash, speech, win } from "../util";

/** Fade a card in over [a, b] with a short lift. */
export function showBetween(card: Card, t: number, a: number, b: number, fin = 0.35, fout = 0.3) {
  const w = win(t, a, b, fin, fout);
  card.opacity = w;
  card.dy = (1 - w) * 8 * (t < (a + b) / 2 ? 1 : -0.6);
  card.scale = 0.96 + 0.04 * w;
  return w;
}

/** Typewriter reveal between a and b. */
export function typeBetween(card: Card, t: number, a: number, b: number) {
  card.reveal = clamp((t - a) / (b - a));
}

/** Staggered pop-in driven by scene presence: item i of n. */
export function pop(presence: number, i: number, n: number, spread = 0.5) {
  const d = (i / Math.max(1, n)) * spread;
  return backOut(clamp((presence - d) / (1 - spread)), 1.4);
}

/** Screen-space helpers in world terms (derived from the camera, so they follow azimuth changes). */
export function screenAxes(camera: THREE.Camera) {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  const right = new THREE.Vector3(e[0], e[1], e[2]).normalize();
  const up = new THREE.Vector3(e[4], e[5], e[6]).normalize();
  const toViewer = new THREE.Vector3(e[8], e[9], e[10]).normalize();
  const floorRight = new THREE.Vector3(right.x, 0, right.z).normalize();
  const floorFront = new THREE.Vector3(toViewer.x, 0, toViewer.z).normalize();
  return { right, up, toViewer, floorRight, floorFront };
}

/** Point on the orb's silhouette at screen angle `deg` (0 = right, 90 = top). */
export function orbEdge(ctx: SceneContext, deg: number, pad = 0) {
  const { right, up } = screenAxes(ctx.camera);
  const a = THREE.MathUtils.degToRad(deg);
  const R = ctx.orbRadius;
  return new THREE.Vector3(0, R, 0)
    .addScaledVector(right, Math.cos(a) * (R + pad))
    .addScaledVector(up, Math.sin(a) * (R + pad));
}

// ------------------------------------------------------------------ turn-taking script
export type Speaker = "caller" | "agent" | null;
export interface Segment {
  who: "caller" | "agent";
  a: number;
  b: number;
  kind?: "backchannel" | "interrupt";
}

export const TURN_DURATION = 10;
export const TURNS: Segment[] = [
  { who: "caller", a: 0.4, b: 2.6 },
  { who: "agent", a: 3.15, b: 5.55 },
  { who: "caller", a: 4.15, b: 4.55, kind: "backchannel" },
  { who: "caller", a: 5.4, b: 7.6, kind: "interrupt" },
  { who: "agent", a: 8.15, b: 9.55 },
];
/** moments the end of a turn is detected, [start, end] of the detection window */
export const DETECT: [number, number][] = [
  [2.6, 3.15],
  [7.6, 8.15],
];

export const TURN_CARDS: { a: number; b: number; title: string; icon: "spinner" | "clock" | "check" | "pause" | "speaker" | "ear"; accent?: boolean; meta: string }[] = [
  { a: 0.3, b: 2.6, title: "Listening to the caller…", icon: "spinner", meta: "Agent" },
  { a: 2.6, b: 3.6, title: "End of turn detected", icon: "clock", accent: true, meta: "Turn-taking" },
  { a: 3.6, b: 4.15, title: "Responding…", icon: "speaker", meta: "Agent" },
  { a: 4.15, b: 5.35, title: "“Mm-hmm” — keep talking", icon: "check", meta: "Backchannel" },
  { a: 5.4, b: 7.0, title: "Caller cut in — yielding", icon: "pause", accent: true, meta: "Interruption" },
  { a: 7.0, b: 7.6, title: "Listening to the caller…", icon: "spinner", meta: "Agent" },
  { a: 7.6, b: 8.5, title: "End of turn detected", icon: "clock", accent: true, meta: "Turn-taking" },
  { a: 8.5, b: 9.7, title: "Responding…", icon: "speaker", meta: "Agent" },
];

/** Who holds the floor, voice levels and detection progress at time t. */
export function turnState(t: number) {
  let caller = 0, agent = 0;
  for (const s of TURNS) {
    if (t < s.a || t > s.b) continue;
    // agent stops within ~120 ms of being interrupted
    let end = s.b;
    if (s.who === "agent") {
      const cut = TURNS.find((x) => x.kind === "interrupt" && x.a > s.a && x.a < s.b);
      if (cut) end = Math.min(end, cut.a + 0.12);
      if (t > end) continue;
    }
    const env = speech(t, s.who === "caller" ? 3 : 7) * Math.min(1, (t - s.a) / 0.08, (end - t) / 0.08);
    if (s.who === "caller") caller = Math.max(caller, env * (s.kind === "backchannel" ? 0.7 : 1));
    else agent = Math.max(agent, env);
  }
  let detect = -1;
  for (const [a, b] of DETECT) if (t >= a && t <= b) detect = (t - a) / (b - a);
  const agentActive = TURNS.some((s) => s.who === "agent" && t >= s.a && t <= Math.min(s.b, s.a + 99) && !isCut(s, t));
  const callerActive = TURNS.some((s) => s.who === "caller" && s.kind !== "backchannel" && t >= s.a && t <= s.b);
  const holder: Speaker = agentActive ? "agent" : callerActive ? "caller" : detect >= 0 ? "caller" : null;
  return { caller, agent, detect, holder, agentActive, callerActive };
}
function isCut(s: Segment, t: number) {
  const cut = TURNS.find((x) => x.kind === "interrupt" && x.a > s.a && x.a < s.b);
  return !!cut && t > cut.a + 0.12;
}

/** words with gaps, an occasional longer pause */
export function words(x: number, seed: number, len: number, gap: number, pauses: number) {
  const P = len + gap;
  const k = Math.floor(x / P);
  const f = (x - k * P) / len;
  if (f > 1 || hash(k * 1.7 + seed) < pauses) return 0;
  return (0.6 + 0.4 * hash(k * 2.1 + seed)) * Math.pow(Math.sin(Math.PI * f), 1.2);
}
/** voice level of the caller or the agent at time t, following the shared turn script */
export function voiceAt(t: number, who: "caller" | "agent", len: number, gap: number, pauses: number) {
  for (const s of TURNS) {
    if (s.who !== who) continue;
    let end = s.b;
    if (who === "agent") {
      const cut = TURNS.find((x) => x.kind === "interrupt" && x.a > s.a && x.a < s.b);
      if (cut) end = Math.min(end, cut.a + 0.12);
    }
    if (t < s.a || t > end) continue;
    const edge = Math.min(1, (t - s.a) / 0.06, (end - t) / 0.06);
    if (s.kind === "backchannel") return 0.55 * Math.sin(Math.PI * clamp((t - s.a) / (end - s.a)));
    return words(t - s.a, who === "caller" ? 3 : 7, len, gap, pauses) * edge;
  }
  return 0;
}

/** Who has the turn, eased: 0 = caller, 1 = agent (for a token travelling between them). */
export function turnToken(t: number) {
  // hand-offs: to agent at end of detection, back to caller at the interruption
  const hops: [number, number][] = [
    [3.0, 1],
    [5.45, 0],
    [8.0, 1],
    [9.7, 0],
  ];
  let v = 0;
  for (const [at, to] of hops) {
    const k = easeInOut((t - at) / 0.45);
    v = v + (to - v) * k;
  }
  return v;
}

export const VOICES = [
  { name: "Nova", trait: "Warm, natural", mid: "#40d9f7", high: "#3e8cf7" },
  { name: "Aria", trait: "Bright, upbeat", mid: "#8fb4ff", high: "#5b6cff" },
  { name: "Milo", trait: "Calm, low", mid: "#5fe0d2", high: "#2f9fd8" },
  { name: "Iris", trait: "Clear, friendly", mid: "#a99bff", high: "#6d5cff" },
  { name: "Jun", trait: "Soft, steady", mid: "#7fd3ff", high: "#3d64ff" },
];
