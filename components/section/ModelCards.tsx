"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Stage } from "@/lib/stage/stage";
import { HARNESS_PARTS, harnessActivity } from "@/lib/stage/directions/harness";
import { SCENES, STEPS, stepScenes, type Arch, type SceneId, type StepId } from "@/lib/stage/types";
import { CARDS, HARNESS_COPY, RETRIEVAL_DETAIL, S2S_CORE, S2S_TELL1_NOTE, S2S_UNCONFIRMED, TELL1_CTA, TELL1_EVAL_URL, type CardCopy } from "./copy";

// the stage as drawn: 876 × 678; the card column sits left of the orb, under the tab bar
const W = 876;
const H = 678;
const COL_LEFT = 24;
const COL_TOP = 80;
const COL_W = 340;

/** a card icon, drawn as a mask so it takes the text colour */
const Icon = ({ name, className = "" }: { name: string; className?: string }) => (
  <span aria-hidden className={`block size-5 shrink-0 bg-current ${className}`} style={{ mask: `url(/icons/m/${name}.svg) center / 20px 20px no-repeat` }} />
);

const SHADOW = "shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_3px_6px_-1.5px_rgba(0,0,0,0.04),0_12px_12px_-6px_rgba(0,0,0,0.04)]";

interface Props {
  scene: SceneId;
  arch: Arch;
  stage: Stage | null;
  onScene: (id: SceneId) => void;
  /** phone layout: a plain list under the stage instead of cards laid over it */
  mobile?: boolean;
  /** false holds the cards back until the stage has loaded */
  show?: boolean;
}

/**
 * The model cards: every capability group, in order. The group playing now is open with its cards and
 * descriptions; the others stay as muted one-line context. On desktop they sit over the stage, with
 * connectors to the orb for whatever is contributing right now.
 */
