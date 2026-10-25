import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Separate build dirs let several dev servers run side by side (NEXT_DIST_DIR=.next-viewer).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: [
    "@thoroughbred/shared",
    "@thoroughbred/racing-engine",
    "@thoroughbred/race-viewer",
    "@thoroughbred/art-pipeline",
  ],
};

export default nextConfig;
