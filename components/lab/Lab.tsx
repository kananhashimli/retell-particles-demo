"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Stage, download } from "@/lib/stage/stage";
import { DIRECTIONS, DIRECTION_ORDER } from "@/lib/stage/directions";
import { mergeConfig } from "@/lib/stage/config";
import { defaultsFor } from "@/lib/stage/defaults";
import { ALL_SCENES, SCENE_ORDER, SCENES, type DirectionId, type SceneId, type StageConfig } from "@/lib/stage/types";
import { getOrbStyle, StylePicker, useOrbStyle } from "../StylePicker";
import { FlowTabs } from "./FlowTabs";
import { Panel } from "./Panel";
import { ModelCards } from "../section/ModelCards";
import { DESCRIPTION, EYEBROW, HEADLINE } from "../section/copy";
import { DownloadIcon, PauseIcon, PlayIcon, SlidersIcon } from "./icons";

const KEY = "retell-stage:v6";
/** from before the orb's latest restyle; their other settings carry over */
const OLD_KEYS = ["retell-stage:v5", "retell-stage:v4", "retell-stage:v3"];
interface Saved {
  direction: DirectionId;
  configs: Partial<Record<DirectionId, StageConfig>>;
}
const load = (): Saved | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Saved;
    const old = OLD_KEYS.map((k) => localStorage.getItem(k)).find(Boolean);
    if (!old) return null;
    // the orb and the floor under it were restyled together: take the new defaults for those
    const s = JSON.parse(old) as Saved;
    for (const [id, c] of Object.entries(s.configs) as [DirectionId, StageConfig][]) {
      const d = defaultsFor(id);
      // the Retell voices scene changed with the extra voices
      s.configs[id] = { ...c, orb: d.orb, floorGlow: d.floorGlow, contactShadow: d.contactShadow, contactColor: d.contactColor, sceneParams: { ...c.sceneParams, voices: d.sceneParams.voices } };
    }
    return s;
  } catch {
    return null;
  }
};
const save = (s: Saved) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
};

