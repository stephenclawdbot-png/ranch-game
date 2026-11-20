"use client";

import { OutageScreen } from "@/components/OutageScreen";
import { retryWhenBack, useErrorKind } from "@/lib/errorKind";

/**
 * The error screen for every page (instead of Next's bare "Application error"): when the
 * database is unreachable or over quota it reads "The yard is closed for a moment"; for any
 * other failure, a plain "Something went wrong at the track" in the same look.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const variant = useErrorKind(error);
  return <OutageScreen variant={variant} onRetry={variant === "outage" ? retryWhenBack(reset) : reset} />;
}
