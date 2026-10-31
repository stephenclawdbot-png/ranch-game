// Page captures for the visual audit: one new stable (invite flow), a few Story races via API-driven UI,
// then every significant screen at 1440x900 and 390x844 (viewport + full page).
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3171";
const OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const SECRET = "e2e-admin-secret-123";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const VP = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const notes = {};
try {
  if (process.env.REUSE) { Object.assign(notes, JSON.parse((await import("node:fs")).readFileSync(`${OUT}/notes.json`, "utf8"))); } else {
  const a = await browser.newContext();
  await a.request.post(`${BASE}/api/admin/session`, { data: { secret: SECRET }, timeout: 180000 });
  const inv = await (await a.request.post(`${BASE}/api/admin/invites`, { data: { count: 1, note: "visual research" } })).json();
  const code = typeof inv.codes[0] === "string" ? inv.codes[0] : inv.codes[0].code;
  await a.close();

  const ctx = await browser.newContext(VP.desktop);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.getByTestId("found-stable").click();
  await page.getByTestId("invite-code").fill(code);
  await page.getByTestId("invite-continue").click();
  const nameInput = page.locator('input[name="stableName"], #stable-name, [data-testid="stable-name-input"]').first();
  await nameInput.waitFor({ timeout: 30000 });
  await nameInput.fill("Hawthorn Lane");
  await page.getByRole("button", { name: /Register|get my horses/i }).first().click();
  await page.getByTestId("mentor-welcome").waitFor({ timeout: 60000 });
  for (let i = 0; i < 8 && (await page.getByTestId("mentor-next").isVisible().catch(() => false)); i++) await page.getByTestId("mentor-next").click();
  await page.getByTestId("mentor-new-yes").click();
  await page.getByTestId("race-now").waitFor({ timeout: 60000 });
  await page.screenshot({ path: `${OUT}/desktop-starters.png` });
  // Race once and skip to the result (Story may skip).
  await page.getByTestId("race-now").click();
  await page.waitForURL(/\/race\//, { timeout: 240000 });
  notes.race1 = page.url();
  await page.getByTestId("results-sequence").waitFor({ timeout: 300000 }).catch(() => log("no results-sequence"));
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/desktop-result.png` });
  await page.screenshot({ path: `${OUT}/desktop-result-full.png`, fullPage: true });
  await ctx.storageState({ path: `${OUT}/state.json` });

  // Find a horse id from the stable page.
  await page.goto(`${BASE}/stable`, { waitUntil: "networkidle", timeout: 180000 }).catch(() => {});
  const hrefs = await page.$$eval('a[href^="/horse/"]', (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
  notes.horses = hrefs;
  await ctx.close();
  }
  const h = (notes.horses.find((x) => /^\/horse\/[^/]+$/.test(x)) ?? "/horse/x");

  const routes = ["/", "/stable", h, `${h}/career`, `${h}/training`, `${h}/care`, "/breeding", "/nursery", "/market", "/packs", "/races", "/story", "/hall", "/trophies", "/legacy", "/jockeys", "/league", "/quick", "/wiki", "/me/races", notes.race1.replace(BASE, "")];
  const pick = process.env.ROUTES ? process.env.ROUTES.split(",").map((x) => (x === "H" ? h : x.startsWith("H/") ? h + x.slice(1) : x)) : routes;
  for (const vp of (process.env.VPS ?? "desktop,phone").split(",")) {
    const c = await browser.newContext({ ...VP[vp], storageState: `${OUT}/state.json` });
    const p = await c.newPage();
    for (const r of pick) {
      const name = r.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_") || "home";
      try {
        await p.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded", timeout: 180000 });
        await p.waitForTimeout(r.startsWith("/race/") ? 9000 : 3500);
        await p.screenshot({ path: `${OUT}/${vp}-${name}.png`, timeout: 120000 });
        if (process.env.FULL) await p.screenshot({ path: `${OUT}/${vp}-${name}-full.png`, fullPage: true, timeout: 120000 }).catch((e) => log("full fail", r));
        log(vp, r);
      } catch (e) { log("fail", vp, r, e.message.slice(0, 120)); }
    }
    // Packs: try a standard pull for the foal reveal.
    if (vp === "phone") {
      try {
        await p.goto(`${BASE}/packs`, { waitUntil: "domcontentloaded" });
        await p.waitForTimeout(3000);
        const btn = p.getByRole("button", { name: /open|pull|buy/i }).first();
        if (await btn.isVisible().catch(() => false)) {
          notes.packButton = await btn.innerText();
          await btn.click();
          await p.waitForTimeout(800);
          await p.screenshot({ path: `${OUT}/phone-foal-reveal-mid.png` });
          await p.waitForTimeout(2500);
          await p.screenshot({ path: `${OUT}/phone-foal-reveal-end.png` });
        }
      } catch (e) { log("pack fail", e.message.slice(0, 120)); }
    }
    await c.close();
  }
} finally {
  if (!process.env.REUSE) writeFileSync(`${OUT}/notes.json`, JSON.stringify(notes, null, 1));
  await browser.close();
}