export function Lab() {
  const box = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [scene, setScene] = useState<SceneId>("denoise");
  const [direction, setDirection] = useState<DirectionId>("particles");
  const [playing, setPlaying] = useState(true);
  const [autoplay, setAutoplay] = useState(true);
  const [panel, setPanel] = useState(true);
  const [version, setVersion] = useState(0);
  const [menu, setMenu] = useState(false);
  const [saveMenu, setSaveMenu] = useState(false);
  const [busy, setBusy] = useState<{ label: string; p: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const saved = useRef<Saved>({ direction: "particles", configs: {} });
  const fileInput = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------- stage
  useEffect(() => {
    const s0 = load();
    if (s0) saved.current = s0;
    const dir: DirectionId = saved.current.direction in DIRECTIONS ? saved.current.direction : "particles";
    const cfg = saved.current.configs[dir] ?? defaultsFor(dir);
    const st = new Stage(box.current!, { ...cfg, direction: dir });
    st.orb.setStyle(getOrbStyle(), true);
    setStage(st);
    setDirection(dir);
    setScene(st.config.scene);
    setPlaying(st.config.playing);
    setAutoplay(st.config.autoplay);
    const offScene = st.on("scene", (id) => setScene(id));
    const offLoop = st.on("loop", (id) => {
      if (!st.config.autoplay) return;
      const next = SCENE_ORDER[(SCENE_ORDER.indexOf(id) + 1) % SCENE_ORDER.length];
      st.applyConfig({ scene: next });
    });
    (window as unknown as { stage: Stage }).stage = st;
    return () => {
      offScene();
      offLoop();
      st.dispose();
    };
  }, []);

  const persist = useCallback((c: StageConfig) => {
    saved.current.direction = c.direction;
    saved.current.configs[c.direction] = c;
    save(saved.current);
    setPlaying(c.playing);
    setAutoplay(c.autoplay);
  }, []);

  const pickScene = useCallback(
    (id: SceneId) => {
      if (!stage || id === stage.config.scene) return;
      // choosing by hand stops auto-advance so the scene can be studied
      stage.applyConfig({ scene: id, autoplay: false });
      persist(stage.config);
      setVersion((v) => v + 1);
    },
    [stage, persist],
  );


  const pickDirection = useCallback(
    (id: DirectionId) => {
      if (!stage || id === stage.config.direction) return;
      persist(stage.config);
      const c = stage.config;
      const next = saved.current.configs[id] ?? defaultsFor(id);
      stage.applyConfig(mergeConfig(next, { direction: id, scene: c.scene, playing: c.playing, speed: c.speed, autoplay: c.autoplay }));
      setDirection(id);
      persist(stage.config);
      setVersion((v) => v + 1);
    },
    [stage, persist],
  );

  const resetLook = useCallback(() => {
    if (!stage) return;
    const c = stage.config;
    stage.applyConfig(mergeConfig(defaultsFor(c.direction), { scene: c.scene, playing: c.playing, speed: c.speed, autoplay: c.autoplay, sceneParams: c.sceneParams }));
    persist(stage.config);
    setVersion((v) => v + 1);
  }, [stage, persist]);

  const togglePlay = useCallback(() => {
    if (!stage) return;
    stage.applyConfig({ playing: !stage.config.playing });
    persist(stage.config);
    setVersion((v) => v + 1);
  }, [stage, persist]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (/^[1-9]$/.test(e.key)) pickScene(ALL_SCENES[+e.key - 1]);
      else if (e.key === "p") setPanel((v) => !v);
      else if (e.key === "l") pickDirection("line");
      else if (e.key === "k") pickDirection("particles");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, pickScene, pickDirection]);

  const orbStyle = useOrbStyle();
  useEffect(() => stage?.orb.setStyle(orbStyle), [stage, orbStyle]);

  const progress = useCallback(() => stage?.progress ?? 0, [stage]);

  // ---------------------------------------------------------------- exports
  const name = (ext: string) => `retell-${direction}-${scene}.${ext}`;
  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setMenu(false);
    setSaveMenu(false);
    setBusy({ label, p: 0 });
    try {
      await fn();
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  type ActionId = "scene-svg" | "copy-scene-svg" | "copy-png" | "layers" | "png" | "png-t" | "video" | "seq" | "cfg" | "import";
  const ACTIONS: { group: string; items: { id: ActionId; label: string; hint: string }[] }[] = [
    {
      group: "For Figma",
      items: [
        { id: "scene-svg", label: "Scene as SVG", hint: "Grid, lines and particles as vectors · no orb" },
        { id: "copy-scene-svg", label: "Copy scene as SVG", hint: "Paste into Figma as editable vectors" },
        { id: "copy-png", label: "Copy frame as PNG", hint: "Paste straight into Figma" },
        { id: "layers", label: "Layers (.zip)", hint: "Floor · objects · orb, transparent PNGs" },
      ],
    },
    {
      group: "Stills",
      items: [
        { id: "png", label: "PNG @2×", hint: "With background" },
        { id: "png-t", label: "PNG @3× transparent", hint: "No background" },
      ],
    },
    {
      group: "Motion",
      items: [
        { id: "video", label: "Video loop", hint: "One seamless loop, MP4 or WebM" },
        { id: "seq", label: "PNG sequence (.zip)", hint: "30 fps, frame-exact" },
      ],
    },
    {
      group: "Config",
      items: [
        { id: "cfg", label: "Download config", hint: "JSON with every setting" },
        { id: "import", label: "Import config…", hint: "Load a saved JSON" },
      ],
    },
  ];
  const act = (id: ActionId, label: string) => {
    if (!stage) return;
    if (id === "import") {
      setMenu(false);
      fileInput.current?.click();
      return;
    }
    run(label, async () => {
      switch (id) {
        case "scene-svg":
          download(new Blob([stage.sceneSVG()], { type: "image/svg+xml" }), name("svg"));
          break;
        case "copy-scene-svg":
          await navigator.clipboard.writeText(stage.sceneSVG());
          flash("Scene SVG copied. Paste it into Figma, orb image on top.");
          break;
        case "copy-png":
          await navigator.clipboard.write([new ClipboardItem({ "image/png": stage.snapshot({ scale: 2 }) })]);
          flash("PNG copied. Paste it into Figma.");
          break;
        case "layers":
          download(await stage.exportLayers(2), name("layers.zip"));
          break;
        case "png":
          download(await stage.snapshot({ scale: 2 }), name("png"));
          break;
        case "png-t":
          download(await stage.snapshot({ scale: 3, transparent: true }), name("transparent.png"));
          break;
        case "video": {
          const b = await stage.record({ loops: 1, onProgress: (p) => setBusy({ label: "Recording loop", p }) });
          download(b, name(b.type.includes("mp4") ? "mp4" : "webm"));
          break;
        }
        case "seq":
          download(await stage.exportSequence({ fps: 30, onProgress: (p) => setBusy({ label: "Rendering frames", p }) }), name("frames.zip"));
          break;
        case "cfg":
          download(new Blob([JSON.stringify(stage.config, null, 2)], { type: "application/json" }), `retell-${direction}.config.json`);
          break;
      }
    });
  };

  const importConfig = async (f: File) => {
    if (!stage) return;
    try {
      const c = JSON.parse(await f.text()) as StageConfig;
      stage.applyConfig(c);
      setDirection(stage.config.direction);
      persist(stage.config);
      setVersion((v) => v + 1);
      flash("Config loaded");
    } catch {
      flash("That file isn't a stage config");
    }
  };

  // ---------------------------------------------------------------- defaults
  /** Writes settings over lib/stage/defaults/*.json (next dev only); the homepage picks them up. */
  const saveDefaults = (all: boolean) => {
    if (!stage) return;
    persist(stage.config);
    const configs = all ? saved.current.configs : { [direction]: stage.config };
    run("Saving defaults", async () => {
      const res = await fetch("/dev/api/defaults", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ configs }) });
      const body = (await res.json()) as { saved?: DirectionId[]; error?: string };
      if (!res.ok || !body.saved) throw new Error(body.error ?? "Could not save the defaults");
      flash(`Saved ${body.saved.map((id) => DIRECTIONS[id].name).join(" and ")} as the default`);
    });
  };

  const revertToDefaults = () => {
    if (!stage) return;
    setSaveMenu(false);
    stage.applyConfig(mergeConfig(defaultsFor(direction), { scene: stage.config.scene }));
    persist(stage.config);
    setVersion((v) => v + 1);
    flash(`${DIRECTIONS[direction].name} is back to the saved defaults`);
  };

  // ---------------------------------------------------------------- view
  return (
    <div className="min-h-screen">
      {/* toolbar */}
      <header className="sticky top-0 z-30 border-b border-line bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1512px] items-center gap-4 px-6">
          <div className="flex items-center gap-2.5 text-[13px]">
            <span className="size-2.5 rounded-full bg-[radial-gradient(circle_at_40%_30%,#fff_0_12%,#00ccff_45%,#3d64ff_80%)]" />
            <span className="font-medium">Flow stage</span>
            <span className="text-muted">Listen · Think · Speak</span>
          </div>
          <nav className="mx-auto flex items-center rounded-full bg-ink/[0.05] p-1" aria-label="Direction">
            {DIRECTION_ORDER.map((id) => {
              const d = DIRECTIONS[id];
              const on = id === direction;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => pickDirection(id)}
                  title={d.description}
                  aria-pressed={on}
                  className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] transition-all duration-300 ${on ? "bg-white text-ink shadow-[0_1px_3px_rgba(0,0,0,0.08)]" : "text-muted hover:text-ink"}`}
                >
                  <span className="font-medium">{d.name}</span>
                  <span className="hidden text-muted lg:inline">{d.tagline}</span>
                </button>
              );
            })}
          </nav>
          <div className="flex items-center gap-2">
            <StylePicker />
            <button type="button" onClick={togglePlay} className="grid size-9 place-items-center rounded-full border border-line hover:border-ink/30" aria-label={playing ? "Pause" : "Play"} title="Play / pause (Space)">
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <div className="relative">
              <button type="button" onClick={() => setSaveMenu((v) => !v)} className="flex h-9 items-center rounded-full border border-line px-4 text-[13px] font-medium hover:border-ink/30" aria-expanded={saveMenu}>
                Save
              </button>
              {saveMenu && (
                <>
                  <button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setSaveMenu(false)} />
                  <div className="absolute right-0 z-20 mt-2 w-[300px] overflow-hidden rounded-2xl border border-line bg-white p-1.5 shadow-[0_20px_50px_-12px_rgba(20,24,40,0.25)]">
                    <p className="px-3 pb-1 pt-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">Defaults · homepage</p>
                    {[
                      { id: "one", label: `Save ${DIRECTIONS[direction].name} as default`, hint: "Everything in the panel, every scene" },
                      { id: "all", label: "Save both directions as default", hint: "Line and Particles as you last left them" },
                      { id: "revert", label: "Revert to saved defaults", hint: `Drop unsaved changes to ${DIRECTIONS[direction].name}` },
                    ].map((it) => (
                      <button key={it.id} type="button" onClick={() => (it.id === "revert" ? revertToDefaults() : saveDefaults(it.id === "all"))} className="flex w-full flex-col rounded-xl px-3 py-2 text-left hover:bg-ink/[0.04]">
                        <span className="text-[13.5px]">{it.label}</span>
                        <span className="text-[12px] text-muted">{it.hint}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="relative">
              <button type="button" onClick={() => setMenu((v) => !v)} className="flex h-9 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-medium text-white hover:bg-ink/85" aria-expanded={menu}>
                <DownloadIcon /> Export
              </button>
              {menu && (
                <>
                  <button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenu(false)} />
                  <div className="absolute right-0 z-20 mt-2 w-[300px] overflow-hidden rounded-2xl border border-line bg-white p-1.5 shadow-[0_20px_50px_-12px_rgba(20,24,40,0.25)]">
                    {ACTIONS.map((g) => (
                      <div key={g.group} className="py-1">
                        <p className="px-3 pb-1 pt-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">{g.group}</p>
                        {g.items.map((it) => (
                          <button key={it.id} type="button" onClick={() => act(it.id, it.label)} className="flex w-full flex-col rounded-xl px-3 py-2 text-left hover:bg-ink/[0.04]">
                            <span className="text-[13.5px]">{it.label}</span>
                            <span className="text-[12px] text-muted">{it.hint}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button type="button" onClick={() => setPanel((v) => !v)} className={`grid size-9 place-items-center rounded-full border ${panel ? "border-ink bg-ink text-white" : "border-line hover:border-ink/30"}`} aria-label="Toggle controls" title="Controls (P)">
              <SlidersIcon />
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* the section, as designed */}
        <main className="min-w-0 flex-1">
          <section className="mx-auto max-w-[1512px] px-6 pb-24 pt-[72px] md:px-[60px]">
            <p className="text-[15px] text-muted">{EYEBROW}</p>
            <h2 className="mt-8 max-w-[1100px] font-serif text-[clamp(44px,5.6vw,72px)] leading-[0.98] tracking-[-0.02em]">{HEADLINE}</h2>
            <p className="mt-6 max-w-[368px] text-[15px] leading-[1.4]">{DESCRIPTION}</p>

            <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,876fr)_minmax(300px,456fr)] lg:gap-[60px]">
              <div className="relative aspect-[876/678] overflow-hidden rounded-[24px]" style={{ background: stage?.config.background ?? "#F5F5F8" }}>
                <div ref={box} className="absolute inset-0" />
                <ModelCards scene={scene} arch="cascaded" stage={stage} />
                <div className="pointer-events-none absolute bottom-4 left-5 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink/40">
                  <span>{DIRECTIONS[direction].name}</span>
                  <span>·</span>
                  <span>{SCENES[scene].title}</span>
                </div>
              </div>
              <FlowTabs scene={scene} onScene={pickScene} progress={progress} autoplay={autoplay} />
            </div>
          </section>
        </main>

        {/* controls */}
        <aside className={`sticky top-14 h-[calc(100vh-56px)] shrink-0 overflow-y-auto border-l border-line bg-white transition-[width] duration-300 ${panel ? "w-[320px]" : "w-0 border-l-0"}`}>
          <div className="w-[320px] p-3">
            <div className="px-1 pb-3 pt-1">
              <p className="text-[13px] font-medium">{DIRECTIONS[direction].name}</p>
              <p className="mt-1 text-[12px] leading-[1.45] text-muted">{DIRECTIONS[direction].description}</p>
            </div>
            {stage && <Panel stage={stage} scene={scene} version={version} onChange={persist} onResetLook={resetLook} />}
            <p className="px-1 pt-4 text-[11.5px] leading-[1.5] text-muted">
              Keys: <b className="font-medium text-ink">Space</b> play · <b className="font-medium text-ink">1–9</b> scenes · <b className="font-medium text-ink">L / K</b> Line / Particles · <b className="font-medium text-ink">P</b> panel. Changes stay in this browser until you use <b className="font-medium text-ink">Save</b> to make them the defaults for the homepage.
            </p>
          </div>
        </aside>
      </div>

      <input ref={fileInput} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importConfig(e.target.files[0])} />

      {(busy || toast) && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-ink px-5 py-2.5 text-[13px] text-white shadow-lg">
          {busy ? (
            <span className="flex items-center gap-3">
              {busy.label}
              <span className="relative h-1 w-28 overflow-hidden rounded bg-white/20">
                <span className="absolute inset-y-0 left-0 bg-white" style={{ width: `${Math.round(busy.p * 100)}%` }} />
              </span>
            </span>
          ) : (
            toast
          )}
        </div>
      )}
    </div>
  );
}
