import type * as THREE from "three";
import type { GridStyle, Ripple, Tile } from "./floor";
import type { OrbState } from "./orb";
import type { Kit } from "./kit";

export type DirectionId = "line" | "particles";
export type StepId = "listen" | "think" | "speak";
export type SceneId = "denoise" | "turns" | "llm" | "flow" | "colloquial" | "voices";

export const STEPS: { id: StepId; title: string; blurb: string; scenes: SceneId[] }[] = [
  { id: "listen", title: "Listen", blurb: "Hear the caller clearly. Clean audio. Natural timing. A conversation that starts with understanding.", scenes: ["denoise", "turns"] },
  { id: "think", title: "Think", blurb: "Reason over the call in real time, and keep it moving toward the outcome that matters.", scenes: ["llm", "flow"] },
  { id: "speak", title: "Speak", blurb: "Answer in a voice that sounds like a person on the phone, not a page being read aloud.", scenes: ["colloquial", "voices"] },
];

export const SCENES: Record<SceneId, { step: StepId; title: string; blurb: string }> = {
  denoise: { step: "listen", title: "Denoising", blurb: "Cancels background noise on the line" },
  turns: { step: "listen", title: "Turn-taking", blurb: "Knows when to speak and when to stop" },
  llm: { step: "think", title: "Retell LLM", blurb: "Text model built for live calls" },
  flow: { step: "think", title: "Conversation flow", blurb: "Checks outcomes, moves the call forward" },
  colloquial: { step: "speak", title: "Colloquial", blurb: "Makes replies sound spoken, not written" },
  voices: { step: "speak", title: "Retell voices", blurb: "Retell's own text to speech" },
};

export const SCENE_ORDER: SceneId[] = ["denoise", "turns", "llm", "flow", "colloquial", "voices"];

export interface StageConfig {
  direction: DirectionId;
  scene: SceneId;
  playing: boolean;
  speed: number;
  autoplay: boolean;
  background: string;
  ink: string;
  accent: string;
  grid: {
    style: GridStyle;
    color: string;
    opacity: number;
    cell: number;
    width: number;
    major: number;
    fadeInner: number;
    fadeOuter: number;
  };
  floorGlow: number;
  contactShadow: number;
  contactColor: string;
  camera: { azimuth: number; elevation: number; zoom: number; height: number; panX: number; panY: number };
  orb: {
    radius: number;
    shadow: string;
    mid: string;
    highlight: string;
    grain: number;
    speed: number;
    contrast: number;
    brightness: number;
    /** how far the orb is scaled inside its circular mask (1 = full, rim light visible) */
    crop: number;
    /** colour multiplied over the lower half, and how strongly */
    shade: string;
    shadeAmount: number;
    /** the orb mirrored in the floor beneath it, in its own colours */
    reflection: number;
  };
  /** shared look of every particle, dot and streak (Particles direction) */
  particles: ParticleLook;
  /** shared look of every stroke (Line direction) */
  lines: LineLook;
  /** scene changes between particle scenes: the dots fly to the next scene instead of crossfading */
  transition: { morph: boolean; duration: number; trail: number; swirl: number };
  /** per-scene settings, only the values that differ from the scene's defaults need to be here */
  sceneParams: Partial<Record<SceneId, SceneParams>>;
}

export type SceneParams = Record<string, number | boolean | string>;

export interface LineLook {
  /** base stroke width, css px */
  width: number;
  /** how much thicker clean / accent strokes are */
  emphasis: number;
  /** ink strokes: noise, written, guides, stems */
  muted: string;
  /** accent strokes: clean voice, traced paths, the agent */
  active: string;
}

export interface ParticleLook {
  /** base dot / streak width, css px */
  size: number;
  /** how much bigger lit dots, crests and comets are */
  emphasis: number;
  /** particles per unit of ring (1 = the reference: Retell LLM and denoised Denoising) */
  density: number;
  /** random spread of each dot around its ring, world units */
  scatter: number;
  /** idle wiggle, world units */
  idle: number;
  /** idle wiggles per loop (whole numbers keep loops seamless) */
  idleSpeed: number;
  /** resting dust and dots */
  muted: string;
  /** lit dots, comets, voices, calm lanes */
  active: string;
  /** brightest tint, near comet heads, crests and the orb */
  highlight: string;
}

/** A tunable scene setting. `rebuild` settings recreate the scene; the rest apply live. */
export interface ParamDef {
  value: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  rebuild?: boolean;
  /** shown in a sub-folder of this name in the panel */
  group?: string;
}
export type ParamDefs = Record<string, ParamDef>;
/** the value types of a ParamDefs object */
export type ParamValues<T extends ParamDefs> = { [K in keyof T]: T[K]["value"] extends boolean ? boolean : T[K]["value"] extends string ? string : number };

/** per-scene overrides of the shared particle look use these keys: own_<key> (bool) + p_<key> (value) */
export const PARTICLE_LOOK_KEYS = ["size", "emphasis", "density", "scatter", "idle", "idleSpeed", "muted", "active", "highlight"] as const;
export const paramDefaults = (defs: ParamDefs): SceneParams => Object.fromEntries(Object.entries(defs).map(([k, d]) => [k, d.value]));

/** Colours resolved for scenes */
export interface Look {
  bg: string;
  ink: string;
  accent: string;
  orbMid: string;
  orbHigh: string;
  line: string;
}

export interface OrbScope {
  state: OrbState;
  listen: number;
  speak: number;
  bands: [number, number, number];
  /** temporary orb colours (e.g. a voice's tint); null = the configured palette */
  tint?: { mid: string; high: string } | null;
}

export interface FloorScope {
  ripple(r: Ripple): void;
  tile(t: Tile): void;
  glow(v: number): void;
  readonly cell: number;
}

export interface SceneContext {
  group: THREE.Group;
  floor: FloorScope;
  orb: OrbScope;
  orbRadius: number;
  look: Look;
  kit: Kit;
  camera: THREE.Camera;
  /** this scene's current settings (defaults + overrides); read it inside update() to stay live */
  readonly params: SceneParams;
  /** shared particle look, live */
  readonly particles: ParticleLook;
  /** shared line look, live */
  readonly lines: LineLook;
  /** how far the orb's hue is turned by a tint right now (1 = full turn); accents follow it */
  readonly hueShift: number;
}

export interface FrameInfo {
  /** local scene time, wraps at duration */
  t: number;
  /** time since the scene was created */
  age: number;
  dt: number;
  /** 0..1 enter / exit */
  presence: number;
  /** whether to fade in at the loop's start / out at its end; off when a morph or the next scene takes over */
  loopIn: boolean;
  loopOut: boolean;
}

export interface SceneInstance {
  update(f: FrameInfo): void;
  dispose?(): void;
}

export interface SceneDef {
  duration: number;
  orb: OrbState;
  params?: ParamDefs;
  /** false: always crossfade into and out of this scene, never morph */
  morph?: boolean;
  create(ctx: SceneContext): SceneInstance;
}

export interface Direction {
  id: DirectionId;
  name: string;
  tagline: string;
  description: string;
  preset: DeepPartial<StageConfig>;
  scenes: Record<SceneId, SceneDef>;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
