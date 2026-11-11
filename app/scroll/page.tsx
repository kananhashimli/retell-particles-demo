import type { Metadata } from "next";
import { ScrollSection } from "@/components/ScrollSection";
import { SiteHeader } from "@/components/SiteHeader";
import { DESCRIPTION, EYEBROW, HEADLINE } from "@/components/section/copy";

export const metadata: Metadata = { title: "Retell · Flow stage on scroll" };

/**
 * The section as it sits in the Retell page (retell-voice-stack.vercel.app): under the site header,
 * its heading, then the stage stepping through the scenes as you scroll.
 */
export default function ScrollDemo() {
  return (
    <>
      <SiteHeader />
      <main>
        <header className="mx-auto max-w-[1512px] px-6 pb-10 pt-[144px] md:px-[60px] md:pb-[48px] md:pt-[320px]">
          <p className="text-[15px] text-black/50">{EYEBROW}</p>
          <h1 className="mt-8 max-w-[1100px] font-serif text-[clamp(44px,5.6vw,72px)] leading-[0.98] tracking-[-0.02em]">{HEADLINE}</h1>
          <p className="mt-6 max-w-[368px] text-[15px] leading-[1.4]">{DESCRIPTION}</p>
        </header>
        <ScrollSection />
        {/* room to scroll past the section, as the rest of a page would */}
        <div className="h-[50svh]" />
      </main>
    </>
  );
}
