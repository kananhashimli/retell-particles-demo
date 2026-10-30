"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Stage } from "@/lib/stage/stage";
import { defaultsFor } from "@/lib/stage/defaults";
import { SCENE_ORDER, type SceneId } from "@/lib/stage/types";
import { FlowTabs } from "./lab/FlowTabs";
import { SceneCards } from "./lab/SceneCards";

const CONFIG = defaultsFor("particles");

/** phones: below Tailwind's md, where the stage turns into a square card */
const MOBILE = "(max-width: 767px)";
const useMobile = () =>
  useSyncExternalStore(
    (onChange) => {
      const m = matchMedia(MOBILE);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => matchMedia(MOBILE).matches,
    () => false,
  );
/** On the square card the scene is framed closer, and higher, clear of the card at the bottom. */
const cameraFor = (mobile: boolean) => (mobile ? { ...CONFIG.camera, zoom: CONFIG.camera.zoom * 1.04, panY: 0.75 } : CONFIG.camera);

/** The stage card and Listen / Think / Speak tabs, cycling through the scenes on their own. */
export function FlowSection() {
  const box = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [scene, setScene] = useState<SceneId>(CONFIG.scene);
  const mobile = useMobile();

  useEffect(() => {
    let st: Stage;
    try {
      st = new Stage(box.current!, { ...CONFIG, camera: cameraFor(matchMedia(MOBILE).matches) });
    } catch (e) {
      // no WebGL: the tabs and cards still work over the plain background
      console.error(e);
      return;
    }
    setStage(st);
    const offScene = st.on("scene", (id) => setScene(id));
    const offLoop = st.on("loop", (id) => st.applyConfig({ scene: SCENE_ORDER[(SCENE_ORDER.indexOf(id) + 1) % SCENE_ORDER.length] }));
    return () => {
      offScene();
      offLoop();
      st.dispose();
    };
  }, []);

  useEffect(() => stage?.applyConfig({ camera: cameraFor(mobile) }), [stage, mobile]);

  const pickScene = useCallback(
    (id: SceneId) => {
      if (!stage) return setScene(id);
      if (id === stage.config.scene) return;
      stage.applyConfig({ scene: id });
    },
    [stage],
  );

  const progress = useCallback(() => stage?.progress ?? 0, [stage]);

  return (
    <main className="mx-auto flex min-h-svh max-w-[1512px] flex-col justify-center px-6 py-16 md:px-[60px]">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,876fr)_minmax(300px,456fr)] lg:gap-[60px]">
        <div className="relative aspect-square overflow-hidden rounded-[32px] md:aspect-[876/678]" style={{ background: CONFIG.background }}>
          <div ref={box} className="absolute inset-0" />
          <SceneCards scene={scene} stage={stage} mobile={mobile} />
        </div>
        <FlowTabs scene={scene} onScene={pickScene} progress={progress} autoplay />
      </div>
    </main>
  );
}
