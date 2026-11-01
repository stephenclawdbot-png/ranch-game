/**
 * "Come back where you left off": the page a signed-out player was trying to open, carried as
 * `?next=` through sign-in (/link, the invite link at /play, wallet sign-in). Never an open
 * redirect: only a same-origin PATH (no scheme, no host, no protocol-relative `//`, no
 * backslashes, no query or fragment) whose first segment is one of the game's own pages.
 */

/** First path segments a sign-in may return to (game pages; never /api, /admin, /dev, or the sign-in pages themselves). */
const NEXT_ROOTS = new Set([
  "race",
  "races",
  "horse",
  "stable",
  "me",
  "market",
  "packs",
  "breeding",
  "nursery",
  "facilities",
  "story",
  "week",
  "jockeys",
  "quick",
  "league",
  "cup",
  "tipsters",
  "hall",
  "news",
  "stables",
  "pool",
  "invite",
  "beta",
  "rival",
  "trophies",
  "wiki",
]);

const BASE = "https://next.invalid";

/** The safe path for `raw`, or null (then the player lands on Home with the welcome back). */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length < 2 || raw.length > 200) return null;
  // Path-only, typed as a path: one leading slash, then plain path characters.
  if (!/^\/[A-Za-z0-9/_-]+$/.test(raw) || raw.startsWith("//") || raw.includes("//")) return null;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE || url.pathname !== raw) return null;
  const root = raw.split("/")[1] ?? "";
  return NEXT_ROOTS.has(root) ? raw : null;
}

/** Where a sign-in goes next: the safe `next`, else Home with the "Welcome back" strip. */
export function afterSignInHref(next: string | null | undefined): string {
  return safeNextPath(next) ?? "/?back=1";
}

/** `/link?next=…` for the page the visitor is on (no `next` from Home or the sign-in pages). */
export function signInHref(currentPath: string | null | undefined): string {
  const next = safeNextPath(currentPath);
  return next ? `/link?next=${encodeURIComponent(next)}` : "/link";
}

/** The `next` of the current URL (browser only), validated. */
export function nextFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}
