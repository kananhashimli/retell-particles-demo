"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { SCENES, sceneLabel, stepScenes, type Arch, type SceneId } from "@/lib/stage/types";

/**
 * The tab bar at the top of the stage: one tab per model in the group that's open on the right.
 * The white thumb slides between tabs, and the whole bar re-lays itself when the group changes.
 */
export function SceneTabs({ scene, arch, onScene, className = "" }: { scene: SceneId; arch: Arch; onScene: (id: SceneId) => void; className?: string }) {
  const step = SCENES[scene].step;
  const ids = stepScenes(step, arch);
  const bar = useRef<HTMLDivElement>(null);
  const btns = useRef(new Map<SceneId, HTMLButtonElement>());
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  // a new group swaps every tab: the thumb jumps there instead of sliding across
  const [group, setGroup] = useState(step);
  const swapped = group !== step;
  if (swapped) setGroup(step);

  useLayoutEffect(() => {
    const measure = () => {
      const b = btns.current.get(scene);
      if (b) setThumb({ x: b.offsetLeft, w: b.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar.current!);
    return () => ro.disconnect();
  }, [scene, step, arch]);

  return (
    <div role="tablist" aria-label="Models" ref={bar} className={`relative flex items-center rounded-full bg-[#E9E9EE] p-1 ${className}`}>
      {thumb && (
        <span
          aria-hidden
          className={`absolute top-1 bottom-1 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08),0_0_0_0.5px_rgba(0,0,0,0.06)] ${swapped ? "" : "transition-[left,width] duration-500 ease-[cubic-bezier(.2,.7,.2,1)]"}`}
          style={{ left: thumb.x, width: thumb.w }}
        />
      )}
      {ids.map((id) => {
        const on = id === scene;
        return (
          <button
            key={`${step}:${id}`}
            ref={(el) => {
              if (el) btns.current.set(id, el);
              else btns.current.delete(id);
            }}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onScene(id)}
            className={`scene-tab relative z-10 cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-[14px] leading-[19px] tracking-[-0.01em] transition-colors duration-300 md:px-5 md:py-[9px] md:text-[15px] ${
              on ? "text-black" : "text-black/55 hover:text-black"
            }`}
          >
            {sceneLabel(id, arch).tab}
          </button>
        );
      })}
    </div>
  );
}
