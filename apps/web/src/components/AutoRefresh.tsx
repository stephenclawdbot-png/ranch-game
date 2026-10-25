"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server component tree when the next scheduled change happens (server clock). */
export function AutoRefresh({ atMs, serverNowMs }: { atMs: number | null; serverNowMs: number }) {
  const router = useRouter();
  useEffect(() => {
    if (atMs === null) return;
    const delay = Math.max(1000, atMs - serverNowMs + 750);
    const t = setTimeout(() => router.refresh(), Math.min(delay, 2_147_000_000));
    return () => clearTimeout(t);
  }, [atMs, serverNowMs, router]);
  return null;
}
