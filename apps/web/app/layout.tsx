import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Thoroughbred",
  description: "Run a racing stable. Deterministic, replayable horse racing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
