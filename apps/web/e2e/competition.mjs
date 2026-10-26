#!/usr/bin/env node
/**
 * End-to-end: competition and story screens against a running server (PGlite locally).
 *
 *   BASE_URL=http://localhost:3112 SCREENSHOT_DIR=/tmp/shots \
 *   NODE_PATH=/opt/node-tools/node_modules node apps/web/e2e/competition.mjs
 *
 * Flow (phone viewport): found a stable -> Daily Cup: pick a horse, take the Cup Run, watch it
 * in the race viewer (skip to the result), board shows the run, a second run is refused, the
 * seed stays sealed -> Story: chapter 1 races, run a chapter race (skip to result) against
 * named rivals, progress shows on /story -> League page (empty state, then joined after a Live
 * entry) -> Hall of Fame (achievements) -> desktop screenshots. No horizontal scroll anywhere.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3112").replace(/\/$/, "");
const OUT = process.env.SCREENSHOT_DIR ?? join(tmpdir(), "thoroughbred-competition");
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(`[competition ${new Date().toISOString().slice(11, 19)}]`, ...a);
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
async function getJson(page, path) {
  const r = await page.request.get(`${BASE_URL}${path}`);
  assert(r.ok(), `${path} -> ${r.status()}`);
  return r.json();
}
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
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|THREE/.test(m.text()) && errors.push(`console: ${m.text()}`));

    log("warming up routes");
    const zero = "00000000-0000-4000-8000-000000000000";
    for (const path of ["/", "/play", "/cup", `/cup/run/${zero}`, "/league", "/hall", "/story", "/races", `/race/${zero}`, "/api/me", "/api/cup", "/api/league", "/api/hall", "/api/story", `/api/cup/runs/${zero}`]) {
      await page.request.get(`${BASE_URL}${path}`, { timeout: 180_000 }).catch(() => undefined);
    }
    for (const path of ["/api/account", "/api/cup/run", "/api/story/race", "/api/races/live-pick"]) {
      await page.request.post(`${BASE_URL}${path}`, { data: {}, timeout: 180_000 }).catch(() => undefined);
    }

    // ------------------------------------------------------------------ signed out
    const out = await getJson(page, "/api/cup");
    assert(out.cup.field.length === 7 && out.cup.horses === null, "signed-out cup view");
    assert(!JSON.stringify(out).includes('"seed":"') || out.cup.yesterday !== null, "today's seed is never in the cup view");

    // ------------------------------------------------------------------ found a stable
    await page.goto(`${BASE_URL}/play`);
    await page.getByLabel("Stable name").fill("Cupwinner Yard");
    await page.getByRole("button", { name: /register/i }).click();
    await page.getByRole("heading", { name: "Cupwinner Yard" }).waitFor();
    const p0 = await me(page);
    assert(p0 && p0.horses.length >= 3, "starter horses");
    log("stable founded:", p0.credits, "credits");

    // ------------------------------------------------------------------ Daily Cup
    await page.goto(`${BASE_URL}/cup`);
    await page.getByRole("heading", { name: "Daily Cup", level: 1 }).waitFor();
    await noHScroll(page, "/cup");
    await page.getByTestId("cup-horse").first().waitFor();
    await shot(page, "cup-before");
    await page.getByTestId("cup-run").click();
    await page.waitForURL(/\/cup\/run\//, { timeout: 60_000 });
    const entryId = page.url().split("/cup/run/")[1];
    log("cup run", entryId);
    await page.getByTestId("cup-stage").waitFor();
    await page.locator("[data-testid=cup-stage] canvas").first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    await shot(page, "cup-run-viewer");
    await page.getByTestId("cup-skip").click();
    await page.getByTestId("cup-result").waitFor();
    const timeText = await page.getByTestId("cup-time").innerText();
    assert(/\d+\.\d\d/.test(timeText), `cup time shown (${timeText})`);
    await noHScroll(page, "/cup/run");
    await shot(page, "cup-run-result");

    const run = await getJson(page, `/api/cup/runs/${entryId}`);
    assert(run.run.mine && run.run.sealed && /^0{64}$/.test(run.run.replay.seed), "run replay sealed while the Cup is open");
    const p1 = await me(page);
    assert(p1.credits === p0.credits + 80, `participation credits once (${p0.credits} -> ${p1.credits})`);
    const again = await page.request.post(`${BASE_URL}/api/cup/run`, { data: { horseId: p0.horses[1].id } });
    assert(again.status() === 409, `second Cup Run refused (${again.status()})`);
    assert(p1.horses.every((h) => h.starts === 0), "the Cup is not a career start");

    await page.getByTestId("cup-board-link").click();
    await page.waitForURL(/\/cup$/);
    await page.getByTestId("cup-mine").waitFor();
    assert((await page.locator("[data-testid=cup-row][data-mine]").count()) >= 1, "my run is on the board");
    await shot(page, "cup-board");

    // ------------------------------------------------------------------ Story chapter race
    await page.goto(`${BASE_URL}/story`);
    await page.getByRole("heading", { name: "Story", level: 1 }).waitFor();
    await page.getByTestId("story-licence").waitFor();
    assert((await page.getByTestId("story-race").count()) === 6, "six Club chapter races");
    assert((await page.getByTestId("rival").count()) >= 3, "rival stables listed");
    await noHScroll(page, "/story");
    await shot(page, "story");
    const firstRace = page.getByTestId("story-race").first();
    const raceKey = await firstRace.getAttribute("data-race-key");
    await firstRace.getByTestId("story-race-open").click();
    await firstRace.getByTestId("story-race-sheet").waitFor();
    await firstRace.getByTestId("story-instant").click();
    await page.waitForURL(/\/race\//, { timeout: 60_000 });
    const raceId = page.url().split("/race/")[1];
    log("story race", raceKey, raceId);
    await page.getByTestId("race-name").waitFor();
    const card = (await getJson(page, `/api/races/${raceId}`)).race;
    assert(card.kind === "story", "a story race");
    const story = (await getJson(page, "/api/story")).story;
    const def = story.chapters[0].races.find((r) => r.key === raceKey);
    const rivalNames = new Set(story.rivals.filter((r) => def.rivals.includes(r.id)).map((r) => r.name));
    const house = card.field.filter((f) => !f.mine);
    assert(house.length > 0 && house.every((f) => rivalNames.has(f.stableName)), "house runners race for the named rivals");
    await page.waitForTimeout(1500);
    await shot(page, "story-race-result");
    const mine = (await getJson(page, `/api/races/${raceId}/me`)).runners[0];
    log("story result: position", mine.position, "reward", mine.storyReward);
    assert(mine.storyReward === (mine.position === 1 ? 400 : 20), "capped story reward");
    await page.goto(`${BASE_URL}/story`);
    await page.getByTestId("story-recent").waitFor();
    if (mine.position === 1) assert((await page.locator(`[data-testid=story-race][data-race-key=${raceKey}][data-won]`).count()) === 1, "won race marked");

    // ------------------------------------------------------------------ League (empty, then joined after a Live entry)
    await page.goto(`${BASE_URL}/league`);
    await page.getByTestId("league-empty").waitFor();
    assert((await page.getByTestId("league-calendar").locator("li").count()) > 0, "feature calendar listed");
    await noHScroll(page, "/league empty");
    const pick = await page.request.post(`${BASE_URL}/api/races/live-pick`, { data: {} });
    if (pick.ok()) {
      log("live pick:", (await pick.json()).pick.raceName);
      await page.goto(`${BASE_URL}/league`);
      await page.getByTestId("league-table").waitFor();
      assert((await page.locator("[data-testid=league-row][data-mine]").count()) === 1, "in a league after a Live entry");
      assert(/Bronze League/.test(await page.getByTestId("league-title").innerText()), "starts in Bronze");
    } else log("live pick unavailable:", pick.status(), await pick.text());
    await shot(page, "league");

    // ------------------------------------------------------------------ Hall of Fame
    await page.goto(`${BASE_URL}/hall`);
    await page.getByRole("heading", { name: "Hall of Fame", level: 1 }).waitFor();
    await page.getByTestId("achievements").waitFor();
    assert((await page.locator("[data-testid=achievements] li[data-earned]").count()) >= 1, "an achievement earned (first race)");
    await noHScroll(page, "/hall");
    await shot(page, "hall");

    // ------------------------------------------------------------------ desktop
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: await ctx.storageState() });
    const d = await desk.newPage();
    for (const path of ["/cup", "/league", "/hall", "/story"]) {
      await d.goto(`${BASE_URL}${path}`);
      await d.waitForTimeout(800);
      await shot(d, `desktop${path.replace(/\//g, "-")}`);
    }
    await desk.close();

    assert(errors.length === 0, `no page errors:\n${errors.join("\n")}`);
    log("PASS");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
