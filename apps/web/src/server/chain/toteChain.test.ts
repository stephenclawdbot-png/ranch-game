/**
 * The DORMANT real-money tote's server side: off by default, every entry point refuses while off
 * (without touching the database or a chain), the configuration it needs to switch on, BetPermit
 * signatures that recover to the permit key, the location allow-list, and the keeper against a
 * fake chain. No network: the RPC URL below is never contacted.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, recoverTypedDataAddress, toBytes, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createDb, createRace, getRace, getRealToteRace, lockField, recordRealToteEvent, resolveRealToteSeed, type Db, type DbHandle } from "@thoroughbred/db";
import * as gc from "@thoroughbred/game-core";
import { packPositions, readAttestorConfig, realToteAttestorRun, toteResultHash, type AttestorChain } from "./toteAttestor";
import {
  betPermitTypedData,
  evmToteChain,
  flagRaceForRealTote,
  prepareRealToteSeed,
  readRealToteConfig,
  RealToteGeoError,
  RealToteOffError,
  realToteBackstop,
  realToteOn,
  realToteTick,
  requestBetPermit,
  toteMarketKey,
  type ToteChainClient,
} from "./toteChain";
import { GET as boardGET } from "../../../app/api/races/[id]/tote/real/route";
import { POST as permitPOST } from "../../../app/api/races/[id]/tote/real/permit/route";

const operatorKey = generatePrivateKey();
const signerKey = generatePrivateKey();
const ON = {
  REAL_TOTE_ENABLED: "true",
  WEB3_ENABLED: "true",
  TOTE_POOLS_ADDRESS: "0x00000000000000000000000000000000000070e1",
  ROBINHOOD_RPC_URL: "http://127.0.0.1:9",
  CHAIN_ID: "46630",
  TOTE_OPERATOR_PRIVATE_KEY: operatorKey,
  TOTE_PERMIT_SIGNER_PRIVATE_KEY: signerKey,
  REAL_TOTE_ALLOWED_COUNTRIES: "GB, IE",
};

/** A database that fails the test if anything touches it. */
const untouchable = new Proxy({}, { get: () => { throw new Error("the database must not be touched while the real tote is off"); } }) as unknown as Db;

/** A chain that records calls and never talks to a network. */
function fakeChain(): ToteChainClient & { calls: string[] } {
  const calls: string[] = [];
  const rec = (name: string) => async () => {
    calls.push(name);
    return "0x01" as Hex;
  };
  return {
    calls,
    chainId: 46630,
    totePools: "0x00000000000000000000000000000000000070e1",
    signPermit: rec("signPermit"),
    createMarket: rec("createMarket"),
    lockEntropy: rec("lockEntropy"),
    sealEntropy: rec("sealEntropy"),
    postResult: rec("postResult"),
    finalize: rec("finalize"),
    cancelMarket: rec("cancelMarket"),
    expireMarket: rec("expireMarket"),
    runnerStakes: async () => [],
    nonceUsed: async () => false,
    logs: async () => ({ logs: [], toBlock: 0n }),
  };
}

let h: DbHandle;
beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

