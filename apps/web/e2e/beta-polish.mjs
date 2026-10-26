#!/usr/bin/env node
/**
 * End-to-end: beta polish against a running dev server (PGlite locally).
 *
 *   BASE_URL=http://localhost:3106 SCREENSHOT_DIR=/tmp/shots \
 *   NODE_PATH=/opt/node22/lib/node_modules node apps/web/e2e/beta-polish.mjs
 *
 * Flow (phone viewport unless stated): new player -> Home: 3 daily goals all to do ->
 * one Story race via "Race now" -> the fresh result scrolls into view and "Race X again"
 * floats above the tab bar -> Home: the race goal is done and credits rose by 60 (paid once
 * across a reload) -> the horse's record is still Unraced (Story races are not career starts)
 * but the run is in its form -> genetics line on /stable and the genetics section on the horse
 * (no vigour/potential, no horizontal overflow) -> premium pity "within 20 pulls" on /packs ->
 * the standings strip fits whole chips plus "+N" at 390 and 1440.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3106").replace(/\/$/, "");
const OUT = process.env.SCREENSHOT_DIR ?? join(tmpdir(), "thoroughbred-beta-polish");
// Story races settle fast (short card, off 10 s after the tap) but keep a wide margin.
const STORY_TIMEOUT_MS = Number(process.env.STORY_TIMEOUT_MS ?? 240_000);
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(`[beta-polish ${new Date().toISOString().slice(11, 19)}]`, ...a);
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

/** The nav pill shows the same number the API pays ("1,500 credits" -> 1500). */
const creditsOf = (text) => Number(text.replace(/[^0-9]/g, ""));

/** documentElement has no horizontal scroll at this width. */
async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 0, `${label} has no horizontal scroll (overflow ${overflow}px)`);
}

