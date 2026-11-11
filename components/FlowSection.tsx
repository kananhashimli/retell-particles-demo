"use client";

import { useCallback, useState } from "react";
import { orderFor, SCENES, stepScenes, type Arch } from "@/lib/stage/types";
import { FlowTabs } from "./lab/FlowTabs";
import { DESCRIPTION, EYEBROW, HEADLINE } from "./section/copy";
import { StageCard, useFlowStage } from "./useFlowStage";

const ARCHS: { id: Arch; label: string }[] = [
  { id: "cascaded", label: "Cascaded" },
  { id: "s2s", label: "Speech-to-speech" },
];

/** Cascaded / speech-to-speech: the brief's two variants of the same layout (the toggle itself is optional). */
function ArchToggle({ arch, onArch }: { arch: Arch; onArch: (a: Arch) => void }) {
  return (
    <div role="group" aria-label="Agent architecture" className="flex items-center rounded-full bg-ink/[0.05] p-1">
      {ARCHS.map((a) => {
        const on = a.id === arch;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onArch(a.id)}
            aria-pressed={on}
            className={`cursor-pointer rounded-full px-3.5 py-1.5 text-[13px] leading-[18px] transition-all duration-300 ${on ? "bg-white text-ink shadow-[0_1px_3px_rgba(0,0,0,0.08)]" : "text-muted hover:text-ink"}`}
          >
            {a.label}
          </button>
        );
      })}
    </div>
  );
}

/** The section: header, the stage with its model tabs and cards, and the three capability groups beside it. */
export function FlowSection() {
  const [arch, setArch] = useState<Arch>("cascaded");
  const flow = useFlowStage({ autoplay: true, arch });
  const { stage } = flow;
  const progress = useCallback(() => stage?.progress ?? 0, [stage]);
  const switchArch = (a: Arch) => {
    setArch(a);
    // a scene the other architecture doesn't play (guardrails, for speech-to-speech) hands over to its group's first
    if (!orderFor(a).includes(flow.scene)) flow.pickScene(stepScenes(SCENES[flow.scene].step, a)[0]);
  };

  return (
    <main className="mx-auto flex min-h-svh max-w-[1512px] flex-col justify-center px-6 py-16 md:px-[60px]">
      <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
        <div>
          <p className="text-[15px] text-muted">{EYEBROW}</p>
          <h2 className="mt-6 max-w-[760px] font-serif text-[clamp(40px,5.2vw,72px)] leading-[0.98] tracking-[-0.02em] md:mt-8">{HEADLINE}</h2>
          <p className="mt-6 max-w-[480px] text-[15px] leading-[1.4]">{DESCRIPTION}</p>
        </div>
        <ArchToggle arch={arch} onArch={switchArch} />
      </header>
      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,876fr)_minmax(300px,456fr)] lg:gap-[60px]">
        <StageCard {...flow} />
        <FlowTabs scene={flow.scene} onScene={flow.pickScene} progress={progress} autoplay arch={arch} />
      </div>
    </main>
  );
}
