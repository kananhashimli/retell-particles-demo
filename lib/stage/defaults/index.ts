import type { DirectionId, StageConfig } from "../types";
import { DIRECTIONS } from "../directions";
import { mergeConfig, presetFor } from "../config";
import line from "./line.json";
import particles from "./particles.json";

/** The tuned look and scene settings for each direction, exported from the /dev panel. */
const SAVED = { line, particles } as unknown as Record<DirectionId, Partial<StageConfig>>;

/** The starting config for a direction: its preset with the saved settings on top. */
export function defaultsFor(id: DirectionId): StageConfig {
  return mergeConfig(presetFor(DIRECTIONS[id].preset, id), SAVED[id]);
}
