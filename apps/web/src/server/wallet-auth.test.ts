/**
 * Wallet sign-in at the HTTP layer (src/server/walletAuth.ts, driven by
 * /api/auth/wallet/challenge + /verify): the login-purpose SIWE message (its wording differs
 * from the link message), the happy path (device session + cookie), every failure (wrong
 * signer, expired, replayed, mismatched address), the replace guard for a browser whose own
 * stable is in play, the link-to-current-account path, the needsStable + create path, and
 * the per-IP limit. Signature storage and challenge single-use live in packages/db's tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex, PrivateKeyAccount } from "viem";
import { authenticate, createAccount, createDb, hashToken, linkVerifiedWallet, listDevices, loginWalletOf, schema, stableOf, type DbHandle } from "@thoroughbred/db";
import { createStoryRace } from "./game";
import { LINK_STATEMENT, LOGIN_STATEMENT, siweAddress, siweMessage } from "./chain/wallet";
import { resetWalletAuthLimit, WALLET_AUTH_LIMIT, walletAuthChallengeResponse, walletAuthVerifyResponse } from "./walletAuth";
import type { Session } from "./session";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 3, 12, 0, 0));
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

const SILKS = { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" };
const CH = { host: "beta.example", proto: "https" };

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

let n = 0;
async function player(name?: string): Promise<Session & { token: string }> {
  const acc = await createAccount(h.db, { stableName: name ?? `Stable ${++n}`, silks: SILKS, now: T0 });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId), token: acc.token };
}

function body(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

/** One full sign-in attempt for `acct`'s wallet (challenge -> wallet signature -> verify). */
async function signIn(acct: PrivateKeyAccount, opts: { ip?: string; session?: Session | null; now?: Date; extra?: Record<string, unknown> } = {}) {
  const ip = opts.ip ?? "9.9.9.9";
  const ch = await walletAuthChallengeResponse(h.db, { address: acct.address, ...CH, ip, now: opts.now ?? T0 });
  const { nonce, message } = (await body(ch)) as { nonce: string; message: string };
  const signature = (await acct.signMessage({ message })) as Hex;
  return walletAuthVerifyResponse(h.db, { body: { nonce, signature, ...opts.extra }, ip, session: opts.session ?? null, now: opts.now ?? T0 });
}

describe("the login SIWE message", () => {
  const base = { domain: "beta.example", uri: "https://beta.example", address: "0x1234567890123456789012345678901234567890" as Address, chainId: 4663, nonce: "abc123def456", issuedAt: T0, expiresAt: at(10 * MIN) };

  it("states sign-in, not linking, and differs from the link message", () => {
    const login = siweMessage({ ...base, statement: LOGIN_STATEMENT });
    const link = siweMessage({ ...base, statement: LINK_STATEMENT });
    expect(login).toContain("Sign in to Post Time with this wallet. Signing is free and sends no transaction.");
    expect(link).toContain("Link this wallet to my Post Time stable");
    expect(login).not.toBe(link);
    expect(siweAddress(login)).toBe(base.address);
  });
});

