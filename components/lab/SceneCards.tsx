"use client";

import { useEffect, useRef, useState } from "react";
import type { Stage } from "@/lib/stage/stage";
import { SCENES, STEPS, type SceneId } from "@/lib/stage/types";

/** Card copy as written in the Figma diagrams; width is the description's wrap width. */
const COPY: Record<SceneId, { text: string; width: number }> = {
  denoise: { text: "Cancels background noise on the line.", width: 132 },
  turns: { text: "Knows when to speak and when to stop.", width: 152 },
  llm: { text: "Text model built\nfor live calls", width: 132 },
  flow: { text: "Checks outcomes, moves the call forward", width: 152 },
  voices: { text: "Retell’s own text to speech models", width: 132 },
  colloquial: { text: "Makes replies sound spoken, not written", width: 152 },
};

// the stage as drawn: 876 × 678, newest card's top at 209, older ones stacked 105 above
const W = 876;
const H = 678;
const LEFT = 172;
const NEWEST = 209;
const PITCH = 105;
const PILL_TOP = 265;

/** "listening" is the pill shown while the dust still floats, before Denoising cleans it up. */
type Shown = SceneId | "listening";

/** Cards for the scenes reached so far in the current step, top to bottom. */
const stack = (scene: Shown): { id: Shown; top: number }[] => {
  if (scene === "listening") return [{ id: scene, top: PILL_TOP }];
  const step = STEPS.find((s) => s.scenes.includes(scene))!;
  const shown = step.scenes.slice(0, step.scenes.indexOf(scene) + 1);
  return shown.map((id, i) => ({
    id,
    top: NEWEST - PITCH * (shown.length - 1 - i),
  }));
};

/** The scene cards floating beside the orb, laid over the stage. */
export function SceneCards({
  scene,
  stage,
}: {
  scene: SceneId;
  stage: Stage | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [listening, setListening] = useState(false);
  const shown: Shown = scene === "denoise" && listening ? "listening" : scene;
  const [prev, setPrev] = useState(shown);
  const [leaving, setLeaving] = useState<{ id: Shown; top: number }[]>([]);

  // Denoising opens on noisy dust; the pill holds until the noisy layer fades (same window as the scene's own "noisy" card)
  useEffect(() => {
    if (!stage || scene !== "denoise") return;
    let raf = 0;
    const tick = () => {
      const t = stage.progress * stage.duration;
      setListening(t < Number(stage.sceneParams("denoise").waveStart) + 0.6);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage, scene]);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / W));
    ro.observe(root.current!);
    return () => ro.disconnect();
  }, []);

  const cards = stack(shown);
  if (shown !== prev) {
    // cards that drop out of the stack stay mounted, in place, while they fade
    setPrev(shown);
    setLeaving(stack(prev).filter((c) => !cards.some((n) => n.id === c.id)));
  }

  useEffect(() => {
    if (!leaving.length) return;
    const t = setTimeout(() => setLeaving([]), 600);
    return () => clearTimeout(t);
  }, [leaving]);

  return (
    <div
      ref={root}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: W, height: H, transform: `scale(${scale})` }}
      >
        <div className="scene-cards-float absolute inset-0">
          {[
            ...leaving
              .filter((c) => !cards.some((n) => n.id === c.id))
              .map((c) => ({ ...c, out: true })),
            ...cards.map((c) => ({ ...c, out: false })),
          ].map(({ id, top, out }) => (
            <div
              key={id}
              className="absolute transition-transform duration-700 ease-[cubic-bezier(.2,.7,.2,1)]"
              style={{ left: LEFT, top: 0, transform: `translateY(${top}px)` }}
            >
              {id === "listening" ? (
                <div
                  className={`scene-card flex h-[41px] w-max min-w-[191px] items-start gap-2 rounded-[20px] bg-[rgba(100,100,100,0.5)] px-[14px] pb-[10px] pt-[12px] text-[14px] leading-[19px] tracking-[-0.01em] text-white backdrop-blur-[11.45px] ${
                    out ? "scene-card-out" : ""
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/icons/listening.svg"
                    alt=""
                    width={16}
                    height={16.4592}
                    className="scene-pill-spin shrink-0"
                  />
                  <p className="whitespace-nowrap">Listening to the caller...</p>
                </div>
              ) : (
                <div
                  className={`scene-card relative h-[97px] w-[220.5px] rounded-[20px] bg-white text-[14px] leading-[19px] tracking-[-0.01em] text-black shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_3px_6px_-1.5px_rgba(0,0,0,0.04),0_12px_12px_-6px_rgba(0,0,0,0.04),0_48px_48px_-24px_rgba(0,0,0,0.04)] ${
                    out ? "scene-card-out" : ""
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/icons/${id}.svg`}
                    alt=""
                    width={20}
                    height={20}
                    className="absolute left-4 top-[18px]"
                  />
                  <p className="absolute left-12 top-4 whitespace-nowrap">
                    {SCENES[id].title}
                  </p>
                  <p
                    className="absolute left-12 top-[43px] whitespace-pre-line text-black/50"
                    style={{ width: COPY[id].width }}
                  >
                    {COPY[id].text}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