describe("real-money tote: off by default", () => {
  it("is off with no settings, and with any one of the three switches missing", () => {
    expect(realToteOn({})).toBe(false);
    expect(realToteOn({ ...ON, REAL_TOTE_ENABLED: "false" })).toBe(false);
    expect(realToteOn({ ...ON, WEB3_ENABLED: "" })).toBe(false);
    expect(realToteOn({ ...ON, TOTE_POOLS_ADDRESS: "" })).toBe(false);
    expect(realToteOn(ON)).toBe(true);
    expect(realToteOn()).toBe(false); // the test environment
  });

  it("every entry point refuses while off, touching neither the database nor a chain", async () => {
    const chain = fakeChain();
    const now = new Date();
    const deps = { env: {}, chain };
    await expect(requestBetPermit(untouchable, { accountId: "a" }, { raceId: "r", horseId: "h", pool: "win", amount: 1, wallet: "0x0", country: "GB", now }, deps)).rejects.toBeInstanceOf(RealToteOffError);
    await expect(flagRaceForRealTote(untouchable, "r", now, deps)).rejects.toBeInstanceOf(RealToteOffError);
    expect(await realToteBackstop(untouchable, now, deps)).toEqual({ skipped: "off", done: {}, errors: [], alerts: [] });
    expect(await realToteAttestorRun(untouchable, now, { env: {} })).toEqual({ skipped: "off", attested: [], mismatched: [], errors: [] });
    await prepareRealToteSeed(untouchable, "r", now, deps);
    await realToteTick(untouchable, "r", now, deps);
    expect(chain.calls).toEqual([]);
    const id = "6f1c1f9e-2d0c-4f43-9b4c-2b2f1d7e8a10";
    const board = await boardGET(new Request(`https://tb.example/api/races/${id}/tote/real`), { params: Promise.resolve({ id }) });
    expect(await board.json()).toEqual({ available: false });
    const permit = await permitPOST(new Request(`https://tb.example/api/races/${id}/tote/real/permit`, { method: "POST", body: "{}" }), { params: Promise.resolve({ id }) });
    expect(permit.status).toBe(503);
  });

  it("names what is missing to switch on, never echoing a key", () => {
    try {
      readRealToteConfig({ ...ON, TOTE_PERMIT_SIGNER_PRIVATE_KEY: operatorKey, REAL_TOTE_ALLOWED_COUNTRIES: "" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RealToteOffError);
      const m = (e as Error).message;
      expect(m).toMatch(/must differ from the operator key/);
      expect(m).toMatch(/REAL_TOTE_ALLOWED_COUNTRIES/);
      expect(m).not.toContain(operatorKey.slice(2));
    }
    expect(() => readRealToteConfig({ ...ON, TOTE_POOLS_ADDRESS: "nope" })).toThrow(/not an address/);
    expect(() => readRealToteConfig({ ...ON, CHAIN_ID: "4663" })).toThrow(/USDG_TOKEN_ADDRESS/); // mainnet needs the asset set explicitly
    const cfg = readRealToteConfig(ON);
    expect(cfg.allowedCountries).toEqual(["GB", "IE"]);
    expect(cfg.stakeAsset).toBe("0x7E955252E15c84f5768B83c41a71F9eba181802F"); // testnet USDG
  });
});

describe("real-money tote: switched on (fake chain, no network)", () => {
  it("market ids match the contract adapter's toteRaceKey", () => {
    const id = "6F1C1F9E-2D0C-4F43-9B4C-2B2F1D7E8A10";
    expect(toteMarketKey(id)).toBe(keccak256(toBytes(`posttime:race:${id.toLowerCase()}`)));
  });

  it("signs BetPermits with the permit key (EIP-712 bound to the chain and the contract)", async () => {
    const cfg = readRealToteConfig(ON);
    const chain = evmToteChain(cfg);
    const p = { bettor: privateKeyToAccount(generatePrivateKey()).address, raceId: toteMarketKey("x"), runner: 3, pool: 1, maxAmount: 5_000_000n, nonce: 7n, issuedAt: 1_899_999_850n, expiry: 1_900_000_000n };
    const sig = await chain.signPermit(p);
    const signer = await recoverTypedDataAddress({ ...betPermitTypedData(p, cfg.chainId, cfg.totePools), signature: sig });
    expect(signer).toBe(privateKeyToAccount(signerKey).address);
    expect(signer).not.toBe(privateKeyToAccount(operatorKey).address);
    const other = await recoverTypedDataAddress({ ...betPermitTypedData(p, 4663, cfg.totePools), signature: sig });
    expect(other).not.toBe(signer);
    // runner and pool are signed: the same signature doesn't cover another runner or pool
    expect(await recoverTypedDataAddress({ ...betPermitTypedData({ ...p, runner: 0 }, cfg.chainId, cfg.totePools), signature: sig })).not.toBe(signer);
    expect(await recoverTypedDataAddress({ ...betPermitTypedData({ ...p, pool: 0 }, cfg.chainId, cfg.totePools), signature: sig })).not.toBe(signer);
  });

  it("refuses a bettor outside the location allow-list before any check or signature", async () => {
    const chain = fakeChain();
    const input = { raceId: "r", horseId: "h", pool: "win" as const, amount: 1_000_000, wallet: "0x0000000000000000000000000000000000000001", now: new Date() };
    await expect(requestBetPermit(untouchable, { accountId: "a" }, { ...input, country: "US" }, { env: ON, chain })).rejects.toBeInstanceOf(RealToteGeoError);
    await expect(requestBetPermit(untouchable, { accountId: "a" }, { ...input, country: null }, { env: ON, chain })).rejects.toBeInstanceOf(RealToteGeoError);
    expect(chain.calls).toEqual([]);
  });

  it("flags a race (earlier field lock) and the keeper does nothing chain-side until its field locks", async () => {
    const chain = fakeChain();
    const now = new Date(Date.UTC(2030, 0, 1, 12));
    const race = await createRace(h.db, {
      kind: "scheduled",
      name: "Real tote web",
      raceClass: "handicap",
      conditions: { minRating: 0, maxRating: 140, distanceM: 1400, surface: "turf" },
      postTime: new Date(now.getTime() + 30 * 60_000),
      entriesCloseAt: new Date(now.getTime() + 29 * 60_000),
    });
    const rt = await flagRaceForRealTote(h.db, race.id, now, { env: ON, chain });
    expect(rt.marketKey).toBe(toteMarketKey(race.id));
    const row = await getRace(h.db, race.id);
    expect(row!.entriesCloseAt).toEqual(new Date(now.getTime() + 15 * 60_000));
    const report = await realToteBackstop(h.db, now, { env: ON, chain });
    expect(report.errors).toEqual([]);
    expect(chain.calls).toEqual([]); // pending until the field locks: no market yet
    await realToteTick(h.db, race.id, now, { env: ON, chain });
    expect(chain.calls).toEqual([]);
    expect((await getRealToteRace(h.db, race.id))!.status).toBe("pending");
  });
});

const attestorKey = generatePrivateKey();
const ATTEST = { ...ON, TOTE_ATTESTOR_PRIVATE_KEY: attestorKey };

/** A flagged race with a locked field, its market open on the (fake) chain. */
async function flaggedOpenRace(now: Date, runners = 5) {
  const race = await createRace(h.db, {
    kind: "scheduled",
    name: `Real tote keeper ${Math.random()}`,
    raceClass: "handicap",
    conditions: { minRating: 0, maxRating: 140, distanceM: 1400, surface: "turf" },
    postTime: new Date(now.getTime() + 30 * 60_000),
    entriesCloseAt: new Date(now.getTime() + 29 * 60_000),
    targetRunners: runners,
  });
  await flagRaceForRealTote(h.db, race.id, now, { env: ON, chain: fakeChain() });
  await lockField(h.db, race.id, new Date(now.getTime() + 15 * 60_000));
  let tx = Math.floor(Math.random() * 1e9);
  const ev = (kind: Parameters<typeof recordRealToteEvent>[1]["kind"], data: Record<string, unknown> = {}) => ({ raceId: race.id, kind, txHash: `0x${(++tx).toString(16).padStart(64, "0")}`, logIndex: 0, blockNumber: tx, data });
  await recordRealToteEvent(h.db, ev("MarketCreated"), now);
  return { race, ev };
}

describe("real-money tote: keeper hardening (fake chain, no network)", () => {
  it("M1: an abandoned market after its entropy block is never cancelled by the operator: the guardian is alerted, then it expires", async () => {
    const now = new Date(Date.UTC(2030, 1, 1, 12));
    const { race, ev } = await flaggedOpenRace(now);
    await recordRealToteEvent(h.db, ev("EntropyLocked", { entropyBlock: "77" }), now);
    // the race ran without sealed entropy: its market is abandoned
    expect((await resolveRealToteSeed(h.db, { id: race.id, seed: "00".repeat(32) }, new Date(now.getTime() + 30 * 60_000)))!.mode).toBe("server");
    expect((await getRealToteRace(h.db, race.id))!.status).toBe("abandoned");
    const chain = fakeChain();
    const off = new Date(now.getTime() + 31 * 60_000);
    const report = await realToteBackstop(h.db, off, { env: ON, chain });
    expect(chain.calls).not.toContain("cancelMarket");
    expect(report.alerts).toContainEqual({ raceId: race.id, kind: "abandoned_after_entropy" });
    const later = new Date(now.getTime() + 29 * 60_000 + gc.REAL_TOTE_MAX_SETTLE_DELAY_MS + 60_000);
    await realToteBackstop(h.db, later, { env: ON, chain });
    expect(chain.calls).toContain("expireMarket");
  });

  it("M3: a step that keeps failing backs off and is parked with an alert; other markets carry on", async () => {
    const now = new Date(Date.UTC(2030, 2, 1, 12));
    const bad = await flaggedOpenRace(now);
    const good = await flaggedOpenRace(now);
    const calls: string[] = [];
    const chain: ToteChainClient = {
      ...fakeChain(),
      lockEntropy: async (k) => {
        calls.push(k);
        if (k === toteMarketKey(bad.race.id)) throw new Error("execution reverted");
        return "0x01";
      },
    };
    let t = new Date(now.getTime() + 29 * 60_000);
    let parked = false;
    for (let i = 0; i < gc.REAL_TOTE_KEEPER_MAX_ATTEMPTS; i++) {
      const r = await realToteBackstop(h.db, t, { env: ON, chain });
      parked ||= r.alerts.some((a) => a.raceId === bad.race.id && a.kind === "keeper_parked");
      t = new Date(t.getTime() + gc.realToteKeeperBackoffMs(i + 1) + 1);
    }
    expect(parked).toBe(true);
    expect(calls).toContain(toteMarketKey(good.race.id));
    expect((await getRealToteRace(h.db, bad.race.id))!.parkedAt).not.toBe(null);
    const before = calls.length;
    await realToteBackstop(h.db, new Date(t.getTime() + 3_600_000), { env: ON, chain });
    expect(calls.slice(before)).not.toContain(toteMarketKey(bad.race.id));
  });
});

describe("real-money tote: the independent result attestor", () => {
  it("needs its own key (never the operator's or the permit signer's)", () => {
    expect(() => readAttestorConfig(ON)).toThrow(/TOTE_ATTESTOR_PRIVATE_KEY/);
    expect(() => readAttestorConfig({ ...ON, TOTE_ATTESTOR_PRIVATE_KEY: operatorKey })).toThrow(/must differ/);
    expect(() => readAttestorConfig({ ...ON, TOTE_ATTESTOR_PRIVATE_KEY: signerKey })).toThrow(/must differ/);
    expect(readAttestorConfig({ ...ATTEST, TOTE_ATTESTOR_RPC_URL: "http://127.0.0.1:8" }).rpcUrl).toBe("http://127.0.0.1:8");
  });

  it("hashes results exactly like TotePools.resultHashOf (abi.encode of three bytes32)", () => {
    const k = toteMarketKey("abc");
    const fs = `0x${"12".repeat(32)}` as Hex;
    const pos = packPositions([2, 1, 0, 3]);
    expect(pos).toBe(`0x${"0".repeat(56)}03000102`);
    expect(toteResultHash(k, fs, pos)).toBe(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }], [k, fs, pos])));
  });

  it("replays from the chain's finalSeed: a match is attested; a forged result is attested with the replay's hash (freezing it) and alerted", async () => {
    const now = new Date(Date.UTC(2030, 3, 1, 12));
    const finalSeed = `0x${"ab".repeat(32)}` as Hex;
    const replayed = [2, 1, 3, 0, 4];
    const make = async (posted: number[]) => {
      const { race, ev } = await flaggedOpenRace(now);
      await recordRealToteEvent(h.db, ev("ResultPosted", { resultHash: toteResultHash(toteMarketKey(race.id), finalSeed, packPositions(posted)), challengeEnd: String(Math.floor(now.getTime() / 1000) + 3600) }), now);
      return race.id;
    };
    const honest = await make(replayed);
    const forged = await make([1, 2, 3, 4, 5]);
    const posted = new Map([[toteMarketKey(honest), replayed], [toteMarketKey(forged), [1, 2, 3, 4, 5]]]);
    const attested: [Hex, Hex][] = [];
    const seeds: string[] = [];
    const chain: AttestorChain = {
      getMarket: async (k) => ({ status: 2, finalSeed, positions: packPositions(posted.get(k) ?? []), runnerCount: 5 }),
      attestResult: async (k, hash) => {
        attested.push([k, hash]);
        return "0x01";
      },
    };
    const report = await realToteAttestorRun(h.db, now, {
      env: ATTEST,
      chain,
      replay: async (_db, _id, seed) => {
        seeds.push(seed);
        return replayed;
      },
    });
    expect(seeds.every((x) => x === "ab".repeat(32))).toBe(true); // the chain's finalSeed, not the database
    expect(report.attested).toContain(honest);
    expect(report.mismatched).toContain(forged);
    const replayHash = (id: string) => toteResultHash(toteMarketKey(id), finalSeed, packPositions(replayed));
    expect(attested).toContainEqual([toteMarketKey(honest), replayHash(honest)]);
    expect(attested).toContainEqual([toteMarketKey(forged), replayHash(forged)]);
    expect((await getRealToteRace(h.db, forged))!.guardianRequestAt).not.toBe(null);
  });
});
