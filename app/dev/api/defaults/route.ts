import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { DirectionId, StageConfig } from "@/lib/stage/types";

const IDS: DirectionId[] = ["line", "particles"];

// slider steps leave float noise like 1.5999999999999992; four decimals keep the files readable
const tidy = (v: unknown): unknown => {
  if (typeof v === "number") return Math.round(v * 1e4) / 1e4;
  if (Array.isArray(v)) return v.map(tidy);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tidy(x)]));
  return v;
};

/** Dev only: writes the /dev panel's settings over lib/stage/defaults/<direction>.json. */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Saving defaults only works while running next dev" }, { status: 403 });
  }
  const { configs } = (await request.json()) as { configs: Partial<Record<DirectionId, StageConfig>> };
  const entries = Object.entries(configs ?? {}) as [DirectionId, StageConfig][];
  if (!entries.length || entries.some(([id, c]) => !IDS.includes(id) || c?.direction !== id)) {
    return Response.json({ error: "That isn't a stage config" }, { status: 400 });
  }
  for (const [id, c] of entries) {
    // defaults open on the first scene and cycle through the rest
    const out = tidy({ ...c, scene: "denoise", playing: true, autoplay: true });
    await writeFile(path.join(process.cwd(), "lib/stage/defaults", `${id}.json`), `${JSON.stringify(out, null, 2)}\n`);
  }
  return Response.json({ saved: entries.map(([id]) => id) });
}
