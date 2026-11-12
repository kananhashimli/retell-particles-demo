import type { SVGProps } from "react";

const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const SlidersIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width={16} height={16} {...p}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </svg>
);

export const DownloadIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width={16} height={16} {...p}>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
  </svg>
);

export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.6-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" />
  </svg>
);

export const PauseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" {...p}>
    <rect x="6" y="5" width="4" height="14" rx="1.2" />
    <rect x="14" y="5" width="4" height="14" rx="1.2" />
  </svg>
);

/** Icons from the Figma design, drawn as masks so they take the text colour. */
export const StepIcon = ({ id, className = "" }: { id: "listen" | "think" | "speak" | "conversation"; className?: string }) => (
  <span aria-hidden className={`block size-5 bg-current ${className}`} style={{ mask: `url(/icons/${id}.svg) center / 20px 20px no-repeat` }} />
);
