import { NextResponse, type NextRequest } from "next/server";

/**
 * Only the outage page runs through here (see `matcher`): it is an ordinary static page, and
 * this gives it the status an outage should have. HTTP 503 tells browsers, crawlers and
 * monitors that the game is temporarily unavailable (not broken, not gone), and nothing may
 * cache it.
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.rewrite(req.nextUrl, { status: 503 });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Retry-After", "120");
  res.headers.set("X-Robots-Tag", "noindex");
  return res;
}

export const config = { matcher: ["/outage"] };
