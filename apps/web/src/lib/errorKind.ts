/**
 * For the error screens (app/error.tsx, app/global-error.tsx): is this failure an outage (the
 * database is unreachable or over quota) or something else? Production hides server error
 * details from the browser, so the screen asks the server once (GET /api/health).
 */
import { useEffect, useState } from "react";
import type { OutageVariant } from "@/components/OutageScreen";
import { isOutageResponse } from "./outage";

/** "outage" when the database is down, "error" otherwise; "checking" for the moment it takes to ask. */
export function useErrorKind(error: unknown): OutageVariant {
  const [variant, setVariant] = useState<OutageVariant>("checking");
  useEffect(() => {
    console.error(error);
    let alive = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    fetch("/api/health", { cache: "no-store", signal: ctrl.signal })
      .then(async (res) => ((await isOutageResponse(res)) ? "outage" : "error") as OutageVariant)
      // No answer at all: the site itself is unreachable, which reads as the same closed yard.
      .catch(() => "outage" as OutageVariant)
      .then((v) => {
        if (alive) setVariant(v);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      alive = false;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [error]);
  return variant;
}

/** Try again during an outage: only re-render the page once the database answers. */
export function retryWhenBack(reset: () => void): () => Promise<void> {
  return async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (await isOutageResponse(res)) return;
    } catch {
      return;
    }
    reset();
  };
}
