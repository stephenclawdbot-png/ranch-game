/**
 * One-step wallet sign-in (top bar "Connect wallet"), with a scripted EIP-6963 test wallet:
 * a new wallet is sent on to found its stable (one signature), then, signed out, the same
 * wallet signs straight back in with one signature. Needs an app without the invite gate:
 *   ALLOW_EMBEDDED_DB=1 PGLITE_DIR=/tmp/wc next dev -p 3178
 *   BASE_URL=http://localhost:3178 SCREENSHOT_DIR=/tmp/shots NODE_PATH=/opt/node-tools/node_modules node apps/web/e2e/wallet-connect.mjs
 */
import { createRequire } from "node:module";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3178";
const SHOTS = process.env.SCREENSHOT_DIR;
const account = privateKeyToAccount(generatePrivateKey());
const assert = (c, m) => {
  if (!c) throw new Error(`FAIL: ${m}`);
  console.log(`ok - ${m}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
let signatures = 0;
await ctx.exposeFunction("__testSign", async (msg) => {
  signatures++;
  const text = msg.startsWith("0x") ? Buffer.from(msg.slice(2), "hex").toString("utf8") : msg;
  return account.signMessage({ message: text });
});
await ctx.addInitScript((address) => {
  const provider = {
    async request({ method, params }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
      if (method === "eth_chainId") return "0xb626";
      if (method === "personal_sign") return window.__testSign(params[0]);
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      throw new Error(`unsupported ${method}`);
    },
    on() {},
    removeListener() {},
  };
  const info = { uuid: "test-wallet", name: "Test Wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "test.wallet" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}, account.address);

const page = await ctx.newPage();
const shot = (n) => SHOTS && page.screenshot({ path: `${SHOTS}/wallet-${n}.png` });

// 1. New wallet: top bar → pick wallet → one signature → off to found a stable.
await page.goto(`${BASE}/`, { timeout: 240_000 });
await page.getByTestId("nav-connect-wallet").click();
await page.locator("dialog[open]").waitFor();
await shot("1-dialog");
await page.locator("dialog[open]").getByTestId("wallet-connect").click();
await page.getByRole("button", { name: "Test Wallet" }).click();
await page.waitForURL(/\/play/, { timeout: 60_000 });
assert(signatures === 1, "new wallet: one signature, then sent to found a stable");
const register = page.getByTestId("wallet-signin-create");
await register.waitFor({ timeout: 60_000 });
await shot("2-play");
assert((await page.getByTestId("wallet-founding").textContent()).includes("With wallet 0x"), "the register button uses the connected wallet");
await register.click();
await page.waitForURL(/\/stable/, { timeout: 120_000 });
assert(signatures === 2, "stable founded with one more signature");

// 2. Signed out (new browser session cookies), same wallet: one signature signs back in.
await ctx.clearCookies();
await page.goto(`${BASE}/`, { timeout: 240_000 });
await page.getByTestId("nav-connect-wallet").click();
await page.locator("dialog[open]").getByTestId("wallet-connect").click();
await page.getByRole("button", { name: "Test Wallet" }).click();
await page.waitForURL(/\/stable/, { timeout: 60_000 });
assert(signatures === 3, "returning wallet: one signature and you're in");
await shot("3-signed-in");
await browser.close();
console.log("wallet-connect: all passed");
