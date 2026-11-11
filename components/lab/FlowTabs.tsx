"use client";

import { useEffect, useRef } from "react";
import { SCENES, STEPS, stepScenes, type Arch, type SceneId } from "@/lib/stage/types";
import { StepIcon } from "./icons";

interface Props {
  scene: SceneId;
  onScene: (id: SceneId) => void;
  /** returns 0..1 through the current loop; polled for the progress line */
  progress: () => number;
  autoplay: boolean;
  arch?: Arch;
  /** false leaves out the response-time note, for tight spaces */
  note?: boolean;
}

/** The response-time note at the foot of the tabs; shown on its own where the tabs leave it out. */
export function ResponseNote({ className = "" }: { className?: string }) {
  return (
    <div className={`text-[14px] tracking-[-0.01em] ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/gauge.svg" alt="" width={24} height={24} />
      <p className="mt-3 leading-normal text-black">~600ms response time</p>
      <p className="mt-2 max-w-[295px] leading-[19px] text-black/50">Keep conversations flowing with fast, natural responses.</p>
    </div>
  );
}

/**
 * The three capability groups. The open one shows its description; the line under it fills as the
 * group's models play. Picking a model inside a group happens in the tab bar on the stage.
 */
export function FlowTabs({ scene, onScene, progress, autoplay, arch = "cascaded", note = true }: Props) {
  const active = SCENES[scene].step;
  const bar = useRef<HTMLSpanElement>(null);
  const ids = stepScenes(active, arch);
  const index = Math.max(0, ids.indexOf(scene));

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      // across the whole group: each model is an equal share of the line
      if (bar.current) bar.current.style.transform = `scaleX(${((index + progress()) / ids.length).toFixed(4)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progress, index, ids.length]);

  return (
    <div className="flex h-full flex-col">
      <div>
        {STEPS.map((s, i) => {
          const open = s.id === active;
          return (
            <div key={s.id} className="relative">
              <button
                type="button"
                onClick={() => onScene(stepScenes(s.id, arch)[0])}
                disabled={open}
                className={`group flex w-full items-center gap-4 pb-4 text-left md:pb-5 ${open ? "cursor-default" : "cursor-pointer"} ${i > 0 ? "pt-5 md:pt-7" : ""}`}
                aria-expanded={open}
              >
                <span
                  className={`grid size-12 place-items-center rounded-[12px] border transition-colors duration-300 ${
                    open ? "border-accent bg-accent text-white" : "border-line bg-white text-black group-hover:border-ink/20"
                  }`}
                >
                  <StepIcon id={s.id} />
                </span>
                <span className="text-[16px] leading-[19px] tracking-[-0.01em]">{s.title}</span>
              </button>
              <div className={`grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(.2,.7,.2,1)] ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                <div className="overflow-hidden" inert={!open}>
                  <p className="max-w-[440px] pb-6 text-[14px] leading-[19px] tracking-[-0.01em] text-black/50 md:pb-8">{s.blurb}</p>
                </div>
              </div>
              {/* the divider; under the open group it is the progress line */}
              {i < STEPS.length - 1 || open ? (
                <span className="relative block h-px overflow-hidden bg-line">
                  {open && <span ref={bar} className="absolute inset-0 origin-left bg-accent" style={{ transform: "scaleX(0)", opacity: autoplay ? 1 : 0.45 }} />}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {note && <ResponseNote className="mt-auto pt-8 md:pt-10" />}
    </div>
  );
}
