#!/usr/bin/env node
/**
 * End-to-end smoke test against a running server (with its database: PGlite locally, Neon on
 * a preview).
 *
 *   BASE_URL=http://localhost:3107 SCREENSHOT_DIR=/tmp/shots \
 *   NODE_PATH=/opt/node-tools/node_modules node apps/web/e2e/smoke.mjs
 *
 * Flow: new player -> account cookie (httpOnly) -> stable from the DB -> Story Quick Pick
 * (skip to result: settled server-side, credits change once, reload shows the same) -> a
 * watched Story race (live broadcast, no leaks, verify) -> enter a Live card race -> the field
 * locks with house horses -> watch live (no leaks) -> results -> inbox on Home -> reload
 * persistence -> mobile screenshots with the same cookie.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3107").replace(/\/$/, "");
const OUT = process.env.SCREENSHOT_DIR ?? join(tmpdir(), "thoroughbred-smoke");
// The soonest race a starter is eligible for can be several 3-minute slots away.
const RACE_TIMEOUT_MS = Number(process.env.RACE_TIMEOUT_MS ?? 900_000);
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
    if (res.status() !== 200) return;
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

async function me(page) {
  return (await (await page.request.get(`${BASE_URL}/api/me`)).json()).player;
}

/** Watches a race page from before the off to the official result, asserting no leaks on the way. */
async function watchToResult(page, raceId, label) {
  const api = (suffix) => `${BASE_URL}/api/races/${encodeURIComponent(raceId)}${suffix}`;
  const broadcast = { liveResponses: 0, lastEdge: -1, leaks: [], finalAt: null, revealedAt: null };
  watchBroadcast(page, label, broadcast);
  await page.locator('[data-testid="viewer"] canvas').first().waitFor({ timeout: RACE_TIMEOUT_MS });
  await page.waitForTimeout(6000);
  await shot(page, `${label}-live`);
  assert(broadcast.lastEdge > 0, `live frames are streaming (edge ${broadcast.lastEdge})`);
  assert((await page.getByTestId("results-table").count()) === 0, "no results table while live");
  assert((await page.getByTestId("seed-revealed").count()) === 0, "seed not revealed while live");
  // Mid-race the full replay, verification, my result and the card stay closed.
  const midReplay = await page.request.get(api("/replay"));
  assert(midReplay.status() === 425, `replay is 425 while live (got ${midReplay.status()})`);
  const midVerify = await page.request.get(api("/verify"));
  assert(midVerify.status() === 425, `verify is 425 while live (got ${midVerify.status()})`);
  const midMine = await page.request.get(api("/me"));
  assert(midMine.status() === 425, `my result is 425 while live (got ${midMine.status()})`);
  const midCard = await (await page.request.get(api(""))).text();
  assert(midCard.includes('"status":"live"') && !/"(result|winner|endsAtMs|seed)"/.test(midCard), "race card has no outcome while live");
  const list = await (await page.request.get(`${BASE_URL}/api/races`)).json();
  for (const r of list.recent) if (r.phase === "live") assert(!r.winner && r.endsAtMs === undefined, `live race ${r.id} in list has no winner/end`);

  log(`${label}: reloading mid-race`);
  await page.reload();
  await page.locator('[data-testid="viewer"] canvas').first().waitFor({ timeout: 30_000 });
  const edgeBefore = broadcast.lastEdge;
  await page.waitForTimeout(3000);
  assert(broadcast.lastEdge > edgeBefore, `broadcast resumes live after reload (${edgeBefore} -> ${broadcast.lastEdge})`);
  assert((await page.getByTestId("results-table").count()) === 0, "still no results after a mid-race reload");

  log(`${label}: waiting for results (real time, no skipping)`);
  await page.getByTestId("results-table").waitFor({ state: "attached", timeout: RACE_TIMEOUT_MS });
  assert(broadcast.finalAt !== null, "results came from the final broadcast chunk");
  assert(broadcast.leaks.length === 0, `no outcome leaked before the finish:\n  ${broadcast.leaks.join("\n  ")}`);
  log(`${label}: live responses checked: ${broadcast.liveResponses}, none leaked`);
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

    // `next dev` compiles each route on first use (10-30 s here): warm them all up first so
    // timing assertions measure the game, not the compiler. Cheap on a deployed build.
    log("warming up routes");
    const zero = "00000000-0000-4000-8000-000000000000";
    for (const path of ["/", "/play", "/stable", "/races", "/me", `/race/${zero}`, `/horse/${zero}`, "/api/me", "/api/races", `/api/races/${zero}`, `/api/races/${zero}/live`, `/api/races/${zero}/replay`, `/api/races/${zero}/verify`, `/api/races/${zero}/me`, `/api/races/${zero}/options`, `/api/horses/${zero}`, "/api/cron/race-card"]) {
      await page.request.get(`${BASE_URL}${path}`, { timeout: 180_000 }).catch(() => undefined);
    }
    for (const path of ["/api/account", "/api/races/quick", "/api/races/live-pick", "/api/entries/refill", "/api/inbox/read", `/api/races/${zero}/enter`, `/api/races/${zero}/scratch`]) {
      await page.request.post(`${BASE_URL}${path}`, { data: {}, timeout: 180_000 }).catch(() => undefined);
    }
    log("onboarding at", BASE_URL);
    assert((await me(page)) === null, "a new browser has no stable");
    await page.goto(`${BASE_URL}/play`);
    await page.getByLabel("Stable name").fill("Larkrise Lodge");
    await page.getByText("Customise colours").click();
    await page.getByRole("button", { name: "Hoops" }).click();
    await shot(page, "desktop-play");
    await page.getByRole("button", { name: /register/i }).click();
    await page.getByRole("heading", { name: "Larkrise Lodge" }).waitFor();
    await page.locator('[aria-label="Your starter horses"] [data-testid="horse-portrait"]').first().waitFor();
    await page.waitForTimeout(800);
    await shot(page, "desktop-welcome");

    const cookie = (await desktop.cookies()).find((c) => c.name === "tb_session");
    assert(cookie && cookie.httpOnly && cookie.sameSite === "Lax", "account token is an httpOnly SameSite=Lax cookie");
    assert(!(await page.evaluate(() => document.cookie)).includes("tb_session"), "token is not readable from JS");
    const p0 = await me(page);
    assert(p0 && p0.stableName === "Larkrise Lodge", "server knows the stable");
    assert(p0.horses.length >= 3, `starter horses from the DB (${p0.horses.length})`);
    log("credits", p0.credits, "entries", `${p0.entries.balance}/${p0.entries.cap}`);

    await page.getByRole("link", { name: /walk into the stable/i }).click();
    await page.waitForURL(/\/stable$/);
    await page.getByTestId("horse-card").first().waitFor();
    assert((await page.getByTestId("horse-card").count()) === p0.horses.length, "stable lists the DB horses");
    assert((await page.getByTestId("entries").first().innerText()).replace(/\s/g, "") === `${p0.entries.balance}/${p0.entries.cap}`, "header shows entries left / cap");
    await shot(page, "desktop-stable");

    await page.getByTestId("horse-card").first().getByRole("link").first().click();
    await page.waitForURL(/\/horse\//);
    await page.getByTestId("horse-name").waitFor();
    await page.getByTestId("horse-status").waitFor();
    await shot(page, "desktop-horse");

    // ---------------------------------------------------- Story: Quick Pick, skip to result
    log("story quick pick: skip to result");
    await page.goto(`${BASE_URL}/`);
    await page.getByTestId("up-next").waitFor();
    await shot(page, "desktop-home");
    await page.getByTestId("quick-pick").first().click();
    await page.getByTestId("pick-card").waitFor();
    assert((await page.getByTestId("pick-reason").innerText()).length > 10, "pick card explains the pick");
    await page.getByTestId("skip-to-result").click();
    await page.waitForURL(/\/race\//);
    const storyId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop());
    await page.getByTestId("result-board").waitFor({ timeout: 60_000 });
    await page.getByTestId("settlement").waitFor({ timeout: 30_000 });
    await page.getByTestId("settlement-detail").waitFor();
    const storyMine = await (await page.request.get(`${BASE_URL}/api/races/${storyId}/me`)).json();
    const reward = storyMine.runners[0].prize + storyMine.runners[0].storyReward;
    const p1 = await me(page);
    // The first race of the local day also completes the daily "race" goal (paid once, same transaction).
    const goal = (p, g) => (p.goals ?? []).find((x) => x.goal === g);
    const goalPay = goal(p1, "race")?.done && !goal(p0, "race")?.done ? goal(p1, "race").credits : 0;
    assert(p1.credits === p0.credits + reward + goalPay, `story reward + daily goal settled server-side once (${p0.credits} + ${reward} + ${goalPay} = ${p1.credits})`);
    assert(p1.entries.balance === p0.entries.balance, "story races are free (no stable entries)");
    await shot(page, "desktop-story-result");
    const storyWinner = (await page.getByTestId("winner-name").innerText()).trim();
    await page.reload();
    await page.getByTestId("result-board").waitFor({ timeout: 30_000 });
    assert((await page.getByTestId("winner-name").innerText()).trim() === storyWinner, "same winner after reload");
    assert((await me(page)).credits === p1.credits, "credits unchanged by viewing again");

    // ---------------------------------------------------- Story: watch live (no leaks)
    log("story race: watch live");
    await page.goto(`${BASE_URL}/races`);
    await page.getByTestId("pick-horse").first().waitFor();
    const enabled = page.locator('[data-testid="pick-horse"]:not([disabled])');
    await enabled.first().click();
    await page.locator("label", { hasText: "Closer" }).click();
    await page.getByTestId("injury-risk").waitFor();
    await shot(page, "desktop-races");
    await page.getByTestId("enter-race").click();
    await page.waitForURL(/\/race\//);
    const watchedId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop());
    await page.getByTestId("seed-commitment").waitFor({ state: "attached" });
    await page.getByTestId("countdown").waitFor();
    const commitment = (await page.getByTestId("seed-commitment").textContent()).trim();
    assert(/^[0-9a-f]{64}$/.test(commitment), "seed commitment shown before post");
    assert((await page.getByTestId("my-runner").count()) === 1, "player's runner highlighted in the field");
    await shot(page, "desktop-race-pre");
    const early = await page.request.get(`${BASE_URL}/api/races/${watchedId}/replay`);
    assert(early.status() === 425, `replay is 425 before post time (got ${early.status()})`);
    const pre = await (await page.request.get(`${BASE_URL}/api/races/${watchedId}/live?from=0`)).json();
    if (pre.serverNowMs < pre.header.race.postTimeMs) assert(pre.liveEdgeFrame === -1 && pre.final === null && pre.frames.length === 0, "live feed is header-only before the off");
    else assert(pre.final === null, "no result right after the off");
    assert((await page.request.get(`${BASE_URL}/api/races/${watchedId}/live?from=-1`)).status() === 400, "bad ?from rejected");
    await watchToResult(page, watchedId, "desktop-story");
    await page.getByTestId("settlement").waitFor({ timeout: 30_000 });
    await page.getByTestId("verify-button").click();
    await page.getByTestId("verify-result").waitFor();
    const verifyText = await page.getByTestId("verify-result").innerText();
    assert((verifyText.match(/✓/g) ?? []).length >= 2 && !verifyText.includes("✕"), `fairness checks pass (${verifyText})`);
    assert((await page.getByTestId("seed-commitment").textContent()).trim() === commitment, "commitment unchanged after reveal");
    await shot(page, "desktop-race-result");
    const bad = await page.request.get(`${BASE_URL}/api/races/${watchedId.replace(/.$/, (c) => (c === "0" ? "1" : "0"))}`);
    assert(bad.status() === 404, `unknown race id is 404 (got ${bad.status()})`);

    // ---------------------------------------------------- Live card: enter, lock, watch, settle
    log("live card: entering the soonest race a horse is eligible for");
    await page.goto(`${BASE_URL}/races`);
    await page.getByTestId("upcoming-race").first().waitFor();
    await shot(page, "desktop-live-card");
    let liveId = null;
    const rows = page.getByTestId("enter-live-race");
    const n = await rows.count();
    for (let i = 0; i < n && !liveId; i++) {
      await rows.nth(i).click();
      await page.getByTestId("live-entry").waitFor();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="live-entry"] [data-testid="pick-horse"]').length > 0, null, { timeout: 15_000 });
      const btn = page.getByTestId("enter-live");
      await page.waitForTimeout(300);
      if (await btn.isEnabled()) {
        await shot(page, "desktop-live-entry");
        await btn.click();
        await page.getByTestId("live-entered").waitFor({ timeout: 15_000 });
        liveId = await page.getByTestId("go-to-race").getAttribute("href").then((h) => decodeURIComponent(h.split("/").pop()));
      } else {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
    }
    assert(liveId, "a Live race on the card accepted one of the starters");
    const p2 = await me(page);
    const card0 = (await (await page.request.get(`${BASE_URL}/api/races/${liveId}`)).json()).race;
    assert(p2.entries.balance === p1.entries.balance - card0.entryCost, `entering costs ${card0.entryCost} stable entry (${p1.entries.balance} -> ${p2.entries.balance})`);
    assert(!/"seed"|"result"|winner/.test(JSON.stringify(card0)), "open card has no seed/result");
    assert(card0.field.some((f) => f.mine), "my entry shows in the field preview");
    log("entered", card0.config.name, "off at", new Date(card0.config.postTimeMs).toISOString());
    await page.getByTestId("go-to-race").click();
    await page.waitForURL(/\/race\//);
    await page.getByTestId("countdown").waitFor();
    await shot(page, "desktop-live-entries-open");

    // Live Quick Pick (one tap) enters another horse in the next suitable race.
    await page.goto(`${BASE_URL}/`);
    await page.getByTestId("live-quick-pick").first().click();
    const picked = await Promise.race([
      page.getByTestId("live-pick").waitFor({ timeout: 20_000 }).then(() => "ok"),
      page.getByTestId("error-note").waitFor({ timeout: 20_000 }).then(() => "error"),
    ]);
    if (picked === "ok") {
      assert((await page.getByTestId("live-pick-reason").innerText()).length > 10, "live quick pick explains the pick");
      await shot(page, "desktop-live-quickpick");
    } else {
      log("live quick pick declined:", await page.getByTestId("error-note").innerText());
      await shot(page, "desktop-live-quickpick-error");
    }
    await page.keyboard.press("Escape");
    await page.getByTestId("inbox-race").first().waitFor();

    log("waiting for the field to lock (entries close 30 s before the off)");
    await page.goto(`${BASE_URL}/race/${liveId}`);
    const lockDeadline = Date.now() + RACE_TIMEOUT_MS;
    let locked = null;
    while (Date.now() < lockDeadline) {
      const c = (await (await page.request.get(`${BASE_URL}/api/races/${liveId}`)).json()).race;
      if (c.fieldLocked) {
        locked = c;
        break;
      }
      await page.waitForTimeout(5000);
    }
    assert(locked, "the field locked at entry close");
    assert(locked.field.length >= 8 && locked.field.length <= 12, `field of 8-12 (${locked.field.length})`);
    assert(locked.field.some((f) => !f.isPlayer), "house horses filled empty gates");
    assert(new Set(locked.field.map((f) => f.gate)).size === locked.field.length && locked.field.every((f) => f.gate > 0), "gates drawn");
    await page.getByTestId("my-runner").waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => /runners/.test(document.querySelector('[data-testid="field-table"]')?.closest("details")?.querySelector("summary")?.textContent ?? ""), null, { timeout: 30_000 });
    await shot(page, "desktop-live-locked");

    await watchToResult(page, liveId, "desktop-live");
    await page.getByTestId("settlement").waitFor({ timeout: 60_000 });
    const liveMine = await (await page.request.get(`${BASE_URL}/api/races/${liveId}/me`)).json();
    assert(liveMine.settled, "live race settled server-side after the broadcast");
    const liveWinner = (await page.getByTestId("winner-name").innerText()).trim();
    await shot(page, "desktop-live-result");

    log("inbox on Home");
    await page.goto(`${BASE_URL}/`);
    await page.getByTestId("your-races").waitFor();
    const resultRow = page.locator(`[data-testid="inbox-result"][href="/race/${liveId}"]`).first();
    await resultRow.waitFor({ timeout: 30_000 });
    assert((await resultRow.getAttribute("data-read")) === "1", "the live result is in the inbox, marked seen");
    await shot(page, "desktop-home-inbox");

    log("reload persistence");
    const p3 = await me(page);
    await page.goto(`${BASE_URL}/race/${liveId}`);
    await page.getByTestId("results-table").waitFor({ state: "attached", timeout: 30_000 });
    assert((await page.getByTestId("winner-name").innerText()).trim() === liveWinner, "same live winner after reload");
    const p4 = await me(page);
    assert(p4.credits === p3.credits, `credits settled once (${p3.credits} vs ${p4.credits})`);
    assert(p4.runs.some((r) => r.raceId === liveId) && p4.runs.some((r) => r.raceId === storyId), "runs persisted");

    // ------------------------------------------------------------------ mobile (same cookie)
    const stored = await desktop.storageState();
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      storageState: { cookies: stored.cookies, origins: [] },
    });
    const m = await mobile.newPage();
    m.on("pageerror", (e) => errors.push(`mobile pageerror: ${e.message}`));
    m.on("console", (msg) => msg.type() === "error" && errors.push(`mobile console: ${msg.text()}`));
    for (const [name, path, ready] of [
      ["mobile-home", "/", "your-races"],
      ["mobile-stable", "/stable", "horse-card"],
      ["mobile-races", "/races", "upcoming-race"],
      ["mobile-race-result", `/race/${liveId}`, "results-table"],
    ]) {
      await m.goto(`${BASE_URL}${path}`);
      await m.getByTestId(ready).first().waitFor({ state: "attached", timeout: 30_000 });
      await m.waitForTimeout(600);
      const overflow = await m.evaluate(() => document.documentElement.scrollWidth - 390);
      assert(overflow <= 0, `${path} has no horizontal scroll on mobile (overflow ${overflow}px)`);
      await shot(m, name);
    }
    assert((await m.getByTestId("credits").first().innerText()).length > 0, "same stable on another browser context with the cookie");
    await m.goto(`${BASE_URL}/stable`);
    await m.getByTestId("horse-card").first().getByRole("link").first().click();
    await m.getByTestId("horse-name").waitFor();
    await shot(m, "mobile-horse");

    // caret-color is injected by Playwright screenshots into focused inputs, not an app bug.
    // 401/404/425 responses are expected API answers (no stable yet, unknown id, too early).
    const fatal = errors.filter((e) => !/Download the React DevTools|favicon|caret-color|status of (401|404|425)/i.test(e));
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
