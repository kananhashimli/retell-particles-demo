// The Retell Agent Harness schedule, shared by the harness scene and the model cards over it, so a
// component's card lights exactly while its node on the stage does.
//
// The harness is a system layer, not a pipeline: across one loop, components step in when the
// conversation needs them — some turns refine and retrieve, some only move the flow, some do nothing.

import { clamp, easeInOut } from "../util";

export type HarnessPart = "query" | "retrieval" | "flow";
export const HARNESS_PARTS: HarnessPart[] = ["query", "retrieval", "flow"];
export const HARNESS_DURATION = 12;
/** a call to a component: when, and which way the comet runs (out: orb → node, in: node → orb) */
export const HARNESS_EVENTS: { part: HarnessPart; t: number; dir: "out" | "in" }[] = [
  { part: "query", t: 0.7, dir: "out" },
  { part: "retrieval", t: 1.6, dir: "in" },
  { part: "flow", t: 4.4, dir: "in" },
  { part: "retrieval", t: 6.5, dir: "in" },
  { part: "query", t: 8.6, dir: "out" },
  { part: "retrieval", t: 9.5, dir: "in" },
];
/** how long one call to a component takes: comet travel, then the node holds and settles */
export const EVENT_SPAN = 1.5;
export const COMET_TIME = 0.6;

/** 0..1: how active a component is at loop time t */
export function harnessActivity(part: HarnessPart, t: number) {
  let v = 0;
  for (const e of HARNESS_EVENTS) {
    if (e.part !== part) continue;
    const x = t - e.t;
    if (x < 0 || x > EVENT_SPAN) continue;
    v = Math.max(v, Math.min(easeInOut(clamp(x / (COMET_TIME * 0.9))), easeInOut(clamp((EVENT_SPAN - x) / 0.6))));
  }
  return v;
}
