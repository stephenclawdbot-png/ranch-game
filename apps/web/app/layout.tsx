import type { Metadata, Viewport } from "next";
import { Jersey_10, Nunito, Pixelify_Sans } from "next/font/google";
import { SiteNav } from "@/components/SiteNav";
import { Telemetry } from "@/components/playtest/Telemetry";
import { EntryProvider } from "@/components/entry/EntryProvider";
import { ArtProvider } from "@/components/pixel/ArtProvider";
import { listArt } from "@/lib/art.server";
import { SETTINGS_BOOT_SCRIPT } from "@/lib/settingsBoot";
import "./globals.css";

// Faces (design system v3.1 "Pixel arcade", owner pick 2026-10-29): Pixelify for titles and labels,
// Jersey for names and numbers, Nunito for reading.
const pixelify = Pixelify_Sans({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-pixelify", display: "swap" });
const jersey = Jersey_10({ subsets: ["latin"], weight: "400", variable: "--font-jersey", display: "swap" });
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--font-nunito", display: "swap" });

/** The deployed commit (Vercel system env), for deploy checks: <meta name="build" content="<sha>">. */
const BUILD_SHA = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.BUILD_SHA ?? "dev").slice(0, 40);

const DESCRIPTION = "Post Time: a pixel-art racing stable game. Breed, raise and race your horses at Kestrel Downs, with a live race every 3 minutes and every result sealed and replayable.";

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
    <html lang="en" className={`${pixelify.variable} ${jersey.variable} ${nunito.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies saved text size / motion settings before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: SETTINGS_BOOT_SCRIPT }} />
      </head>
      <body>
        <ArtProvider files={art}>
          <EntryProvider>
            <SiteNav />
            <Telemetry />
            <main id="main" className="relative mx-auto w-full max-w-[75rem] px-[var(--gutter)] pb-[140px] pt-4 md:pb-16 md:pt-8">
              {children}
            </main>
          </EntryProvider>
        </ArtProvider>
      </body>
    </html>
  );
}
