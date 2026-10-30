"use client";

import { useCallback } from "react";
import { FlowTabs } from "./lab/FlowTabs";
import { StageCard, useFlowStage } from "./useFlowStage";

/** The stage card and Listen / Think / Speak tabs, cycling through the scenes on their own. */
export function FlowSection() {
  const flow = useFlowStage({ autoplay: true });
  const { stage } = flow;
  const progress = useCallback(() => stage?.progress ?? 0, [stage]);

  return (
    <main className="mx-auto flex min-h-svh max-w-[1512px] flex-col justify-center px-6 py-16 md:px-[60px]">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,876fr)_minmax(300px,456fr)] lg:gap-[60px]">
        <StageCard {...flow} />
        <FlowTabs scene={flow.scene} onScene={flow.pickScene} progress={progress} autoplay />
      </div>
    </main>
  );
}
