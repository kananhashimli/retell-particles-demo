"use client";

import { useEffect, useState } from "react";

/** Space the floating header takes at the top of the screen (16px inset + 40px bar), css px. Pinned content sits below it. */
export const HEADER_SPACE = 56;

const NAV: { label: string; menu?: boolean }[] = [
  { label: "Product", menu: true },
  { label: "Solutions", menu: true },
  { label: "Developers", menu: true },
  { label: "Resources", menu: true },
  { label: "Pricing" },
];

/** The dotted ring of the logo. */
function Mark() {
  const dots = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    return <circle key={i} cx={13 + Math.cos(a) * 10} cy={13 + Math.sin(a) * 10} r={2.3} />;
  });
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="currentColor" aria-hidden>
      {dots}
    </svg>
  );
}

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.5 6.5 8 10l3.5-3.5" />
    </svg>
  );
}

/**
 * A stand-in for the Retell site header, matching retell-voice-stack.vercel.app: it floats 16px from
 * the top and gains a frosted pill behind it once the page scrolls. Links go nowhere.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(scrollY > 8);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-4 z-20 mt-4 px-5 text-[14px] tracking-[-0.01em] text-black">
      <div className="relative flex h-10 items-center">
        <span
          aria-hidden
          className={`absolute -inset-x-2.5 -inset-y-1.5 -z-10 rounded-full bg-white/[0.78] shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05)] backdrop-blur-[20px] transition-opacity duration-300 ${scrolled ? "opacity-100" : "opacity-0"}`}
        />
        <a href="#" className="flex w-[200px] shrink-0 items-center gap-2.5 text-[21px] font-medium tracking-[-0.02em]">
          <Mark />
          Retell
        </a>
        <nav className="hidden items-center gap-6 lg:flex">
          {NAV.map((n) => (
            <a key={n.label} href="#" className="flex items-center gap-0.5 hover:text-black/60">
              {n.label}
              {n.menu && <Chevron />}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          <a href="#" className="hidden h-10 items-center px-3 hover:text-black/60 md:flex">
            Login
          </a>
          <a href="#" className={`hidden h-10 items-center rounded-full px-4 transition-shadow duration-300 hover:bg-black/[0.03] md:flex ${scrolled ? "" : "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"}`}>
            Contact Sales
          </a>
          <a href="#" className="flex h-10 items-center rounded-full bg-[#172131] px-4 text-white hover:bg-[#172131]/90">
            Try for free
          </a>
        </div>
      </div>
    </header>
  );
}
