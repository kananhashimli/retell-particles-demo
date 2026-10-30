"use client";

import { useEffect, useRef } from "react";
import { SCENES, STEPS, type SceneId } from "@/lib/stage/types";
import { StepIcon } from "./icons";

interface Props {
  scene: SceneId;
  onScene: (id: SceneId) => void;
  /** returns 0..1 through the current loop; polled for the progress line */
  progress: () => number;
  autoplay: boolean;
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

/** Listen / Think / Speak, as in the design: the open step shows its copy and sub-steps. */
export function FlowTabs({ scene, onScene, progress, autoplay, note = true }: Props) {
  const active = SCENES[scene].step;
  const bar = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (bar.current) bar.current.style.transform = `scaleY(${progress().toFixed(4)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progress, scene]);

  return (
    <div className="flex h-full flex-col">
      <div>
        {STEPS.map((s, i) => {
          const open = s.id === active;
          return (
            <div key={s.id} className={i > 0 ? "border-t border-line" : ""}>
              <button
                type="button"
                onClick={() => onScene(s.scenes[0])}
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
                  <p className="max-w-[327px] pb-3 text-[14px] md:pb-4 leading-[19px] tracking-[-0.01em] text-black/50">{s.blurb}</p>
                  <ul className="pb-3 md:pb-[17px]">
                    {s.scenes.map((id) => {
                      const on = id === scene;
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            onClick={() => onScene(id)}
                            disabled={on}
                            aria-current={on ? "step" : undefined}
                            className={`relative flex w-full ${on ? "cursor-default" : "cursor-pointer"} items-baseline gap-3 py-1.5 pl-4 md:py-2 text-left text-[14px] leading-[19px] tracking-[-0.01em] transition-colors ${on ? "text-black" : "text-black/50 hover:text-black"}`}
                          >
                            <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] md:top-2 md:bottom-2 overflow-hidden rounded bg-line">
                              {on && (
                                <span
                                  ref={bar}
                                  className="absolute inset-0 origin-top bg-accent"
                                  style={{ transform: "scaleY(0)", opacity: autoplay ? 1 : 0.45 }}
                                />
                              )}
                            </span>
                            <span className="whitespace-nowrap">{SCENES[id].title}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
              {/* with the blurb shut, the icon sits 28px above the divider */}
              <div className="h-2" />
            </div>
          );
        })}
      </div>
      {note && <ResponseNote className="mt-auto pt-8 md:pt-10" />}
    </div>
  );
}
