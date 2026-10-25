import { expect } from "chai";
import hre from "hardhat";
import { createHash, randomBytes } from "node:crypto";
import { custom, createWalletClient, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import { setBalance } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

/** Asserts the promise rejects and the error text mentions `name` (custom error / reason). */
export async function expectRevert(p: Promise<unknown>, name: string): Promise<void> {
  let error: unknown;
  try {
    await p;
  } catch (e) {
    error = e;
  }
  if (error === undefined) expect.fail(`expected revert with ${name}, but the call succeeded`);
  const text = [(error as Error).message, (error as { details?: string }).details, String(error)].join("\n");
  expect(text, `revert reason should mention ${name}`).to.include(name);
}

export async function expectAnyRevert(p: Promise<unknown>): Promise<void> {
  let failed = false;
  try {
    await p;
  } catch {
    failed = true;
  }
  expect(failed, "expected the call to revert").to.equal(true);
}

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
export const DEFAULT_ADMIN_ROLE: Hex = `0x${"00".repeat(32)}`;

export const random32 = (): Hex => toHex(randomBytes(32));

/** Same as racing-engine `commitSeed`: sha256 over the raw 32 seed bytes, lowercase hex (no 0x). */
export function engineCommitSeed(seedHex: string): string {
  return createHash("sha256").update(Buffer.from(seedHex.replace(/^0x/, ""), "hex")).digest("hex");
}

/**
 * A fresh local key generated at runtime (never stored in a file), funded on the Hardhat network,
 * wrapped in a wallet client that signs locally, like the production server does.
 */
export async function localServerWallet() {
  const account = privateKeyToAccount(generatePrivateKey());
  await setBalance(account.address, 10n ** 20n);
  const wallet = createWalletClient({ account, chain: hardhat, transport: custom(hre.network.provider) });
  return { account, wallet };
}

export async function latestTimestamp(): Promise<bigint> {
  const pc = await hre.viem.getPublicClient();
  return (await pc.getBlock()).timestamp;
}
