import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { SiteNav } from "@/components/SiteNav";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz", "SOFT"], display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Thoroughbred", template: "%s · Thoroughbred" },
  description: "Run a racing stable. Deterministic, replayable horse racing.",
};

export const viewport: Viewport = {
  themeColor: "#07120d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>
        <SiteNav />
        <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-28 pt-4 sm:px-6 md:pb-16 md:pt-8">{children}</main>
      </body>
    </html>
  );
}
