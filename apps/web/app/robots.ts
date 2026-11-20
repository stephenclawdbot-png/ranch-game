import type { MetadataRoute } from "next";

/**
 * Crawlers may read the public, cached pages (the landing page, the guide, the race card, the
 * Hall of Fame, the news). They are asked to stay out of the API and of the per-race, per-horse
 * and per-player pages: those are computed from the database on demand, and a crawl of them
 * keeps the database awake (and billed) for nothing.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/race/", "/horse/", "/quick/", "/cup/run/", "/packs/pulls/", "/jockeys/", "/stables/", "/me", "/admin", "/dev/", "/outage", "/link", "/invite"],
      },
    ],
  };
}
