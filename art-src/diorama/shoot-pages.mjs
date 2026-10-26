// Page screenshots with the live diorama (dev QA).
//   NODE_PATH=/opt/node-tools/node_modules node art-src/diorama/shoot-pages.mjs <base> <outDir> <w> <h> <dpr> <path...>
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [base, out, w, h, dpr, ...paths] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(dpr), isMobile: Number(w) < 600, hasTouch: Number(w) < 600 });
const errors = [];
if (process.env.FOUND) {
  const page = await ctx.newPage();
  await page.goto(`${base}/play`, { waitUntil: "networkidle" });
  await page.getByLabel("Stable name").fill(process.env.FOUND);
  await page.getByRole("button", { name: /register/i }).click();
  await page.getByRole("heading", { name: process.env.FOUND }).waitFor({ timeout: 60000 });
  await page.close();
}
for (const p of paths) {
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${p}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${p}: ${e.message}`));
  await page.goto(base + p, { waitUntil: "networkidle" });
  await page.waitForSelector(`[data-diorama-state="live"], [data-diorama-state="still"], [data-diorama-state="fallback"]`, { timeout: 60000 }).catch(() => errors.push(`${p}: no diorama`));
  if (process.env.FULL) {
    const H = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < H; y += 400) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(250);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => [...document.querySelectorAll("[data-diorama]")].every((e) => e.getAttribute("data-diorama-state") !== "loading"), null, { timeout: 60000 });
  }
  await page.waitForTimeout(1200);
  const name = p === "/" ? "home" : p.replace(/[/?=&]/g, "_").replace(/^_/, "");
  await page.screenshot({ path: `${out}/${name}-${w}x${h}.png`, fullPage: !!process.env.FULL });
  const state = await page.$$eval("[data-diorama]", (els) => els.map((e) => `${e.getAttribute("data-diorama")}:${e.getAttribute("data-diorama-state")}`));
  console.log(p, state.join(","));
  await page.close();
}
console.log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
