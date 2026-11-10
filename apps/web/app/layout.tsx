import type { Metadata, Viewport } from "next";
import { Jersey_10, Nunito } from "next/font/google";
import localFont from "next/font/local";
import { MEETINGS_PER_DAY, isUsdgPracticeMode } from "@thoroughbred/game-core";
import { MEETING_CADENCE } from "@/lib/meetings";
import { UsdgModeProvider } from "@/components/chain/UsdgMode";
import { SiteNav } from "@/components/SiteNav";
import { Telemetry } from "@/components/playtest/Telemetry";
import { EntryProvider } from "@/components/entry/EntryProvider";
import { ArtProvider } from "@/components/pixel/ArtProvider";
import { listArt } from "@/lib/art.server";
import { SETTINGS_BOOT_SCRIPT } from "@/lib/settingsBoot";
import { DeviceTierBoot } from "@/components/DeviceTierBoot";
import "./globals.css";

// Faces (design system v3.2 "Pixel arcade"): Jersey 25 for titles, buttons and labels, Jersey 10 for
// names and numbers, Nunito for reading. Jersey 25 replaced Pixelify Sans (2026-11-10): Pixelify's
// B read as G and its C as O ("Grave Heart", "Olub"), on the most prominent text in the game.
// Self-hosted (OFL, app/fonts) so the face can carry size-adjust: Jersey is a condensed face, and
// at 125% it fills the sizes the CSS was written for (a little narrower than Pixelify, never wider).
// One file serves every weight 400-700, so the browser never smears a fake bold onto pixel type.
const heading = localFont({
  src: "./fonts/Jersey25-Regular.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-heading",
  display: "swap",
  fallback: ["Courier New", "monospace"],
  adjustFontFallback: false,
  declarations: [{ prop: "size-adjust", value: "125%" }],
});
const jersey = Jersey_10({ subsets: ["latin"], weight: "400", variable: "--font-jersey", display: "swap" });
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--font-nunito", display: "swap" });

/** The deployed commit (Vercel system env), for deploy checks: <meta name="build" content="<sha>">. */
const BUILD_SHA = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.BUILD_SHA ?? "dev").slice(0, 40);

const DESCRIPTION = `Post Time: a pixel-art racing stable game. Breed, raise and race your horses at Kestrel Downs, with ${MEETINGS_PER_DAY} live race meetings a day (one ${MEETING_CADENCE}) and every result sealed and replayable.`;

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")),
  title: { default: "Post Time · a racing stable game", template: "%s · Post Time" },
  description: DESCRIPTION,
  applicationName: "Post Time",
  openGraph: { type: "website", siteName: "Post Time", title: "Post Time", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "Post Time", description: DESCRIPTION },
  other: { build: BUILD_SHA },
};

export const viewport: Viewport = {
  themeColor: "#0f2a1d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const art = listArt();
  return (
    <html lang="en" className={`${heading.variable} ${jersey.variable} ${nunito.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies saved text size / motion settings before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: SETTINGS_BOOT_SCRIPT }} />
      </head>
      <body>
        <DeviceTierBoot />
        <ArtProvider files={art}>
          {/* USDG_MODE=practice: T-USDG test money everywhere USDG appears (server env, read here once). */}
          <UsdgModeProvider practice={isUsdgPracticeMode(process.env)}>
          <EntryProvider>
            <SiteNav />
            <Telemetry />
            <main id="main" className="relative mx-auto w-full max-w-[75rem] px-[var(--gutter)] pb-[140px] pt-4 md:pb-16 md:pt-8">
              {children}
            </main>
          </EntryProvider>
          </UsdgModeProvider>
        </ArtProvider>
      </body>
    </html>
  );
}
