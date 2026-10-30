"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SCENE_ORDER, type SceneId } from "@/lib/stage/types";
import { FlowTabs } from "./lab/FlowTabs";
import { HEADER_SPACE } from "./SiteHeader";
import { StageCard, useFlowStage, useMedia } from "./useFlowStage";

const N = SCENE_ORDER.length;
/** scroll each scene holds the screen for, in viewport heights */
const PER_SCENE = 1.46;

/**
 * The section driven by the page's scroll, built the way retell-voice-stack.vercel.app does it:
 * a tall section with a sticky panel, centred under the floating header, that stays on screen while
 * the section scrolls past. How far through the section you are picks the scene; scrolling itself
 * stays native, nothing snaps or hijacks it. Choosing a tab scrolls the page to that scene's stretch.
 *
 * Below 1024px the stage and tabs are stacked and too tall to pin, so there it is the homepage's
 * section instead: scenes play on their own and the tabs pick one.
 */
export function ScrollSection() {
  // side by side (Tailwind's lg) the panel fits the screen and the scroll drives it
  const scrolling = useMedia("(min-width: 1024px)");
  const flow = useFlowStage({ autoplay: !scrolling });
  const { stage, scene, pickScene } = flow;
  const section = useRef<HTMLElement>(null);
  const sticky = useRef<HTMLDivElement>(null);
  // the section's height follows the panel and the viewport: PER_SCENE screens per scene, plus the panel itself
  const [layout, setLayout] = useState({ panel: 700, height: 0 });
  // while a tab click scrolls the page, the scenes passed on the way are skipped
  const seeking = useRef<number | null>(null);
  const sync = useRef(() => {});

  useEffect(() => {
    const measure = () => {
      const panel = sticky.current!.offsetHeight;
      setLayout({ panel, height: Math.round(N * innerHeight * PER_SCENE + panel) });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(sticky.current!);
    addEventListener("resize", measure);
    measure();
    return () => {
      ro.disconnect();
      removeEventListener("resize", measure);
    };
  }, []);

  /** where the panel pins (start) and how much scroll the section spans while pinned (len) */
  const range = useCallback(() => {
    const sec = section.current!, st = sticky.current!;
    const start = sec.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(st).top) || 0);
    return { start, len: Math.max(1, sec.offsetHeight - st.offsetHeight) };
  }, []);

  /** how far through the section the page is, 0..N: scene i owns [i, i + 1) */
  const position = useCallback(() => {
    if (!section.current) return 0;
    const { start, len } = range();
    return Math.min(1, Math.max(0, (scrollY - start) / len)) * N;
  }, [range]);

  useEffect(() => {
    if (!scrolling) return;
    sync.current = () => {
      if (seeking.current !== null) return;
      pickScene(SCENE_ORDER[Math.min(N - 1, Math.floor(position()))]);
    };
    let raf = 0;
    const onScroll = () => {
      raf ||= requestAnimationFrame(() => {
        raf = 0;
        sync.current();
      });
    };
    const onEnd = () => {
      seeking.current = null;
      sync.current();
    };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("scrollend", onEnd);
    sync.current();
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", onScroll);
      removeEventListener("scrollend", onEnd);
    };
  }, [scrolling, pickScene, position]);

  const goTo = useCallback(
    (id: SceneId) => {
      const { start, len } = range();
      // just inside the start of the scene's stretch, so its progress line starts from empty
      const top = Math.round(start + ((SCENE_ORDER.indexOf(id) + 0.01) / N) * len);
      seeking.current = top;
      pickScene(id);
      scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      // browsers without scrollend, or a scroll that had nowhere to go, still hand control back
      setTimeout(() => {
        if (seeking.current !== top) return;
        seeking.current = null;
        sync.current();
      }, 1500);
    },
    [pickScene, range],
  );

  // the progress line fills as the page scrolls through the scene's stretch, or with the scene's own loop
  const progress = useCallback(
    () => (scrolling ? Math.min(1, Math.max(0, position() - SCENE_ORDER.indexOf(scene))) : (stage?.progress ?? 0)),
    [scrolling, position, scene, stage],
  );

  // centred in the space under the header, at least 16px below it
  const top = `calc(${HEADER_SPACE}px + max(16px, (100svh - ${HEADER_SPACE}px - ${layout.panel}px) / 2))`;

  // the same elements either way, so the stage's canvas stays put when the layout switches
  return (
    <>
      <section ref={section} className={scrolling ? "relative" : undefined} style={scrolling ? { height: layout.height || undefined } : undefined}>
        <div ref={sticky} className={`mx-auto max-w-[1512px] px-6 md:px-[60px] ${scrolling ? "sticky" : ""}`} style={scrolling ? { top } : undefined}>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,876fr)_minmax(300px,456fr)] lg:gap-[60px]">
            <StageCard {...flow} />
            <FlowTabs scene={scene} onScene={scrolling ? goTo : pickScene} progress={progress} autoplay />
          </div>
        </div>
      </section>
      {/* room before whatever follows the section on the page */}
      <div aria-hidden className="h-24 lg:h-[160px]" />
    </>
  );
}
