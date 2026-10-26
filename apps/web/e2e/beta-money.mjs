#!/usr/bin/env node
/**
 * End-to-end: invites/affiliates, wallet linking and the beta-money pages against a server in
 * playtest mode WITHOUT web3 (mock chain: Premium shows "coming soon", the pool is empty).
 * The on-chain money path (deploy -> buy -> confirm -> pool -> claim) is covered by
 * `pnpm --filter @thoroughbred/web test:chain` on a local Hardhat node.
 *
 *   PLAYTEST_MODE=1 ADMIN_SECRET=e2e-admin-secret-123 ALLOW_EMBEDDED_DB=1 PGLITE_DIR=/tmp/bm next start -p 3141
 *   BASE_URL=http://localhost:3141 ADMIN_SECRET=e2e-admin-secret-123 NODE_PATH=/opt/node-tools/node_modules node apps/web/e2e/beta-money.mjs
 *
 * Flow: admin makes a root code -> the owner joins with it, verifies a wallet (SIWE, signed
 * here with a throwaway key) and claims the root -> Alice joins with a root code (owner = her
 * level 1) -> Bob joins with Alice's personal link -> /invite shows Bob as Alice's level 1 and
 * the owner's level 2 -> admin Affiliates tab shows the tree -> /pool and /packs render.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3141").replace(/\/$/, "");
const SECRET = process.env.ADMIN_SECRET ?? "e2e-admin-secret-123";
const OUT = process.env.SCREENSHOT_DIR ?? join(tmpdir(), "thoroughbred-beta-money");
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(`[beta-money ${new Date().toISOString().slice(11, 19)}]`, ...a);
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}
async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
}
async function noHScroll(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(over <= 1, `${label}: no horizontal scroll (overflow ${over}px)`);
}

async function adminSignIn(page) {
  await page.goto(`${BASE_URL}/admin`);
  await page.getByTestId("admin-secret").fill(SECRET);
  await page.getByTestId("admin-signin").click();
  await page.getByTestId("admin").waitFor();
}

async function joinWith(browser, code, mobile = false) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE_URL}/play?invite=${encodeURIComponent(code)}`);
  await p.getByRole("button", { name: /Register & get my horses/ }).waitFor({ timeout: 60_000 });
  await p.getByRole("button", { name: /Register & get my horses/ }).click();
  await p.getByTestId("race-now").waitFor({ timeout: 60_000 });
  return { ctx, p };
}

/** SIWE through the real API: challenge -> sign (throwaway key) -> link. */
async function linkWallet(page) {
  const acct = privateKeyToAccount(generatePrivateKey());
  const ch = await (await page.request.post(`${BASE_URL}/api/wallet/challenge`, { data: { address: acct.address } })).json();
  assert(ch.message?.includes(acct.address), "challenge names the address");
  const res = await page.request.post(`${BASE_URL}/api/wallet/link`, { data: { nonce: ch.nonce, signature: await acct.signMessage({ message: ch.message }) } });
  assert(res.ok(), `wallet linked (${res.status()})`);
  const replay = await page.request.post(`${BASE_URL}/api/wallet/link`, { data: { nonce: ch.nonce, signature: await acct.signMessage({ message: ch.message }) } });
  assert(!replay.ok(), "a SIWE nonce can't be replayed");
  return acct.address;
}

