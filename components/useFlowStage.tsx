"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import { Stage } from "@/lib/stage/stage";
import { defaultsFor } from "@/lib/stage/defaults";
import { SCENE_ORDER, type SceneId } from "@/lib/stage/types";
import { SceneCards } from "./lab/SceneCards";

const CONFIG = defaultsFor("particles");

/** whether a media query matches, kept live (false while rendering on the server) */
export const useMedia = (query: string) =>
  useSyncExternalStore(
    (onChange) => {
      const m = matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
    () => false,
  );
/** phones: below Tailwind's md, where the stage turns into a square card */
const MOBILE = "(max-width: 767px)";
export const useMobile = () => useMedia(MOBILE);

/** On the square card the scene is framed closer, and higher, clear of the card at the bottom. */
const cameraFor = (mobile: boolean) => (mobile ? { ...CONFIG.camera, zoom: CONFIG.camera.zoom * 1.04, panY: 0.75 } : CONFIG.camera);

/**
 * The particle stage and its scene. With `autoplay` it cycles through the scenes on its own;
 * without, each scene loops until something else picks the next one. `autoplay` can change at any
 * time without rebuilding the stage.
 */
export function useFlowStage({ autoplay }: { autoplay: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  // the cards wait for the stage, so the whole section fades in together
  const [ready, setReady] = useState(false);
  const [scene, setScene] = useState<SceneId>(CONFIG.scene);
  const mobile = useMobile();

  useEffect(() => {
    let st: Stage | null = null;
    try {
      st = new Stage(box.current!, { ...CONFIG, camera: cameraFor(matchMedia(MOBILE).matches) });
    } catch (e) {
      // no WebGL: the tabs and cards still work over the plain background
      console.error(e);
    }
    let alive = true;
    (st?.ready ?? Promise.resolve()).then(() => alive && setReady(true));
    if (!st) {
      return () => {
        alive = false;
      };
    }
    setStage(st);
    const offScene = st.on("scene", (id) => setScene(id));
    const offLoop = st.on("loop", (id) => st.config.autoplay && st.applyConfig({ scene: SCENE_ORDER[(SCENE_ORDER.indexOf(id) + 1) % SCENE_ORDER.length] }));
    return () => {
      alive = false;
      offScene();
      offLoop();
      st.dispose();
    };
  }, []);

  useEffect(() => stage?.applyConfig({ autoplay }), [stage, autoplay]);
  useEffect(() => stage?.applyConfig({ camera: cameraFor(mobile) }), [stage, mobile]);

  const pickScene = useCallback(
    (id: SceneId) => {
      if (!stage) return setScene(id);
      if (id === stage.config.scene) return;
      stage.applyConfig({ scene: id });
    },
    [stage],
  );

  return { box, stage, ready, scene, mobile, pickScene };
}

interface StageCardProps {
  box: RefObject<HTMLDivElement | null>;
  scene: SceneId;
  stage: Stage | null;
  mobile: boolean;
  ready: boolean;
  style?: CSSProperties;
}

/** The rounded stage card: the canvas (in `box`) with the scene cards over it. Takes useFlowStage's result. */
export function StageCard({ box, scene, stage, mobile, ready, style }: StageCardProps) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-[32px] md:aspect-[876/678]" style={{ background: CONFIG.background, ...style }}>
      <div ref={box} className="absolute inset-0" />
      <SceneCards scene={scene} stage={stage} mobile={mobile} show={ready} />
    </div>
  );
}
