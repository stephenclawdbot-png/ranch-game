// Screenshots + fps probe for the diorama (dev QA; needs a running server).
//   NODE_PATH=/opt/node-tools/node_modules node art-src/diorama/shoot.mjs <baseUrl> <outDir> [scene|all] [w] [h] [frames]
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [base = "http://localhost:3300", out = "/tmp/dio", which = "all", w = "1440", h = "900", frames = "0"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--enable-gpu-rasterization", "--ignore-gpu-blocklist"] });
const scenes = which === "all" ? ["yard", "paddock", "grandstand", "barn", "track-dusk"] : which.split(",");
const errors = [];
for (const s of scenes) {
  const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${s}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${s}: ${e.message}`));
  await page.goto(`${base}/dev/diorama?scene=${s}${process.env.H ? `&h=${process.env.H}` : ""}`, { waitUntil: "networkidle" });
  await page.waitForSelector(`[data-diorama-state="live"], [data-diorama-state="still"], [data-diorama-state="fallback"]`, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const el = page.locator(`[data-diorama="${s}"]`);
  await el.screenshot({ path: `${out}/${s}-${w}x${h}.png` });
  const n = Number(frames);
  for (let i = 0; i < n; i++) {
    await page.waitForTimeout(250);
    await el.screenshot({ path: `${out}/${s}-${w}x${h}-f${i}.png` });
  }
  const fps = await page.evaluate(
    () =>
      new Promise((res) => {
        const t = [];
        let last = performance.now();
        const tick = (now) => {
          t.push(now - last);
          last = now;
          if (t.length < 120) requestAnimationFrame(tick);
          else {
            const engines = [...(window.__dioramas ?? [])].map((e) => e.stats());
            res({ rafFps: 1000 / (t.slice(10).reduce((a, b) => a + b, 0) / (t.length - 10)), engines });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  console.log(s, JSON.stringify(fps));
  await page.close();
}
console.log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
