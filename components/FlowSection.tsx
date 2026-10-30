"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Stage } from "@/lib/stage/stage";
import { defaultsFor } from "@/lib/stage/defaults";
import { SCENE_ORDER, type SceneId } from "@/lib/stage/types";
import { FlowTabs } from "./lab/FlowTabs";
import { SceneCards } from "./lab/SceneCards";

const CONFIG = defaultsFor("particles");

/** The stage card and Listen / Think / Speak tabs, cycling through the scenes on their own. */
export function FlowSection() {
  const box = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [scene, setScene] = useState<SceneId>(CONFIG.scene);

  useEffect(() => {
    const st = new Stage(box.current!, CONFIG);
    setStage(st);
    const offScene = st.on("scene", (id) => setScene(id));
    const offLoop = st.on("loop", (id) => st.applyConfig({ scene: SCENE_ORDER[(SCENE_ORDER.indexOf(id) + 1) % SCENE_ORDER.length] }));
    return () => {
      offScene();
      offLoop();
      st.dispose();
    };
  }, []);

  const pickScene = useCallback(
    (id: SceneId) => {
      if (!stage) return;
      if (id === stage.config.scene) stage.restart();
      else stage.applyConfig({ scene: id });
    },
    [stage],
  );

  const progress = useCallback(() => stage?.progress ?? 0, [stage]);

  return (
    <main className="mx-auto flex min-h-svh max-w-[1512px] flex-col justify-center px-6 py-16 md:px-[60px]">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,876fr)_minmax(300px,456fr)] lg:gap-[60px]">
        <div className="relative aspect-[876/678] overflow-hidden rounded-[32px]" style={{ background: CONFIG.background }}>
          <div ref={box} className="absolute inset-0" />
          <SceneCards scene={scene} stage={stage} />
        </div>
        <FlowTabs scene={scene} onScene={pickScene} progress={progress} autoplay />
      </div>
    </main>
  );
}
