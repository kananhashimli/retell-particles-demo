"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import { Stage } from "@/lib/stage/stage";
import { defaultsFor } from "@/lib/stage/defaults";
import { orderFor, type Arch, type SceneId } from "@/lib/stage/types";
import { ModelCards } from "./section/ModelCards";
import { SceneTabs } from "./section/SceneTabs";
import { getOrbStyle, useOrbStyle } from "./StylePicker";

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
export function useFlowStage({ autoplay, arch = "cascaded" }: { autoplay: boolean; arch?: Arch }) {
  const box = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  // the cards wait for the stage, so the whole section fades in together
  const [ready, setReady] = useState(false);
  const [scene, setScene] = useState<SceneId>(CONFIG.scene);
  const mobile = useMobile();
  const style = useOrbStyle();
  // the autoplay order follows the architecture; read from a ref so switching never rebuilds the stage
  const order = useRef(orderFor(arch));
  useEffect(() => {
    order.current = orderFor(arch);
  }, [arch]);

  useEffect(() => {
    let st: Stage | null = null;
    try {
      st = new Stage(box.current!, { ...CONFIG, camera: cameraFor(matchMedia(MOBILE).matches) });
      st.orb.setStyle(getOrbStyle(), true);
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
    // for the console and screenshot scripts, as on /dev
    if (process.env.NODE_ENV !== "production") (window as unknown as { stage: Stage }).stage = st;
    const offScene = st.on("scene", (id) => setScene(id));
    const offLoop = st.on("loop", (id) => {
      if (!st.config.autoplay) return;
      const o = order.current;
      st.applyConfig({ scene: o[(o.indexOf(id) + 1) % o.length] });
    });
    return () => {
      alive = false;
      offScene();
      offLoop();
      st.dispose();
    };
  }, []);

  useEffect(() => stage?.applyConfig({ autoplay }), [stage, autoplay]);
  useEffect(() => stage?.applyConfig({ camera: cameraFor(mobile) }), [stage, mobile]);
  useEffect(() => stage?.orb.setStyle(style), [stage, style]);

  const pickScene = useCallback(
    (id: SceneId) => {
      if (!stage) return setScene(id);
      if (id === stage.config.scene) return;
      stage.applyConfig({ scene: id });
    },
    [stage],
  );

  return { box, stage, ready, scene, mobile, pickScene, arch };
}

interface StageCardProps {
  box: RefObject<HTMLDivElement | null>;
  scene: SceneId;
  stage: Stage | null;
  mobile: boolean;
  ready: boolean;
  arch: Arch;
  pickScene: (id: SceneId) => void;
  style?: CSSProperties;
}

/**
 * The rounded stage card: the canvas (in `box`), the model tabs along its top and the model cards over
 * it. On phones the cards drop below the card instead. Takes useFlowStage's result.
 */
export function StageCard({ box, scene, stage, mobile, ready, arch, pickScene, style }: StageCardProps) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="relative aspect-square overflow-hidden rounded-[32px] md:aspect-[876/678]" style={{ background: CONFIG.background, ...style }}>
        <div ref={box} className="absolute inset-0" />
        {!mobile && <ModelCards scene={scene} arch={arch} stage={stage} show={ready} />}
        <div className={`absolute inset-x-0 top-3 flex justify-center px-3 transition-opacity duration-700 md:top-4 ${ready ? "opacity-100" : "opacity-0"}`}>
          <div className="max-w-full overflow-x-auto [scrollbar-width:none]">
            <SceneTabs scene={scene} arch={arch} onScene={pickScene} />
          </div>
        </div>
      </div>
      {mobile && <ModelCards scene={scene} arch={arch} stage={stage} show={ready} mobile />}
    </div>
  );
}