describe("POST /api/auth/wallet/verify (wallet belongs to a stable)", () => {
  it("signs the device in: cookie set, device row created, stable name returned", async () => {
    const home = await player("Wallet Home Stable");
    const key = generatePrivateKey();
    const acct = privateKeyToAccount(key);
    // The payout-wallet link (any SIWE verification) is what makes the wallet findable.
    await linkVerifiedWallet(h.db, { accountId: home.accountId, address: acct.address, stableName: "Wallet Home Stable", now: T0 });
    expect(await loginWalletOf(h.db, home.accountId)).toBe(acct.address);

    const res = await signIn(acct, { ip: "10.0.0.1" });
    expect(res.status).toBe(200);
    expect((await body(res)).stableName).toBe("Wallet Home Stable");
    const cookie = res.cookies.get("tb_session")!;
    expect(cookie.httpOnly).toBe(true);
    expect(await authenticate(h.db, cookie.value)).toMatchObject({ accountId: home.accountId });
    const devices = await listDevices(h.db, home.accountId, hashToken(cookie.value));
    expect(devices.devices).toHaveLength(1);
    expect(devices.devices[0]).toMatchObject({ label: "Wallet sign-in", current: true });
    // Also found through the verified tester row alone (older accounts have no accounts.wallet_address yet).
  });

  it("finds the stable through a verified tester wallet when accounts.wallet_address is unset, and backfills it", async () => {
    const home = await player("Tester Wallet Stable");
    const acct = privateKeyToAccount(generatePrivateKey());
    // An account linked before this feature: a verified tester row, no wallet on the account.
    await h.db.insert(schema.testers).values({ inviteCode: "OPEN", accountId: home.accountId, stableName: "Tester Wallet Stable", walletAddress: acct.address, walletVerifiedAt: T0, joinedAt: T0 });
    expect(await loginWalletOf(h.db, home.accountId)).toBeNull();

    const res = await signIn(acct, { ip: "10.0.0.11" });
    expect(res.status).toBe(200);
    expect((await body(res)).stableName).toBe("Tester Wallet Stable");
    expect(await authenticate(h.db, res.cookies.get("tb_session")!.value)).toMatchObject({ accountId: home.accountId });
    // The sign-in backfilled accounts.wallet_address, so lookups go straight there next time.
    expect(await loginWalletOf(h.db, home.accountId)).toBe(acct.address);
  });

  it("rejects a wrong signer, an expired challenge, a replay and a mismatched address", async () => {
    const home = await player("Careful Wallet Stable");
    const acct = privateKeyToAccount(generatePrivateKey());
    await linkVerifiedWallet(h.db, { accountId: home.accountId, address: acct.address, stableName: "Careful Wallet Stable", now: T0 });
    const other = privateKeyToAccount(generatePrivateKey());

    // Wrong signer: someone else's signature for the stored message.
    const ch1 = (await body(await walletAuthChallengeResponse(h.db, { address: acct.address, ...CH, ip: "10.0.0.2", now: T0 }))) as { nonce: string; message: string };
    const bad = await other.signMessage({ message: ch1.message });
    await expect(walletAuthVerifyResponse(h.db, { body: { nonce: ch1.nonce, signature: bad }, ip: "10.0.0.2", session: null, now: T0 })).rejects.toThrow(
      /doesn't match that wallet/,
    );
    // The failed attempt consumed the nonce: a replay with the right key still fails.
    const good = await acct.signMessage({ message: ch1.message });
    await expect(walletAuthVerifyResponse(h.db, { body: { nonce: ch1.nonce, signature: good }, ip: "10.0.0.2", session: null, now: T0 })).rejects.toThrow(
      /already used|expired/,
    );

    // Expired: a 10-minute challenge is refused at 11 minutes.
    const ch2 = (await body(await walletAuthChallengeResponse(h.db, { address: acct.address, ...CH, ip: "10.0.0.2", now: T0 }))) as { nonce: string; message: string };
    const sig2 = await acct.signMessage({ message: ch2.message });
    await expect(walletAuthVerifyResponse(h.db, { body: { nonce: ch2.nonce, signature: sig2 }, ip: "10.0.0.2", session: null, now: at(11 * MIN) })).rejects.toThrow(
      /expired/,
    );

    // Address mismatch: a message for another address can't be signed in as this wallet.
    const ch3 = (await body(await walletAuthChallengeResponse(h.db, { address: other.address, ...CH, ip: "10.0.0.2", now: T0 }))) as { nonce: string; message: string };
    const sig3 = await acct.signMessage({ message: ch3.message }); // signs a message naming `other`
    await expect(walletAuthVerifyResponse(h.db, { body: { nonce: ch3.nonce, signature: sig3 }, ip: "10.0.0.2", session: null, now: T0 })).rejects.toThrow(
      /doesn't match that wallet/,
    );
  });

  it("refuses to switch a browser whose stable is in play without { replace: true }", async () => {
    const home = await player("Old Wallet Stable");
    const away = await player("New Wallet Stable");
    await createStoryRace(h.db, home, { instant: true }, new Date()); // the browser's stable is in play
    const acct = privateKeyToAccount(generatePrivateKey());
    await linkVerifiedWallet(h.db, { accountId: away.accountId, address: acct.address, stableName: "New Wallet Stable", now: T0 });

    const refused = await signIn(acct, { ip: "10.0.0.3", session: home });
    expect(refused.status).toBe(409);
    expect((await body(refused)).error).toBe("replace_required");
    const replaced = await signIn(acct, { ip: "10.0.0.3", session: home, extra: { replace: true } });
    expect(replaced.status).toBe(200);
    const cookie = replaced.cookies.get("tb_session")!;
    expect(await authenticate(h.db, cookie.value)).toMatchObject({ accountId: away.accountId });
  });
});

