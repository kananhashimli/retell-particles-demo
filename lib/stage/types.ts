import type * as THREE from "three";
import type { GridStyle, Ripple, Tile } from "./floor";
import type { OrbParams, OrbState } from "./orb";
import type { Kit } from "./kit";

export type DirectionId = "line" | "particles";
export type StepId = "listen" | "think" | "speak";
export type SceneId = "denoise" | "turns" | "ivr" | "llm" | "s2s" | "harness" | "flow" | "colloquial" | "guardrails" | "voices";
/** Cascaded (STT → Tell-1 → TTS-style text pipeline) or speech-to-speech agents: same layout, different cards */
export type Arch = "cascaded" | "s2s";

/** A capability group on the right of the section (the brief's "sections"). `icon` picks its step icon. */
export interface Group {
  id: string;
  icon: StepId;
  title: string;
  blurb: string;
  scenes: SceneId[];
}

/** Cascaded: the three capability groups. */
export const STEPS: (Group & { id: StepId })[] = [
  {
    id: "listen",
    icon: "listen",
    title: "Speech perception",
    blurb: "Detect speech, recognize call conditions, and determine when to listen, wait, or respond.",
    scenes: ["denoise", "turns", "ivr"],
  },
  {
    id: "think",
    icon: "think",
    title: "Reasoning & orchestration",
    blurb: "Bring together models, knowledge, and tools to move every conversation forward.",
    scenes: ["llm", "harness"],
  },
  {
    id: "speak",
    icon: "speak",
    title: "Response generation",
    blurb: "Deliver clear, natural responses shaped for live conversation.",
    scenes: ["colloquial", "guardrails"],
  },
];

/** Duplex (speech-to-speech): perception and generation are one group, since one model hears and speaks. */
export const S2S_GROUPS: Group[] = [
  {
    id: "semantic",
    icon: "listen",
    title: "Semantic perception & generation",
    blurb:
      "Handles interruptions, turn-taking, and backchannels in real time. Understands emotion and semantic meaning, then responds with context-aware, human-like speech.",
    // no required rewrite or guardrail stage is established for speech-to-speech: one neutral "spoken response" scene
    scenes: ["denoise", "turns", "ivr", "colloquial"],
  },
  {
    id: "think",
    icon: "think",
    title: "Reasoning & orchestration",
    blurb: "Bring together models, knowledge, and tools to move every conversation forward.",
    // speech-to-speech has its own scene in Tell-1's place: one unbroken stream instead of a text pipeline
    scenes: ["s2s", "harness"],
  },
];

/** `title` is the model card title, `tab` the short label in the stage's tab bar; `s2s` overrides both for speech-to-speech */
export const SCENES: Record<SceneId, { step: StepId; title: string; tab: string; s2s?: { title: string; tab: string } }> = {
  denoise: { step: "listen", title: "Denoising Model", tab: "Denoising" },
  turns: { step: "listen", title: "Turn-Taking Model", tab: "Turn-taking" },
  ivr: { step: "listen", title: "Voicemail & IVR Detection", tab: "Voicemail & IVR" },
  llm: { step: "think", title: "Tell-1", tab: "Tell-1" },
  s2s: { step: "think", title: "Speech-to-speech model", tab: "Speech-to-speech" },
  harness: { step: "think", title: "Retell Agent Harness", tab: "Agent harness" },
  flow: { step: "think", title: "Conversation flow", tab: "Flow" },
  colloquial: { step: "speak", title: "Colloquial Rewrite Model", tab: "Colloquial rewrite", s2s: { title: "Spoken response", tab: "Spoken response" } },
  guardrails: { step: "speak", title: "Response Guardrails", tab: "Guardrails" },
  voices: { step: "speak", title: "Retell voices", tab: "Voices" },
};

/** the groups shown, for an architecture */
export const groupsFor = (arch: Arch = "cascaded"): Group[] => (arch === "s2s" ? S2S_GROUPS : STEPS);
/** the group a scene plays in, for an architecture */
export const groupOf = (scene: SceneId, arch: Arch = "cascaded") => groupsFor(arch).find((g) => g.scenes.includes(scene));
/** every scene the section plays, in order */
export const orderFor = (arch: Arch = "cascaded"): SceneId[] => groupsFor(arch).flatMap((g) => g.scenes);
/** the scene to show after switching architecture: the same one if it plays there, else the first with the same role */
export const sceneIn = (scene: SceneId, arch: Arch): SceneId => {
  const order = orderFor(arch);
  return order.includes(scene) ? scene : order.find((id) => SCENES[id].step === SCENES[scene].step) ?? order[0];
};
export const sceneLabel = (id: SceneId, arch: Arch = "cascaded") => (arch === "s2s" && SCENES[id].s2s) || SCENES[id];

/** the section's scenes (cascaded); "flow" and "voices" stay in the engine for the lab */
export const SCENE_ORDER: SceneId[] = orderFor("cascaded");
/** every scene the engine knows, for the lab */
export const ALL_SCENES: SceneId[] = ["denoise", "turns", "ivr", "llm", "s2s", "harness", "flow", "colloquial", "guardrails", "voices"];

export interface StageConfig {
  direction: DirectionId;
  scene: SceneId;
  playing: boolean;
  /** which architecture the section shows: speech-to-speech gives each scene its own motion */
  arch: Arch;
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
  orb: OrbParams;
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
  /** the architecture shown; scenes ease into their speech-to-speech motion with archBlend */
  readonly arch: Arch;
}

export interface FrameInfo {
  /** local scene time, wraps at duration */
  t: number;
  /** time since the scene was created */
  age: number;
  dt: number;
  /** 0..1 enter / exit */
  presence: number;
  /** whether the scene closes its loop (it will play again): off when a morph or the next scene takes over at its end */
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
