#!/usr/bin/env node
/**
 * The first hour, timed: a brand-new player at phone size (390x844) and at desktop size
 * (1440x900) goes landing -> "I have an invite" -> register (types a stable name) -> the
 * mentor's welcome -> the first Story race -> result + Why card -> the suggested next action
 * -> a second race -> the stable page -> the wiki. Every step is timed (wall clock and clicks)
 * and screenshotted, for the first-hour playtest report.
 *
 * Run against a LOCAL server started as the beta runs it (embedded PGlite, never production):
 *
 *   PLAYTEST_MODE=1 ADMIN_SECRET=e2e-admin-secret-123 USDG_MODE=practice LOGIN_CODE_SECRET=<40 chars> \
 *     ALLOW_EMBEDDED_DB=1 PGLITE_DIR=/tmp/fh next start -p 3131
 *   BASE_URL=http://localhost:3131 ADMIN_SECRET=e2e-admin-secret-123 SCREENSHOT_DIR=/tmp/first-hour \
 *     NODE_PATH=/opt/node-tools/node_modules node apps/web/e2e/first-hour.mjs
 *
 * Writes SCREENSHOT_DIR/<viewport>-NN-step.png and SCREENSHOT_DIR/timings.json. Exits non-zero
 * if a step can't be completed (the step that failed is in the log and the JSON).
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3131").replace(/\/$/, "");
const SECRET = process.env.ADMIN_SECRET ?? "e2e-admin-secret-123";
const OUT = process.env.SCREENSHOT_DIR ?? join(tmpdir(), "thoroughbred-first-hour");
const ONLY = process.env.VIEWPORT; // "phone" | "desktop" (default: both)
/** Races play at real speed: allow a generous wait for the finish and the staged result. */
const RACE_TIMEOUT_MS = Number(process.env.RACE_TIMEOUT_MS ?? 240_000);
/** Opening a race from a result page renders the next route while the replay still plays: slow on a busy machine. */
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS ?? 240_000);
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(`[first-hour ${new Date().toISOString().slice(11, 19)}]`, ...a);

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 } },
};

async function inviteCodes(count) {
  const ctx = await chromium.launch().then((b) => b.newContext().then((c) => ({ b, c })));
  try {
    const r = ctx.c.request;
    const s = await r.post(`${BASE_URL}/api/admin/session`, { data: { secret: SECRET }, timeout: 180_000 });
    if (!s.ok()) throw new Error(`admin sign-in failed (${s.status()})`);
    const res = await r.post(`${BASE_URL}/api/admin/invites`, { data: { count, note: "first-hour playtest" } });
    if (!res.ok()) throw new Error(`invite generation failed (${res.status()})`);
    const body = await res.json();
    return body.codes.map((c) => (typeof c === "string" ? c : c.code));
  } finally {
    await ctx.b.close();
  }
}

