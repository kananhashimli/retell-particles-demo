"use client";

import { useSyncExternalStore } from "react";
import type { OrbStyle } from "@/lib/stage/orb";

const KEY = "retell-stage:orb-style";
const STYLES: OrbStyle[] = [1, 2];
const listeners = new Set<() => void>();

/** the chosen orb style; shared by every page, so a choice carries over between them */
export const getOrbStyle = (): OrbStyle => {
  try {
    return localStorage.getItem(KEY) === "2" ? 2 : 1;
  } catch {
    return 1;
  }
};

const setOrbStyle = (style: OrbStyle) => {
  try {
    localStorage.setItem(KEY, String(style));
  } catch {}
  listeners.forEach((fn) => fn());
};

export const useOrbStyle = () =>
  useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      addEventListener("storage", onChange);
      return () => {
        listeners.delete(onChange);
        removeEventListener("storage", onChange);
      };
    },
    getOrbStyle,
    (): OrbStyle => 1,
  );

/** Style 1 / Style 2, for comparing the two looks of the orb. */
export function StylePicker({ className = "" }: { className?: string }) {
  const style = useOrbStyle();
  return (
    <div role="group" aria-label="Orb style" className={`flex items-center rounded-full bg-ink/[0.05] p-1 ${className}`}>
      {STYLES.map((s) => {
        const on = s === style;
        return (
          <button
            key={s}
            type="button"
            onClick={() => setOrbStyle(s)}
            aria-pressed={on}
            className={`cursor-pointer rounded-full px-3 py-1.5 text-[13px] font-medium leading-none transition-all duration-300 ${on ? "bg-white text-ink shadow-[0_1px_3px_rgba(0,0,0,0.08)]" : "text-muted hover:text-ink"}`}
          >
            Style {s}
          </button>
        );
      })}
    </div>
  );
}
