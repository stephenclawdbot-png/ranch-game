import type { Metadata, Viewport } from "next";
import { Jersey_10, Nunito, Pixelify_Sans, Silkscreen, VT323 } from "next/font/google";
import { SiteNav } from "@/components/SiteNav";
import { ArtProvider } from "@/components/pixel/ArtProvider";
import { listArt } from "@/lib/art.server";
import "./globals.css";

const pixelify = Pixelify_Sans({ subsets: ["latin"], variable: "--font-pixelify", display: "swap" });
const silkscreen = Silkscreen({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-silkscreen", display: "swap" });
const vt323 = VT323({ subsets: ["latin"], weight: "400", variable: "--font-vt323", display: "swap" });
const jersey = Jersey_10({ subsets: ["latin"], weight: "400", variable: "--font-jersey", display: "swap" });
const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Thoroughbred", template: "%s · Thoroughbred" },
  description: "Run a racing stable. Deterministic, replayable horse racing.",
};

export const viewport: Viewport = {
  themeColor: "#0f2a1d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const art = listArt();
  return (
    <html lang="en" className={`${pixelify.variable} ${silkscreen.variable} ${vt323.variable} ${jersey.variable} ${nunito.variable}`}>
      <body>
        <ArtProvider files={art}>
          <SiteNav />
          <main className="relative z-10 mx-auto w-full max-w-6xl px-3 pb-28 pt-4 sm:px-6 md:pb-16 md:pt-6">{children}</main>
        </ArtProvider>
      </body>
    </html>
  );
}
