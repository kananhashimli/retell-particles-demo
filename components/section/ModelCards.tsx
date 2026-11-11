"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Stage } from "@/lib/stage/stage";
import { HARNESS_PARTS, harnessActivity } from "@/lib/stage/directions/harness";
import { SCENES, type Arch, type SceneId } from "@/lib/stage/types";
import { CARDS, HARNESS_COPY, RETRIEVAL_DETAIL, S2S_CORE, S2S_TELL1_NOTE, S2S_UNCONFIRMED, TELL1_CTA, TELL1_EVAL_URL, type CardCopy } from "./copy";

// the stage as drawn: 876 × 678; the card sits left of the orb, below the tab bar, centred in the space left
const W = 876;
const H = 678;
const COL_LEFT = 24;
const COL_TOP = 80;
const COL_BOTTOM = 24;
const COL_W = 340;

/** a card icon, drawn as a mask so it takes the text colour */
const Icon = ({ name, className = "" }: { name: string; className?: string }) => (
  <span aria-hidden className={`block size-5 shrink-0 bg-current ${className}`} style={{ mask: `url(/icons/m/${name}.svg) center / 20px 20px no-repeat` }} />
);

const SHADOW = "shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_3px_6px_-1.5px_rgba(0,0,0,0.04),0_12px_12px_-6px_rgba(0,0,0,0.04),0_48px_48px_-24px_rgba(0,0,0,0.04)]";

interface Props {
  scene: SceneId;
  arch: Arch;
  stage: Stage | null;
  /** phone layout: the card under the stage instead of laid over it */
  mobile?: boolean;
  /** false holds the card back until the stage has loaded */
  show?: boolean;
}

/** The card for the tab that's open: one model, or the agent harness with its three components. */
export function ModelCards({ scene, arch, stage, mobile = false, show = true }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const parts = useRef(new Map<string, HTMLElement>());
  const [size, setSize] = useState({ w: W, h: H });
  const scale = size.w / W;

  useEffect(() => {
    if (mobile) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(root.current!);
    return () => ro.disconnect();
  }, [mobile]);

  // harness components light while their nodes on the stage are called
  useEffect(() => {
    if (scene !== "harness") return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = stage ? stage.progress * stage.duration : 0;
      for (const p of HARNESS_PARTS) parts.current.get(p)?.style.setProperty("--act", harnessActivity(p, t).toFixed(3));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage, scene]);

  const reg = (key: string) => (el: HTMLElement | null) => {
    if (el) parts.current.set(key, el);
    else parts.current.delete(key);
  };

  // keyed by scene, so each tab's card rises in fresh
  const card = (
    <div key={`${arch}:${scene}`} className="scene-card flex flex-col gap-2">
      <SceneCard scene={scene} arch={arch} reg={reg} />
    </div>
  );

  if (mobile) return <div className={`transition-opacity duration-700 ${show ? "opacity-100" : "opacity-0"}`}>{card}</div>;

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className={`absolute left-0 top-0 origin-top-left transition-opacity duration-700 ${show ? "opacity-100" : "opacity-0"}`}
        style={{ width: W, height: H, transform: `scale(${scale})` }}
      >
        <div className="pointer-events-auto absolute flex flex-col justify-center" style={{ left: COL_LEFT, top: COL_TOP, bottom: COL_BOTTOM, width: COL_W }}>
          {card}
        </div>
      </div>
    </div>
  );
}

/** What the open tab shows. */
function SceneCard({ scene, arch, reg }: { scene: SceneId; arch: Arch; reg: (key: string) => (el: HTMLElement | null) => void }) {
  const s2s = arch === "s2s";
  if (scene === "harness") return <Harness reg={reg} />;
  if (scene === "llm") {
    return (
      <Card copy={s2s ? S2S_CORE : CARDS.llm!} big>
        {s2s ? (
          <p className="mt-2 text-[12px] leading-[16px] text-black/40">{S2S_TELL1_NOTE}</p>
        ) : (
          <a href={TELL1_EVAL_URL} className="mt-2.5 inline-flex items-center gap-1 text-[13px] leading-[18px] text-accent hover:underline">
            {TELL1_CTA}
            <span aria-hidden>→</span>
          </a>
        )}
      </Card>
    );
  }
  // speech-to-speech "Spoken response": the response controls, shown but not as active until confirmed
  if (s2s && SCENES[scene].step === "speak") {
    return (
      <>
        <Card copy={CARDS.colloquial!} unconfirmed />
        <Card copy={CARDS.guardrails!} unconfirmed />
      </>
    );
  }
  return <Card copy={CARDS[scene]!} />;
}

/** A model card. */
function Card({ copy, unconfirmed = false, big = false, children }: { copy: CardCopy; unconfirmed?: boolean; big?: boolean; children?: ReactNode }) {
  return (
    <div
      className={`rounded-[20px] text-[14px] leading-[19px] tracking-[-0.01em] ${
        unconfirmed ? "border border-dashed border-black/20 bg-[#F6F6F8]/85 text-black/55 backdrop-blur-[6px]" : `bg-white text-black ${SHADOW}`
      } ${big ? "p-5" : "px-4 py-4"}`}
    >
      <div className="flex gap-3">
        <Icon name={copy.icon} className={`mt-[1px] ${unconfirmed ? "text-black/45" : "text-accent"}`} />
        <div className="min-w-0 flex-1">
          <p className={big ? "text-[17px] leading-[22px]" : ""}>{copy.title}</p>
          <p className="mt-1 text-[13px] leading-[18px] text-black/50">{copy.text}</p>
          {unconfirmed && <p className="mt-2 inline-block rounded-full border border-black/15 px-2 py-0.5 text-[11px] leading-[14px] text-black/50">{S2S_UNCONFIRMED}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

/** The harness: a container, visibly not a model card, with its three components inside. */
function Harness({ reg }: { reg: (key: string) => (el: HTMLElement | null) => void }) {
  return (
    <div className="rounded-[22px] border border-dashed border-accent/45 bg-[#EEF2FD]/85 p-2 backdrop-blur-[6px]">
      <div className="flex gap-3 px-2 pb-2.5 pt-2 text-[14px] leading-[19px] tracking-[-0.01em]">
        <Icon name="harness" className="mt-[1px] text-accent" />
        <div className="min-w-0 flex-1">
          <p>{CARDS.harness!.title}</p>
          <p className="mt-1 text-[13px] leading-[18px] text-black/50">{CARDS.harness!.text}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {HARNESS_PARTS.map((p) => (
          <div
            key={p}
            ref={reg(p)}
            className="flex gap-2.5 rounded-[14px] bg-white px-3 py-2 text-[13px] leading-[17px] tracking-[-0.01em]"
            style={{ "--act": 0, boxShadow: "0 0 0 calc(0.5px + var(--act) * 0.5px) color-mix(in srgb, var(--accent) calc(var(--act) * 60%), rgba(0,0,0,0.1))" } as CSSProperties}
          >
            <span className="relative mt-[5px] size-[7px] shrink-0 rounded-full bg-black/20">
              <span className="absolute inset-0 rounded-full bg-accent" style={{ opacity: "var(--act)", transform: "scale(calc(1 + var(--act) * 0.3))" }} />
            </span>
            <div className="min-w-0">
              <p>{HARNESS_COPY[p].title}</p>
              <p className="mt-0.5 text-[12px] leading-[16px] text-black/50">
                {HARNESS_COPY[p].text}
                {/* optional technical detail */}
                {p === "retrieval" && <span className="ml-1 font-mono text-[10px] uppercase tracking-[0.04em] text-black/30">{RETRIEVAL_DETAIL}</span>}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