export function ModelCards({ scene, arch, stage, onScene, mobile = false, show = true }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const paths = useRef(new Map<string, { line: SVGPathElement; dot: SVGCircleElement }>());
  const [size, setSize] = useState({ w: W, h: H });
  const scale = size.w / W;
  const step = SCENES[scene].step;

  useEffect(() => {
    if (mobile) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(root.current!);
    return () => ro.disconnect();
  }, [mobile]);

  // live: harness components light with their nodes, and the connectors follow the cards to the orb
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = stage ? stage.progress * stage.duration : 0;
      const act: Record<string, number> = {};
      for (const p of HARNESS_PARTS) {
        const v = scene === "harness" ? harnessActivity(p, t) : 0;
        act[`part:${p}`] = v;
        els.current.get(`part:${p}`)?.style.setProperty("--act", v.toFixed(3));
      }
      if (mobile || !stage || !frame.current) return;
      const fr = frame.current.getBoundingClientRect();
      const R = stage.config.orb.radius;
      const c = stage.project(0, R, 0);
      const top = stage.project(0, 2 * R, 0);
      const ox = c.x / scale, oy = c.y / scale, orbR = Math.abs(c.y - top.y) / scale;
      const now = (performance.now() - t0) / 1000;
      paths.current.forEach(({ line, dot }, key) => {
        const el = els.current.get(key);
        let o = 0;
        if (key === scene && !(arch === "s2s" && SCENES[scene].step === "speak")) o = 1;
        else if (key.startsWith("part:")) o = act[key];
        else if (key === "harness-group" && scene === "harness") o = 0.35;
        if (!el || o < 0.01) {
          line.style.opacity = "0";
          dot.style.opacity = "0";
          return;
        }
        const r = el.getBoundingClientRect();
        const x1 = (r.right - fr.left) / scale + 6;
        const y1 = (r.top + r.height / 2 - fr.top) / scale;
        // land on the orb's rim, facing the card
        const ang = Math.atan2(y1 - oy, x1 - ox);
        const x2 = ox + Math.cos(ang) * orbR * 1.08, y2 = oy + Math.sin(ang) * orbR * 1.08;
        const k = Math.max(24, (x2 - x1) * 0.5);
        line.setAttribute("d", `M${x1},${y1} C${x1 + k},${y1} ${x2 - Math.cos(ang) * -k * 0.5},${y2 - Math.sin(ang) * -k * 0.5} ${x2},${y2}`);
        line.style.opacity = String(o);
        // one pulse travelling to the orb: contribution, not a fixed pipeline
        const u = (now / 1.8 + (key.length % 5) * 0.21) % 1;
        const p = line.getPointAtLength(u * line.getTotalLength());
        dot.setAttribute("cx", String(p.x));
        dot.setAttribute("cy", String(p.y));
        dot.style.opacity = String(o * Math.sin(Math.PI * u));
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage, scene, scale, mobile, arch]);

  const reg = (key: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(key, el);
    else els.current.delete(key);
  };

  const column = (
    <div className={`flex flex-col gap-4 ${mobile ? "" : "pointer-events-auto"}`}>
      {STEPS.map((s) => (
        <Group key={s.id} id={s.id} open={s.id === step} onOpen={() => onScene(stepScenes(s.id, arch)[0])} arch={arch}>
          {s.id === "think" ? (
            <Reasoning scene={scene} arch={arch} onScene={onScene} reg={reg} />
          ) : (
            s.scenes.map((id) => {
              // speech-to-speech: response controls are shown, not as active, until their availability is confirmed
              const unconfirmed = arch === "s2s" && s.id === "speak";
              return (
                <Card
                  key={id}
                  copy={CARDS[id]!}
                  current={id === scene && !unconfirmed}
                  unconfirmed={unconfirmed}
                  onPick={unconfirmed ? undefined : () => onScene(id)}
                  ref={reg(id)}
                />
              );
            })
          )}
        </Group>
      ))}
    </div>
  );

  if (mobile) return <div className={`transition-opacity duration-700 ${show ? "opacity-100" : "opacity-0"}`}>{column}</div>;

  const keys = [...STEPS.flatMap((s) => s.scenes), "harness-group", ...HARNESS_PARTS.map((p) => `part:${p}`)];
  return (
    <div ref={root} className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        ref={frame}
        className={`absolute left-0 top-0 origin-top-left transition-opacity duration-700 ${show ? "opacity-100" : "opacity-0"}`}
        style={{ width: W, height: H, transform: `scale(${scale})` }}
      >
        <svg className="absolute inset-0 overflow-visible" width={W} height={H} aria-hidden>
          {keys.map((k) => (
            <g key={k}>
              <path
                ref={(el) => {
                  const cur = paths.current.get(k);
                  if (el) paths.current.set(k, { line: el, dot: cur?.dot ?? (null as unknown as SVGCircleElement) });
                }}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1}
                strokeDasharray="3 4"
                className="connector-flow transition-opacity duration-300"
                style={{ opacity: 0 }}
              />
              <circle
                ref={(el) => {
                  const cur = paths.current.get(k);
                  if (el && cur) cur.dot = el;
                }}
                r={2.5}
                fill="var(--accent)"
                style={{ opacity: 0 }}
              />
            </g>
          ))}
        </svg>
        <div className="absolute" style={{ left: COL_LEFT, top: COL_TOP, width: COL_W }}>
          {column}
        </div>
      </div>
    </div>
  );
}

/** One capability group: a label, then its cards when open, or its model names as muted context when not. */
function Group({ id, open, onOpen, arch, children }: { id: StepId; open: boolean; onOpen: () => void; arch: Arch; children: ReactNode }) {
  const s = STEPS.find((x) => x.id === id)!;
  const names = s.scenes.map((sc) => (sc === "llm" && arch === "s2s" ? S2S_CORE.title : SCENES[sc].tab));
  return (
    <section aria-label={s.title}>
      <button
        type="button"
        onClick={onOpen}
        disabled={open}
        className={`group -mx-3 block w-[calc(100%+24px)] rounded-[12px] px-3 text-left transition-colors duration-500 ${open ? "cursor-default py-1" : "cursor-pointer bg-[#F6F6F8]/80 py-2 backdrop-blur-[6px] hover:bg-[#EEEEF2]/90"}`}
      >
        <span className={`block text-[11px] font-medium uppercase leading-[14px] tracking-[0.08em] transition-colors ${open ? "text-black/45" : "text-black/35 group-hover:text-black/60"}`}>{s.title}</span>
        <span className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(.2,.7,.2,1)] ${open ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}>
          <span className="overflow-hidden">
            <span className="block pt-1.5 text-[13px] leading-[17px] tracking-[-0.01em] text-black/45 group-hover:text-black/70">{names.join(" · ")}</span>
          </span>
        </span>
      </button>
      <div className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(.2,.7,.2,1)] ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        {/* padded out past the column, so the clip leaves room for the card shadows */}
        <div className="-mx-1.5 overflow-hidden px-1.5" inert={!open}>
          <div className="flex flex-col gap-2 pb-2 pt-2.5">{children}</div>
        </div>
      </div>
    </section>
  );
}

