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
// on phones the cards keep their size, pinned to the bottom-left corner
const INSET = 16;
const CARD_H = 97;
const PILL_H = 41;

/** "listening" is the pill shown while the dust still floats, before Denoising cleans it up. */
type Shown = SceneId | "listening";

/**
 * Cards for the scenes reached so far in the current step, top to bottom: the newest at a fixed
 * place, older ones stacked above it. On phones (`bottom`: where the card's foot sits, in css px)
 * only the current scene's card shows.
 */
const stack = (scene: Shown, bottom?: number): { id: Shown; top: number }[] => {
  if (scene === "listening") return [{ id: scene, top: bottom === undefined ? PILL_TOP : bottom - PILL_H }];
  if (bottom !== undefined) return [{ id: scene, top: bottom - CARD_H }];
  const step = STEPS.find((s) => s.scenes.includes(scene))!;
  const shown = step.scenes.slice(0, step.scenes.indexOf(scene) + 1);
  return shown.map((id, i) => ({ id, top: NEWEST - PITCH * (shown.length - 1 - i) }));
};

/** The scene cards floating beside the orb, laid over the stage. */
export function SceneCards({
  scene,
  stage,
  mobile = false,
  show = true,
}: {
  scene: SceneId;
  stage: Stage | null;
  /** phone layout: cards at full size in the bottom-left corner instead of scaling with the stage */
  mobile?: boolean;
  /** false holds the cards back, e.g. until the stage has loaded; they rise in once it turns true */
  show?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: W, h: H });
  const scale = size.w / W;
  const bottom = mobile ? size.h - INSET : undefined;
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
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(root.current!);
    return () => ro.disconnect();
  }, []);

  const cards = stack(shown, bottom);
  if (shown !== prev) {
    // cards that drop out of the stack stay mounted, in place, while they fade
    setPrev(shown);
    setLeaving(stack(prev, bottom).filter((c) => !cards.some((n) => n.id === c.id)));
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
        style={mobile ? { width: "100%", height: "100%" } : { width: W, height: H, transform: `scale(${scale})` }}
        hidden={!show}
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
              style={{ left: mobile ? INSET : LEFT, top: 0, transform: `translateY(${top}px)` }}
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
