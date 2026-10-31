import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { commitSeed, mixSeedEntropy } from "../crypto";
import { gc } from "../gameCore";
import { accounts, auditLog, fraudEvents, races, realTotePermits, realToteRaces } from "../schema";
import { recordAccountSignal } from "../services/accounts";
import { createRace, enterRace, getRaceForSimulation, listRaceEntries, lockField, settleRace, type CreateRaceInput } from "../services/races";
import {
  closeUnopenedRealToteRace,
  enableRealToteForRace,
  getRealToteRace,
  issueRealTotePermit,
  lapseRealTotePermits,
  raiseRealToteAlert,
  realToteAttestWork,
  realToteUnsettledPermits,
  recordRealToteKeeperOutcome,
  setRealToteSyncedBlock,
  unparkRealToteRace,
  realToteBoard,
  realToteDueWork,
  realToteEnabled,
  realToteMarketParams,
  realToteResultFor,
  realToteSeedMatches,
  recordRealToteEvent,
  resolveRealToteSeed,
  type RealToteChainEvent,
} from "../services/realTote";
import { confirmToteAdult, selfExcludeTote } from "../services/tote";
import { at, makeHorse, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const ON = { REAL_TOTE_ENABLED: "true", WEB3_ENABLED: "true", TOTE_POOLS_ADDRESS: "0x00000000000000000000000000000000000000aa" };
const U = gc.REAL_TOTE_UNIT;
let n = 0;
let tx = 0;
const key = () => `0x${(++n).toString(16).padStart(64, "0")}`;

function liveRace(extra: Partial<CreateRaceInput> = {}) {
  return createRace(h.db, {
    kind: "scheduled",
    name: `Real tote ${++n}`,
    raceClass: "handicap",
    conditions: { minRating: 0, maxRating: 140, distanceM: 1400, surface: "turf" },
    postTime: at(30 * MIN),
    entriesCloseAt: at(29 * MIN),
    purse: 3_000,
    maxRunners: 12,
    targetRunners: 6,
    ...extra,
  });
}

async function flaggedRace(runners = 6) {
  const race = await liveRace({ targetRunners: runners });
  const rt = await enableRealToteForRace(h.db, { raceId: race.id, marketKey: key(), now: T0, env: ON });
  const owners = [];
  for (let i = 0; i < runners; i++) {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { rating: 30 });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "stalker", now: T0 });
    owners.push({ ...p, horseId: horse.id });
  }
  return { race, rt, owners };
}

const WALLET = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;
let w = 1000;

async function bettor() {
  const p = await newPlayer(h.db);
  const wallet = WALLET(++w);
  await h.db.update(accounts).set({ walletAddress: wallet }).where(eq(accounts.id, p.accountId));
  await confirmToteAdult(h.db, { accountId: p.accountId, now: T0 });
  return { ...p, wallet };
}

function ev(raceId: string, kind: RealToteChainEvent["kind"], data: Record<string, unknown> = {}): RealToteChainEvent {
  return { raceId, kind, txHash: `0x${(++tx).toString(16).padStart(64, "0")}`, logIndex: 0, blockNumber: 100 + tx, data };
}

async function openMarket(raceId: string) {
  await lockField(h.db, raceId, at(15 * MIN));
  await recordRealToteEvent(h.db, ev(raceId, "MarketCreated"), at(15 * MIN));
}

function permit(b: { accountId: string; wallet: string }, raceId: string, horseId: string, amount: number, now = at(16 * MIN), pool: "win" | "place" = "win") {
  return issueRealTotePermit(h.db, { accountId: b.accountId, raceId, horseId, pool, amount, wallet: b.wallet, now, env: ON });
}

