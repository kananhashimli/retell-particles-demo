"use client";

import { useEffect, useRef } from "react";
import { Pane, type FolderApi } from "tweakpane";
import type { Stage } from "@/lib/stage/stage";
import { defaultsFor } from "@/lib/stage/defaults";
import { SCENES, paramDefaults, type SceneId, type StageConfig } from "@/lib/stage/types";

interface Props {
  stage: Stage;
  scene: SceneId;
  /** bump to pull the stage's config back into the pane (direction switch, import, reset) */
  version: number;
  onChange: (c: StageConfig) => void;
  onResetLook: () => void;
}

/** the config the main folders bind to; scene settings have their own folder */
function lookConfig(c: StageConfig) {
  const copy = structuredClone(c) as Partial<StageConfig>;
  delete copy.sceneParams;
  delete copy.particles;
  delete copy.lines;
  return copy as StageConfig;
}

/** copy src into target in place, so bindings that hold nested objects stay valid */
function assignDeep(target: Record<string, unknown>, src: Record<string, unknown>) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object") assignDeep(target[k] as Record<string, unknown>, v as Record<string, unknown>);
    else target[k] = v;
  }
}

export function Panel({ stage, scene, version, onChange, onResetLook }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ref = useRef<{ pane: Pane; params: StageConfig; syncing: boolean } | null>(null);
  const cb = useRef({ onChange, onResetLook });
  useEffect(() => {
    cb.current = { onChange, onResetLook };
  });

  useEffect(() => {
    const params = lookConfig(stage.config);
    const pane = new Pane({ container: host.current! });
    const state = { pane, params, syncing: false };
    ref.current = state;

    const play = pane.addFolder({ title: "Playback" });
    play.addBinding(params, "playing");
    play.addBinding(params, "autoplay", { label: "auto-advance" });
    play.addBinding(params, "speed", { min: 0.1, max: 2, step: 0.05 });
    play.addButton({ title: "Restart scene" }).on("click", () => stage.restart());

    const pal = pane.addFolder({ title: "Palette" });
    pal.addBinding(params, "background");
    pal.addBinding(params, "ink");
    pal.addBinding(params, "accent");

    const orb = pane.addFolder({ title: "Orb" });
    orb.addBinding(params.orb, "radius", { min: 0.6, max: 1.4, step: 0.01 });
    orb.addBinding(params.orb, "mid");
    orb.addBinding(params.orb, "highlight");
    orb.addBinding(params.orb, "shadow");
    orb.addBinding(params.orb, "grain", { min: 0, max: 1.5, step: 0.01 });
    orb.addBinding(params.orb, "speed", { min: 0, max: 2, step: 0.01 });
    orb.addBinding(params.orb, "contrast", { min: 0.5, max: 1.6, step: 0.01 });
    orb.addBinding(params.orb, "brightness", { min: -0.3, max: 0.3, step: 0.01 });
    orb.addBinding(params.orb, "crop", { min: 1, max: 1.2, step: 0.005, label: "rim crop" });
    orb.addBinding(params.orb, "shade", { label: "lower shade" });
    orb.addBinding(params.orb, "shadeAmount", { min: 0, max: 1.5, step: 0.01, label: "shade amount" });
    orb.addBinding(params.orb, "reflection", { min: 0, max: 1, step: 0.01, label: "reflection amount" });

    const grid = pane.addFolder({ title: "Grid" });
    grid.addBinding(params.grid, "style", { options: { lines: "lines", dots: "dots", crosses: "cross" } });
    grid.addBinding(params.grid, "color");
    grid.addBinding(params.grid, "opacity", { min: 0, max: 0.6, step: 0.005 });
    grid.addBinding(params.grid, "cell", { min: 0.2, max: 2, step: 0.05 });
    grid.addBinding(params.grid, "width", { min: 0.5, max: 3, step: 0.05 });
    grid.addBinding(params.grid, "major", { min: 0, max: 8, step: 1, label: "major every" });
    grid.addBinding(params.grid, "fadeInner", { min: 0, max: 10, step: 0.1, label: "fade from" });
    grid.addBinding(params.grid, "fadeOuter", { min: 0.5, max: 16, step: 0.1, label: "fade to" });

    const light = pane.addFolder({ title: "Floor & light" });
    light.addBinding(params, "floorGlow", { min: 0, max: 1.5, step: 0.01, label: "orb glow" });
    light.addBinding(params, "contactShadow", { min: 0, max: 1, step: 0.01, label: "contact shadow" });
    light.addBinding(params, "contactColor", { label: "shadow colour" });
    light.addBinding(params.light, "orb", { min: 0, max: 30, step: 0.1, label: "orb light" });
    light.addBinding(params.light, "key", { min: 0, max: 4, step: 0.05, label: "key light" });
    light.addBinding(params.light, "ambient", { min: 0, max: 4, step: 0.05 });
    light.addBinding(params.light, "shadows", { min: 0, max: 0.5, step: 0.005, label: "cast shadows" });

    const cam = pane.addFolder({ title: "Camera", expanded: false });
    cam.addBinding(params.camera, "azimuth", { min: 0, max: 90, step: 0.5 });
    cam.addBinding(params.camera, "elevation", { min: 10, max: 80, step: 0.1 });
    cam.addBinding(params.camera, "zoom", { min: 0.4, max: 2, step: 0.01 });
    cam.addBinding(params.camera, "height", { min: -1, max: 3, step: 0.01, label: "look at y" });
    cam.addBinding(params.camera, "panX", { min: -3, max: 3, step: 0.01, label: "pan x" });
    cam.addBinding(params.camera, "panY", { min: -3, max: 3, step: 0.01, label: "pan y" });
    cam.addButton({ title: "True isometric" }).on("click", () => {
      params.camera.azimuth = 45;
      params.camera.elevation = 35.26;
      pane.refresh();
    });

    const cards = pane.addFolder({ title: "Cards" });
    cards.addBinding(params.cards, "show");
    cards.addBinding(params.cards, "style", { options: { "grey glass": "glass-dark", "white glass": "glass-light", outline: "outline" } });
    cards.addBinding(params.cards, "scale", { min: 0.6, max: 1.6, step: 0.01 });

    pane.addButton({ title: "Reset look to defaults" }).on("click", () => cb.current.onResetLook());

    pane.on("change", () => {
      if (state.syncing) return;
      stage.applyConfig(structuredClone(params));
      cb.current.onChange(stage.config);
    });
    return () => {
      pane.dispose();
      ref.current = null;
    };
  }, [stage]);

  useEffect(() => {
    const s = ref.current;
    if (!s) return;
    s.syncing = true;
    assignDeep(s.params as unknown as Record<string, unknown>, lookConfig(stage.config) as unknown as Record<string, unknown>);
    s.pane.refresh();
    s.syncing = false;
  }, [version, stage]);

  // shared particle look (Particles direction only), then the current scene's own settings;
  // both sit right under Playback and are rebuilt when the scene or direction changes
  useEffect(() => {
    const s = ref.current;
    if (!s || stage.config.direction !== "line") return;
    const look = { ...stage.config.lines };
    const folder: FolderApi = s.pane.addFolder({ title: "Lines · all scenes", index: 1 });
    folder.addBinding(look, "width", { label: "line width", min: 0.5, max: 5, step: 0.05 });
    folder.addBinding(look, "emphasis", { label: "accent / clean ×", min: 1, max: 3, step: 0.05 });
    folder.addBinding(look, "muted", { label: "muted colour" });
    folder.addBinding(look, "active", { label: "active colour" });
    folder.on("change", () => {
      stage.applyConfig({ lines: { ...look } });
      cb.current.onChange(stage.config);
    });
    return () => folder.dispose();
  }, [stage, version]);

  useEffect(() => {
    const s = ref.current;
    if (!s || stage.config.direction !== "particles") return;
    const look = { ...stage.config.particles };
    const folder: FolderApi = s.pane.addFolder({ title: "Particles · all scenes", index: 1 });
    folder.addBinding(look, "size", { label: "dot size", min: 0.5, max: 5, step: 0.05 });
    folder.addBinding(look, "emphasis", { label: "lit / crest ×", min: 1, max: 3, step: 0.05 });
    folder.addBinding(look, "density", { min: 0.2, max: 3, step: 0.05 });
    folder.addBinding(look, "scatter", { min: 0, max: 0.15, step: 0.001 });
    folder.addBinding(look, "idle", { label: "idle movement", min: 0, max: 0.08, step: 0.001 });
    folder.addBinding(look, "idleSpeed", { label: "idle wiggles / loop", min: 0, max: 12, step: 1 });
    folder.addBinding(look, "muted", { label: "muted colour" });
    folder.addBinding(look, "active", { label: "active colour" });
    folder.addBinding(look, "highlight", { label: "highlight colour" });
    folder.on("change", () => {
      stage.applyConfig({ particles: { ...look } });
      cb.current.onChange(stage.config);
    });
    return () => folder.dispose();
  }, [stage, version]);

  useEffect(() => {
    const s = ref.current;
    const defs = stage.direction.scenes[scene].params;
    if (!s || !defs) return;
    const vals = stage.sceneParams(scene);
    // second after the shared folder of the direction
    const folder: FolderApi = s.pane.addFolder({ title: `Scene · ${SCENES[scene].title}`, index: 2 });
    const groups = new Map<string, FolderApi>();
    for (const [key, d] of Object.entries(defs)) {
      let target = folder;
      if (d.group) {
        if (!groups.has(d.group)) groups.set(d.group, folder.addFolder({ title: d.group, expanded: false }));
        target = groups.get(d.group)!;
      }
      target.addBinding(vals, key, { label: d.label ?? key, ...(typeof d.value === "number" ? { min: d.min, max: d.max, step: d.step } : {}) });
    }
    folder.addButton({ title: "Reset scene settings" }).on("click", () => {
      Object.assign(vals, paramDefaults(defs), defaultsFor(stage.config.direction).sceneParams[scene]);
      folder.refresh();
      stage.applyConfig({ sceneParams: { [scene]: { ...vals } } });
      cb.current.onChange(stage.config);
    });
    folder.on("change", (ev) => {
      // switching an override on starts it from the current shared value, so nothing jumps
      const key = (ev.target as unknown as { key?: string }).key;
      if (key?.startsWith("own_") && vals[key] === true) {
        const shared = (stage.config.particles as unknown as Record<string, number | string>)[key.slice(4)];
        if (shared !== undefined) {
          vals[`p_${key.slice(4)}`] = shared;
          folder.refresh();
        }
      }
      stage.applyConfig({ sceneParams: { [scene]: { ...vals } } });
      cb.current.onChange(stage.config);
    });
    return () => folder.dispose();
  }, [stage, scene, version]);

  return <div ref={host} className="tp-host" />;
}
