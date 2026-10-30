/**
 * Wallet sign-in at the HTTP layer (src/server/walletAuth.ts, driven by
 * /api/auth/wallet/challenge + /verify): the login-purpose SIWE message, the signin/link
 * intent matrix (same-account keeps the cookie, replace required for ANY stable, unknown
 * wallet never auto-linked, link-to-current only), every signature failure, the SIWE
 * domain allowlist, the per-IP limit, atomic founding (one stable per wallet, no invite
 * seat leak) and the stable-switch audit row. Signature storage and challenge single-use
 * live in packages/db's tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex, PrivateKeyAccount } from "viem";
import {
  accountForWallet,
  authenticate,
  createAccount,
  createDb,
  createWalletChallenge,
  generateInviteCodes,
  hashToken,
  linkVerifiedWallet,
  listDevices,
  loginWalletOf,
  schema,
  stableOf,
  type DbHandle,
} from "@thoroughbred/db";
import { createStoryRace } from "./game";
import { LOGIN_STATEMENT, siweAddress, siweMessage } from "./chain/wallet";
import { resetWalletAuthLimit, WALLET_AUTH_LIMIT, walletAuthChallengeResponse, walletAuthVerifyResponse } from "./walletAuth";
import type { Session } from "./session";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 3, 12, 0, 0));
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

const SILKS = { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" };
/** beta.example is the one host on this test's allowlist. */
const CH = { host: "beta.example", proto: "https", env: { APP_HOSTS: "beta.example" } as Record<string, string | undefined> };

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

/** A signed challenge for `acct`'s wallet, ready to verify. */
async function signedChallenge(acct: PrivateKeyAccount, ip: string, now = T0): Promise<{ nonce: string; signature: Hex }> {
  const ch = await body(await walletAuthChallengeResponse(h.db, { address: acct.address, ...CH, ip, now }));
  const { nonce, message } = ch as { nonce: string; message: string };
  return { nonce, signature: (await acct.signMessage({ message })) as Hex };
}

/** One full sign-in attempt for `acct`'s wallet (challenge -> wallet signature -> verify). */
async function signIn(acct: PrivateKeyAccount, opts: { ip?: string; session?: Session | null; now?: Date; extra?: Record<string, unknown> } = {}) {
  const ip = opts.ip ?? "9.9.9.9";
  const { nonce, signature } = await signedChallenge(acct, ip, opts.now ?? T0);
  return walletAuthVerifyResponse(h.db, { body: { nonce, signature, ...opts.extra }, ip, session: opts.session ?? null, now: opts.now ?? T0, env: CH.env });
}

/** Every audit row with the given action (the switch trail; small log, filter in JS). */
async function auditRows(action: string) {
  return (await h.db.select().from(schema.auditLog)).filter((r) => r.action === action);
}

describe("the login SIWE message", () => {
  const base = { domain: "beta.example", uri: "https://beta.example", address: "0x1234567890123456789012345678901234567890" as Address, chainId: 4663, nonce: "abc123def456", issuedAt: T0, expiresAt: at(10 * MIN) };

  it("states sign-in, not linking, and names the address", () => {
    const login = siweMessage({ ...base, statement: LOGIN_STATEMENT });
    expect(login).toContain("Sign in to Post Time with this wallet. Signing is free and sends no transaction.");
    expect(siweAddress(login)).toBe(base.address);
  });
});

