import type { Metadata } from "next";
import localFont from "next/font/local";
import { Instrument_Serif, Geist_Mono } from "next/font/google";
import "./globals.css";

const untitledSans = localFont({
  variable: "--font-untitled",
  src: [
    { path: "./fonts/untitled-sans-light.woff2", weight: "300" },
    { path: "./fonts/untitled-sans-regular.woff2", weight: "400" },
    { path: "./fonts/untitled-sans-medium.woff2", weight: "500" },
    { path: "./fonts/untitled-sans-bold.woff2", weight: "700" },
  ],
});
const serif = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400" });
const mono = Geist_Mono({ variable: "--font-mono-g", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Retell · Flow stage",
  description: "Listen, think, speak: animated isometric scenes around the Retell orb.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${untitledSans.variable} ${serif.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
