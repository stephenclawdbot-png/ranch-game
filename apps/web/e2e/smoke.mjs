#!/usr/bin/env node
/**
 * End-to-end smoke test against a running server.
 *
 *   BASE_URL=http://localhost:3100 SCREENSHOT_DIR=/tmp/shots \
 *   NODE_PATH=/opt/node-tools/node_modules node apps/web/e2e/smoke.mjs
 *
 * Flow: onboard -> stable -> quick race -> post time -> live broadcast (no result in
 * any response before the finish; reload mid-race resumes live) -> results -> verify
 * fairness -> reload -> same winner, credits settled once. Screenshots of every page at
 * desktop and mobile sizes.
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

/**
 * Records every live-broadcast response and fails if one sent before the official result
 * carries outcome data (result, seed, final, frames/events beyond the live edge).
 */
function watchBroadcast(page, label, state) {
  page.on("response", async (res) => {
    const url = res.url();
    if (!/\/api\/races\/[^/]+\/(live|replay|verify)/.test(url)) return;
    let body = "";
    try {
      body = await res.text();
    } catch {
      return;
    }
    if (/\/replay|\/verify/.test(url)) {
      if (res.status() === 200) state.revealedAt ??= Date.now();
      return;
    }
    state.liveResponses++;
    const chunk = JSON.parse(body);
    if (chunk.final) {
      state.finalAt ??= Date.now();
      return;
    }
    state.lastEdge = Math.max(state.lastEdge, chunk.liveEdgeFrame);
    const problems = [];
    if (/"(result|seed|totalTicks|finishOrder|finishTimeUs|winningTimeUs)"/.test(body)) problems.push("outcome key present");
    if (chunk.frames.length && chunk.fromFrame + chunk.frames.length - 1 > chunk.liveEdgeFrame) problems.push("frame beyond edge");
    const edgeTick = chunk.liveEdgeFrame * chunk.header.sampleEvery;
    if (chunk.events.some((e) => e.tick > edgeTick)) problems.push("event beyond edge");
    if (problems.length) state.leaks.push(`${label}: ${problems.join(", ")} (${url})`);
  });
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
    await page.getByText("Customise colours").click(); // colours are pre-rolled; customising is optional
    await page.getByRole("button", { name: "Hoops" }).click();
    await shot(page, "desktop-play");
    await page.getByRole("button", { name: /register/i }).click();
    await page.getByRole("heading", { name: "Larkrise Lodge" }).waitFor();
    await page.locator('[aria-label="Your starter horses"] [data-testid="horse-portrait"]').first().waitFor();
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
    await page.getByTestId("seed-commitment").waitFor({ state: "attached" }); // behind "How sealing works"
    await page.getByTestId("countdown").waitFor();
    const commitment = (await page.getByTestId("seed-commitment").textContent()).trim();
    assert(/^[0-9a-f]{64}$/.test(commitment), "seed commitment shown before post");
    assert((await page.getByTestId("my-runner").count()) === 1, "player's runner highlighted in the field");
    await shot(page, "desktop-race-pre");

    // Before post time the replay must be withheld; the live feed has only the header.
    const raceId = decodeURIComponent(new URL(raceUrl).pathname.split("/").pop());
    const api = (suffix) => `${BASE_URL}/api/races/${encodeURIComponent(raceId)}${suffix}`;
    const early = await page.request.get(api("/replay"));
    assert(early.status() === 425, `replay is 425 before post time (got ${early.status()})`);
    const pre = await (await page.request.get(api("/live?from=0"))).json();
    assert(pre.liveEdgeFrame === -1 && pre.final === null && pre.frames.length === 0, "live feed is header-only before the off");
    assert((await page.request.get(api("/live?from=-1"))).status() === 400, "bad ?from rejected");

    const broadcast = { liveResponses: 0, lastEdge: -1, leaks: [], finalAt: null, revealedAt: null };
    watchBroadcast(page, "desktop", broadcast);

    log("waiting for the off");
    await page.locator('[data-testid="viewer"] canvas').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(6000);
    await shot(page, "desktop-race-live");
    assert(broadcast.lastEdge > 0, `live frames are streaming (edge ${broadcast.lastEdge})`);
    assert((await page.getByTestId("results-table").count()) === 0, "no results table while live");
    assert((await page.getByTestId("seed-revealed").count()) === 0, "seed not revealed while live");

    // Mid-race the full replay, verification and card stay closed.
    const midReplay = await page.request.get(api("/replay"));
    assert(midReplay.status() === 425, `replay is 425 while live (got ${midReplay.status()})`);
    const midVerify = await page.request.get(api("/verify"));
    assert(midVerify.status() === 425, `verify is 425 while live (got ${midVerify.status()})`);
    const midCard = await (await page.request.get(api(""))).text();
    assert(midCard.includes('"status":"live"') && !/"(result|winner|endsAtMs|seed)"/.test(midCard), "race card has no outcome while live");
    const list = await (await page.request.get(`${BASE_URL}/api/races`)).json();
    for (const r of list.recent) if (r.phase === "live") assert(!r.winner && r.endsAtMs === undefined, `live race ${r.id} in list has no winner/end`);

    log("reloading mid-race");
    await page.reload();
    await page.locator('[data-testid="viewer"] canvas').first().waitFor({ timeout: 30_000 });
    const edgeBefore = broadcast.lastEdge;
    await page.waitForTimeout(3000);
    assert(broadcast.lastEdge > edgeBefore, `broadcast resumes live after reload (${edgeBefore} -> ${broadcast.lastEdge})`);
    assert((await page.getByTestId("results-table").count()) === 0, "still no results after a mid-race reload");
    await shot(page, "desktop-race-live-reloaded");

    log("waiting for results (real time, no skipping)");
    await page.getByTestId("results-table").waitFor({ state: "attached", timeout: RACE_TIMEOUT_MS }); // full table is collapsed
    assert(broadcast.finalAt !== null, "results came from the final broadcast chunk");
    assert(broadcast.leaks.length === 0, `no outcome leaked before the finish:\n  ${broadcast.leaks.join("\n  ")}`);
    log(`live responses checked: ${broadcast.liveResponses}, none leaked`);
    const winner = (await page.getByTestId("winner-name").innerText()).trim();
    log("winner", winner);
    await page.getByTestId("settlement").waitFor();
    const creditsAfter = await page.getByTestId("credits").first().innerText();
    log("credits after race", creditsAfter);

    await page.getByTestId("verify-button").click();
    await page.getByTestId("verify-result").waitFor();
    const verifyText = await page.getByTestId("verify-result").innerText();
    assert((verifyText.match(/✓/g) ?? []).length >= 2 && !verifyText.includes("✕"), `fairness checks pass (${verifyText})`);
    assert((await page.getByTestId("seed-commitment").textContent()).trim() === commitment, "commitment unchanged after reveal");
    await shot(page, "desktop-race-result");

    log("reloading");
    await page.reload();
    await page.getByTestId("results-table").waitFor({ state: "attached", timeout: 30_000 });
    const winner2 = (await page.getByTestId("winner-name").innerText()).trim();
    assert(winner2 === winner, `same winner after reload (${winner} vs ${winner2})`);
    const creditsReload = await page.getByTestId("credits").first().innerText();
    assert(creditsReload === creditsAfter, `credits settled once (${creditsAfter} vs ${creditsReload})`);

    const tampered = raceId.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    const bad = await page.request.get(`${BASE_URL}/api/races/${encodeURIComponent(tampered)}`);
    assert(bad.status() === 404, `tampered race id rejected (got ${bad.status()})`);

    // ---------------------------------------------------- Quick Pick (Story mode)
    log("quick pick: watch later, then skip to result");
    await page.goto(`${BASE_URL}/`);
    await page.getByTestId("quick-pick").click();
    await page.getByTestId("pick-card").waitFor();
    assert((await page.getByTestId("pick-reason").innerText()).length > 10, "pick card explains the pick");
    await page.getByTestId("watch-later").click();
    await page.getByTestId("entered-later").waitFor();
    await page.keyboard.press("Escape");
    await page.getByTestId("inbox-race").first().waitFor();
    await page.getByTestId("quick-pick").click();
    await page.getByTestId("skip-to-result").click();
    await page.waitForURL(/\/race\//);
    await page.getByTestId("result-board").waitFor({ timeout: 60_000 });
    await page.getByTestId("settlement").waitFor();
    await shot(page, "desktop-quickpick-result");

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
    m.on("console", (msg) => msg.type() === "error" && errors.push(`mobile console: ${msg.text()}`));
    for (const [name, path, ready] of [
      ["mobile-paddock", "/", "next-race"],
      ["mobile-stable", "/stable", "horse-card"],
      ["mobile-races", "/races", "pick-horse"],
      ["mobile-race-result", new URL(raceUrl).pathname, "results-table"],
    ]) {
      await m.goto(`${BASE_URL}${path}`);
      await m.getByTestId(ready).first().waitFor({ state: "attached", timeout: 30_000 });
      await m.waitForTimeout(600);
      const overflow = await m.evaluate(() => document.documentElement.scrollWidth - 390);
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

    // caret-color is injected by Playwright screenshots into focused inputs, not an app bug.
    const fatal = errors.filter((e) => !/Download the React DevTools|favicon|caret-color/i.test(e));
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
