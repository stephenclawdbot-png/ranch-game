#!/usr/bin/env node
/**
 * End-to-end: the closed playtest against a server started with PLAYTEST_MODE=1 and
 * ADMIN_SECRET (a local PGlite database: this script RESETS game progress at the end).
 *
 *   PLAYTEST_MODE=1 ADMIN_SECRET=e2e-admin-secret-123 ALLOW_EMBEDDED_DB=1 PGLITE_DIR=/tmp/pt next start -p 3121
 *   BASE_URL=http://localhost:3121 ADMIN_SECRET=e2e-admin-secret-123 SCREENSHOT_DIR=/tmp/shots \
 *   NODE_PATH=/opt/node-tools/node_modules node apps/web/e2e/playtest.mjs
 *
 * Flow: signup without a code is refused -> /play shows the invite gate (bad code explained)
 * -> admin signs in and generates codes -> a tester joins with ?invite= -> the code can't be
 * reused -> feedback from the top bar (and the rate limit) -> admin accepts it as a bug ->
 * pending bounty -> approve -> mark paid with a tx hash -> /beta shows it paid, wallet saved
 * -> metrics and testers -> reset keeps the tester, who re-joins with the same code.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3121").replace(/\/$/, "");
const SECRET = process.env.ADMIN_SECRET ?? "e2e-admin-secret-123";
const OUT = process.env.SCREENSHOT_DIR ?? join(tmpdir(), "thoroughbred-playtest");
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(`[playtest ${new Date().toISOString().slice(11, 19)}]`, ...a);
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}
async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  log("screenshot", path);
}
async function noHScroll(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(over <= 1, `${label}: no horizontal scroll (overflow ${over}px)`);
}
const silks = { pattern: "hoops", primary: "#16224d", secondary: "#e2b33c", cap: "#e2b33c" };

async function main() {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, tag) => {
    p.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
    p.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|THREE/.test(m.text()) && errors.push(`${tag} console: ${m.text()}`));
  };
  try {
    const anon = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const a = await anon.newPage();
    watch(a, "anon");
    for (const path of ["/", "/play", "/beta", "/admin", "/api/invite", "/api/admin/invites", "/api/beta"]) await a.request.get(`${BASE_URL}${path}`, { timeout: 180_000 }).catch(() => undefined);

    log("signup needs an invite");
    const refused = await a.request.post(`${BASE_URL}/api/account`, { data: { stableName: "QA Bot Gatecrasher", silks } });
    assert(refused.status() === 403 && (await refused.json()).error === "invite_required", `no code -> 403 (${refused.status()})`);
    const bad = await a.request.post(`${BASE_URL}/api/account`, { data: { stableName: "QA Bot Gatecrasher", silks, inviteCode: "TB-NOPE-NOPE" } });
    assert(bad.status() === 400, `bad code -> 400 (${bad.status()})`);
    assert((await a.request.get(`${BASE_URL}/api/admin/invites`)).status() === 401, "admin API needs the admin");

    await a.goto(`${BASE_URL}/play`);
    await a.getByTestId("invite-gate").waitFor();
    await a.getByTestId("invite-code").fill("TB-ZZZZ-ZZZZ");
    await a.getByTestId("invite-continue").click();
    await a.getByTestId("invite-problem").waitFor();
    assert(/recognise/.test(await a.getByTestId("invite-problem").innerText()), "bad code explained");
    await shot(a, "play-invite-gate");

    log("admin: sign in, generate codes");
    await a.goto(`${BASE_URL}/admin`);
    await a.getByTestId("admin-secret").fill("wrong-secret-value");
    await a.getByTestId("admin-signin").click();
    await a.getByText("That isn't the admin secret.").waitFor();
    await a.getByTestId("admin-secret").fill(SECRET);
    await a.getByTestId("admin-signin").click();
    await a.getByTestId("admin").waitFor();
    await a.getByTestId("admin-tab-invites").click();
    await a.getByTestId("playtest-config").waitFor();
    assert(/ON/.test(await a.getByTestId("playtest-config").innerText()), "admin shows playtest mode on");
    await a.getByTestId("invite-count").fill("3");
    await a.getByTestId("invite-generate").click();
    await a.getByTestId("invite-new-codes").waitFor();
    const codes = (await a.getByTestId("invite-new-codes").inputValue()).split("\n").map((l) => l.trim().split(/\s+/)[0]);
    assert(codes.length === 3 && codes.every((c) => /^TB-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c)), `3 codes (${codes.join(",")})`);
    await shot(a, "admin-invites");

    log("tester joins with an invite link");
    const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const t = await tctx.newPage();
    watch(t, "tester");
    await t.goto(`${BASE_URL}/play?invite=${codes[0]}`);
    await t.getByRole("button", { name: /Register & get my horses/ }).waitFor({ timeout: 30_000 });
    await t.getByRole("button", { name: /Register & get my horses/ }).click();
    await t.getByTestId("race-now").waitFor({ timeout: 60_000 });
    const me = (await (await t.request.get(`${BASE_URL}/api/me`)).json()).player;
    assert(me.tester === true, "the new stable is a tester");
    log("tester", me.stableName);

    log("a used code is refused");
    const other = await browser.newContext();
    const o = await other.newPage();
    await o.goto(`${BASE_URL}/play`);
    await o.getByTestId("invite-code").fill(codes[0]);
    await o.getByTestId("invite-continue").click();
    await o.getByTestId("invite-problem").waitFor();
    assert(/already been used/.test(await o.getByTestId("invite-problem").innerText()), "used code explained");
    await other.close();

    log("feedback from the top bar");
    await t.goto(`${BASE_URL}/stable`);
    await t.getByTestId("feedback-open").click();
    await t.getByTestId("feedback-dialog").waitFor();
    assert(await t.getByTestId("feedback-send").isDisabled(), "send needs a category and a message");
    await t.getByTestId("feedback-cat-bug").click();
    await t.getByTestId("feedback-message").fill("QA Bot: the stall door animation stutters on my phone.");
    await shot(t, "mobile-feedback-dialog");
    await t.getByTestId("feedback-send").click();
    await t.getByTestId("feedback-sent").waitFor();
    await t.keyboard.press("Escape");
    await t.getByTestId("feedback-dialog").waitFor({ state: "detached" });
    // Rate limit: 10 an hour per sender.
    let limited = 0;
    for (let i = 0; i < 10; i++) {
      const r = await t.request.post(`${BASE_URL}/api/feedback`, { data: { category: "idea", message: `QA Bot idea ${i}`, route: "/stable" } });
      if (r.status() === 429) limited++;
    }
    assert(limited >= 1, "feedback is rate limited");

    log("admin: accept as bug -> bounty -> approve -> paid");
    await a.goto(`${BASE_URL}/admin#feedback`);
    await a.getByTestId("fb-item").first().waitFor();
    const bugItem = a.getByTestId("fb-item").filter({ hasText: "stall door animation" });
    await bugItem.getByTestId("fb-accept").click();
    await bugItem.getByText("Bug accepted").waitFor();
    await shot(a, "admin-feedback");
    await a.getByTestId("admin-tab-payouts").click();
    const row = a.locator('[data-testid="payout-row"][data-status="pending"]').first();
    await row.waitFor();
    await row.getByTestId("payout-approve").click();
    const approved = a.locator('[data-testid="payout-row"][data-status="approved"]').first();
    await approved.waitFor();
    const csv = await a.request.get(`${BASE_URL}/api/admin/payouts/csv`);
    assert(csv.ok() && /bug_bounty/.test(await csv.text()), "CSV of approved, unpaid rewards");
    const hash = `0x${"ab".repeat(32)}`;
    await approved.getByTestId("payout-tx").fill("0x1234");
    assert(await approved.getByTestId("payout-paid").isDisabled(), "a short tx hash is refused");
    await approved.getByTestId("payout-tx").fill(hash);
    await approved.getByTestId("payout-paid").click();
    await a.locator('[data-testid="payout-row"][data-status="paid"]').first().waitFor();
    await shot(a, "admin-payouts");

    log("/beta: payout and wallet");
    await t.goto(`${BASE_URL}/beta`);
    await t.getByTestId("beta-progress").waitFor();
    await t.locator('[data-testid="beta-reward"][data-status="paid"]').waitFor();
    assert((await t.locator(`a[href$="/tx/${hash}"]`).count()) === 1, "paid reward links to the explorer");
    await t.getByTestId("wallet-input").fill("0x123");
    assert(await t.getByTestId("wallet-save").isDisabled(), "a bad address can't be saved");
    await t.getByTestId("wallet-input").fill("0x52908400098527886E0F7030069857D2E4169EE7");
    await t.getByTestId("wallet-save").click();
    await t.getByTestId("wallet-msg").waitFor();
    await noHScroll(t, "/beta");
    await shot(t, "mobile-beta");
    await t.goto(`${BASE_URL}/me`);
    await t.getByTestId("me-beta-link").waitFor();

    log("admin: metrics and testers");
    await a.goto(`${BASE_URL}/admin#metrics`);
    await a.getByTestId("funnel").waitFor();
    await a.getByTestId("admin-tab-testers").click();
    await a.getByTestId("testers-table").getByText(me.stableName).waitFor();
    assert(/0x5290/.test(await a.getByTestId("testers-table").innerText()), "the tester's wallet is listed");
    await shot(a, "admin-testers");

    log("admin: reset keeps the tester");
    await a.getByTestId("admin-tab-reset").click();
    assert(await a.getByTestId("reset-go").isDisabled(), "reset needs the typed confirmation");
    await a.getByTestId("reset-confirm").fill("RESET PLAYTEST");
    await a.getByTestId("reset-go").click();
    await a.getByTestId("reset-result").waitFor({ timeout: 60_000 });
    assert(/Done/.test(await a.getByTestId("reset-result").innerText()), "reset done");
    assert((await t.request.get(`${BASE_URL}/api/me`)).status() !== 200 || !(await (await t.request.get(`${BASE_URL}/api/me`)).json()).player, "old session gone after reset");
    // Re-join with the same code (a fresh device cookie).
    await tctx.clearCookies();
    const again = await t.request.post(`${BASE_URL}/api/account`, { data: { stableName: "QA Bot Rejoined", silks, inviteCode: codes[0] } });
    assert(again.status() === 201, `re-join with the same code after a reset (${again.status()})`);
    const beta = await (await t.request.get(`${BASE_URL}/api/beta`)).json();
    assert(beta.tester?.walletAddress === "0x52908400098527886E0F7030069857D2E4169EE7", "wallet kept across the reset");
    assert(beta.rewards.some((r) => r.status === "paid"), "paid reward kept across the reset");

    const fatal = errors.filter((e) => !/Download the React DevTools|favicon|status of (401|403|404|409|425|429)/i.test(e));
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
