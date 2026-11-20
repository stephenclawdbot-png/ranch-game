"use client";

import { OutageScreen } from "@/components/OutageScreen";
import { retryWhenBack, useErrorKind } from "@/lib/errorKind";
import "./globals.css";

/**
 * The last line of defence: an error in the root layout itself. This replaces the whole
 * document, so it brings its own <html> and <body> and the global styles; the web fonts are not
 * loaded here (the stylesheet's fallback faces apply).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const variant = useErrorKind(error);
  return (
    <html lang="en">
      <body>
        <main id="main" className="relative mx-auto w-full max-w-[75rem] px-[var(--gutter)] pb-16 pt-4 md:pt-8">
          <OutageScreen variant={variant} onRetry={variant === "outage" ? retryWhenBack(reset) : reset} />
        </main>
      </body>
    </html>
  );
}
