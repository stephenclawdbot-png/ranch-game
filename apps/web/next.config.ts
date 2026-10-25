import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Separate build dirs let several dev servers run side by side (NEXT_DIST_DIR=.next-viewer).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: [
    "@thoroughbred/shared",
    "@thoroughbred/racing-engine",
    "@thoroughbred/race-viewer",
    "@thoroughbred/art-pipeline",
    "@thoroughbred/pixel-rig",
    "@thoroughbred/game-core",
    "@thoroughbred/db",
  ],
  // Database drivers load native/WASM assets at runtime (PGlite's postgres.wasm + data
  // bundle, Neon's WebSocket client); keep them out of the server bundle and require them
  // from node_modules instead.
  serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless"],
};

export default nextConfig;
