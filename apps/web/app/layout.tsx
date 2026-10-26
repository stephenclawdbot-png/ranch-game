import type { Metadata, Viewport } from "next";
import { Jersey_10, Nunito, Pixelify_Sans } from "next/font/google";
import { SiteNav } from "@/components/SiteNav";
import { EntryProvider } from "@/components/entry/EntryProvider";
import { ArtProvider } from "@/components/pixel/ArtProvider";
import { listArt } from "@/lib/art.server";
import { SETTINGS_BOOT_SCRIPT } from "@/lib/settingsBoot";
import "./globals.css";

// Three faces only: pixel display (titles, >= 24 px), scoreboard numerals, and a readable sans.
const pixelify = Pixelify_Sans({ subsets: ["latin"], weight: ["600"], variable: "--font-pixelify", display: "swap" });
const jersey = Jersey_10({ subsets: ["latin"], weight: "400", variable: "--font-jersey", display: "swap" });
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--font-nunito", display: "swap" });

/** The deployed commit (Vercel system env), for deploy checks: <meta name="build" content="<sha>">. */
const BUILD_SHA = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.BUILD_SHA ?? "dev").slice(0, 40);

export const metadata: Metadata = {
  title: { default: "Thoroughbred", template: "%s · Thoroughbred" },
  description: "Run a racing stable. Breed, raise and race horses; every result sealed and replayable.",
  other: { build: BUILD_SHA },
};

export const viewport: Viewport = {
  themeColor: "#0a1b12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const art = listArt();
  return (
    <html lang="en" className={`${pixelify.variable} ${jersey.variable} ${nunito.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies saved text size / motion settings before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: SETTINGS_BOOT_SCRIPT }} />
      </head>
      <body>
        <ArtProvider files={art}>
          <EntryProvider>
            <SiteNav />
            <main id="main" className="relative mx-auto w-full max-w-[75rem] px-4 pb-24 pt-4 md:px-6 md:pb-16 md:pt-8">
              {children}
            </main>
          </EntryProvider>
        </ArtProvider>
      </body>
    </html>
  );
}