describe("POST /api/auth/wallet/verify, intent signin (wallet belongs to a stable)", () => {
  it("signs the device in: cookie set, device row created, stable name returned", async () => {
    const home = await player("Wallet Home Stable");
    const acct = privateKeyToAccount(generatePrivateKey());
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

  it("answers { alreadySignedIn } when the wallet belongs to this browser's account: no new session, cookie untouched", async () => {
    const home = await player("Already Here Stable");
    const acct = privateKeyToAccount(generatePrivateKey());
    await linkVerifiedWallet(h.db, { accountId: home.accountId, address: acct.address, stableName: "Already Here Stable", now: T0 });

    const res = await signIn(acct, { ip: "10.0.0.12", session: home });
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ alreadySignedIn: true });
    expect(res.cookies.get("tb_session")).toBeUndefined();
    expect((await listDevices(h.db, home.accountId, hashToken(home.token))).devices).toHaveLength(0);
  });

  it("requires { replace: true } whenever this browser has ANY stable, progress or not, and writes an account.switch audit row", async () => {
    const home = await player("Established Wallet Stable");
    await createStoryRace(h.db, home, { instant: true }, new Date()); // the browser's stable is in play
    const away = await player("Other Wallet Stable");
    const acct = privateKeyToAccount(generatePrivateKey());
    await linkVerifiedWallet(h.db, { accountId: away.accountId, address: acct.address, stableName: "Other Wallet Stable", now: T0 });

    const refused = await signIn(acct, { ip: "10.0.0.3", session: home });
    expect(refused.status).toBe(409);
    expect(await body(refused)).toMatchObject({ error: "replace_required", currentStable: "Established Wallet Stable" });
    const replaced = await signIn(acct, { ip: "10.0.0.3", session: home, extra: { replace: true } });
    expect(replaced.status).toBe(200);
    const cookie = replaced.cookies.get("tb_session")!;
    expect(await authenticate(h.db, cookie.value)).toMatchObject({ accountId: away.accountId });
    const switches = await auditRows("account.switch");
    expect(switches.at(-1)).toMatchObject({ data: { from: home.accountId, to: away.accountId } });

    // A browser whose stable is still fresh (no races, nothing bought) also confirms.
    const fresh = await player("Fresh Starter Stable");
    const refusedFresh = await signIn(acct, { ip: "10.0.0.13", session: fresh });
    expect(refusedFresh.status).toBe(409);
    expect(await body(refusedFresh)).toMatchObject({ error: "replace_required" });
    const replacedFresh = await signIn(acct, { ip: "10.0.0.13", session: fresh, extra: { replace: true } });
    expect(replacedFresh.status).toBe(200);
    expect((await auditRows("account.switch")).at(-1)).toMatchObject({ data: { from: fresh.accountId, to: away.accountId } });
  });

  it("rejects a wrong signer, an expired challenge, a replay and a mismatched address", async () => {
    const home = await player("Careful Wallet Stable");
    const acct = privateKeyToAccount(generatePrivateKey());
    await linkVerifiedWallet(h.db, { accountId: home.accountId, address: acct.address, stableName: "Careful Wallet Stable", now: T0 });
    const other = privateKeyToAccount(generatePrivateKey());

    // Wrong signer: someone else's signature for the stored message.
    const ch1 = (await body(await walletAuthChallengeResponse(h.db, { address: acct.address, ...CH, ip: "10.0.0.2", now: T0 }))) as { nonce: string; message: string };
    const bad = await other.signMessage({ message: ch1.message });
    await expect(walletAuthVerifyResponse(h.db, { body: { nonce: ch1.nonce, signature: bad }, ip: "10.0.0.2", session: null, now: T0, env: CH.env })).rejects.toThrow(/doesn't match that wallet/);
    // The failed attempt consumed the nonce: a replay with the right key still fails.
    const good = await acct.signMessage({ message: ch1.message });
    await expect(walletAuthVerifyResponse(h.db, { body: { nonce: ch1.nonce, signature: good }, ip: "10.0.0.2", session: null, now: T0, env: CH.env })).rejects.toThrow(
      /already used|expired/,
    );

    // Expired: a 10-minute challenge is refused at 11 minutes.
    const ch2 = (await body(await walletAuthChallengeResponse(h.db, { address: acct.address, ...CH, ip: "10.0.0.2", now: T0 }))) as { nonce: string; message: string };
    const sig2 = await acct.signMessage({ message: ch2.message });
    await expect(walletAuthVerifyResponse(h.db, { body: { nonce: ch2.nonce, signature: sig2 }, ip: "10.0.0.2", session: null, now: at(11 * MIN), env: CH.env })).rejects.toThrow(/expired/);

    // Address mismatch: a message for another address can't be signed in as this wallet.
    const ch3 = (await body(await walletAuthChallengeResponse(h.db, { address: other.address, ...CH, ip: "10.0.0.2", now: T0 }))) as { nonce: string; message: string };
    const sig3 = await acct.signMessage({ message: ch3.message }); // signs a message naming `other`
    await expect(walletAuthVerifyResponse(h.db, { body: { nonce: ch3.nonce, signature: sig3 }, ip: "10.0.0.2", session: null, now: T0, env: CH.env })).rejects.toThrow(/doesn't match that wallet/);
  });
});

describe("POST /api/auth/wallet/verify, intent signin (wallet unknown)", () => {
  it("never auto-links: answers { needsStable, canLinkCurrent }, and intent link then links it to the current stable", async () => {
    const home = await player("Link Here Stable");
    const acct = privateKeyToAccount(generatePrivateKey());
    const res = await signIn(acct, { ip: "10.0.0.4", session: home });
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ needsStable: true, canLinkCurrent: true, currentStable: "Link Here Stable" });
    expect(await loginWalletOf(h.db, home.accountId)).toBeNull(); // not linked behind the player's back
    expect(res.cookies.get("tb_session")).toBeUndefined();

    // The explicit retry with intent "link" (the /me-style button): links, no session, no cookie.
    const link = await signIn(acct, { ip: "10.0.0.4", session: home, extra: { intent: "link" } });
    expect(link.status).toBe(200);
    expect((await body(link)).address).toBe(acct.address);
    expect(link.cookies.get("tb_session")).toBeUndefined();
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
    const data = (await body(created)) as { created: boolean; stableName: string };
    expect(data.created).toBe(true);
    expect(data.stableName).toBe("Wallet Found Stable");
    const cookie = created.cookies.get("tb_session")!;
    const session = await authenticate(h.db, cookie.value);
    expect(await loginWalletOf(h.db, session!.accountId)).toBe(acct.address);
    // And the next device signs in with the same wallet.
    const again = await signIn(acct, { ip: "10.0.0.7" });
    expect((await body(again)).stableName).toBe("Wallet Found Stable");
  });

  it("founding from a browser that has a stable needs the same replace confirmation, then audits the switch", async () => {
    const home = await player("Wallet Found From Stable");
    const acct = privateKeyToAccount(generatePrivateKey());
    const refused = await signIn(acct, { ip: "10.0.0.14", session: home, extra: { create: true, stableName: "Wallet Founded Second", silks: SILKS } });
    expect(refused.status).toBe(409);
    expect((await body(refused)).error).toBe("replace_required");
    const created = await signIn(acct, { ip: "10.0.0.14", session: home, extra: { create: true, replace: true, stableName: "Wallet Founded Second", silks: SILKS } });
    expect(created.status).toBe(201);
    expect((await body(created)).created).toBe(true);
    expect((await auditRows("account.switch")).at(-1)).toMatchObject({ data: { from: home.accountId } });
  });

  it("refuses to create without a valid stable name", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    await expect(signIn(acct, { ip: "10.0.0.8", extra: { create: true, stableName: "x", silks: SILKS } })).rejects.toThrow(/Check the stable name/);
  });
});