interface CardProps {
  copy: CardCopy;
  current: boolean;
  unconfirmed?: boolean;
  onPick?: () => void;
  ref?: (el: HTMLElement | null) => void;
  /** Tell-1 / the core model: larger, with room for a link */
  big?: boolean;
  children?: ReactNode;
}

/** A model card. The one playing now is lit; the rest of its group stay readable, a step back. */
function Card({ copy, current, unconfirmed = false, onPick, ref, big = false, children }: CardProps) {
  return (
    <div
      ref={ref}
      className={`relative rounded-[16px] text-[14px] leading-[19px] tracking-[-0.01em] transition-[opacity,box-shadow,background-color] duration-500 ${
        unconfirmed ? "border border-dashed border-black/20 bg-[#F6F6F8]/85 text-black/55 backdrop-blur-[6px]" : `bg-white ${SHADOW} ${current ? "ring-1 ring-accent/45" : "text-black/60 hover:text-black"}`
      } ${big ? "px-4 pb-4 pt-4" : "px-4 py-3"}`}
    >
      <div className="flex gap-3">
        <Icon name={copy.icon} className={`mt-[1px] transition-colors duration-500 ${current ? "text-accent" : "text-black/45"}`} />
        <div className="min-w-0 flex-1">
          {onPick ? (
            <button type="button" onClick={onPick} disabled={current} className={`text-left after:absolute after:inset-0 after:rounded-[16px] ${current ? "cursor-default" : "cursor-pointer"} ${big ? "text-[17px] leading-[22px]" : ""}`}>
              {copy.title}
            </button>
          ) : (
            <p className={big ? "text-[17px] leading-[22px]" : ""}>{copy.title}</p>
          )}
          <p className={`mt-1 text-[13px] leading-[18px] ${current ? "text-black/50" : "text-black/40"}`}>{copy.text}</p>
          {unconfirmed && <p className="mt-2 inline-block rounded-full border border-black/15 px-2 py-0.5 text-[11px] leading-[14px] text-black/50">{S2S_UNCONFIRMED}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

/** Reasoning & orchestration: the core model as a prominent card, then the harness as its own system layer. */
function Reasoning({ scene, arch, onScene, reg }: { scene: SceneId; arch: Arch; onScene: (id: SceneId) => void; reg: (key: string) => (el: HTMLElement | null) => void }) {
  const s2s = arch === "s2s";
  const harnessOn = scene === "harness";
  return (
    <>
      <Card copy={s2s ? S2S_CORE : CARDS.llm!} current={scene === "llm"} onPick={() => onScene("llm")} ref={reg("llm")} big>
        {s2s ? (
          <p className="mt-2 text-[12px] leading-[16px] text-black/40">{S2S_TELL1_NOTE}</p>
        ) : (
          <a href={TELL1_EVAL_URL} className="relative z-10 mt-2.5 inline-flex items-center gap-1 text-[13px] leading-[18px] text-accent hover:underline">
            {TELL1_CTA}
            <span aria-hidden>→</span>
          </a>
        )}
      </Card>

      {/* the harness: a container, visibly not a model card, its three components inside */}
      <div
        ref={reg("harness-group")}
        className={`relative rounded-[20px] border border-dashed p-2 transition-colors duration-500 ${harnessOn ? "border-accent/45 bg-[#EEF2FD]/85" : "border-black/15 bg-[#F6F6F8]/85"} backdrop-blur-[6px]`}
      >
        <div className="relative flex gap-3 px-2 pb-2 pt-1.5 text-[14px] leading-[19px] tracking-[-0.01em]">
          <Icon name="harness" className={`mt-[1px] transition-colors duration-500 ${harnessOn ? "text-accent" : "text-black/45"}`} />
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => onScene("harness")} disabled={harnessOn} className={`text-left after:absolute after:inset-0 ${harnessOn ? "cursor-default" : "cursor-pointer"}`}>
              {CARDS.harness!.title}
            </button>
            <p className="mt-1 text-[13px] leading-[18px] text-black/50">{CARDS.harness!.text}</p>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {HARNESS_PARTS.map((p) => (
            <div
              key={p}
              ref={reg(`part:${p}`)}
              className={`flex gap-2.5 rounded-[12px] bg-white px-3 py-[7px] text-[13px] leading-[17px] tracking-[-0.01em] transition-colors duration-500 ${harnessOn ? "" : "text-black/60"}`}
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
    </>
  );
}
