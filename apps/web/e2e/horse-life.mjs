#!/usr/bin/env node
/**
 * Horse life end-to-end against a running server (PGlite locally, Neon on a preview).
 *
 *   BASE_URL=http://localhost:3110 SCREENSHOT_DIR=/tmp/shots \
 *   NODE_PATH=/opt/node-tools/node_modules node apps/web/e2e/horse-life.mjs
 *
 * Flow (phone viewport, the same cookie throughout): found a stable -> horse tabs -> Care
 * (once per local day: a second tap is refused, the session is counted once) -> Training
 * (save a plan, run a session: credits charged once, arrows shown, a double tap is a no-op)
 * -> condition, injury risk and insurance -> Career (rename, retire, Legacy Farm, release to
 * the Club with the payout) -> Nursery (a pack foal if packs are available: name it, care)
 * -> Facilities (game-core prices; buy when affordable).
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3110").replace(/\/$/, "");
const OUT = process.env.SCREENSHOT_DIR ?? join(tmpdir(), "thoroughbred-horse-life");
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(`[horse-life ${new Date().toISOString().slice(11, 19)}]`, ...a);
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}
async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  log("screenshot", path);
}
async function me(page) {
  return (await (await page.request.get(`${BASE_URL}/api/me`)).json()).player;
}
async function life(page, id) {
  const r = await page.request.get(`${BASE_URL}/api/horses/${id}/life`);
  assert(r.ok(), `life view ${r.status()}`);
  return r.json();
}
/** No horizontal page scroll at phone width. */
async function noHScroll(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(over <= 1, `${label}: no horizontal scroll (overflow ${over}px)`);
}