describe("POST /api/auth/wallet/verify, intent link (the /me button)", () => {
  it("needs a session and only ever links to the CURRENT stable", async () => {
    const home = await player("Link Mine Stable");
    const away = await player("Link Theirs Stable");
    const acct = privateKeyToAccount(generatePrivateKey());
    await linkVerifiedWallet(h.db, { accountId: away.accountId, address: acct.address, stableName: "Link Theirs Stable", now: T0 });

    // No session: nothing to link to.
    const noSession = await signIn(acct, { ip: "10.0.0.15", extra: { intent: "link" } });
    expect(noSession.status).toBe(403);
    expect((await body(noSession)).error).toBe("signin_required");

    // The wallet signs in to another stable: refused, and never switched to.
    const inUse = await signIn(acct, { ip: "10.0.0.15", session: home, extra: { intent: "link" } });
    expect(inUse.status).toBe(409);
    expect(await body(inUse)).toMatchObject({ error: "wallet_in_use", message: "That wallet already signs in to another stable." });
    expect(inUse.cookies.get("tb_session")).toBeUndefined();
    expect(await loginWalletOf(h.db, home.accountId)).toBeNull();

    // The wallet already on this account: { linked: true } again, with no session or cookie change.
    const mine = privateKeyToAccount(generatePrivateKey());
    await linkVerifiedWallet(h.db, { accountId: home.accountId, address: mine.address, stableName: "Link Mine Stable", now: T0 });
    const again = await signIn(mine, { ip: "10.0.0.15", session: home, extra: { intent: "link" } });
    expect(again.status).toBe(200);
    expect(await body(again)).toEqual({ linked: true, address: mine.address });
    expect(again.cookies.get("tb_session")).toBeUndefined();
    expect((await listDevices(h.db, home.accountId, hashToken(home.token))).devices).toHaveLength(0);
  });
});

