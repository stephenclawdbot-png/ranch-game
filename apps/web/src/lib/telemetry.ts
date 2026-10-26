/**
 * First-party telemetry from the browser: session start, page views (route only) and
 * watched races. Goes to our own database via /api/events; no third parties, no query
 * strings, no identifiers beyond the session cookie the game already uses.
 */
type ClientEvent = { name: "session_start" | "page_view" | "race_watched"; route?: string; raceId?: string };

export function trackClient(event: ClientEvent): void {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({ events: [event] });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    // Telemetry never breaks the game.
  }
}