describe("POST /api/auth/wallet/verify (wallet unknown)", () => {
  it("links the wallet to this browser's stable, which can then sign in elsewhere", async () => {
    const home = await player("Link Here Stable");
    const acct = privateKeyToAccount(generatePrivateKey());
    const res = await signIn(acct, { ip: "10.0.0.4", session: home });
    expect(res.status).toBe(200);
    const data = (await body(res)) as { linked: boolean; address: string };
    expect(data).toMatchObject({ linked: true, address: acct.address });
    expect(await loginWalletOf(h.db, home.accountId)).toBe(acct.address);

    // Second device, no session: the same wallet now signs straight in.
    const second = await signIn(acct, { ip: "10.0.0.5" });
    expect(second.status).toBe(200);
    expect((await body(second)).stableName).toBe("Link Here Stable");
    expect(await authenticate(h.db, second.cookies.get("tb_session")!.value)).toMatchObject({ accountId: home.accountId });
  });

  it("answers { needsStable } without a session, and { create: true } founds the stable and links the wallet", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const first = await signIn(acct, { ip: "10.0.0.6" });
    expect(first.status).toBe(200);
    expect(await body(first)).toEqual({ needsStable: true });

    const created = await signIn(acct, { ip: "10.0.0.6", extra: { create: true, stableName: "Wallet Found Stable", silks: SILKS } });
    expect(created.status).toBe(201);
    const data = (await body(created)) as { created: boolean; stableName: string; player: { accountId: string } };
    expect(data.created).toBe(true);
    expect(data.stableName).toBe("Wallet Found Stable");
    const cookie = created.cookies.get("tb_session")!;
    const session = await authenticate(h.db, cookie.value);
    expect(await loginWalletOf(h.db, session!.accountId)).toBe(acct.address);
    // And the next device signs in with the same wallet.
    const again = await signIn(acct, { ip: "10.0.0.7" });
    expect((await body(again)).stableName).toBe("Wallet Found Stable");
  });

  it("refuses to create without a valid stable name", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    await expect(signIn(acct, { ip: "10.0.0.8", extra: { create: true, stableName: "x", silks: SILKS } })).rejects.toThrow(/Check the stable name/);
  });
});

describe("the per-IP limit", () => {
  it("answers 429 past 30 requests (challenges + verifies) from one IP within the hour", async () => {
    resetWalletAuthLimit();
    const acct = privateKeyToAccount(generatePrivateKey());
    for (let i = 0; i < WALLET_AUTH_LIMIT; i++) {
      const res = await walletAuthChallengeResponse(h.db, { address: acct.address, ...CH, ip: "10.0.0.9", now: at(i * 1000) });
      expect(res.status).toBe(200);
    }
    const throttled = await walletAuthChallengeResponse(h.db, { address: acct.address, ...CH, ip: "10.0.0.9", now: at(WALLET_AUTH_LIMIT * 1000) });
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Retry-After")).toBe("3600");
    const verifyToo = await walletAuthVerifyResponse(h.db, { body: { nonce: "aaaaaaaa", signature: "0x00" }, ip: "10.0.0.9", session: null, now: at(WALLET_AUTH_LIMIT * 1000) });
    expect(verifyToo.status).toBe(429);
    // Another IP is unaffected.
    const ok = await walletAuthChallengeResponse(h.db, { address: acct.address, ...CH, ip: "10.0.0.10", now: at(WALLET_AUTH_LIMIT * 1000) });
    expect(ok.status).toBe(200);
  });
});