async function main() {
  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text()}`));

    log("warming up routes");
    const zero = "00000000-0000-4000-8000-000000000000";
    for (const path of ["/", "/play", "/stable", "/nursery", "/facilities", `/horse/${zero}`, `/horse/${zero}/care`, `/horse/${zero}/training`, `/horse/${zero}/career`, "/api/me", "/api/nursery", "/api/facilities", `/api/horses/${zero}/life`]) {
      await page.request.get(`${BASE_URL}${path}`, { timeout: 180_000 }).catch(() => undefined);
    }
    for (const path of ["/api/account", `/api/horses/${zero}/care`, `/api/horses/${zero}/training`, `/api/horses/${zero}/career`, `/api/horses/${zero}/rename`, `/api/horses/${zero}/insurance`, "/api/facilities", "/api/nursery/care-all"]) {
      await page.request.post(`${BASE_URL}${path}`, { data: {}, timeout: 180_000 }).catch(() => undefined);
    }

    // ------------------------------------------------------------------ found a stable
    await page.goto(`${BASE_URL}/play`);
    await page.getByLabel("Stable name").fill("Hollybrook Yard");
    await page.getByRole("button", { name: /register/i }).click();
    await page.getByRole("heading", { name: "Hollybrook Yard" }).waitFor();
    const p0 = await me(page);
    assert(p0 && p0.horses.length >= 3, "starter horses");
    const [h1, h2, h3] = p0.horses;
    log("stable founded:", p0.credits, "credits,", p0.horses.length, "horses");

    // ------------------------------------------------------------------ overview -> care tab
    await page.goto(`${BASE_URL}/horse/${h1.id}`);
    await page.getByTestId("tab-care").click();
    await page.waitForURL(/\/care$/);
    await page.getByTestId("care-panel").waitFor();
    await noHScroll(page, "care");
    await shot(page, "care-before");
    const l0 = await life(page, h1.id);
    assert(l0.care.caredToday === false, "not cared for yet today");
    await page.getByTestId("care-now").click();
    await page.getByTestId("care-result").waitFor();
    await page.getByTestId("cared-today").waitFor();
    assert(await page.getByTestId("care-now").isDisabled(), "care button disabled after today's session");
    const l1 = await life(page, h1.id);
    assert(l1.care.caredToday && l1.care.sessions === l0.care.sessions + 1, `one session counted (${l0.care.sessions} -> ${l1.care.sessions})`);
    assert(l1.care.bond > l0.care.bond, "bond grew");
    // A second session the same day is refused server-side (no double count).
    const again = await (await page.request.post(`${BASE_URL}/api/horses/${h1.id}/care`, { data: {} })).json();
    assert(again.counted === false, "second care today is a no-op");
    assert((await life(page, h1.id)).care.sessions === l1.care.sessions, "still one session today");
    await page.getByTestId("risk-table").waitFor();
    await page.getByTestId("insurance").waitFor();
    await shot(page, "care-after");

    // ------------------------------------------------------------------ training
    await page.getByTestId("tab-training").click();
    await page.waitForURL(/\/training$/);
    await page.getByTestId("training-plan").waitFor();
    await noHScroll(page, "training");
    await page.getByTestId("slot-0").selectOption("stamina_gallops");
    await page.getByTestId("save-plan").click();
    await page.getByTestId("save-plan").waitFor({ state: "detached" });
    const lt = await life(page, h1.id);
    assert(lt.training.plan[0] === "stamina_gallops", "plan saved on the server");
    const credits0 = (await me(page)).credits;
    await page.getByTestId("train-now").click();
    await page.getByTestId("train-result").waitFor();
    assert((await page.getByTestId("train-result").innerText()).includes("Stamina"), "arrow on the trained stat");
    await page.getByTestId("sessions-used").filter({ hasText: "1/3" }).waitFor();
    const credits1 = (await me(page)).credits;
    assert(credits1 === credits0 - 60, `stamina gallops cost 60 credits once (${credits0} -> ${credits1})`);
    const dup = await (await page.request.post(`${BASE_URL}/api/horses/${h1.id}/training`, { data: { expectedSession: 0 } })).json();
    assert(dup.ran === false, "a double tap (stale session) is a no-op");
    assert((await me(page)).credits === credits1, "no double charge");
    const lt2 = await life(page, h1.id);
    assert(lt2.training.sessionsUsed === 1 && lt2.condition.peak.phase === "building", "session counted; freshness peak building");
    await shot(page, "training");

    // ------------------------------------------------------------------ career
    await page.getByTestId("tab-career").click();
    await page.waitForURL(/\/career$/);
    await page.getByTestId("career-clock").waitFor();
    await noHScroll(page, "career");
    assert((await page.getByTestId("career-clock").innerText()).includes("/ 40"), "career clock n / 40");
    await page.getByTestId("maturity").waitFor();
    await shot(page, "career");
    // Rename (unraced horses only).
    await page.getByTestId("rename").click();
    await page.getByTestId("rename-input").fill("Copper Meridian");
    await page.getByTestId("rename-save").click();
    await page.getByTestId("horse-name").filter({ hasText: "Copper Meridian" }).waitFor();
    // Retire (two-tap confirm), then the Legacy Farm.
    await page.getByTestId("retire").click();
    await page.getByTestId("retire-confirm").click();
    await page.getByTestId("career-stage").filter({ hasText: "Retired" }).waitFor();
    assert((await life(page, h1.id)).career.careerStatus === "retired", "retired on the server");
    await page.getByTestId("legacy").click();
    await page.getByTestId("legacy-confirm").click();
    await page.getByTestId("career-stage").filter({ hasText: "Legacy Farm" }).waitFor();
    // Release another horse to the Club: payout through the ledger, horse gone.
    const before = (await me(page)).credits;
    await page.goto(`${BASE_URL}/horse/${h2.id}/career`);
    await page.getByTestId("release").click();
    await page.getByTestId("release-confirm").click();
    await page.waitForURL(/\/stable$/);
    const p2 = await me(page);
    assert(p2.credits === before + 50, `release pays 50 credits (${before} -> ${p2.credits})`);
    assert(!p2.horses.some((h) => h.id === h2.id) && !p2.horses.some((h) => h.id === h1.id), "released and Legacy Farm horses left the stalls");
    const gone = await page.request.get(`${BASE_URL}/api/horses/${h2.id}/life`);
    assert(gone.status() === 404, "a released horse is no longer yours");

    // ------------------------------------------------------------------ nursery
    const pack = await page.request.post(`${BASE_URL}/api/packs/pull`, { data: { packType: "paddock", free: false, key: `e2e-${Date.now()}` } });
    if (pack.ok()) log("pulled a paddock pack for a foal");
    else log(`no pack foal (packs ${pack.status()}): nursery checked empty`);
    await page.goto(`${BASE_URL}/nursery`);
    await page.getByTestId("nursery-stalls").waitFor();
    await noHScroll(page, "nursery");
    if (pack.ok()) {
      const card = page.getByTestId("foal-card").first();
      await card.waitFor();
      const foalId = await card.getAttribute("data-horse-id");
      await card.getByTestId("foal-name").click();
      await card.getByTestId("foal-name-input").fill("Little Comet");
      await card.getByTestId("foal-name-save").click();
      await page.getByText("Little Comet").first().waitFor();
      await card.getByTestId("foal-care").click();
      await card.getByText("✓ Cared today").waitFor();
      const fl = await life(page, foalId);
      assert(fl.care.sessions === 1 && fl.care.growth.stage === "foal", "foal growth: 1 of 19 sessions");
      assert(fl.training.available === false, "foals don't train");
      await page.getByTestId("ranges").first().waitFor({ state: "attached" });
    } else {
      await page.getByTestId("nursery-empty").waitFor();
    }
    await shot(page, "nursery");

    // ------------------------------------------------------------------ facilities
    await page.goto(`${BASE_URL}/facilities`);
    await page.getByTestId("facility-stalls").waitFor();
    await noHScroll(page, "facilities");
    const fac = await (await page.request.get(`${BASE_URL}/api/facilities`)).json();
    const stalls = fac.items.find((i) => i.key === "stalls");
    assert(stalls.level === 6 && stalls.nextCost === 2000, "stall 7 costs 2,000 (game-core stallCost)");
    if (fac.credits >= stalls.nextCost) {
      await page.getByTestId("buy-stalls").click();
      await page.getByTestId("facility-stalls").getByTestId("facility-level").filter({ hasText: "7 of 24" }).waitFor();
      assert((await me(page)).credits === fac.credits - stalls.nextCost, "stall charged once");
    } else {
      assert(await page.getByTestId("buy-stalls").isDisabled(), "unaffordable upgrade is disabled");
      log(`stall upgrade unaffordable with ${fac.credits} credits: button disabled`);
    }
    await shot(page, "facilities");

    // Third horse untouched by all this.
    assert((await life(page, h3.id)).care.sessions >= 19, "other horses unaffected");
    assert(errors.length === 0, `no page errors:\n  ${errors.join("\n  ")}`);
    log("PASS");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
