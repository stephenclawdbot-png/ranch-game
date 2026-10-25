#!/usr/bin/env node
/**
 * End-to-end smoke test against a running server.
 *
 *   BASE_URL=http://localhost:3100 SCREENSHOT_DIR=/tmp/shots \
 *   NODE_PATH=/opt/node-tools/node_modules node apps/web/e2e/smoke.mjs
 *
 * Flow: onboard -> stable -> quick race -> post time -> viewer canvas -> results
 * -> verify fairness -> reload -> same winner, credits settled once. Screenshots of
 * every page at desktop and mobile sizes.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const OUT = process.env.SCREENSHOT_DIR ?? join(tmpdir(), "thoroughbred-smoke");
const RACE_TIMEOUT_MS = Number(process.env.RACE_TIMEOUT_MS ?? 300_000);
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(`[smoke ${new Date().toISOString().slice(11, 19)}]`, ...a);
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  log("screenshot", path);
}

/** Speed the replay up if the viewer exposes speed controls; otherwise just wait. */
async function trySpeedUp(page) {
  const candidates = [
    page.getByRole("button", { name: /^(4|8|16)\s*[x×]$/i }),
    page.getByRole("button", { name: /speed/i }),
    page.getByRole("button", { name: /skip|finish/i }),
  ];
  for (const loc of candidates) {
    const n = await loc.count().catch(() => 0);
    if (n > 0) {
      await loc.last().click().catch(() => {});
      log("clicked viewer speed control");
      return true;
    }
  }
  return false;
}

async function main() {
  const browser = await chromium.launch();
  const errors = [];
  try {
    // ------------------------------------------------------------------ desktop
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await desktop.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

    log("onboarding at", BASE_URL);
    await page.goto(`${BASE_URL}/play`);
    await page.getByLabel("Stable name").fill("Larkrise Lodge");
    await page.getByRole("button", { name: "Hoops" }).click();
    await shot(page, "desktop-play");
    await page.getByRole("button", { name: /register/i }).click();
    await page.getByRole("heading", { name: "Larkrise Lodge" }).waitFor();
    await page.locator('[aria-label="Your starter horses"] svg').first().waitFor();
    await page.waitForTimeout(800);
    await shot(page, "desktop-welcome");

    await page.getByRole("link", { name: /walk into the stable/i }).click();
    await page.waitForURL(/\/stable$/);
    await page.getByTestId("horse-card").nth(5).waitFor();
    assert((await page.getByTestId("horse-card").count()) === 6, "six starter horses");
    const creditsBefore = await page.getByTestId("credits").first().innerText();
    log("credits before race", creditsBefore);
    await shot(page, "desktop-stable");

    await page.getByTestId("horse-card").first().getByRole("link").first().click();
    await page.waitForURL(/\/horse\//);
    await page.getByTestId("horse-name").waitFor();
    await shot(page, "desktop-horse");

    await page.goto(`${BASE_URL}/`);
    await page.getByTestId("next-race").waitFor();
    await shot(page, "desktop-paddock");

    await page.goto(`${BASE_URL}/races`);
    await page.getByTestId("pick-horse").nth(5).waitFor();
    await page.getByText("Front-runner").first().waitFor();
    await shot(page, "desktop-races");

    log("entering quick race");
    await page.getByTestId("pick-horse").nth(1).click();
    await page.locator("label", { hasText: "Closer" }).click();
    await page.getByTestId("enter-race").click();
    await page.waitForURL(/\/race\//);
    const raceUrl = page.url();
    log("race url", raceUrl);
    await page.getByTestId("seed-commitment").waitFor();
    await page.getByTestId("countdown").waitFor();
    const commitment = (await page.getByTestId("seed-commitment").innerText()).trim();
    assert(/^[0-9a-f]{64}$/.test(commitment), "seed commitment shown before post");
    assert((await page.getByTestId("my-runner").count()) === 1, "player's runner highlighted in the field");
    await shot(page, "desktop-race-pre");

    // Before post time the replay must be withheld.
    const raceId = decodeURIComponent(new URL(raceUrl).pathname.split("/").pop());
    const early = await page.request.get(`${BASE_URL}/api/races/${encodeURIComponent(raceId)}/replay`);
    assert(early.status() === 425, `replay is 425 before post time (got ${early.status()})`);

    log("waiting for the off");
    await page.locator('[data-testid="viewer"] canvas').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    await shot(page, "desktop-race-live");
    await trySpeedUp(page);

    log("waiting for results");
    await page.getByTestId("results-table").waitFor({ timeout: RACE_TIMEOUT_MS });
    const winner = (await page.getByTestId("winner-name").innerText()).trim();
    log("winner", winner);
    await page.getByTestId("settlement").waitFor();
    const creditsAfter = await page.getByTestId("credits").first().innerText();
    log("credits after race", creditsAfter);

    await page.getByTestId("verify-button").click();
    await page.getByTestId("verify-result").waitFor();
    const verifyText = await page.getByTestId("verify-result").innerText();
    assert((verifyText.match(/✓/g) ?? []).length >= 2 && !verifyText.includes("✕"), `fairness checks pass (${verifyText})`);
    assert((await page.getByTestId("seed-commitment").innerText()).trim() === commitment, "commitment unchanged after reveal");
    await shot(page, "desktop-race-result");

    log("reloading");
    await page.reload();
    await page.getByTestId("results-table").waitFor({ timeout: 30_000 });
    const winner2 = (await page.getByTestId("winner-name").innerText()).trim();
    assert(winner2 === winner, `same winner after reload (${winner} vs ${winner2})`);
    const creditsReload = await page.getByTestId("credits").first().innerText();
    assert(creditsReload === creditsAfter, `credits settled once (${creditsAfter} vs ${creditsReload})`);

    const tampered = raceId.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    const bad = await page.request.get(`${BASE_URL}/api/races/${encodeURIComponent(tampered)}`);
    assert(bad.status() === 404, `tampered race id rejected (got ${bad.status()})`);

    // ------------------------------------------------------------------ mobile
    const state = await desktop.storageState();
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      storageState: state,
    });
    const m = await mobile.newPage();
    m.on("pageerror", (e) => errors.push(`mobile pageerror: ${e.message}`));
    for (const [name, path, ready] of [
      ["mobile-paddock", "/", "next-race"],
      ["mobile-stable", "/stable", "horse-card"],
      ["mobile-races", "/races", "pick-horse"],
      ["mobile-race-result", new URL(raceUrl).pathname, "results-table"],
    ]) {
      await m.goto(`${BASE_URL}${path}`);
      await m.getByTestId(ready).first().waitFor({ timeout: 30_000 });
      await m.waitForTimeout(600);
      const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 0, `${path} has no horizontal scroll on mobile (overflow ${overflow}px)`);
      await shot(m, name);
    }
    await m.goto(`${BASE_URL}/stable`);
    await m.getByTestId("horse-card").first().getByRole("link").first().click();
    await m.getByTestId("horse-name").waitFor();
    await shot(m, "mobile-horse");
    await m.goto(`${BASE_URL}/play`);
    await m.getByLabel("Stable name").waitFor();
    await shot(m, "mobile-play");

    const fatal = errors.filter((e) => !/Download the React DevTools|favicon/i.test(e));
    if (fatal.length) log("browser errors:\n  " + fatal.join("\n  "));
    log("PASS");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