describe("SIWE domain allowlist (APP_HOSTS + Vercel URLs; localhost outside production)", () => {
  it("refuses to issue a challenge for a host that isn't allowed", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    await expect(
      walletAuthChallengeResponse(h.db, { address: acct.address, host: "evil.example", proto: "https", ip: "10.0.0.30", now: T0, env: { APP_HOSTS: "beta.example" } }),
    ).rejects.toThrow(/can't issue/);
    await expect(
      walletAuthChallengeResponse(h.db, { address: acct.address, host: "localhost:3000", proto: "http", ip: "10.0.0.30", now: T0, env: { NODE_ENV: "production" } }),
    ).rejects.toThrow(/can't issue/);
    // Allowed: an APP_HOSTS entry (comma list, any casing) and localhost outside production.
    expect((await walletAuthChallengeResponse(h.db, { address: acct.address, host: "beta.example", proto: "https", ip: "10.0.0.30", now: T0, env: { APP_HOSTS: "other.example, BETA.example" } })).status).toBe(200);
    expect((await walletAuthChallengeResponse(h.db, { address: acct.address, host: "localhost:5173", proto: "http", ip: "10.0.0.30", now: T0, env: { VERCEL_URL: "preview.example" } })).status).toBe(200);
    expect((await walletAuthChallengeResponse(h.db, { address: acct.address, host: "preview.example", proto: "https", ip: "10.0.0.30", now: T0, env: { VERCEL_BRANCH_URL: "preview.example" } })).status).toBe(200);
  });

  it("refuses to verify a message signed for a foreign domain, or a foreign URI", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const foreign = siweMessage({ domain: "evil.example", uri: "https://evil.example", address: acct.address, chainId: 4663, nonce: "foreign12345", issuedAt: T0, expiresAt: at(10 * MIN), statement: LOGIN_STATEMENT });
    await createWalletChallenge(h.db, { accountId: null, nonce: "foreign12345", message: foreign, expiresAt: at(10 * MIN), purpose: "login" });
    const sigForeign = await acct.signMessage({ message: foreign });
    await expect(
      walletAuthVerifyResponse(h.db, { body: { nonce: "foreign12345", signature: sigForeign }, ip: "10.0.0.31", session: null, now: T0, env: CH.env }),
    ).rejects.toThrow(/another site/);

    // Allowed domain, foreign URI: still refused.
    const mixed = siweMessage({ domain: "beta.example", uri: "https://evil.example", address: acct.address, chainId: 4663, nonce: "mixeduri12345", issuedAt: T0, expiresAt: at(10 * MIN), statement: LOGIN_STATEMENT });
    await createWalletChallenge(h.db, { accountId: null, nonce: "mixeduri12345", message: mixed, expiresAt: at(10 * MIN), purpose: "login" });
    const sigMixed = await acct.signMessage({ message: mixed });
    await expect(
      walletAuthVerifyResponse(h.db, { body: { nonce: "mixeduri12345", signature: sigMixed }, ip: "10.0.0.31", session: null, now: T0, env: CH.env }),
    ).rejects.toThrow(/another site/);
  });
});

