import type { Direction, DirectionId } from "../types";
import { line } from "./line";
import { particles } from "./particles";

export const DIRECTIONS: Record<DirectionId, Direction> = { line, particles };
export const DIRECTION_ORDER: DirectionId[] = ["line", "particles"];