async function main() {
  const browser = await chromium.launch();
  try {
    const admin = await (await browser.newContext()).newPage();
    for (const path of ["/", "/play", "/invite", "/pool", "/packs", "/admin", "/admin/chain", "/api/pool"]) await admin.request.get(`${BASE_URL}${path}`, { timeout: 180_000 }).catch(() => undefined);
    log("admin: root codes");
    await adminSignIn(admin);
    await admin.getByTestId("admin-tab-invites").click();
    await admin.getByTestId("invite-count").fill("3");
    await admin.getByTestId("invite-generate").click();
    await admin.getByTestId("invite-new-codes").waitFor();
    const codes = (await admin.getByTestId("invite-new-codes").inputValue()).split("\n").map((l) => l.trim().split(/\s+/)[0]);

    log("owner joins, verifies a wallet and claims the root");
    const owner = await joinWith(browser, codes[0]);
    const ownerWallet = await linkWallet(owner.p);
    await owner.p.goto(`${BASE_URL}/me`);
    await owner.p.getByTestId("wallet-linked").first().waitFor();
    await adminSignIn(owner.p);
    await owner.p.goto(`${BASE_URL}/admin/chain`);
    await owner.p.getByTestId("claim-owner").click();
    await owner.p.getByText(/Owner set/).waitFor();
    await shot(owner.p, "admin-chain");
    log("owner wallet", ownerWallet);

    log("Alice joins with a root code: the owner is her inviter");
    const alice = await joinWith(browser, codes[1], true);
    await linkWallet(alice.p);
    await alice.p.goto(`${BASE_URL}/invite`);
    await alice.p.getByTestId("invite-link").waitFor();
    const link = await alice.p.getByTestId("invite-link").inputValue();
    const aliceCode = (await alice.p.getByTestId("invite-code").innerText()).trim();
    assert(link.includes(`/play?invite=${aliceCode}`) && /^R-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(aliceCode), `personal link (${link})`);
    assert(/never need to buy anything/.test(await alice.p.getByTestId("invite-rules").innerText()), "rules say no purchase is needed");
    await noHScroll(alice.p, "/invite mobile");
    await shot(alice.p, "invite-mobile");

    log("Bob joins with Alice's personal link");
    const bob = await joinWith(browser, aliceCode);
    await alice.p.reload();
    await alice.p.getByTestId("invitees").waitFor();
    assert(/Level 1/.test(await alice.p.getByTestId("invitees").innerText()), "Bob is Alice's level 1");
    await owner.p.goto(`${BASE_URL}/invite`);
    await owner.p.getByTestId("invitees").waitFor();
    const ownerList = await owner.p.getByTestId("invitees").innerText();
    assert(/Level 1/.test(ownerList) && /Level 2/.test(ownerList), "owner sees Alice (L1) and Bob (L2)");

    log("admin: affiliates tree and Prize Pool tab");
    await admin.goto(`${BASE_URL}/admin`);
    await admin.getByTestId("admin-tab-affiliates").click();
    await admin.getByTestId("affiliate-tree").waitFor();
    const tree = await admin.getByTestId("affiliate-tree").innerText();
    assert(/OWNER/.test(tree), "tree shows the owner as root");
    await shot(admin, "admin-affiliates");
    await admin.getByTestId("admin-tab-pool").click();
    await admin.getByTestId("admin-pool").waitFor();

    log("pages: /pool and /packs (web3 off)");
    await bob.p.goto(`${BASE_URL}/pool`);
    await bob.p.getByTestId("pool-balance").waitFor();
    assert(/0 ETH/.test(await bob.p.getByTestId("pool-balance").innerText()), "empty mock pool");
    await bob.p.getByTestId("pool-rules").waitFor();
    await alice.p.goto(`${BASE_URL}/pool`);
    await alice.p.getByTestId("pool-balance").waitFor();
    await noHScroll(alice.p, "/pool mobile");
    await shot(alice.p, "pool-mobile");
    await bob.p.goto(`${BASE_URL}/packs`);
    await bob.p.getByTestId("premium-demo").waitFor();
    assert((await bob.p.getByTestId("premium-checkout").count()) === 0, "no ETH checkout while WEB3_ENABLED is off");
    const quote = await bob.p.request.post(`${BASE_URL}/api/checkout/quote`, { data: { sku: "premium_pack", quantity: 1 } });
    assert(quote.status() === 503 && (await quote.json()).error === "coming_soon", `quote is 'coming soon' (${quote.status()})`);
    log("OK");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