describe("atomic founding (one stable per wallet, no invite seat leak)", () => {
  it("two concurrent creates for the same wallet get ONE stable; the loser is refused under the lock", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const [c1, c2] = await Promise.all([signedChallenge(acct, "10.0.0.20"), signedChallenge(acct, "10.0.0.21")]);
    const results = await Promise.allSettled([
      walletAuthVerifyResponse(h.db, { body: { nonce: c1.nonce, signature: c1.signature, create: true, stableName: "Race Winner", silks: SILKS }, ip: "10.0.0.20", session: null, now: T0, env: CH.env }),
      walletAuthVerifyResponse(h.db, { body: { nonce: c2.nonce, signature: c2.signature, create: true, stableName: "Race Loser", silks: SILKS }, ip: "10.0.0.21", session: null, now: T0, env: CH.env }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Response>[];
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const answered = await Promise.all(ok.map((r) => body(r.value)));
    expect(answered.filter((b) => b.created === true).length).toBeLessThanOrEqual(1); // never two stables
    // The wallet points at exactly one stable.
    expect(await accountForWallet(h.db, acct.address)).toBeTypeOf("string");
    const owner = (await accountForWallet(h.db, acct.address))!;
    const names = (await h.db.select().from(schema.stables)).filter((s) => s.accountId === owner).map((s) => s.name);
    expect(names).toEqual(["Race Winner"]);
    for (const b of answered) expect(b.stableName).toBe("Race Winner");
    if (failed.length) {
      // The loser found the winner's stable under the lock — never a second one.
      expect(String(failed[0]!.reason)).toMatch(/just founded|already linked/);
    }
  });

  it("consumes the invite seat exactly once when two creates race (playtest)", async () => {
    process.env.PLAYTEST_MODE = "1";
    try {
      const [code] = await generateInviteCodes(h.db, { count: 1, maxUses: 1, note: "wallet create race" });
      const acct = privateKeyToAccount(generatePrivateKey());
      const [c1, c2] = await Promise.all([signedChallenge(acct, "10.0.0.22"), signedChallenge(acct, "10.0.0.23")]);
      const attempt = (c: { nonce: string; signature: Hex }, ip: string) =>
        walletAuthVerifyResponse(h.db, { body: { nonce: c.nonce, signature: c.signature, create: true, stableName: "Seat Race", silks: SILKS, inviteCode: code }, ip, session: null, now: T0, env: CH.env });
      await Promise.allSettled([attempt(c1, "10.0.0.22"), attempt(c2, "10.0.0.23")]);
      const used = (await h.db.select().from(schema.inviteCodes)).find((c) => c.code === code)!;
      expect(used.uses).toBe(1); // the seat was taken once, never twice
      expect((await h.db.select().from(schema.stables)).filter((s) => s.name === "Seat Race")).toHaveLength(1);
    } finally {
      delete process.env.PLAYTEST_MODE;
    }
  });

  it("needs an invite code in the playtest before anything is consumed", async () => {
    process.env.PLAYTEST_MODE = "1";
    try {
      const acct = privateKeyToAccount(generatePrivateKey());
      await expect(signIn(acct, { ip: "10.0.0.24", extra: { create: true, stableName: "No Invite Stable", silks: SILKS } })).rejects.toThrow(/invite only/);
    } finally {
      delete process.env.PLAYTEST_MODE;
    }
  });
});

describe("no IP-as-device signals", () => {
  it("nothing in the wallet flows records a device-kind signal (NAT-sharing testers aren't linked)", async () => {
    const deviceSignals = (await h.db.select().from(schema.accountLinks)).filter((r) => r.kind === "device");
    expect(deviceSignals).toHaveLength(0);
  });
});

describe("the per-IP limit", () => {
  it("answers 429 past 30 requests (challenges + verifies) from one IP within the hour", async () => {
    await resetWalletAuthLimit(h.db);
    const acct = privateKeyToAccount(generatePrivateKey());
    for (let i = 0; i < WALLET_AUTH_LIMIT; i++) {
      const res = await walletAuthChallengeResponse(h.db, { address: acct.address, ...CH, ip: "10.0.0.9", now: at(i * 1000) });
      expect(res.status).toBe(200);
    }
    const throttled = await walletAuthChallengeResponse(h.db, { address: acct.address, ...CH, ip: "10.0.0.9", now: at(WALLET_AUTH_LIMIT * 1000) });
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Retry-After")).toBe("3600");
    const verifyToo = await walletAuthVerifyResponse(h.db, { body: { nonce: "aaaaaaaa", signature: "0x00" }, ip: "10.0.0.9", session: null, now: at(WALLET_AUTH_LIMIT * 1000), env: CH.env });
    expect(verifyToo.status).toBe(429);
    // Another IP is unaffected.
    const ok = await walletAuthChallengeResponse(h.db, { address: acct.address, ...CH, ip: "10.0.0.10", now: at(WALLET_AUTH_LIMIT * 1000) });
    expect(ok.status).toBe(200);
  });
});