/** One player's run: each step records seconds, clicks and a screenshot. */
async function run(browser, kind, code) {
  const ctx = await browser.newContext(VIEWPORTS[kind]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  const steps = [];
  const notes = {};
  let clicks = 0;
  let n = 0;
  const t0 = Date.now();
  let stepStart = t0;
  let stepClicks = 0;
  const click = async (locator) => {
    await locator.click();
    clicks++;
    stepClicks++;
  };
  const shot = async (name) => {
    n++;
    const path = join(OUT, `${kind}-${String(n).padStart(2, "0")}-${name}.png`);
    await page.screenshot({ path, fullPage: true }).catch(() => page.screenshot({ path }));
    return path;
  };
  const endStep = async (name, extra = {}) => {
    const now = Date.now();
    const s = { step: name, seconds: Math.round((now - stepStart) / 100) / 10, clicks: stepClicks, atSeconds: Math.round((now - t0) / 100) / 10, totalClicks: clicks, ...extra };
    s.screenshot = await shot(name);
    steps.push(s);
    log(kind, name, `${s.seconds}s`, `${s.clicks} clicks`, `(t=${s.atSeconds}s, ${clicks} clicks)`);
    stepStart = Date.now();
    stepClicks = 0;
    return s;
  };
  const visible = async (locator, timeout = 1500) => locator.first().isVisible({ timeout }).catch(() => false);

  try {
    // 1. Landing.
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.getByTestId("found-stable").waitFor({ timeout: 60_000 });
    notes.landingCta = (await page.getByTestId("found-stable").innerText()).trim();
    await endStep("landing");

    // 2. "I have an invite" -> the invite gate.
    await click(page.getByTestId("found-stable"));
    await page.getByTestId("invite-code").waitFor({ timeout: 60_000 });
    await page.getByTestId("invite-code").fill(code);
    await click(page.getByTestId("invite-continue"));
    await endStep("invite-accepted", {});

    // 3. Register: the player types their own stable name.
    const nameInput = page.locator('input[name="stableName"], #stable-name, [data-testid="stable-name-input"]').first();
    await nameInput.waitFor({ timeout: 30_000 });
    const stableName = `${kind === "phone" ? "Moss" : "Larch"} Lane ${String(Date.now()).slice(-4)}`.slice(0, 24);
    await nameInput.fill(stableName);
    await shot("register-form");
    const register = page.getByRole("button", { name: /Register|get my horses/i }).first();
    await click(register);
    await page.getByTestId("mentor-welcome").waitFor({ timeout: 60_000 });
    await endStep("registered-mentor-1", { stableName });

    // 4. The mentor's welcome: read every screen (a new player), then "Yes, keep it simple".
    let mentorScreens = 1;
    while (await visible(page.getByTestId("mentor-next"), 500)) {
      await click(page.getByTestId("mentor-next"));
      mentorScreens++;
      if (mentorScreens <= 4) await shot(`mentor-${mentorScreens}`);
      if (mentorScreens > 8) break;
    }
    await click(page.getByTestId("mentor-new-yes"));
    await endStep("mentor-done", { mentorScreens });

    // 5. The starters and "Race <horse> now".
    await page.getByTestId("race-now").waitFor({ timeout: 60_000 });
    notes.firstRaceButton = (await page.getByTestId("race-now").innerText()).trim();
    await shot("starters");
    await click(page.getByTestId("race-now"));
    await page.waitForURL(/\/race\//, { timeout: NAV_TIMEOUT_MS });
    await endStep("first-race-entered");

    // 6. The race: build-up, the off, the finish, the staged result.
    const firstRaceUrl = page.url();
    await page.waitForTimeout(4000);
    await shot("race-prerace");
    const offAt = Date.now();
    await page.getByTestId("results-sequence").waitFor({ timeout: RACE_TIMEOUT_MS });
    notes.raceWaitSeconds = Math.round((Date.now() - offAt) / 1000) + 4;
    // Let the staged reveal (board, credits, why, next) finish.
    await page.waitForTimeout(4500);
    await endStep("first-result", { url: firstRaceUrl });

    // 7. The Why card and the suggested change.
    const why = page.getByTestId("why-card");
    if (await visible(why, 10_000)) {
      await why.scrollIntoViewIfNeeded();
      notes.firstWhy = (await why.innerText()).replace(/\s+/g, " ").trim();
      await page.screenshot({ path: join(OUT, `${kind}-why-card.png`) });
    }
    const detail = page.getByTestId("settlement-detail");
    if (await visible(detail)) notes.firstSettlement = (await detail.innerText()).trim();
    const reason = page.getByTestId("why-reason");
    if (await visible(reason)) {
      notes.firstReason = (await reason.innerText()).trim();
      const change = page.getByTestId("why-change");
      if (await visible(change)) notes.firstChangeText = (await change.innerText()).trim();
      await page.getByTestId("verdict").scrollIntoViewIfNeeded();
      await page.getByTestId("verdict").screenshot({ path: join(OUT, `${kind}-verdict.png`) });
      // How far down the result page the verdict sits (a phone screen is 844 px).
      notes.verdictTopPx = await page.getByTestId("verdict").evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
    }
    const change = page.getByTestId("try-change");
    notes.hasOneTapChange = await visible(change);
    if (notes.hasOneTapChange) notes.firstChange = (await change.innerText()).trim();
    await endStep("why-read");

    // 8. The suggested next action: the one-tap "try again with the change" when offered, else "Race again".
    const next = notes.hasOneTapChange ? change : page.getByTestId("race-again");
    await next.first().scrollIntoViewIfNeeded();
    notes.secondRaceAction = (await next.first().innerText()).trim();
    await click(next.first());
    await page.waitForURL((u) => /\/race\//.test(u.toString()) && u.toString() !== firstRaceUrl, { timeout: NAV_TIMEOUT_MS });
    await endStep("second-race-entered", { action: notes.secondRaceAction });

    // 9. Second race result.
    await page.getByTestId("results-sequence").waitFor({ timeout: RACE_TIMEOUT_MS });
    await page.waitForTimeout(4500);
    const why2 = page.getByTestId("why-card");
    if (await visible(why2, 10_000)) notes.secondWhy = (await why2.innerText()).replace(/\s+/g, " ").trim();
    if (await visible(page.getByTestId("why-reason"))) notes.secondReason = (await page.getByTestId("why-reason").innerText()).trim();
    await endStep("second-result");

    // 10. Back to the stable.
    const back = page.getByRole("link", { name: /Back to the stable/i }).first();
    if (await visible(back)) await click(back);
    else await page.goto(`${BASE_URL}/stable`);
    await page.waitForURL(/\/stable/, { timeout: 30_000 });
    await page.getByTestId("horse-card").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await endStep("stable");

    // 11. Home (the yard): what does it ask for next?
    await page.goto(`${BASE_URL}/`);
    await page.waitForTimeout(2500);
    notes.homeText = (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 900);
    await endStep("home-after-two-races");

    // 12. The wiki / explore.
    await page.goto(`${BASE_URL}/wiki`);
    await page.waitForTimeout(1500);
    await endStep("wiki");

    // Navigation the player can see (for "too much too soon").
    notes.navLinks = await page
      .locator("nav a")
      .evaluateAll((as) => [...new Set(as.map((a) => (a.textContent ?? "").trim()).filter(Boolean))])
      .catch(() => []);
    const me = await page.request.get(`${BASE_URL}/api/me`).then((r) => r.json()).catch(() => null);
    notes.unlocks = me?.player?.onboarding?.unlocks ?? null;
    notes.credits = me?.player?.credits ?? null;
    return { kind, ok: true, steps, notes, errors, totalSeconds: Math.round((Date.now() - t0) / 1000), totalClicks: clicks };
  } catch (e) {
    await shot("FAILED").catch(() => undefined);
    log(kind, "FAILED", e.message);
    return { kind, ok: false, failed: e.message, steps, notes, errors, totalSeconds: Math.round((Date.now() - t0) / 1000), totalClicks: clicks };
  } finally {
    await ctx.close();
  }
}

async function main() {
  const kinds = ONLY ? [ONLY] : ["phone", "desktop"];
  // Warm the server (first requests compile nothing in production, but PGlite migrates once).
  const codes = await inviteCodes(kinds.length);
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [i, kind] of kinds.entries()) results.push(await run(browser, kind, codes[i]));
  } finally {
    await browser.close();
  }
  const summary = results.map((r) => {
    const at = (name) => r.steps.find((s) => s.step === name);
    return {
      kind: r.kind,
      ok: r.ok,
      firstRaceEnteredAtS: at("first-race-entered")?.atSeconds ?? null,
      clicksToFirstRace: at("first-race-entered")?.totalClicks ?? null,
      firstResultAtS: at("first-result")?.atSeconds ?? null,
      secondRaceEnteredAtS: at("second-race-entered")?.atSeconds ?? null,
      totalSeconds: r.totalSeconds,
      totalClicks: r.totalClicks,
    };
  });
  writeFileSync(join(OUT, "timings.json"), JSON.stringify({ baseUrl: BASE_URL, at: new Date().toISOString(), summary, results }, null, 2));
  console.table(summary);
  log("wrote", join(OUT, "timings.json"));
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
