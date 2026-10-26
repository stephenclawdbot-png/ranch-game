#!/usr/bin/env node
/**
 * End-to-end: the economy screens against a running dev server (PGlite locally).
 *
 *   BASE_URL=http://localhost:3111 SCREENSHOT_DIR=/tmp/shots \
 *   NODE_PATH=/opt/node-tools/node_modules node apps/web/e2e/economy.mjs
 *
 * Flow: new stable (API) -> /packs: published odds + pity, Premium is "coming soon", pull a
 * Paddock Pack for credits -> foal reveal -> "Verify this pull" re-derives it in the browser
 * -> /breeding: preview a starter filly x colt (stat ranges, coats, COI, nick, fees) with the
 * eligibility reason (needs 25 starts or retirement) -> /market: seller requirements shown as
 * missing; the guarded test fixture (non-production only) makes the account a seller; list the
 * pack foal at its floor, cancel; bound starters show why they can't be sold -> mobile screens
 * without horizontal scroll.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3111").replace(/\/$/, "");
const OUT = process.env.SCREENSHOT_DIR ?? join(tmpdir(), "thoroughbred-economy");
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(`[economy ${new Date().toISOString().slice(11, 19)}]`, ...a);
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}
async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  log("screenshot", path);
}

async function main() {
  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

    log("warming up routes");
    for (const path of ["/packs", "/breeding", "/market", "/api/packs", "/api/breeding", "/api/market", "/api/studs", "/packs/pulls/00000000-0000-4000-8000-000000000000"]) {
      await page.request.get(`${BASE_URL}${path}`, { timeout: 180_000 }).catch(() => undefined);
    }
    for (const path of ["/api/packs/pull", "/api/breeding/preview", "/api/market/list", "/api/account"]) {
      await page.request.post(`${BASE_URL}${path}`, { data: {}, timeout: 180_000 }).catch(() => undefined);
    }

    // Unauthenticated APIs answer 401.
    assert((await page.request.get(`${BASE_URL}/api/packs`)).status() === 401, "packs need a stable");

    const created = await page.request.post(`${BASE_URL}/api/account`, {
      data: { stableName: "Economy Downs", silks: { pattern: "hoops", primary: "#16224d", secondary: "#e2b33c", cap: "#e2b33c" }, timezone: "Europe/London" },
    });
    assert(created.status() === 201, `account created (${created.status()})`);
    const player = (await created.json()).player;
    const credits0 = player.credits;
    log("stable", player.stableName, "credits", credits0);

    // ------------------------------------------------------------------ packs
    await page.goto(`${BASE_URL}/packs`);
    await page.getByTestId("pack-paddock").waitFor();
    const odds = await page.getByTestId("odds-paddock").innerText();
    assert(/Common/.test(odds) && /70%/.test(odds) && /Uncommon/.test(odds) && /30%/.test(odds), `paddock odds published (${odds.replace(/\s+/g, " ")})`);
    assert(/Rare/.test(await page.getByTestId("odds-premium").innerText()), "premium odds published");
    assert(/within 5 pulls/.test(await page.getByTestId("pity-paddock").innerText()), "paddock pity published");
    assert(/within 10 pulls/.test(await page.getByTestId("pity-premium").innerText()) && /within 50 pulls/.test(await page.getByTestId("pity-premium").innerText()), "premium pity published");
    assert((await page.getByTestId("premium-demo").innerText()).includes("Coming soon"), "premium labelled coming soon / demo");
    // Design v2: "Coming soon" is a line of text, never a disabled button.
    assert((await page.locator('button[data-testid="open-premium"]:not([disabled])').count()) === 0, "premium can't be bought");
    assert(/Coming soon/.test(await page.getByTestId("open-premium").innerText()), "premium button says coming soon");
    assert((await page.getByTestId("weekly-paddock").innerText()).trim() === "0/3", "weekly paddock limit 0/3");
    const cropBefore = Number((await page.getByTestId("crop-remaining").innerText()).replace(/\D/g, ""));
    assert(cropBefore > 0, "foal crop counter shown");
    assert(/next free pack on play day 3/.test(await page.getByTestId("free-pack").innerText()), "free pack progress shown");
    await shot(page, "packs");

    log("pulling a Paddock Pack");
    await page.getByTestId("open-paddock").click();
    await page.getByTestId("foal-reveal").waitFor();
    await page.getByTestId("reveal-verify").waitFor({ timeout: 10_000 });
    const foalName = (await page.getByTestId("reveal-name").innerText()).trim();
    assert(foalName.length > 0, "the foal is revealed with a name");
    await shot(page, "packs-reveal");
    const me1 = (await (await page.request.get(`${BASE_URL}/api/me`)).json()).player;
    assert(me1.credits === credits0 - 1200, `paddock pack costs 1,200 credits (${credits0} -> ${me1.credits})`);
    await page.getByTestId("reveal-verify").click();
    await page.waitForURL(/\/packs\/pulls\//);
    await page.locator('[data-testid="verify-result"][data-verified="true"]').waitFor({ timeout: 20_000 });
    log("pull verified in the browser");
    await shot(page, "packs-verify");
    await page.goto(`${BASE_URL}/packs`);
    await page.getByTestId("pull-history").waitFor();
    assert((await page.getByTestId("weekly-paddock").innerText()).trim() === "1/3", "weekly count went up");
    assert(Number((await page.getByTestId("crop-remaining").innerText()).replace(/\D/g, "")) === cropBefore - 1, "the crop counter went down by one");

    // --------------------------------------------------------------- breeding
    log("breeding preview");
    await page.goto(`${BASE_URL}/breeding`);
    await page.getByTestId("pick-mare").first().waitFor();
    await page.getByTestId("pick-sire").first().waitFor();
    await page.getByTestId("breeding-preview").waitFor({ timeout: 30_000 });
    assert(/Breeds from 25 starts/.test(await page.getByTestId("cover-eligibility").innerText()), "eligibility reason shown (25 starts or retired)");
    // Design v2: no disabled primary button; an ineligible pair shows the reason and no Cover action.
    assert((await page.locator('[data-testid="cover"]:not([disabled])').count()) === 0, "can't cover an ineligible pair");
    const nick = Number(await page.getByTestId("preview-nick").innerText());
    assert(nick >= 0 && nick <= 100, `nick rating shown (${nick})`);
    assert(Number(await page.getByTestId("preview-p50").innerText()) > 0, "predicted overall shown");
    assert(/COI/.test(await page.getByTestId("preview-coi").innerText()), "COI shown");
    const fees = await page.getByTestId("preview-fees").innerText();
    assert(/1,500/.test(fees) && /burned/.test(fees), `fees with the burn shown (${fees.replace(/\s+/g, " ")})`);
    await shot(page, "breeding-preview");
    await page.getByTestId("tab-studs").click();
    await page.getByTestId("my-stallion").first().waitFor();
    await shot(page, "breeding-studs");

    // ----------------------------------------------------------------- market
    log("market");
    await page.goto(`${BASE_URL}/market`);
    await page.getByTestId("tab-sell").click();
    await page.locator('[data-testid="seller-requirements"][data-ok="false"]').waitFor();
    const req = await page.getByTestId("seller-requirements").innerText();
    assert(/7 days old/.test(req) && /20 races/.test(req), "missing seller requirements listed");
    assert(!/verified email/i.test(req), "no email requirement by default (MARKET_REQUIRE_VERIFIED_EMAIL off)");
    assert((await page.getByTestId("lock-reason").count()) >= 3, "bound starters show why they can't be sold");
    assert(/Club-bred/.test(await page.getByTestId("lock-reason").first().innerText()), "bound reason in plain words");
    await shot(page, "market-sell-requirements");

    const fx = await page.request.post(`${BASE_URL}/api/market/test-seller`);
    assert(fx.status() === 200, `test seller fixture (non-production only) (${fx.status()})`);
    await page.reload();
    await page.getByTestId("tab-sell").click();
    await page.locator('[data-testid="seller-requirements"][data-ok="true"]').waitFor();
    const row = page.locator('[data-testid="sell-row"][data-listable="true"]').filter({ hasText: foalName }).first();
    await row.getByTestId("list-open").click();
    // Below the floor: refused in the form.
    const floor = Number((await row.innerText()).match(/floor ([\d,]+)/)[1].replace(/,/g, ""));
    await row.getByTestId("list-price").fill(String(floor - 1));
    assert(await row.getByTestId("list-confirm").isDisabled(), "price below the floor can't be listed");
    await row.getByTestId("list-price").fill(String(floor));
    await row.getByTestId("list-confirm").click();
    await page.getByTestId("my-listing").first().waitFor();
    assert((await page.getByTestId("my-listing").innerText()).includes(foalName), "listing shows under Your listings");
    await shot(page, "market-listed");
    const listed = (await (await page.request.get(`${BASE_URL}/api/market`)).json());
    assert(listed.mine.length === 1 && listed.mine[0].price === floor, "the server has the listing at the floor price");
    await page.getByTestId("cancel-listing").click();
    await page.getByText("You have no horses listed").waitFor();
    const after = await (await page.request.get(`${BASE_URL}/api/market`)).json();
    assert(after.mine.length === 0 && after.horses.find((h) => h.horse.name === foalName)?.lock === null, "cancel unlocks the horse");
    log("listed and cancelled", foalName, "at", floor);

    // ----------------------------------------------------------------- mobile
    const stored = await ctx.storageState();
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: { cookies: stored.cookies, origins: [] } });
    const m = await mobile.newPage();
    m.on("pageerror", (e) => errors.push(`mobile pageerror: ${e.message}`));
    for (const [name, path, ready] of [
      ["mobile-packs", "/packs", "pack-paddock"],
      ["mobile-breeding", "/breeding", "breeding-preview"],
      ["mobile-market", "/market", "tab-sell"],
    ]) {
      await m.goto(`${BASE_URL}${path}`);
      await m.getByTestId(ready).first().waitFor({ timeout: 30_000 });
      await m.waitForTimeout(500);
      const overflow = await m.evaluate(() => document.documentElement.scrollWidth - 390);
      assert(overflow <= 0, `${path} has no horizontal scroll on mobile (overflow ${overflow}px)`);
      await shot(m, name);
    }

    const fatal = errors.filter((e) => !/Download the React DevTools|favicon|caret-color|status of (401|404|425)/i.test(e));
    assert(fatal.length === 0, `no browser errors:\n  ${fatal.join("\n  ")}`);
    log("PASS");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