describe("real-USDG tote (dormant scaffold)", () => {
  it("refuses everything while switched off", async () => {
    expect(realToteEnabled({})).toBe(false);
    expect(realToteEnabled({ REAL_TOTE_ENABLED: "true", WEB3_ENABLED: "true" })).toBe(false);
    const race = await liveRace();
    await expect(enableRealToteForRace(h.db, { raceId: race.id, marketKey: key(), now: T0, env: {} })).rejects.toMatchObject({ code: "TOTE_UNAVAILABLE" });
    await expect(enableRealToteForRace(h.db, { raceId: race.id, marketKey: key(), now: T0, env: { ...ON, TOTE_POOLS_ADDRESS: "" } })).rejects.toMatchObject({ code: "TOTE_UNAVAILABLE" });
    const b = await bettor();
    await expect(issueRealTotePermit(h.db, { accountId: b.accountId, raceId: race.id, horseId: race.id, pool: "win", amount: U, wallet: b.wallet, now: T0, env: { ...ON, WEB3_ENABLED: "false" } })).rejects.toMatchObject({ code: "TOTE_UNAVAILABLE" });
    const [row] = await h.db.select().from(races).where(eq(races.id, race.id));
    expect(row!.entriesCloseAt).toEqual(at(29 * MIN)); // unchanged
    expect(await getRealToteRace(h.db, race.id)).toBe(null);
  });

  it("flags a race: the field locks REAL_TOTE_FIELD_LOCK_MS before the off; unflagged races are untouched", async () => {
    const plain = await liveRace();
    const { race, rt } = await flaggedRace(5);
    expect(rt.fieldLockAt).toEqual(at(30 * MIN - gc.REAL_TOTE_FIELD_LOCK_MS));
    expect(rt.marketCloseAt).toEqual(at(29 * MIN));
    expect(rt.betsCloseAt).toEqual(at(28 * MIN));
    const [row] = await h.db.select().from(races).where(eq(races.id, race.id));
    expect(row!.entriesCloseAt).toEqual(at(15 * MIN));
    const [other] = await h.db.select().from(races).where(eq(races.id, plain.id));
    expect(other!.entriesCloseAt).toEqual(at(29 * MIN));
    // idempotent
    expect((await enableRealToteForRace(h.db, { raceId: race.id, marketKey: key(), now: T0, env: ON })).marketKey).toBe(rt.marketKey);
    await expect(lockField(h.db, race.id, at(14 * MIN))).rejects.toMatchObject({ code: "TOO_EARLY" });
    expect(await lockField(h.db, race.id, at(15 * MIN))).not.toBe(null);
    await expect(enableRealToteForRace(h.db, { raceId: plain.id, marketKey: key(), now: at(16 * MIN), env: ON })).rejects.toMatchObject({ code: "RACE_CLOSED" });
    const story = await liveRace({ kind: "quick" });
    await expect(enableRealToteForRace(h.db, { raceId: story.id, marketKey: key(), now: T0, env: ON })).rejects.toMatchObject({ code: "TOTE_UNAVAILABLE" });
    await expect(enableRealToteForRace(h.db, { raceId: story.id, marketKey: "0x12", now: T0, env: ON })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("market params carry the race's seed commitment, the locked field size and the place terms", async () => {
    const { race } = await flaggedRace(8);
    await expect(realToteMarketParams(h.db, race.id)).rejects.toMatchObject({ code: "TOO_EARLY" });
    await lockField(h.db, race.id, at(15 * MIN));
    const p = await realToteMarketParams(h.db, race.id);
    const [row] = await h.db.select().from(races).where(eq(races.id, race.id));
    expect(p.seedCommitment).toBe(row!.seedCommitment);
    expect(realToteSeedMatches(row!.seed, p.seedCommitment)).toBe(true);
    expect(p).toMatchObject({ runnerCount: 8, placeTerms: 3, takeoutBps: 1_500, closeTime: Math.floor(at(29 * MIN).getTime() / 1000) });
  });

  it("permits run the tote's checks plus the real-money ones", async () => {
    const { race, owners } = await flaggedRace(6);
    const horse = owners[0]!.horseId;
    const b = await bettor();
    await expect(permit(b, race.id, horse, U)).rejects.toMatchObject({ code: "TOTE_UNAVAILABLE" }); // market not on chain yet
    await openMarket(race.id);
    // the wallet must be the account's linked wallet
    await expect(issueRealTotePermit(h.db, { accountId: b.accountId, raceId: race.id, horseId: horse, pool: "win", amount: U, wallet: WALLET(1), now: at(16 * MIN), env: ON })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    // 18+
    const kid = await newPlayer(h.db);
    await h.db.update(accounts).set({ walletAddress: WALLET(++w) }).where(eq(accounts.id, kid.accountId));
    await expect(permit({ accountId: kid.accountId, wallet: WALLET(w) }, race.id, horse, U)).rejects.toMatchObject({ code: "TOTE_AGE_CONFIRM" });
    // own runner
    await h.db.update(accounts).set({ walletAddress: WALLET(++w) }).where(eq(accounts.id, owners[1]!.accountId));
    await confirmToteAdult(h.db, { accountId: owners[1]!.accountId, now: T0 });
    await expect(permit({ accountId: owners[1]!.accountId, wallet: WALLET(w) }, race.id, horse, U)).rejects.toMatchObject({ code: "TOTE_CONFLICT" });
    // linked account (fraud event recorded)
    const alt = await bettor();
    await recordAccountSignal(h.db, { accountId: owners[2]!.accountId, kind: "device", value: `rt-dev-${race.id}` });
    await recordAccountSignal(h.db, { accountId: alt.accountId, kind: "device", value: `rt-dev-${race.id}` });
    await expect(permit(alt, race.id, horse, U)).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    const frauds = await h.db.select().from(fraudEvents).where(eq(fraudEvents.accountId, alt.accountId));
    expect(frauds.some((f) => f.kind === "tote_linked_bet_blocked" && (f.data as { currency?: string }).currency === "USDG")).toBe(true);
    // self-excluded
    const ex = await bettor();
    await selfExcludeTote(h.db, { accountId: ex.accountId, choice: "7d", now: T0 });
    await expect(permit(ex, race.id, horse, U)).rejects.toMatchObject({ code: "TOTE_EXCLUDED" });
    // a horse not in the field
    await expect(permit(b, race.id, race.id, U)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // fine
    const g = await permit(b, race.id, owners[3]!.horseId, 5 * U);
    const [row] = await h.db.select().from(races).where(eq(races.id, race.id));
    const gate = (row!.field as { runners: { horseId: string; gate: number }[] }).runners.find((r) => r.horseId === owners[3]!.horseId)!.gate;
    expect(g).toMatchObject({ runner: gate - 1, pool: "win", maxAmount: 5 * U, wallet: b.wallet, issuedAt: at(16 * MIN) });
    const [stored] = await h.db.select().from(realTotePermits).where(eq(realTotePermits.nonce, g.nonce));
    expect(stored).toMatchObject({ runner: gate - 1, pool: "win" }); // bound on chain too (signed into the permit)
    // staff can't bet
    await expect(issueRealTotePermit(h.db, { accountId: b.accountId, raceId: race.id, horseId: horse, pool: "win", amount: U, wallet: b.wallet, now: at(16 * MIN), env: ON, staff: true })).rejects.toMatchObject({ code: "TOTE_STAFF" });
    expect(g.expiresAt).toEqual(at(16 * MIN + gc.REAL_TOTE_PERMIT_TTL_MS));
    expect(BigInt(g.nonce) > 0n).toBe(true);
    // betting closed
    await expect(permit(b, race.id, horse, U, at(28 * MIN))).rejects.toMatchObject({ code: "RACE_CLOSED" });
    // a permit asked for just before the close never outlives it
    const late = await permit(b, race.id, horse, U, at(28 * MIN - 30_000));
    expect(late.expiresAt).toEqual(at(28 * MIN));
  });

  it("limits: per bet, per race (spent permits at what was staked, others at their maximum until they lapse)", async () => {
    const { race, owners } = await flaggedRace(6);
    await openMarket(race.id);
    const b = await bettor();
    const horse = owners[0]!.horseId;
    await expect(permit(b, race.id, horse, gc.REAL_TOTE_MAX_STAKE_PER_BET + 1)).rejects.toMatchObject({ code: "TOTE_LIMIT" });
    await expect(permit(b, race.id, horse, U - 1)).rejects.toMatchObject({ code: "TOTE_LIMIT" });
    const p1 = await permit(b, race.id, horse, 100 * U);
    await permit(b, race.id, horse, 100 * U);
    await expect(permit(b, race.id, horse, 60 * U)).rejects.toMatchObject({ code: "TOTE_LIMIT" }); // 250 per race
    // the first permit was spent for 10 only: 90 back
    await recordRealToteEvent(h.db, ev(race.id, "BetPlaced", { pool: 0, runner: 0, amount: String(10 * U), nonce: p1.nonce, poolTotal: String(10 * U), runnerTotal: String(10 * U) }), at(16 * MIN));
    const [spent] = await h.db.select().from(realTotePermits).where(eq(realTotePermits.nonce, p1.nonce));
    expect(spent!.usedAmount).toBe(10 * U);
    await permit(b, race.id, horse, 60 * U);
    // L5: an expired permit with no mirrored bet still counts at its maximum (its bet may have
    // landed on chain without being mirrored yet) ...
    await expect(permit(b, race.id, horse, 90 * U, at(20 * MIN))).rejects.toMatchObject({ code: "TOTE_LIMIT" });
    // ... until a chain check (nonceUsed) shows it was never used and it lapses
    const unsettled = await realToteUnsettledPermits(h.db, b.accountId, at(20 * MIN));
    expect(unsettled.map((x) => x.nonce)).not.toContain(p1.nonce); // spent: settled by the mirror
    expect(unsettled.length).toBe(2);
    await lapseRealTotePermits(h.db, unsettled.map((x) => x.nonce), at(20 * MIN));
    await permit(b, race.id, horse, 90 * U, at(20 * MIN));
    // betting closed on chain (EntropyLocked): every permit without a mirrored bet lapses
    await recordRealToteEvent(h.db, ev(race.id, "EntropyLocked", { entropyBlock: "5" }), at(29 * MIN));
    const left = await h.db.select().from(realTotePermits).where(eq(realTotePermits.raceId, race.id));
    expect(left.filter((x) => x.usedAmount === null).every((x) => x.lapsedAt !== null)).toBe(true);
  });

  it("linked accounts can't back different runners of the same real-money pool (fraud event)", async () => {
    const { race, owners } = await flaggedRace(6);
    await openMarket(race.id);
    const [a, b] = [await bettor(), await bettor()];
    await recordAccountSignal(h.db, { accountId: a.accountId, kind: "device", value: `rt-pair-${race.id}` });
    await recordAccountSignal(h.db, { accountId: b.accountId, kind: "device", value: `rt-pair-${race.id}` });
    await permit(a, race.id, owners[0]!.horseId, U);
    await permit(b, race.id, owners[0]!.horseId, U); // the same runner: fine
    await permit(b, race.id, owners[1]!.horseId, U, at(16 * MIN), "place"); // another pool: fine
    await expect(permit(b, race.id, owners[1]!.horseId, U)).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    const frauds = await h.db.select().from(fraudEvents).where(eq(fraudEvents.accountId, b.accountId));
    expect(frauds.some((f) => f.kind === "tote_linked_opposing_bets")).toBe(true);
  });

  it("mirrors chain events idempotently and shows odds from the on-chain totals", async () => {
    const { race, owners } = await flaggedRace(5);
    await openMarket(race.id);
    const e = ev(race.id, "BetPlaced", { pool: 0, runner: 1, amount: String(4 * U), nonce: "1", poolTotal: String(4 * U), runnerTotal: String(4 * U) });
    expect(await recordRealToteEvent(h.db, e, at(16 * MIN))).toBe(true);
    expect(await recordRealToteEvent(h.db, e, at(16 * MIN))).toBe(false);
    const thin = (await realToteBoard(h.db, race.id))!.pools[0]!;
    expect([thin.bettors, thin.thin]).toEqual([0, true]); // events without a bettor: unknown wallets
    await recordRealToteEvent(h.db, ev(race.id, "BetPlaced", { pool: 0, runner: 2, amount: String(6 * U), nonce: "2", poolTotal: String(10 * U), runnerTotal: String(6 * U), bettor: WALLET(7) }), at(16 * MIN));
    const board = (await realToteBoard(h.db, race.id))!;
    expect(board.status).toBe("open");
    const win = board.pools.find((p) => p.kind === "win")!;
    expect(win.total).toBe(10 * U);
    expect([win.bettors, win.thin]).toEqual([1, true]); // only one known wallet so far
    const [row] = await h.db.select().from(races).where(eq(races.id, race.id));
    const byGate = (g: number) => (row!.field as { runners: { horseId: string; gate: number }[] }).runners.find((r) => r.gate === g)!.horseId;
    expect(win.runners.find((r) => r.horseId === byGate(2))!.oddsMilli).toBe(2_125); // 8.5 / 4
    expect(win.runners.find((r) => r.horseId === byGate(1))!.oddsMilli).toBe(null);
    expect(owners.length).toBe(5);
    expect(await realToteBoard(h.db, (await liveRace()).id)).toBe(null);
  });

  it("runs a flagged race on sha256(serverSeed ‖ entropy), fixed once; unflagged races keep their seed", async () => {
    const { race } = await flaggedRace(5);
    await openMarket(race.id);
    await recordRealToteEvent(h.db, ev(race.id, "EntropyLocked", { entropyBlock: "123" }), at(29 * MIN));
    const entropy = "ab".repeat(32);
    await recordRealToteEvent(h.db, ev(race.id, "EntropySealed", { entropyBlock: "123", entropy: `0x${entropy}` }), at(29 * MIN));
    const sim = await getRaceForSimulation(h.db, race.id, at(30 * MIN));
    const [row] = await h.db.select().from(races).where(eq(races.id, race.id));
    expect(sim.race.seed).toBe(mixSeedEntropy(row!.seed, entropy));
    expect(sim.realTote).toMatchObject({ mode: "final", serverSeed: row!.seed, entropy });
    expect(commitSeed(row!.seed)).toBe(row!.seedCommitment); // the published commitment is the server seed's
    // A later (bogus) EntropySealed can't change a decided seed.
    await recordRealToteEvent(h.db, ev(race.id, "EntropySealed", { entropy: `0x${"cd".repeat(32)}` }), at(31 * MIN));
    expect((await getRaceForSimulation(h.db, race.id, at(31 * MIN))).race.seed).toBe(sim.race.seed);

    const plain = await liveRace();
    const plainSim = await getRaceForSimulation(h.db, plain.id, at(30 * MIN)).catch(() => null);
    const [plainRow] = await h.db.select().from(races).where(eq(races.id, plain.id));
    if (plainSim) {
      expect(plainSim.race.seed).toBe(plainRow!.seed);
      expect(plainSim.realTote).toBeUndefined();
    }
    expect(await resolveRealToteSeed(h.db, plainRow!, at(30 * MIN))).toBe(null);
  });

  it("without sealed entropy at the off the race runs on its server seed and the market is abandoned (to cancel)", async () => {
    const { race } = await flaggedRace(5);
    await openMarket(race.id);
    const sim = await getRaceForSimulation(h.db, race.id, at(30 * MIN));
    const [row] = await h.db.select().from(races).where(eq(races.id, race.id));
    expect(sim.race.seed).toBe(row!.seed);
    expect(sim.realTote!.mode).toBe("server");
    expect((await getRealToteRace(h.db, race.id))!.status).toBe("abandoned");
    // entropy arriving late changes nothing
    await recordRealToteEvent(h.db, ev(race.id, "EntropySealed", { entropy: `0x${"ef".repeat(32)}` }), at(31 * MIN));
    expect((await getRaceForSimulation(h.db, race.id, at(31 * MIN))).race.seed).toBe(row!.seed);
    expect((await getRealToteRace(h.db, race.id))!.status).toBe("abandoned");
    // no entropy block was picked: the operator may still cancel
    expect((await realToteDueWork(h.db, at(31 * MIN))).cancel).toContain(race.id);
    await expect(realToteResultFor(h.db, race.id, at(60 * MIN))).rejects.toMatchObject({ code: "TOTE_UNAVAILABLE" });
    await recordRealToteEvent(h.db, ev(race.id, "MarketVoided", { reason: "cancelled" }), at(32 * MIN));
    expect((await getRealToteRace(h.db, race.id))!.status).toBe("void");
  });

  it("the result goes on chain only once it is public, with positions by gate", async () => {
    const { race } = await flaggedRace(5);
    await openMarket(race.id);
    expect((await realToteDueWork(h.db, at(29 * MIN))).lock).toContain(race.id);
    await recordRealToteEvent(h.db, ev(race.id, "EntropyLocked", { entropyBlock: "7" }), at(29 * MIN));
    expect((await realToteDueWork(h.db, at(29 * MIN))).seal).toContain(race.id);
    await recordRealToteEvent(h.db, ev(race.id, "EntropySealed", { entropy: `0x${"12".repeat(32)}` }), at(29 * MIN));
    await getRaceForSimulation(h.db, race.id, at(30 * MIN));
    await expect(realToteResultFor(h.db, race.id, at(30 * MIN))).rejects.toMatchObject({ code: "TOO_EARLY" });
    const entries = await listRaceEntries(h.db, race.id);
    const order = [...entries].sort((a, b) => (a.gate ?? 0) - (b.gate ?? 0)).reverse(); // highest gate wins
    await settleRace(h.db, { raceId: race.id, now: at(31 * MIN), resultHash: "0".repeat(64), result: { finishOrder: [] }, runners: order.map((e, i) => ({ horseId: e.horseId, position: i + 1 })) });
    await expect(realToteResultFor(h.db, race.id, at(31 * MIN - 1_000))).rejects.toMatchObject({ code: "TOO_EARLY" });
    const r = await realToteResultFor(h.db, race.id, at(40 * MIN));
    expect(r.positions).toEqual([5, 4, 3, 2, 1]);
    const [row] = await h.db.select().from(races).where(eq(races.id, race.id));
    expect(r.serverSeed).toBe(row!.seed);
    expect((await realToteDueWork(h.db, at(40 * MIN))).post).toContain(race.id);
    const end = Math.floor(at(101 * MIN).getTime() / 1000);
    const hash = `0x${"77".repeat(32)}`;
    await recordRealToteEvent(h.db, ev(race.id, "ResultPosted", { resultHash: hash, challengeEnd: String(end) }), at(41 * MIN));
    // H1: no attestation yet: the attestor's list has it; finalize waits even after the window
    expect(await realToteAttestWork(h.db)).toContain(race.id);
    expect((await realToteDueWork(h.db, at(41 * MIN))).finalize).not.toContain(race.id);
    expect((await realToteDueWork(h.db, at(102 * MIN))).finalize).not.toContain(race.id);
    expect((await realToteDueWork(h.db, at(102 * MIN))).guardian).toContainEqual({ raceId: race.id, reason: "attestation_missing" });
    await recordRealToteEvent(h.db, ev(race.id, "ResultAttested", { attestedHash: hash, matches: true }), at(42 * MIN));
    expect(await realToteAttestWork(h.db)).not.toContain(race.id);
    expect((await realToteDueWork(h.db, at(100 * MIN))).finalize).not.toContain(race.id); // window still open
    expect((await realToteDueWork(h.db, at(102 * MIN))).finalize).toContain(race.id);
    await recordRealToteEvent(h.db, ev(race.id, "MarketFinalized", {}), at(102 * MIN));
    expect((await getRealToteRace(h.db, race.id))!.status).toBe("finalized");
  });

  it("a mismatching attestation marks the market disputed (for the guardian) until a correction", async () => {
    const { race } = await flaggedRace(5);
    await openMarket(race.id);
    await recordRealToteEvent(h.db, ev(race.id, "EntropyLocked", { entropyBlock: "9" }), at(29 * MIN));
    await recordRealToteEvent(h.db, ev(race.id, "EntropySealed", { entropy: `0x${"34".repeat(32)}` }), at(29 * MIN));
    const end = Math.floor(at(101 * MIN).getTime() / 1000);
    await recordRealToteEvent(h.db, ev(race.id, "ResultPosted", { resultHash: `0x${"aa".repeat(32)}`, challengeEnd: String(end) }), at(41 * MIN));
    await recordRealToteEvent(h.db, ev(race.id, "ResultAttested", { attestedHash: `0x${"bb".repeat(32)}`, matches: false }), at(42 * MIN));
    expect((await getRealToteRace(h.db, race.id))!.disputed).toBe(true);
    expect(await realToteAttestWork(h.db)).not.toContain(race.id); // waits for the guardian
    expect((await realToteDueWork(h.db, at(50 * MIN))).guardian).toContainEqual({ raceId: race.id, reason: "result_disputed" });
    await recordRealToteEvent(h.db, ev(race.id, "ResultCorrected", { resultHash: `0x${"bb".repeat(32)}`, challengeEnd: String(end + 3600) }), at(60 * MIN));
    const rt = (await getRealToteRace(h.db, race.id))!;
    expect(rt.disputed).toBe(false);
    expect(rt.attestedHash).toBe(rt.resultHash); // the correction matches the replay
    expect((await realToteDueWork(h.db, at(102 * MIN))).finalize).not.toContain(race.id); // the reopened window
    expect((await realToteDueWork(h.db, at(162 * MIN))).finalize).toContain(race.id);
  });

  it("the keeper: M1 abandoned after the entropy block goes to the guardian, M3 expiry, never-opened races, backoff and parking", async () => {
    // abandoned after the entropy block was picked: no operator cancel; a guardian request, then expiry
    const a = await flaggedRace(5);
    await openMarket(a.race.id);
    await recordRealToteEvent(h.db, ev(a.race.id, "EntropyLocked", { entropyBlock: "11" }), at(29 * MIN));
    await getRaceForSimulation(h.db, a.race.id, at(30 * MIN)); // no sealed entropy at the off: abandoned
    const w1 = await realToteDueWork(h.db, at(31 * MIN));
    expect(w1.cancel).not.toContain(a.race.id);
    expect(w1.guardian).toContainEqual({ raceId: a.race.id, reason: "abandoned_after_entropy" });
    expect(await raiseRealToteAlert(h.db, { raceId: a.race.id, kind: "abandoned_after_entropy" }, at(31 * MIN))).toBe(true);
    expect(await raiseRealToteAlert(h.db, { raceId: a.race.id, kind: "abandoned_after_entropy" }, at(32 * MIN))).toBe(false); // once
    const after = at(29 * MIN + gc.REAL_TOTE_MAX_SETTLE_DELAY_MS + MIN);
    expect((await realToteDueWork(h.db, after)).expire).toContain(a.race.id);

    // flagged but the market never got created before betting closed: closed locally
    const b = await flaggedRace(5);
    expect((await realToteDueWork(h.db, at(28 * MIN))).close).toContain(b.race.id);
    await closeUnopenedRealToteRace(h.db, b.race.id, at(28 * MIN));
    expect((await getRealToteRace(h.db, b.race.id))!).toMatchObject({ status: "void", voidReason: "never_opened" });

    // a failing step backs off, and after REAL_TOTE_KEEPER_MAX_ATTEMPTS the market is parked (with an alert)
    const c = await flaggedRace(5);
    await openMarket(c.race.id);
    expect((await realToteDueWork(h.db, at(29 * MIN))).lock).toContain(c.race.id);
    expect(await recordRealToteKeeperOutcome(h.db, c.race.id, { ok: false, step: "lock", error: "rpc down" }, at(29 * MIN))).toBe(false);
    expect((await realToteDueWork(h.db, at(29 * MIN))).lock).not.toContain(c.race.id); // backing off
    expect((await realToteDueWork(h.db, at(29 * MIN + 30_000))).lock).toContain(c.race.id);
    let parked = false;
    for (let i = 1; i < gc.REAL_TOTE_KEEPER_MAX_ATTEMPTS; i++) parked = await recordRealToteKeeperOutcome(h.db, c.race.id, { ok: false, step: "lock", error: "rpc down" }, at(30 * MIN));
    expect(parked).toBe(true);
    expect((await getRealToteRace(h.db, c.race.id))!.keeperError).toBe("lock: rpc down");
    expect((await realToteDueWork(h.db, at(300 * MIN))).lock).not.toContain(c.race.id);
    const alerts = await h.db.select().from(auditLog).where(eq(auditLog.entityId, c.race.id));
    expect(alerts.some((x) => x.action === "real_tote.alert.keeper_parked")).toBe(true);
    await unparkRealToteRace(h.db, c.race.id, at(300 * MIN));
    expect((await realToteDueWork(h.db, at(300 * MIN))).lock).toContain(c.race.id);
    await recordRealToteKeeperOutcome(h.db, c.race.id, { ok: true }, at(300 * MIN));
    expect((await getRealToteRace(h.db, c.race.id))!.keeperAttempts).toBe(0);
  });

  it("M3: stuck old markets don't hold up newer ones (ordered by when their step fell due, parked rows skipped)", async () => {
    const old = [];
    for (let i = 0; i < 3; i++) {
      const r = await flaggedRace(5);
      await openMarket(r.race.id);
      await h.db.update(realToteRaces).set({ parkedAt: at(MIN) }).where(eq(realToteRaces.raceId, r.race.id));
      old.push(r.race.id);
    }
    const fresh = await flaggedRace(5);
    await openMarket(fresh.race.id);
    const work = await realToteDueWork(h.db, at(29 * MIN), 1);
    expect(work.lock.length).toBe(1);
    expect(work.lock.some((id) => old.includes(id))).toBe(false);
    expect((await realToteDueWork(h.db, at(29 * MIN), 50)).lock).toContain(fresh.race.id);
    // the sync cursor only moves forward
    await setRealToteSyncedBlock(h.db, fresh.race.id, 500, at(29 * MIN));
    await setRealToteSyncedBlock(h.db, fresh.race.id, 400, at(29 * MIN));
    expect((await getRealToteRace(h.db, fresh.race.id))!.syncedBlock).toBe(500);
  });
});
