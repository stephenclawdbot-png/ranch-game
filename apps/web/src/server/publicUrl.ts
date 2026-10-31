/**
 * The public site host (e.g. "ranch-game.vercel.app") from PUBLIC_BASE_URL, for share
 * links and share-card watermarks made on the client. Null when unset (the client then
 * falls back to its own origin's host).
 */
export function publicSiteHost(): string | null {
  const url = process.env.PUBLIC_BASE_URL?.trim();
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