/** Polls `cond` in the page until true or the timeout hits; the message names what never came. */
async function until(page, cond, timeoutMs, msg) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(cond)) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  const browser = await chromium.launch();
  const errors = [];
  try {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await phone.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

    // `next dev` compiles each route on first use: warm them so timing checks measure the game.
    log("warming up routes");
    const zero = "00000000-0000-4000-8000-000000000000";
    for (const path of ["/", "/play", "/stable", "/packs", "/dev/viewer", `/race/${zero}`, `/horse/${zero}`, "/api/me", "/api/packs", `/api/horses/${zero}`, `/api/races/${zero}/me`]) {
      await page.request.get(`${BASE_URL}${path}`, { timeout: 180_000 }).catch(() => undefined);
    }
    for (const path of ["/api/races/quick"]) {
      await page.request.post(`${BASE_URL}${path}`, { data: {}, timeout: 180_000 }).catch(() => undefined);
    }

    // ---------------------------------------------------------- new player from /play
    log("founding the stable");
    assert((await me(page)) === null, "a new browser has no stable");
    await page.goto(`${BASE_URL}/play`);
    await page.locator('button[type="submit"]').click();
    await page.getByTestId("race-now").waitFor({ timeout: 60_000 });
    const p0 = await me(page);
    assert(p0 && p0.horses.length >= 3, `starter horses arrived (${p0?.horses.length})`);
    log("credits", p0.credits, "horses", p0.horses.length);

    // ---------------------------------------------------------- 1. daily goals on Home
    // /play is one-shot (it sends existing stables to /me), so the goals are checked in a
    // second tab while the welcome page with "Race now" stays open. The goal completes in the
    // entry transaction, so this has to happen before the race.
    const home = await phone.newPage();
    home.on("pageerror", (e) => errors.push(`home pageerror: ${e.message}`));
    home.on("console", (m) => m.type() === "error" && errors.push(`home console: ${m.text()}`));
    await home.goto(`${BASE_URL}/`);
    const goals = home.getByTestId("daily-goals");
    await goals.waitFor();
    assert((await goals.locator("li").count()) === 3, "Home shows three daily goals");
    for (const g of ["race", "care", "cup"]) {
      const row = home.getByTestId(`goal-${g}`);
      assert((await row.count()) === 1, `the ${g} goal is listed`);
      assert((await row.getAttribute("data-done")) === "0", `the ${g} goal is still to do`);
    }
    const asideText = (await goals.locator(".eyebrow").innerText()).replace(/\s+/g, " ").trim().toLowerCase();
    assert(asideText === "3 to do", `the goals header says 3 to do (got "${asideText}")`);
    const header0 = creditsOf(await home.getByTestId("credits").first().innerText());
    assert(header0 === p0.credits, `the header credits match the API (${header0} vs ${p0.credits})`);
    await shot(home, "home-goals-todo");

    // ---------------------------------------------------------- race once, watch it settle
    log("racing once via Race now");
    await page.getByTestId("race-now").click();
    await page.waitForURL(/\/race\//);
    const storyId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop());
    await page.getByTestId("results-sequence").waitFor({ timeout: STORY_TIMEOUT_MS });
    log("story race", storyId, "settled");

    // The fresh reveal scrolls into view on its own (once, only for a fresh result).
    await until(
      page,
      () => {
        const el = document.querySelector('[data-testid="results-sequence"]');
        return !!el && el.getBoundingClientRect().top < window.innerHeight;
      },
      5000,
      "the results sequence scrolled into view within 5 s of settling",
    );

    // The staged reveal reaches "What next" ~3 s in; then the bar floats once its spot is gone.
    const again = page.getByTestId("race-again");
    await again.waitFor({ state: "visible", timeout: 30_000 });
    await until(
      page,
      () => document.querySelector('[data-action-bar] [data-testid="race-again"]')?.closest("[data-action-bar]")?.getAttribute("data-floating") === "true",
      5000,
      'the "Race again" bar floats on phones once its inline spot has scrolled away',
    );
    const barRect = await page.evaluate(() => {
      const r = document.querySelector('[data-action-bar] [data-testid="race-again"]').closest("[data-action-bar]").getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: window.innerWidth, h: window.innerHeight };
    });
    assert(barRect.top >= 0 && barRect.left >= 0 && barRect.right <= barRect.w && barRect.bottom <= barRect.h, `the floating bar is fully inside the viewport (${JSON.stringify(barRect)})`);
    assert(barRect.bottom <= barRect.h, `the floating bar sits above the tab bar (bottom ${barRect.bottom} <= ${barRect.h})`);
    assert(await again.isVisible(), "Race again is visible");
    await shot(page, "race-result-phone");

    const mine = await (await page.request.get(`${BASE_URL}/api/races/${storyId}/me`)).json();
    const horseId = mine.runners[0].horseId;
    assert(horseId, "the race API names my runner's horse");

    // ---------------------------------------------------------- goal done, paid once
    await home.goto(`${BASE_URL}/`);
    await goals.waitFor();
    assert((await home.getByTestId("goal-race").getAttribute("data-done")) === "1", "the race goal is done after racing");
    const p1 = await me(home);
    assert(p1.credits >= p0.credits + 60, `credits rose by at least 60 for the goal (${p0.credits} -> ${p1.credits})`);
    const header1 = creditsOf(await home.getByTestId("credits").first().innerText());
    assert(header1 >= header0 + 60, `the header credits rose too (${header0} -> ${header1})`);
    await shot(home, "home-goals-race-done");
    await home.reload();
    await goals.waitFor();
    assert((await home.getByTestId("goal-race").getAttribute("data-done")) === "1", "the race goal is still done after a reload");
    assert((await me(home)).credits === p1.credits, `the goal was paid once (credits unchanged by the reload: ${p1.credits})`);
    await home.close();

    // ---------------------------------------------------------- Story starts don't count
    await page.goto(`${BASE_URL}/horse/${horseId}`);
    await page.getByTestId("horse-name").waitFor();
    const record = page.locator("p.t-meta").filter({ hasText: /Unraced|runs ·/ });
    assert((await record.count()) === 1, "the horse page has its record line");
    assert((await record.first().innerText()).trim() === "Unraced", `Story races don't count as career starts: still Unraced, 0 runs (got "${await record.first().innerText()}")`);
    const history = page.getByTestId("history");
    if ((await history.count()) > 0) {
      assert((await history.locator(`a[href="/race/${storyId}"]`).count()) === 1, "the Story race is in the horse's form");
    }
    await shot(page, "horse-unraced");

    // ---------------------------------------------------------- genetics
    await page.goto(`${BASE_URL}/stable`);
    await page.getByTestId("horse-card").first().waitFor();
    const cards = await page.getByTestId("horse-card").count();
    const lines = await page.getByTestId("genetics-line").count();
    assert(cards >= 3 && lines === cards, `every horse on /stable carries a genetics line (${lines}/${cards})`);
    await assertNoOverflow(page, "/stable");
    await page.goto(`${BASE_URL}/horse/${horseId}`);
    await page.getByTestId("genetics").waitFor();
    const gen = await page.getByTestId("genetics").innerText();
    assert(gen.includes("Extension") && gen.includes("Agouti"), "the genetics section shows the coat loci (Extension, Agouti)");
    assert(/Thoroughbred|Arabian|Quarter Horse|Akhal-Teke/.test(gen), "the genetics section names a breed");
    assert(!/vigour|potential/i.test(gen), "the genetics section never mentions vigour or potential");
    const detail = await (await page.request.get(`${BASE_URL}/api/horses/${horseId}`)).json();
    assert(detail.genetics, "the horse API serves the genetics summary");
    assert(!/vigour|potential/i.test(JSON.stringify(detail.genetics)), "the genetics JSON has no vigour or potential either");
    await assertNoOverflow(page, "the horse page");
    await shot(page, "horse-genetics");

    // ---------------------------------------------------------- packs pity
    await page.goto(`${BASE_URL}/packs`);
    await page.getByTestId("pity-premium").waitFor();
    const pity = await page.getByTestId("pity-premium").innerText();
    assert(/Epic/i.test(pity) && /within 20 pulls/.test(pity), `premium pity guarantees Epic within 20 pulls (got "${pity}")`);
    await shot(page, "packs-pity");

    // ---------------------------------------------------------- standings strip, two widths
    for (const vp of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      const ctx = await browser.newContext({ viewport: vp });
      const vpPage = await ctx.newPage();
      vpPage.on("pageerror", (e) => errors.push(`${vp.width} pageerror: ${e.message}`));
      vpPage.on("console", (m) => m.type() === "error" && errors.push(`${vp.width} console: ${m.text()}`));
      await vpPage.goto(`${BASE_URL}/dev/viewer?horses=12&t=20&paused`);
      await vpPage.locator(".rv-standings .rv-st").first().waitFor({ timeout: 60_000 });
      // The strip hides until it has measured how many whole chips fit; wait for the fit.
      await until(
        vpPage,
        () => {
          const s = document.querySelector(".rv-standings");
          return !!s && getComputedStyle(s).visibility !== "hidden" && s.querySelectorAll(".rv-st").length > 1;
        },
        20_000,
        `the standings strip measured its fit at ${vp.width}x${vp.height}`,
      );
      await vpPage.waitForTimeout(500);
      const check = await vpPage.evaluate(() => {
        const strip = document.querySelector(".rv-standings");
        const s = strip.getBoundingClientRect();
        const chips = [...strip.querySelectorAll(".rv-st")].map((c) => c.getBoundingClientRect().right);
        const more = strip.querySelector(".rv-st-more");
        return { over: chips.filter((r) => r > s.right + 0.5).map((r) => (r - s.right).toFixed(1)), more: more ? more.textContent.trim() : null };
      });
      assert(check.over.length === 0, `every standings chip fits inside the strip at ${vp.width} (over by ${check.over.join(", ")}px)`);
      assert(check.more && /^\+\d+$/.test(check.more), `a "+N" chip is present at ${vp.width} (got ${check.more})`);
      log(`standings at ${vp.width}x${vp.height}: chips fit, "${check.more}" shown`);
      await shot(vpPage, `standings-${vp.width}`);
      await ctx.close();
    }

    // caret-color is injected by Playwright screenshots into focused inputs, not an app bug.
    // 401/404/425 responses are expected API answers (warming without a stable, unknown ids).
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