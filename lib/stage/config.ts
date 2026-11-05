import { ORB_LOOKS } from "./orb";
import type { DeepPartial, StageConfig } from "./types";

export const DEFAULT_CONFIG: StageConfig = {
  direction: "line",
  scene: "denoise",
  playing: true,
  speed: 1,
  autoplay: true,
  background: "#F6F6F8",
  ink: "#1A1C22",
  accent: "#3E6AEF",
  grid: { style: "lines", color: "#1A1C22", opacity: 0.1, cell: 1, width: 1, major: 0, fadeInner: 3.4, fadeOuter: 8 },
  floorGlow: 0.07,
  contactShadow: 0.14,
  contactColor: "#3d64ff",
  camera: { azimuth: 45, elevation: 12, zoom: 1, height: 1.25, panX: 0, panY: 0 },
  orb: { radius: 1, mid: "#00ccff", highlight: "#3d64ff", speed: 1, reflection: 0.35, looks: ORB_LOOKS },
  particles: { size: 1.5, emphasis: 1.6, density: 1, scatter: 0.025, idle: 0.012, idleSpeed: 3, muted: "#1A1C22", active: "#3E6AEF", highlight: "#3E8CF7" },
  lines: { width: 1.3, emphasis: 1.25, muted: "#1A1C22", active: "#3E6AEF" },
  transition: { morph: true, duration: 1.4, trail: 0.03, swirl: 0.25 },
  sceneParams: {},
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep merge that never mutates its inputs. */
export function mergeConfig<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return structuredClone(base);
  const out = structuredClone(base) as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(out[k]) ? mergeConfig(out[k], v as DeepPartial<unknown>) : v;
  }
  return out as T;
}

/** The default config for a direction: base defaults + that direction's look. */
export function presetFor(preset: DeepPartial<StageConfig>, direction: StageConfig["direction"]): StageConfig {
  return mergeConfig(mergeConfig(DEFAULT_CONFIG, preset), { direction });
}
