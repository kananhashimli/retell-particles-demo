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
  floorGlow: 0.22,
  contactShadow: 0.8,
  contactColor: "#071871",
  camera: { azimuth: 45, elevation: 12, zoom: 1, height: 1.25, panX: 0, panY: 0 },
  orb: { radius: 1, shadow: "#F7F8FB", mid: "#40d9f7", highlight: "#3e8cf7", grain: 0.4, speed: 1, contrast: 1, brightness: 0, crop: 1.06, shade: "#0D39BD", shadeAmount: 0.8, reflection: 0.6 },
  particles: { size: 1.5, emphasis: 1.6, density: 1, scatter: 0.025, idle: 0.012, idleSpeed: 3, muted: "#1A1C22", active: "#3E6AEF", highlight: "#3E8CF7" },
  lines: { width: 1.3, emphasis: 1.25, muted: "#1A1C22", active: "#3E6AEF" },
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
