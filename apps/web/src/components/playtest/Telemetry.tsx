"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { installClientErrorLog } from "@/lib/clientErrors";
import { trackClient } from "@/lib/telemetry";

const SESSION_KEY = "tb:session-started";

/** Session start (once per browser session) and a page view per route change (path only). */
export function Telemetry() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    installClientErrorLog();
    let started = false;
    try {
      started = sessionStorage.getItem(SESSION_KEY) === "1";
      if (!started) sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // Private mode: count it as a new session.
    }
    if (!started) trackClient({ name: "session_start", route: window.location.pathname });
  }, []);

  useEffect(() => {
    if (!pathname || pathname === last.current || pathname.startsWith("/admin")) return;
    last.current = pathname;
    trackClient({ name: "page_view", route: pathname });
  }, [pathname]);

  return null;
}
