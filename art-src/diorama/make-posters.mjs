// Render each scene's static poster frame (the reduced-motion composition at 1x) to
// apps/web/public/art/diorama/poster-<scene>.png. Needs a running dev server.
//   NODE_PATH=/opt/node-tools/node_modules node art-src/diorama/make-posters.mjs http://localhost:3300
// Then: python3 -I art-src/diorama/finish-posters.py (palette clamp + optimise)
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.argv[2] ?? "http://localhost:3300";
const browser = await chromium.launch();
for (const s of ["yard", "paddock", "grandstand", "barn", "track-dusk", "pasture", "sales-ring"]) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  await page.goto(`${base}/dev/diorama?scene=${s}&motion=still`, { waitUntil: "networkidle" });
  await page.waitForSelector(`[data-diorama-state="still"]`, { timeout: 60000 });
  const url = await page.evaluate(() => [...window.__dioramas][0].posterDataUrl());
  writeFileSync(`apps/web/public/art/diorama/poster-${s}.png`, Buffer.from(url.split(",")[1], "base64"));
  console.log(s, "ok");
  await page.close();
}
await browser.close();
