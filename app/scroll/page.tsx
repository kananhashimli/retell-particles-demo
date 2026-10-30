import type { Metadata } from "next";
import { ScrollSection } from "@/components/ScrollSection";
import { SiteHeader } from "@/components/SiteHeader";

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
          <p className="text-[15px] text-black/50">Retell vCX Conversational Dynamics</p>
          <h1 className="mt-8 max-w-[680px] font-serif text-[clamp(44px,5.6vw,72px)] leading-[0.80] tracking-[-0.02em]">The most powerful agent for the contact center</h1>
          <p className="mt-6 max-w-[350px] text-[15px] leading-[1.4]">Six purpose-built Retell models handle the listening, thinking, and speaking on every call.</p>
        </header>
        <ScrollSection />
        {/* room to scroll past the section, as the rest of a page would */}
        <div className="h-[50svh]" />
      </main>
    </>
  );
}
