import { expect } from "chai";
import hre from "hardhat";
import { loadFixture, mine, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { concat, encodeFunctionData, getAddress, hashTypedData, keccak256, sha256, toBytes, toFunctionSelector, type Address, type Hex } from "viem";
import { totePoolsAbi } from "../adapter/abi";
import { toBytes32 } from "../adapter/merkle";
import {
  betPermitTypedData,
  packTotePositions,
  toteFinalSeed,
  toteOddsMilli,
  totePlacesFor,
  toteRaceKey,
  toteResultHash,
  unpackTotePositions,
  type BetPermit,
} from "../adapter/totePools";
import { engineCommitSeed, expectAnyRevert, expectRevert, latestTimestamp, localServerWallet, random32, ZERO_ADDRESS } from "./helpers";
import { refSettle, type RefBet, type RefFinisher } from "./toteReference";

const WIN = 0;
const PLACE = 1;
const USDG = 1_000_000n;
const CLOSE_MARGIN = 60n;
const CHALLENGE = 3_600n;
const MAX_SETTLE = 86_400n;
const ENTROPY_DELAY = 2n;
const ENTROPY_BLOCKS = 3n;
const TAKE_BPS = 1_500; // game-core TOTE_TAKEOUT_PERMILLE 150
const STATUS = { none: 0, open: 1, posted: 2, finalized: 3, void: 4 } as const;
const role = (name: string) => keccak256(toBytes(name));
const reasonOf = (s: string): Hex => `0x${Buffer.from(s).toString("hex").padEnd(64, "0")}`;
const TIMING = { closeMargin: CLOSE_MARGIN, challengeWindow: CHALLENGE, maxSettleDelay: MAX_SETTLE, entropyDelayBlocks: ENTROPY_DELAY, entropyBlocks: ENTROPY_BLOCKS };

async function deployTote(tokenName: "MockStablecoin" | "MockReentrantToteToken" = "MockStablecoin", arbSys: Address = ZERO_ADDRESS) {
  const wallets = await hre.viem.getWalletClients();
  const [admin, operator, guardian, treasury, other, attestor] = wallets;
  const bettors = wallets.slice(6);
  const publicClient = await hre.viem.getPublicClient();
  const signer = await localServerWallet();
  // Typed as MockStablecoin either way (the hostile token shares the ERC-20 calls the tests use).
  const deployed = tokenName === "MockStablecoin" ? await hre.viem.deployContract("MockStablecoin", []) : await hre.viem.deployContract("MockReentrantToteToken", []);
  const usd = await hre.viem.getContractAt("MockStablecoin", deployed.address);
  const roles = {
    admin: admin!.account.address,
    operator: operator!.account.address,
    permitSigner: signer.account.address,
    guardian: guardian!.account.address,
    attestor: attestor!.account.address,
  };
  const tote = await hre.viem.deployContract("TotePools", [roles, treasury!.account.address, usd.address, arbSys, TIMING]);
  for (const w of bettors) {
    await usd.write.mint([w.account.address, 100_000n * USDG]);
    const t = await hre.viem.getContractAt("MockStablecoin", usd.address, { client: { wallet: w } });
    await t.write.approve([tote.address, 2n ** 256n - 1n]);
  }
  const as = (w: (typeof wallets)[number]) => hre.viem.getContractAt("TotePools", tote.address, { client: { wallet: w } });
  const asOperator = await as(operator!);
  const asGuardian = await as(guardian!);
  const asAttestor = await as(attestor!);
  const asOther = await as(other!);
  const chainId = await publicClient.getChainId();

  async function permit(bettor: Address, raceId: Hex, maxAmount: bigint, runner: number, pool: number, o: Partial<BetPermit> = {}): Promise<{ p: BetPermit; sig: Hex }> {
    const now = await latestTimestamp();
    const p: BetPermit = { bettor: getAddress(bettor), raceId, runner, pool, maxAmount, nonce: BigInt(random32()), issuedAt: now - 5n, expiry: now + 300n, ...o };
    const sig = await signer.wallet.signTypedData({ account: signer.account, ...betPermitTypedData(p, chainId, getAddress(tote.address)) });
    return { p, sig };
  }

  const ethMarkets = new Set<Hex>();

  /** Bets with the right payment for the market's asset (msg.value in an ETH market). */
  async function bet(w: (typeof wallets)[number], raceId: Hex, runner: number, pool: number, amount: bigint) {
    const { p, sig } = await permit(w.account.address, raceId, amount, runner, pool);
    const c = await as(w);
    return c.write.bet([raceId, runner, pool, amount, p, sig], ethMarkets.has(raceId) ? { value: amount } : {});
  }

  async function market(o: { runners?: number; places?: number; take?: number; maxPool?: bigint; closeIn?: bigint; asset?: Address } = {}) {
    const seed = random32();
    const raceId = toteRaceKey(crypto.randomUUID());
    const closeTime = (await latestTimestamp()) + (o.closeIn ?? 3_600n);
    const runners = o.runners ?? 8;
    const asset = o.asset ?? usd.address;
    await asOperator.write.createMarket([raceId, asset, closeTime, runners, o.places ?? totePlacesFor(runners), toBytes32(engineCommitSeed(seed)), o.take ?? TAKE_BPS, o.maxPool ?? 1_000_000n * USDG]);
    if (asset === ZERO_ADDRESS) ethMarkets.add(raceId);
    return { raceId, seed, closeTime, runners };
  }

  async function closeAndSeal(raceId: Hex, closeTime: bigint) {
    await time.increaseTo(closeTime);
    await asOther.write.lockEntropy([raceId]);
    await mine(Number(ENTROPY_DELAY + ENTROPY_BLOCKS));
    await asOther.write.sealEntropy([raceId]);
  }

  /** The hash the attestor would get by replaying `positions` from the market's finalSeed. */
  async function hashFor(raceId: Hex, positions: number[]): Promise<Hex> {
    const m = await tote.read.getMarket([raceId]);
    return toteResultHash(raceId, m.finalSeed, packTotePositions(positions));
  }

  /** Operator posts, the attestor attests the same result, the window passes, anyone finalizes. */
  async function settle(raceId: Hex, seed: Hex, positions: number[]) {
    await asOperator.write.postResult([raceId, seed, positions]);
    await asAttestor.write.attestResult([raceId, await hashFor(raceId, positions)]);
    await time.increase(CHALLENGE);
    await asOther.write.finalize([raceId]);
  }

  async function claimAs(w: (typeof wallets)[number], raceId: Hex): Promise<bigint> {
    const before = await usd.read.balanceOf([w.account.address]);
    await (await as(w)).write.claim([raceId, w.account.address]);
    return (await usd.read.balanceOf([w.account.address])) - before;
  }

  return {
    tote,
    usd,
    roles,
    admin: admin!,
    operator: operator!,
    guardian: guardian!,
    attestor: attestor!,
    treasury: treasury!,
    other: other!,
    bettors,
    signer,
    publicClient,
    chainId,
    as,
    asOperator,
    asGuardian,
    asAttestor,
    asOther,
    permit,
    bet,
    market,
    closeAndSeal,
    hashFor,
    settle,
    claimAs,
  };
}

const fixture = () => deployTote();

/** Expected claims per bettor index from the game-core reference, over both pools. */
function expectedFrom(bets: [number, number, number, bigint][], positions: number[], permille: number) {
  const finishers: RefFinisher[] = positions.flatMap((p, i) => (p > 0 ? [{ horseId: `r${i}`, position: p }] : []));
  const expected = new Map<number, bigint>();
  let house = 0n;
  for (const [pool, kind] of [[WIN, "win"], [PLACE, "place"]] as const) {
    const refBets: RefBet[] = bets
      .map(([b, r, p, a], i) => ({ b, r, p, a, i }))
      .filter((x) => x.p === pool)
      .map((x) => ({ id: `b${String(x.i).padStart(3, "0")}`, bettor: `w${x.b}`, horseId: `r${x.r}`, stake: Number(x.a) }));
    if (!refBets.length) continue;
    const s = refSettle(kind, refBets, finishers, permille);
    house += BigInt(s.takeout + s.remainder);
    for (const x of [...s.payouts, ...s.refunds]) {
      const b = bets[Number(x.betId.slice(1))]![0];
      expected.set(b, (expected.get(b) ?? 0n) + BigInt(x.amount));
    }
  }
  return { expected, house };
}

describe("TotePools", () => {
  describe("deployment", () => {
    it("grants each role to its own key and starts with conservative stake limits", async () => {
      const { tote, admin, operator, guardian, attestor, signer, treasury, usd } = await loadFixture(fixture);
      expect(await tote.read.hasRole([role("OPERATOR_ROLE"), operator.account.address])).to.equal(true);
      expect(await tote.read.hasRole([role("GUARDIAN_ROLE"), guardian.account.address])).to.equal(true);
      expect(await tote.read.hasRole([role("RESULT_ATTESTOR_ROLE"), attestor.account.address])).to.equal(true);
      expect(await tote.read.hasRole([role("RESULT_ATTESTOR_ROLE"), operator.account.address])).to.equal(false);
      expect(await tote.read.hasRole([role("PERMIT_SIGNER_ROLE"), signer.account.address])).to.equal(true);
      expect(await tote.read.hasRole([role("PAUSER_ROLE"), admin.account.address])).to.equal(true);
      expect(await tote.read.hasRole([role("OPERATOR_ROLE"), admin.account.address])).to.equal(false);
      expect(getAddress(await tote.read.treasury())).to.equal(getAddress(treasury.account.address));
      expect(await tote.read.stakeLimits([usd.address])).to.deep.equal([1n * USDG, 100n * USDG, 250n * USDG]);
      expect(await tote.read.assetAllowed([usd.address])).to.equal(true);
      expect(await tote.read.assetAllowed([ZERO_ADDRESS])).to.equal(false); // ETH off by default
      expect(await tote.read.stakeLimits([ZERO_ADDRESS])).to.deep.equal([0n, 0n, 0n]);
      expect(await tote.read.CLOSE_MARGIN()).to.equal(CLOSE_MARGIN);
      expect(await tote.read.ENTROPY_BLOCKS()).to.equal(ENTROPY_BLOCKS);
      expect(await tote.read.MAX_CORRECTIONS()).to.equal(2);
      expect(await tote.read.entropyBeacon()).to.equal(ZERO_ADDRESS); // the randomness hook is off
    });

    it("rejects zero addresses, shared role keys and unsafe timing", async () => {
      const ws = await hre.viem.getWalletClients();
      const [a, b, c, d, e] = ws.map((w) => w.account.address);
      const usd = await hre.viem.deployContract("MockStablecoin", []);
      const roles = { admin: a!, operator: b!, permitSigner: c!, guardian: d!, attestor: e! };
      const deploy = (r: Partial<typeof roles>, t: Partial<typeof TIMING> = {}, usdg: Address = usd.address, arb: Address = ZERO_ADDRESS) =>
        hre.viem.deployContract("TotePools", [{ ...roles, ...r }, a!, usdg, arb, { ...TIMING, ...t }]);
      await expectRevert(deploy({ admin: ZERO_ADDRESS }), "ZeroAddress");
      await expectRevert(deploy({ attestor: ZERO_ADDRESS }), "ZeroAddress");
      await expectRevert(deploy({}, {}, ZERO_ADDRESS), "ZeroAddress");
      // the result attestor, operator, guardian and permit signer must be different keys
      await expectRevert(deploy({ attestor: b! }), "SharedRoleKey");
      await expectRevert(deploy({ guardian: b! }), "SharedRoleKey");
      await expectRevert(deploy({ guardian: e! }), "SharedRoleKey");
      await expectRevert(deploy({ permitSigner: b! }), "SharedRoleKey");
      await expectRevert(deploy({ permitSigner: e! }), "SharedRoleKey");
      for (const t of [{ closeMargin: 0n }, { challengeWindow: 60n }, { maxSettleDelay: 60n }, { entropyDelayBlocks: 0n }, { entropyDelayBlocks: 65n }, { entropyBlocks: 2n }, { entropyBlocks: 17n }]) {
        await expectRevert(deploy({}, t), "BadConfig");
      }
      // an ArbSys address with no code is refused
      await expectRevert(deploy({}, {}, usd.address, "0x0000000000000000000000000000000000000064"), "BadConfig");
    });

    it("L3: on Robinhood Chain (4663 / 46630) the ArbSys precompile is required and must have code", async () => {
      const ws = await hre.viem.getWalletClients();
      const [a, b, c, d, e] = ws.map((w) => w.account.address);
      const usd = await hre.viem.deployContract("MockStablecoin", []);
      const roles = { admin: a!, operator: b!, permitSigner: c!, guardian: d!, attestor: e! };
      await expectRevert(hre.viem.deployContract("TotePoolsChainHarness", [roles, a!, usd.address, ZERO_ADDRESS, TIMING]), "BadConfig");
      await expectRevert(hre.viem.deployContract("TotePoolsChainHarness", [roles, a!, usd.address, "0x0000000000000000000000000000000000000064", TIMING]), "BadConfig");
      const arb = await hre.viem.deployContract("MockArbSys", []);
      const ok = await hre.viem.deployContract("TotePoolsChainHarness", [roles, a!, usd.address, arb.address, TIMING]);
      expect(getAddress(await ok.read.arbSys())).to.equal(getAddress(arb.address));
    });

    it("BetPermit digest and the result hash match the adapter", async () => {
      const { tote, chainId, bettors } = await loadFixture(fixture);
      const p: BetPermit = { bettor: getAddress(bettors[0]!.account.address), raceId: toteRaceKey("abc"), runner: 5, pool: PLACE, maxAmount: 5n * USDG, nonce: 42n, issuedAt: 1_899_999_900n, expiry: 1_900_000_000n };
      expect(await tote.read.hashBetPermit([p])).to.equal(hashTypedData(betPermitTypedData(p, chainId, getAddress(tote.address))));
      // runner and pool are signed: changing either changes the digest
      expect(await tote.read.hashBetPermit([{ ...p, runner: 0 }])).to.not.equal(await tote.read.hashBetPermit([p]));
      expect(await tote.read.hashBetPermit([{ ...p, pool: WIN }])).to.not.equal(await tote.read.hashBetPermit([p]));
      const k = toteRaceKey("x");
      const fs = random32();
      const pos = packTotePositions([2, 1, 0, 3]);
      expect(await tote.read.resultHashOf([k, fs, pos])).to.equal(toteResultHash(k, fs, pos));
    });

    it("finalSeedOf and the position packing match the adapter", async () => {
      const { tote } = await loadFixture(fixture);
      const s = random32();
      const e = random32();
      expect(await tote.read.finalSeedOf([s, e])).to.equal(`0x${toteFinalSeed(s, e)}`);
      expect(toteFinalSeed(s, e)).to.equal(sha256(`0x${s.slice(2)}${e.slice(2)}`).slice(2));
      expect([0, 4, 5, 7, 8, 24].map(totePlacesFor)).to.deep.equal([0, 0, 2, 2, 3, 3]);
      const pos = [3, 1, 0, 2, 4];
      expect(unpackTotePositions(packTotePositions(pos), 5)).to.deep.equal(pos);
    });
  });

  describe("markets", () => {
    it("only the operator creates, once per race, with sane terms", async () => {
      const { tote, asOther, asOperator, market, usd } = await loadFixture(fixture);
      const U = usd.address;
      const { raceId, closeTime, seed } = await market();
      const m = await tote.read.getMarket([raceId]);
      expect(m.status).to.equal(STATUS.open);
      expect(m.seedCommitment).to.equal(toBytes32(engineCommitSeed(seed)));
      expect(m.placeTerms).to.equal(3);
      expect(m.beacon).to.equal(ZERO_ADDRESS);
      const c = toBytes32(engineCommitSeed(random32()));
      const now = await latestTimestamp();
      expect(getAddress(m.asset)).to.equal(getAddress(U));
      await expectRevert(asOther.write.createMarket([toteRaceKey("x"), U, now + 3_600n, 8, 3, c, TAKE_BPS, USDG]), "AccessControlUnauthorizedAccount");
      await expectRevert(asOperator.write.createMarket([raceId, U, closeTime, 8, 3, c, TAKE_BPS, USDG]), "MarketExists");
      const bad: [Hex, bigint, number, number, Hex, number, bigint][] = [
        [`0x${"00".repeat(32)}`, now + 3_600n, 8, 3, c, TAKE_BPS, USDG],
        [toteRaceKey("a"), now + 3_600n, 8, 3, `0x${"00".repeat(32)}`, TAKE_BPS, USDG],
        [toteRaceKey("a"), now + 3_600n, 8, 3, c, TAKE_BPS, 0n],
        [toteRaceKey("a"), now + 30n, 8, 3, c, TAKE_BPS, USDG], // inside the close margin
        [toteRaceKey("a"), now + 8n * 86_400n, 8, 3, c, TAKE_BPS, USDG], // too far ahead
        [toteRaceKey("a"), now + 3_600n, 1, 0, c, TAKE_BPS, USDG],
        [toteRaceKey("a"), now + 3_600n, 25, 3, c, TAKE_BPS, USDG],
        [toteRaceKey("a"), now + 3_600n, 8, 1, c, TAKE_BPS, USDG],
        [toteRaceKey("a"), now + 3_600n, 8, 4, c, TAKE_BPS, USDG],
        [toteRaceKey("a"), now + 3_600n, 3, 3, c, TAKE_BPS, USDG],
        [toteRaceKey("a"), now + 3_600n, 8, 3, c, 2_501, USDG],
      ];
      for (const [k, ...rest] of bad) await expectRevert(asOperator.write.createMarket([k, U, ...rest]), "BadMarket");
    });
  });

  describe("full lifecycle", () => {
    it("bets, entropy, result, attestation, challenge window, finalize, claims: payouts match game-core and the contract ends empty", async () => {
      const f = await loadFixture(fixture);
      const { tote, usd, bettors, market, bet, closeAndSeal, settle, claimAs, treasury, asOther, publicClient } = f;
      const { raceId, seed, closeTime } = await market({ runners: 8 });
      const plan: [number, number, number, bigint][] = [
        // bettor, runner, pool, amount
        [0, 0, WIN, 10n * USDG],
        [1, 0, WIN, 30n * USDG],
        [2, 1, WIN, 25n * USDG],
        [3, 2, WIN, 7_333_333n],
        [4, 0, PLACE, 12n * USDG],
        [5, 3, PLACE, 40n * USDG],
        [6, 5, PLACE, 9_999_999n],
        [7, 7, PLACE, 3n * USDG],
      ];
      for (const [b, r, p, a] of plan) await bet(bettors[b]!, raceId, r, p, a);
      const [ev] = await tote.getEvents.BetPlaced({ raceId }, { fromBlock: 0n });
      expect(ev!.args.amount).to.equal(10n * USDG);
      expect(await tote.read.runnerStakes([raceId, WIN])).to.deep.equal([40n * USDG, 25n * USDG, 7_333_333n, 0n, 0n, 0n, 0n, 0n]);
      const odds = toteOddsMilli(await tote.read.runnerStakes([raceId, WIN]), TAKE_BPS, 1);
      expect(odds[0]).to.equal(Math.floor(((72_333_333 - Math.floor((72_333_333 * 1500) / 10_000)) * 1000) / 40_000_000));

      await closeAndSeal(raceId, closeTime);
      const m1 = await tote.read.getMarket([raceId]);
      // M4: the entropy mixes ENTROPY_BLOCKS consecutive block hashes from the locked block
      const hashes: Hex[] = [];
      for (let i = 0n; i < ENTROPY_BLOCKS; i++) hashes.push((await publicClient.getBlock({ blockNumber: m1.entropyBlock + i })).hash!);
      expect(m1.entropy).to.equal(keccak256(concat([raceId, ...hashes])));
      // finishing order by runner index: runner 0 won, 3 second, 5 third
      const positions = [1, 4, 5, 2, 6, 3, 7, 8];
      await settle(raceId, seed, positions);
      const m2 = await tote.read.getMarket([raceId]);
      expect(m2.status).to.equal(STATUS.finalized);
      expect(m2.revealedSeed).to.equal(seed);
      expect(m2.finalSeed).to.equal(`0x${toteFinalSeed(seed, m1.entropy)}`);
      expect(unpackTotePositions(m2.positions, 8)).to.deep.equal(positions);

      const { expected, house } = expectedFrom(plan, positions, 150);
      let paid = 0n;
      for (let b = 0; b < plan.length; b++) {
        const preview = await tote.read.claimable([raceId, bettors[b]!.account.address]);
        const got = await claimAs(bettors[b]!, raceId);
        expect(got, `bettor ${b}`).to.equal(expected.get(b) ?? 0n);
        expect(preview).to.equal(got);
        paid += got;
      }
      expect(await tote.read.treasuryOwed([usd.address])).to.equal(house);
      const total = plan.reduce((s, [, , , a]) => s + a, 0n);
      expect(paid + house).to.equal(total);
      await asOther.write.withdrawTreasury([usd.address]);
      expect(await usd.read.balanceOf([treasury.account.address])).to.equal(house);
      expect(await usd.read.balanceOf([tote.address])).to.equal(0n);
    });
  });

  describe("bet refusals", () => {
    it("accepts a bet one second before closeTime - CLOSE_MARGIN", async () => {
      const { bettors, market, permit, as, tote } = await loadFixture(fixture);
      const { raceId, closeTime } = await market();
      const { p, sig } = await permit(bettors[0]!.account.address, raceId, USDG, 0, WIN, { expiry: closeTime, issuedAt: closeTime - 300n });
      await time.setNextBlockTimestamp(closeTime - CLOSE_MARGIN - 1n);
      await (await as(bettors[0]!)).write.bet([raceId, 0, WIN, USDG, p, sig]);
      expect(await tote.read.walletTotal([raceId, bettors[0]!.account.address])).to.equal(USDG);
    });

    it("refuses a bet whose block lands at or after closeTime - CLOSE_MARGIN, and after the close", async () => {
      const f = await loadFixture(fixture);
      const { raceId, closeTime } = await f.market();
      const w = f.bettors[0]!;
      const c = await f.as(w);
      const a = await f.permit(w.account.address, raceId, USDG, 0, WIN, { expiry: closeTime, issuedAt: closeTime - 300n });
      await time.setNextBlockTimestamp(closeTime - CLOSE_MARGIN);
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, a.p, a.sig]), "BettingClosed");
      await time.increaseTo(closeTime + 10n);
      const b = await f.permit(w.account.address, raceId, USDG, 0, WIN);
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, b.p, b.sig]), "BettingClosed");
    });

    it("refuses missing, expired, reused, foreign and wrong-signer permits", async () => {
      const f = await loadFixture(fixture);
      const { raceId } = await f.market();
      const { raceId: otherRace } = await f.market();
      const w = f.bettors[0]!;
      const c = await f.as(w);
      const ok = await f.permit(w.account.address, raceId, 5n * USDG, 0, WIN);
      // no signature at all
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, ok.p, "0x"]), "InvalidSignature");
      // tampered amount ceiling
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, { ...ok.p, maxAmount: 50n * USDG }, ok.sig]), "InvalidSignature");
      // signed by a key without PERMIT_SIGNER_ROLE
      const rogue = await localServerWallet();
      const rogueSig = await rogue.wallet.signTypedData({ account: rogue.account, ...betPermitTypedData(ok.p, f.chainId, getAddress(f.tote.address)) });
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, ok.p, rogueSig]), "InvalidSignature");
      // someone else's permit
      const theirs = await f.permit(f.bettors[1]!.account.address, raceId, USDG, 0, WIN);
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, theirs.p, theirs.sig]), "NotPermitBettor");
      // a permit for another race
      const elsewhere = await f.permit(w.account.address, otherRace, USDG, 0, WIN);
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, elsewhere.p, elsewhere.sig]), "PermitRaceMismatch");
      // above the permit's maxAmount
      await expectRevert(c.write.bet([raceId, 0, WIN, 6n * USDG, ok.p, ok.sig]), "AboveMaxAmount");
      // expired
      const now = await latestTimestamp();
      const short = await f.permit(w.account.address, raceId, USDG, 0, WIN, { expiry: now + 5n });
      await time.increase(10);
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, short.p, short.sig]), "PermitExpired");
      // single use
      const once = await f.permit(w.account.address, raceId, 5n * USDG, 0, WIN);
      await c.write.bet([raceId, 0, WIN, USDG, once.p, once.sig]);
      expect(await f.tote.read.nonceUsed([w.account.address, once.p.nonce])).to.equal(true);
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, once.p, once.sig]), "NonceUsed");
    });

    it("L1 exploit A: a permit for runner 0 / WIN can't be used on runner 5 / PLACE (or any other runner or pool)", async () => {
      const f = await loadFixture(fixture);
      const { raceId } = await f.market();
      const w = f.bettors[0]!;
      const c = await f.as(w);
      const { p, sig } = await f.permit(w.account.address, raceId, 10n * USDG, 0, WIN);
      await expectRevert(c.write.bet([raceId, 5, PLACE, USDG, p, sig]), "PermitTermsMismatch");
      await expectRevert(c.write.bet([raceId, 5, WIN, USDG, p, sig]), "PermitTermsMismatch");
      await expectRevert(c.write.bet([raceId, 0, PLACE, USDG, p, sig]), "PermitTermsMismatch");
      // rewriting the permit's runner and pool breaks the signature
      await expectRevert(c.write.bet([raceId, 5, PLACE, USDG, { ...p, runner: 5, pool: PLACE }, sig]), "InvalidSignature");
      await c.write.bet([raceId, 0, WIN, USDG, p, sig]);
      expect(await f.tote.read.stakeOf([raceId, w.account.address, WIN, 0])).to.equal(USDG);
      expect(await f.tote.read.stakeOf([raceId, w.account.address, PLACE, 5])).to.equal(0n);
    });

    it("L2 exploit E: a long-dated permit is refused (lifetime counted from issue; not valid before issue)", async () => {
      const f = await loadFixture(fixture);
      const { raceId } = await f.market({ closeIn: 6n * 86_400n });
      const w = f.bettors[0]!;
      const c = await f.as(w);
      const now = await latestTimestamp();
      // issued now, valid for a day
      const long = await f.permit(w.account.address, raceId, USDG, 0, WIN, { issuedAt: now, expiry: now + 86_400n });
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, long.p, long.sig]), "PermitTtlTooLong");
      // pre-signed for use in two days: refused now, and refused then too (its lifetime from issue is too long)
      const later = await f.permit(w.account.address, raceId, USDG, 0, WIN, { issuedAt: now + 2n * 86_400n, expiry: now + 2n * 86_400n + 300n });
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, later.p, later.sig]), "PermitNotYetValid");
      const backdated = await f.permit(w.account.address, raceId, USDG, 0, WIN, { issuedAt: now - 86_400n, expiry: now + 300n });
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, backdated.p, backdated.sig]), "PermitTtlTooLong");
      // exactly MAX_PERMIT_TTL from issue is fine
      const edge = await f.permit(w.account.address, raceId, USDG, 0, WIN, { issuedAt: now, expiry: now + 600n });
      await c.write.bet([raceId, 0, WIN, USDG, edge.p, edge.sig]);
    });

    it("enforces the minimum, per-bet, per-wallet and pool caps", async () => {
      const f = await loadFixture(fixture);
      const { raceId } = await f.market({ maxPool: 300n * USDG });
      const [w0, w1, w2, w3] = f.bettors;
      await expectRevert(f.bet(w0!, raceId, 0, WIN, USDG - 1n), "StakeBelowMin");
      await expectRevert(f.bet(w0!, raceId, 0, WIN, 100n * USDG + 1n), "StakeAboveMax");
      await f.bet(w0!, raceId, 0, WIN, 100n * USDG);
      await f.bet(w0!, raceId, 1, PLACE, 100n * USDG);
      await f.bet(w0!, raceId, 2, WIN, 50n * USDG);
      expect(await f.tote.read.walletTotal([raceId, w0!.account.address])).to.equal(250n * USDG);
      await expectRevert(f.bet(w0!, raceId, 2, WIN, USDG), "WalletCapExceeded");
      await f.bet(w1!, raceId, 0, WIN, 100n * USDG);
      await f.bet(w2!, raceId, 0, WIN, 50n * USDG); // WIN pool now 300
      await expectRevert(f.bet(w3!, raceId, 0, WIN, USDG), "PoolCapExceeded");
      await f.bet(w3!, raceId, 0, PLACE, USDG); // the place pool has its own cap
    });

    it("refuses bad runners, a missing place pool, unknown markets and paused betting", async () => {
      const f = await loadFixture(fixture);
      const { raceId } = await f.market({ runners: 4, places: 0 });
      const w = f.bettors[0]!;
      await expectRevert(f.bet(w, raceId, 4, WIN, USDG), "BadRunner");
      await expectRevert(f.bet(w, raceId, 0, PLACE, USDG), "NoPlacePool");
      await expectRevert(f.bet(w, toteRaceKey("nope"), 0, WIN, USDG), "MarketNotOpen");
      await expectAnyRevert(f.bet(w, raceId, 0, 2, USDG)); // no such pool
      await expectRevert(f.asOther.write.pause(), "AccessControlUnauthorizedAccount");
      const asAdmin = await f.as(f.admin);
      await asAdmin.write.pause();
      await expectRevert(f.bet(w, raceId, 0, WIN, USDG), "EnforcedPause");
      await expectRevert(f.asOther.write.unpause(), "AccessControlUnauthorizedAccount");
      await asAdmin.write.unpause();
      await f.bet(w, raceId, 0, WIN, USDG);
    });

    it("refuses fee-on-transfer tokens (the amount received must be exact)", async () => {
      const f = await loadFixture(fixture);
      const { raceId } = await f.market();
      await f.usd.write.setFeeBps([100n]);
      await expectRevert(f.bet(f.bettors[0]!, raceId, 0, WIN, 10n * USDG), "UnexpectedAmountReceived");
    });
  });

  describe("entropy", () => {
    it("can't be locked before the close, is locked once, sealed once, only after its last block exists", async () => {
      const f = await loadFixture(fixture);
      const { raceId, closeTime } = await f.market();
      await expectRevert(f.asOther.write.lockEntropy([raceId]), "EntropyTooEarly");
      await expectRevert(f.asOther.write.sealEntropy([raceId]), "EntropyNotLocked");
      await time.increaseTo(closeTime);
      await f.asOther.write.lockEntropy([raceId]);
      await expectRevert(f.asOther.write.lockEntropy([raceId]), "EntropyAlreadyLocked");
      await expectRevert(f.asOther.write.sealEntropy([raceId]), "EntropyNotReady");
      // the first entropy blocks exist, the last doesn't yet (the seal would run in the block before it)
      const last = (await f.tote.read.getMarket([raceId])).entropyBlock + ENTROPY_BLOCKS - 1n;
      const head = await f.publicClient.getBlockNumber();
      if (last - 1n > head) await mine(Number(last - 1n - head));
      await expectRevert(f.asOther.write.sealEntropy([raceId]), "EntropyNotReady");
      await mine(2);
      await f.asOther.write.sealEntropy([raceId]);
      await expectRevert(f.asOther.write.sealEntropy([raceId]), "EntropyAlreadySealed");
      await expectRevert(f.asOther.write.lockEntropy([toteRaceKey("none")]), "MarketNotOpen");
    });

    it("voids the market when nobody sealed while the block hashes were readable", async () => {
      const f = await loadFixture(fixture);
      const { raceId, closeTime } = await f.market();
      await f.bet(f.bettors[0]!, raceId, 0, WIN, 10n * USDG);
      await time.increaseTo(closeTime);
      await f.asOther.write.lockEntropy([raceId]);
      await mine(300);
      await f.asOther.write.sealEntropy([raceId]);
      expect((await f.tote.read.getMarket([raceId])).status).to.equal(STATUS.void);
      const [ev] = await f.tote.getEvents.MarketVoided({ raceId }, { fromBlock: 0n });
      expect(ev!.args.reason).to.equal(reasonOf("entropy_missed"));
      expect(await f.claimAs(f.bettors[0]!, raceId)).to.equal(10n * USDG);
    });

    it("uses ArbSys block numbers and hashes when configured, voids when out of range, and any other ArbSys failure reverts instead of voiding", async () => {
      const arb = await hre.viem.deployContract("MockArbSys", []);
      const f = await deployTote("MockStablecoin", arb.address);
      const a = await f.market();
      await f.bet(f.bettors[0]!, a.raceId, 0, WIN, 10n * USDG);
      await f.bet(f.bettors[1]!, a.raceId, 1, WIN, 10n * USDG);
      await f.closeAndSeal(a.raceId, a.closeTime);
      const m = await f.tote.read.getMarket([a.raceId]);
      const hashes: Hex[] = [];
      for (let i = 0n; i < ENTROPY_BLOCKS; i++) hashes.push((await f.publicClient.getBlock({ blockNumber: m.entropyBlock + i })).hash!);
      expect(m.entropy).to.equal(keccak256(concat([a.raceId, ...hashes])));
      await f.settle(a.raceId, a.seed, [1, 2, 3, 4, 5, 6, 7, 8]);
      expect(await f.claimAs(f.bettors[0]!, a.raceId)).to.equal(17n * USDG);

      const b = await f.market();
      await time.increaseTo(b.closeTime);
      await f.asOther.write.lockEntropy([b.raceId]);
      await mine(300);
      await f.asOther.write.sealEntropy([b.raceId]);
      expect((await f.tote.read.getMarket([b.raceId])).status).to.equal(STATUS.void);

      // Info: an unexpected ArbSys error (or a starved call) must not be read as "missed": it reverts.
      const c = await f.market();
      await time.increaseTo(c.closeTime);
      await f.asOther.write.lockEntropy([c.raceId]);
      await mine(Number(ENTROPY_DELAY + ENTROPY_BLOCKS));
      await arb.write.setBroken([true]);
      await expectRevert(f.asOther.write.sealEntropy([c.raceId]), "EntropyReadFailed");
      expect((await f.tote.read.getMarket([c.raceId])).status).to.equal(STATUS.open);
      await arb.write.setBroken([false]);
      await f.asOther.write.sealEntropy([c.raceId]);
      expect((await f.tote.read.getMarket([c.raceId])).entropy).to.not.equal(`0x${"00".repeat(32)}`);
    });

    it("M4: an optional randomness beacon (off by default) is requested at lock and mixed in at seal", async () => {
      const f = await loadFixture(fixture);
      const beacon = await hre.viem.deployContract("MockEntropyBeacon", []);
      const asAdmin = await f.as(f.admin);
      await expectRevert(f.asOperator.write.setEntropyBeacon([beacon.address]), "AccessControlUnauthorizedAccount");
      await expectRevert(asAdmin.write.setEntropyBeacon([f.other.account.address]), "BadConfig"); // no code
      const before = await f.market(); // created without a beacon: keeps none
      await asAdmin.write.setEntropyBeacon([beacon.address]);
      const { raceId, closeTime } = await f.market();
      expect(getAddress((await f.tote.read.getMarket([raceId])).beacon)).to.equal(getAddress(beacon.address));
      expect((await f.tote.read.getMarket([before.raceId])).beacon).to.equal(ZERO_ADDRESS);
      await time.increaseTo(closeTime);
      await f.asOther.write.lockEntropy([raceId]);
      expect(await beacon.read.requested([raceId])).to.equal(true);
      await mine(Number(ENTROPY_DELAY + ENTROPY_BLOCKS));
      // the block part is fixed now; the beacon hasn't delivered
      await f.asOther.write.sealEntropy([raceId]);
      const m1 = await f.tote.read.getMarket([raceId]);
      expect(m1.blockEntropy).to.not.equal(`0x${"00".repeat(32)}`);
      expect(m1.entropy).to.equal(`0x${"00".repeat(32)}`);
      await expectRevert(f.asOther.write.sealEntropy([raceId]), "BeaconNotReady");
      // much later (block hashes long gone) the beacon delivers: no void, the stored block part is used
      await mine(300);
      const r = random32();
      await beacon.write.deliver([raceId, r]);
      await f.asOther.write.sealEntropy([raceId]);
      expect((await f.tote.read.getMarket([raceId])).entropy).to.equal(keccak256(concat([m1.blockEntropy, r])));
      await asAdmin.write.setEntropyBeacon([ZERO_ADDRESS]);
      expect(await f.tote.read.entropyBeacon()).to.equal(ZERO_ADDRESS);
    });
  });

  describe("results", () => {
    it("checks the operator role, the sealed entropy, the seed commitment and the finish", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 5 });
      await expectRevert(f.asOperator.write.postResult([raceId, seed, [1, 2, 3, 4, 5]]), "EntropyNotSealed");
      await f.closeAndSeal(raceId, closeTime);
      await expectRevert(f.asOther.write.postResult([raceId, seed, [1, 2, 3, 4, 5]]), "AccessControlUnauthorizedAccount");
      await expectRevert(f.asOperator.write.postResult([raceId, random32(), [1, 2, 3, 4, 5]]), "SeedMismatch");
      for (const bad of [[1, 2, 3, 4], [1, 2, 3, 4, 6], [2, 3, 4, 5, 6], [1, 1, 2, 3, 4], [1, 2, 2, 2, 3], [0, 0, 0, 0, 2], [1, 3, 4, 5, 6]]) {
        await expectRevert(f.asOperator.write.postResult([raceId, seed, bad]), "BadPositions");
      }
      // valid: dead heats and non-runners in standard ranking
      await f.asOperator.write.postResult([raceId, seed, [1, 1, 3, 0, 4]]);
      await expectRevert(f.asOperator.write.postResult([raceId, seed, [1, 2, 3, 4, 5]]), "MarketNotOpen");
      await expectRevert(f.asOther.write.finalize([raceId]), "ChallengeWindowOpen");
    });

    it("H1 exploit D: an operator-only fake result can't finalize without a matching attestation", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 5 });
      const [honest, insider] = f.bettors;
      await f.bet(honest!, raceId, 0, WIN, 100n * USDG);
      await f.bet(insider!, raceId, 4, WIN, 5n * USDG); // the longshot
      await f.closeAndSeal(raceId, closeTime);
      const truth = [1, 2, 3, 4, 5];
      const fake = [5, 2, 3, 4, 1]; // posts the longshot as the winner
      await f.asOperator.write.postResult([raceId, seed, fake]);
      await time.increase(CHALLENGE);
      // no attestation: can't finalize
      await expectRevert(f.asOther.write.finalize([raceId]), "NotAttested");
      // only the attestor role attests (not the operator)
      await expectRevert(f.asOperator.write.attestResult([raceId, await f.hashFor(raceId, fake)]), "AccessControlUnauthorizedAccount");
      // the independent replay disagrees: the market freezes
      await f.asAttestor.write.attestResult([raceId, await f.hashFor(raceId, truth)]);
      const [ev] = await f.tote.getEvents.ResultAttested({ raceId }, { fromBlock: 0n });
      expect(ev!.args.matches).to.equal(false);
      expect((await f.tote.read.getMarket([raceId])).disputed).to.equal(true);
      await expectRevert(f.asOther.write.finalize([raceId]), "ResultDisputed");
      // a later matching attestation doesn't lift the freeze: only the guardian does
      await f.asAttestor.write.attestResult([raceId, await f.hashFor(raceId, fake)]);
      await expectRevert(f.asOther.write.finalize([raceId]), "ResultDisputed");
      // past the window, the guardian can still correct a frozen result (then a new full window)
      await f.asGuardian.write.correctResult([raceId, truth]);
      await expectRevert(f.asOther.write.finalize([raceId]), "ChallengeWindowOpen");
      await time.increase(CHALLENGE);
      await expectRevert(f.asOther.write.finalize([raceId]), "AttestationMismatch"); // the last attestation was the fake
      await f.asAttestor.write.attestResult([raceId, await f.hashFor(raceId, truth)]);
      await f.asOther.write.finalize([raceId]);
      expect(await f.claimAs(insider!, raceId)).to.equal(0n);
      // winners never lose: the 15 % take would leave the favourite short, so only the 5 USDG profit is taken
      expect(await f.claimAs(honest!, raceId)).to.equal(100n * USDG);
      expect(await f.tote.read.treasuryOwed([f.usd.address])).to.equal(5n * USDG);
    });

    it("M2 exploit C: a correction at challengeEnd - 1 reopens the full window; at most 2 corrections, then only void", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 5 });
      await f.bet(f.bettors[0]!, raceId, 1, WIN, 10n * USDG);
      await f.bet(f.bettors[1]!, raceId, 0, WIN, 10n * USDG);
      await f.closeAndSeal(raceId, closeTime);
      await f.asOperator.write.postResult([raceId, seed, [1, 2, 3, 4, 5]]);
      await f.asAttestor.write.attestResult([raceId, await f.hashFor(raceId, [2, 1, 3, 4, 5])]);
      await expectRevert(f.asOperator.write.correctResult([raceId, [2, 1, 3, 4, 5]]), "AccessControlUnauthorizedAccount");
      const end0 = (await f.tote.read.getMarket([raceId])).challengeEnd;
      await time.setNextBlockTimestamp(end0 - 1n);
      await f.asGuardian.write.correctResult([raceId, [2, 1, 3, 4, 5]]);
      const m = await f.tote.read.getMarket([raceId]);
      expect(m.challengeEnd).to.equal(end0 - 1n + CHALLENGE);
      expect(m.corrections).to.equal(1);
      expect(m.disputed).to.equal(false);
      // at the old challengeEnd the window is still open
      await time.setNextBlockTimestamp(end0);
      await expectRevert(f.asOther.write.finalize([raceId]), "ChallengeWindowOpen");
      await expectRevert(f.asGuardian.write.correctResult([raceId, [1, 2, 3, 4]]), "BadPositions");
      await f.asGuardian.write.correctResult([raceId, [1, 2, 3, 4, 5]]);
      await expectRevert(f.asGuardian.write.correctResult([raceId, [2, 1, 3, 4, 5]]), "TooManyCorrections");
      // the last correction disagrees with the attestation; re-attest the replayed truth
      await f.asAttestor.write.attestResult([raceId, await f.hashFor(raceId, [2, 1, 3, 4, 5])]);
      expect((await f.tote.read.getMarket([raceId])).disputed).to.equal(true);
      // too many corrections: the guardian can only void now
      await f.asGuardian.write.voidMarket([raceId]);
      expect(await f.claimAs(f.bettors[0]!, raceId)).to.equal(10n * USDG);
      expect(await f.claimAs(f.bettors[1]!, raceId)).to.equal(10n * USDG);
    });

    it("lets the guardian correct (and the result stand) only in the window once a result is attested", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 5 });
      await f.bet(f.bettors[0]!, raceId, 1, WIN, 10n * USDG);
      await f.bet(f.bettors[1]!, raceId, 0, WIN, 10n * USDG);
      await f.closeAndSeal(raceId, closeTime);
      await f.asOperator.write.postResult([raceId, seed, [2, 1, 3, 4, 5]]);
      await f.asAttestor.write.attestResult([raceId, await f.hashFor(raceId, [2, 1, 3, 4, 5])]);
      await expectRevert(f.asAttestor.write.attestResult([raceId, `0x${"00".repeat(32)}`]), "BadPositions");
      await time.increase(CHALLENGE);
      await expectRevert(f.asGuardian.write.correctResult([raceId, [1, 2, 3, 4, 5]]), "ChallengeWindowOver");
      await expectRevert(f.asGuardian.write.voidMarket([raceId]), "ChallengeWindowOver");
      await expectRevert(f.asOther.write.expireMarket([raceId]), "NotVoidable");
      await f.asOther.write.finalize([raceId]);
      await expectRevert(f.asOther.write.finalize([raceId]), "NotResultPosted");
      await expectRevert(f.asGuardian.write.correctResult([raceId, [1, 2, 3, 4, 5]]), "NotResultPosted");
      await expectRevert(f.asAttestor.write.attestResult([raceId, random32()]), "NotResultPosted");
      // runner 1 won: bettor 0 gets the stake back plus the whole profit
      expect(await f.claimAs(f.bettors[0]!, raceId)).to.equal(17n * USDG);
      expect(await f.claimAs(f.bettors[1]!, raceId)).to.equal(0n);
    });

    it("guardian void refunds every stake in full (open, or within the window); finalized markets can't be voided", async () => {
      const f = await loadFixture(fixture);
      const a = await f.market();
      await f.bet(f.bettors[0]!, a.raceId, 0, WIN, 10n * USDG);
      await f.bet(f.bettors[1]!, a.raceId, 1, PLACE, 3n * USDG);
      await expectRevert(f.asOther.write.voidMarket([a.raceId]), "AccessControlUnauthorizedAccount");
      await f.asGuardian.write.voidMarket([a.raceId]);
      await expectRevert(f.bet(f.bettors[0]!, a.raceId, 0, WIN, USDG), "MarketNotOpen");
      expect(await f.claimAs(f.bettors[0]!, a.raceId)).to.equal(10n * USDG);
      expect(await f.claimAs(f.bettors[1]!, a.raceId)).to.equal(3n * USDG);
      await expectRevert(f.asGuardian.write.voidMarket([a.raceId]), "NotVoidable");

      const b = await f.market();
      await f.bet(f.bettors[0]!, b.raceId, 0, WIN, 10n * USDG);
      await f.closeAndSeal(b.raceId, b.closeTime);
      await f.asOperator.write.postResult([b.raceId, b.seed, [1, 2, 3, 4, 5, 6, 7, 8]]);
      await f.asGuardian.write.voidMarket([b.raceId]);
      await expectRevert(f.asOther.write.finalize([b.raceId]), "NotResultPosted");
      expect(await f.claimAs(f.bettors[0]!, b.raceId)).to.equal(10n * USDG);
      expect(await f.tote.read.treasuryOwed([f.usd.address])).to.equal(0n);
      expect(await f.usd.read.balanceOf([f.tote.address])).to.equal(0n);
    });

    it("M1 exploit B: the operator can't cancel once the entropy block exists (only the guardian can void)", async () => {
      const f = await loadFixture(fixture);
      const a = await f.market();
      await f.bet(f.bettors[0]!, a.raceId, 0, WIN, 10n * USDG);
      await expectRevert(f.asOther.write.cancelMarket([a.raceId]), "AccessControlUnauthorizedAccount");
      await f.asOperator.write.cancelMarket([a.raceId]); // before the close: fine
      expect(await f.claimAs(f.bettors[0]!, a.raceId)).to.equal(10n * USDG);
      // after the close but before lockEntropy, still nobody can know anything: fine
      const b = await f.market();
      await time.increaseTo(b.closeTime);
      await f.asOperator.write.cancelMarket([b.raceId]);
      // the insider waits for the entropy block, reads its hash, and tries to cancel a losing market
      const c = await f.market();
      await f.bet(f.bettors[1]!, c.raceId, 0, WIN, 10n * USDG);
      await time.increaseTo(c.closeTime);
      await f.asOther.write.lockEntropy([c.raceId]);
      await mine(Number(ENTROPY_DELAY + ENTROPY_BLOCKS));
      await expectRevert(f.asOperator.write.cancelMarket([c.raceId]), "NotVoidable"); // block hashes exist, not sealed yet
      await f.asOther.write.sealEntropy([c.raceId]);
      await expectRevert(f.asOperator.write.cancelMarket([c.raceId]), "NotVoidable");
      await f.asGuardian.write.voidMarket([c.raceId]);
      expect(await f.claimAs(f.bettors[1]!, c.raceId)).to.equal(10n * USDG);
    });

    it("anyone expires a market with no result after MAX_SETTLE_DELAY; a late result is refused", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market();
      await f.bet(f.bettors[0]!, raceId, 0, WIN, 10n * USDG);
      await f.bet(f.bettors[1]!, raceId, 1, WIN, 5n * USDG);
      await f.closeAndSeal(raceId, closeTime);
      await expectRevert(f.asOther.write.expireMarket([raceId]), "NotExpired");
      await time.increaseTo(closeTime + MAX_SETTLE + 1n);
      await expectRevert(f.asOperator.write.postResult([raceId, seed, [1, 2, 3, 4, 5, 6, 7, 8]]), "ResultTooLate");
      await f.asOther.write.expireMarket([raceId]);
      await expectRevert(f.asOther.write.expireMarket([raceId]), "MarketNotOpen");
      expect(await f.claimAs(f.bettors[0]!, raceId)).to.equal(10n * USDG);
      expect(await f.claimAs(f.bettors[1]!, raceId)).to.equal(5n * USDG);
      expect(await f.usd.read.balanceOf([f.tote.address])).to.equal(0n);
    });

    it("a posted result that never gets a matching attestation expires to refunds (funds never stuck)", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 5 });
      await f.bet(f.bettors[0]!, raceId, 0, WIN, 10n * USDG);
      await f.bet(f.bettors[1]!, raceId, 1, WIN, 5n * USDG);
      await f.closeAndSeal(raceId, closeTime);
      await f.asOperator.write.postResult([raceId, seed, [1, 2, 3, 4, 5]]);
      const end = (await f.tote.read.getMarket([raceId])).challengeEnd;
      await time.increaseTo(end + MAX_SETTLE - 10n);
      await expectRevert(f.asOther.write.expireMarket([raceId]), "NotExpired");
      await time.increase(20);
      await f.asOther.write.expireMarket([raceId]);
      const [ev] = await f.tote.getEvents.MarketVoided({ raceId }, { fromBlock: 0n });
      expect(ev!.args.reason).to.equal(reasonOf("expired"));
      expect(await f.claimAs(f.bettors[0]!, raceId)).to.equal(10n * USDG);
    });
  });

  describe("settlement rules", () => {
    it("dead heat for first in the WIN pool: stakes back, then half the profit to each dead-heater", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 6 });
      await f.bet(f.bettors[0]!, raceId, 0, WIN, 10n * USDG);
      await f.bet(f.bettors[1]!, raceId, 1, WIN, 30n * USDG);
      await f.bet(f.bettors[2]!, raceId, 2, WIN, 60n * USDG);
      await f.closeAndSeal(raceId, closeTime);
      await f.settle(raceId, seed, [1, 1, 3, 4, 5, 6]);
      // net 85, winning stakes 40, profit 45: 22.5 each on top of the stake
      expect(await f.claimAs(f.bettors[0]!, raceId)).to.equal(32_500_000n);
      expect(await f.claimAs(f.bettors[1]!, raceId)).to.equal(52_500_000n);
      expect(await f.claimAs(f.bettors[2]!, raceId)).to.equal(0n);
    });

    it("dead heat for the last paying place shares that place's part of the profit (8 runners, 3 places)", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 8 });
      const plan: [number, number, number, bigint][] = [0, 1, 2, 3].map((r) => [r, r, PLACE, 10n * USDG] as [number, number, number, bigint]);
      plan.push([4, 4, PLACE, 20n * USDG]);
      for (const [b, r, p, a] of plan) await f.bet(f.bettors[b]!, raceId, r, p, a);
      await f.closeAndSeal(raceId, closeTime);
      const positions = [1, 2, 3, 3, 5, 6, 7, 8];
      await f.settle(raceId, seed, positions);
      const { expected } = expectedFrom(plan, positions, 150);
      for (let b = 0; b < 5; b++) expect(await f.claimAs(f.bettors[b]!, raceId), `bettor ${b}`).to.equal(expected.get(b) ?? 0n);
      // profit 11 (60 - 9 - 40): thirds for 1st and 2nd, the third split between the dead-heaters
      expect(expected.get(0)).to.equal(10n * USDG + (11n * USDG * 6n) / 18n);
      await f.asOther.write.withdrawTreasury([f.usd.address]);
      expect(await f.usd.read.balanceOf([f.tote.address])).to.equal(0n);
    });

    it("an unbacked paying runner's part goes to the other paying runners", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 8 });
      await f.bet(f.bettors[0]!, raceId, 0, PLACE, 10n * USDG); // 1st
      await f.bet(f.bettors[1]!, raceId, 5, PLACE, 10n * USDG); // unplaced
      await f.closeAndSeal(raceId, closeTime);
      await f.settle(raceId, seed, [1, 2, 3, 4, 5, 6, 7, 8]);
      expect(await f.claimAs(f.bettors[0]!, raceId)).to.equal(17n * USDG);
      expect(await f.claimAs(f.bettors[1]!, raceId)).to.equal(0n);
    });

    it("no winner: the net pool goes back to every staker pro rata", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 6 });
      await f.bet(f.bettors[0]!, raceId, 3, WIN, 10n * USDG);
      await f.bet(f.bettors[1]!, raceId, 4, WIN, 30n * USDG);
      await f.bet(f.bettors[2]!, raceId, 4, WIN, 7_777_777n);
      await f.closeAndSeal(raceId, closeTime);
      await f.settle(raceId, seed, [1, 2, 3, 4, 5, 6]);
      const total = 47_777_777n;
      const net = total - (total * 1_500n) / 10_000n;
      const got = [];
      for (let b = 0; b < 3; b++) got.push(await f.claimAs(f.bettors[b]!, raceId));
      expect(got).to.deep.equal([10n * USDG, 30n * USDG, 7_777_777n].map((s) => (net * s) / total));
      await f.asOther.write.withdrawTreasury([f.usd.address]);
      expect(await f.usd.read.balanceOf([f.tote.address])).to.equal(0n);
    });

    it("non-runners are refunded in full and outside the pool", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 6 });
      await f.bet(f.bettors[0]!, raceId, 0, WIN, 10n * USDG);
      await f.bet(f.bettors[1]!, raceId, 2, WIN, 20n * USDG); // scratched
      await f.bet(f.bettors[2]!, raceId, 1, WIN, 10n * USDG);
      await f.bet(f.bettors[1]!, raceId, 0, PLACE, 5n * USDG); // the only place bet: a thin pool, refunded
      await f.closeAndSeal(raceId, closeTime);
      // runner 2 a non-runner: 5 ran, so the place pool pays 2 places
      await f.settle(raceId, seed, [1, 2, 0, 3, 4, 5]);
      expect(await f.claimAs(f.bettors[0]!, raceId)).to.equal(17n * USDG); // stake back + the 10 live less 15 %
      expect(await f.claimAs(f.bettors[1]!, raceId)).to.equal(25n * USDG);
      expect(await f.claimAs(f.bettors[2]!, raceId)).to.equal(0n);
    });

    it("too few runners left for a place pool: every place stake refunded", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 5 });
      await f.bet(f.bettors[0]!, raceId, 0, PLACE, 10n * USDG);
      await f.bet(f.bettors[2]!, raceId, 1, PLACE, 10n * USDG);
      await f.bet(f.bettors[1]!, raceId, 0, WIN, 10n * USDG);
      await f.bet(f.bettors[2]!, raceId, 1, WIN, 10n * USDG);
      await f.closeAndSeal(raceId, closeTime);
      await f.settle(raceId, seed, [1, 2, 3, 4, 0]); // 4 ran: no place pool
      const [ev] = await f.tote.getEvents.PoolRefunded({ raceId }, { fromBlock: 0n });
      expect([ev!.args.pool, ev!.args.reason]).to.deep.equal([PLACE, reasonOf("no_place_pool")]);
      expect(await f.claimAs(f.bettors[0]!, raceId)).to.equal(10n * USDG);
      expect(await f.claimAs(f.bettors[1]!, raceId)).to.equal(17n * USDG);
      expect(await f.claimAs(f.bettors[2]!, raceId)).to.equal(10n * USDG);
    });

    it("minimum pool: one wallet on two runners, or two wallets on one runner, is refunded in full with no take", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 6 });
      const [a, b] = f.bettors;
      await f.bet(a!, raceId, 0, WIN, 30n * USDG);
      await f.bet(a!, raceId, 1, WIN, 20n * USDG); // WIN: one wallet, two runners
      await f.bet(a!, raceId, 2, PLACE, 10n * USDG);
      await f.bet(b!, raceId, 2, PLACE, 15n * USDG); // PLACE: two wallets, one runner
      await f.closeAndSeal(raceId, closeTime);
      await f.settle(raceId, seed, [1, 2, 3, 4, 5, 6]);
      const evs = await f.tote.getEvents.PoolRefunded({ raceId }, { fromBlock: 0n });
      expect(evs.map((e) => [e.args.pool, e.args.reason])).to.deep.equal([
        [WIN, reasonOf("thin_pool")],
        [PLACE, reasonOf("thin_pool")],
      ]);
      expect(await f.claimAs(a!, raceId)).to.equal(60n * USDG);
      expect(await f.claimAs(b!, raceId)).to.equal(15n * USDG);
      expect(await f.tote.read.treasuryOwed([f.usd.address])).to.equal(0n);
      expect(await f.usd.read.balanceOf([f.tote.address])).to.equal(0n);
    });

    it("winners never lose: the take is cut (to zero if needed) so every winner gets the stake back", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 6 });
      const [a, b, c, d] = f.bettors;
      await f.bet(a!, raceId, 0, WIN, 95n * USDG); // heavy favourite
      await f.bet(b!, raceId, 1, WIN, 5n * USDG);
      // PLACE: both placed runners carry the whole pool, so even a zero take only returns the stakes
      await f.bet(c!, raceId, 0, PLACE, 90n * USDG);
      await f.bet(d!, raceId, 1, PLACE, 10n * USDG);
      await f.closeAndSeal(raceId, closeTime);
      await f.settle(raceId, seed, [1, 2, 3, 4, 5, 6]);
      expect(await f.claimAs(a!, raceId)).to.equal(95n * USDG);
      expect(await f.claimAs(b!, raceId)).to.equal(0n);
      expect(await f.claimAs(c!, raceId)).to.equal(90n * USDG);
      expect(await f.claimAs(d!, raceId)).to.equal(10n * USDG);
      expect(await f.tote.read.treasuryOwed([f.usd.address])).to.equal(5n * USDG); // the take, cut from 15 to 5
      const [fin] = await f.tote.getEvents.MarketFinalized({ raceId }, { fromBlock: 0n });
      expect(fin!.args.toTreasury).to.equal(5n * USDG);
    });

    it("L4: only paying runners with a share count toward entitledStake, so the last claim sweeps the dust", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 8 });
      await f.bet(f.bettors[0]!, raceId, 0, PLACE, 3_333_333n);
      await f.bet(f.bettors[1]!, raceId, 0, PLACE, 1_111_111n);
      await f.bet(f.bettors[2]!, raceId, 1, PLACE, 7_777_777n);
      await f.bet(f.bettors[3]!, raceId, 6, PLACE, 9_999_999n); // unplaced
      await f.closeAndSeal(raceId, closeTime);
      await f.settle(raceId, seed, [1, 2, 3, 4, 5, 6, 7, 8]);
      const pool = await f.tote.read.getPool([raceId, PLACE]);
      expect(pool.entitledStake).to.equal(3_333_333n + 1_111_111n + 7_777_777n);
      for (let b = 0; b < 4; b++) await f.claimAs(f.bettors[b]!, raceId);
      const after = await f.tote.read.getPool([raceId, PLACE]);
      expect(after.claimedStake).to.equal(after.entitledStake);
      expect(after.paid).to.equal(after.toPay);
      await f.asOther.write.withdrawTreasury([f.usd.address]);
      expect(await f.usd.read.balanceOf([f.tote.address])).to.equal(0n);
    });
  });

  describe("claims", () => {
    it("pays once, never before finalize, pays a frozen winner to another address, and works while paused", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 5 });
      const [w0, w1] = f.bettors;
      await f.bet(w0!, raceId, 0, WIN, 10n * USDG);
      await f.bet(w1!, raceId, 1, WIN, 10n * USDG);
      const c0 = await f.as(w0!);
      await expectRevert(c0.write.claim([raceId, w0!.account.address]), "NotClaimable");
      await f.closeAndSeal(raceId, closeTime);
      await f.settle(raceId, seed, [1, 2, 3, 4, 5]);
      await (await f.as(f.admin)).write.pause();
      await expectRevert(c0.write.claim([raceId, ZERO_ADDRESS]), "ZeroAddress");
      await f.usd.write.setBlocked([w0!.account.address, true]);
      await expectAnyRevert(c0.write.claim([raceId, w0!.account.address]));
      const safe = f.other.account.address;
      const before = await f.usd.read.balanceOf([safe]);
      await c0.write.claim([raceId, safe]);
      expect((await f.usd.read.balanceOf([safe])) - before).to.equal(17n * USDG);
      await expectRevert(c0.write.claim([raceId, safe]), "AlreadyClaimed");
      expect(await f.tote.read.claimable([raceId, w0!.account.address])).to.equal(0n);
      await expectRevert((await f.as(f.bettors[5]!)).write.claim([raceId, safe]), "NothingToClaim");
      expect(await f.claimAs(w1!, raceId)).to.equal(0n);
      await f.asOther.write.withdrawTreasury([f.usd.address]);
      expect(await f.usd.read.balanceOf([f.tote.address])).to.equal(0n);
    });

    it("tokens sent straight to the contract are never accounted or movable (documented: they stay)", async () => {
      const f = await loadFixture(fixture);
      await f.usd.write.mint([f.tote.address, 7n * USDG]);
      await f.asOther.write.withdrawTreasury([f.usd.address]);
      expect(await f.usd.read.balanceOf([f.tote.address])).to.equal(7n * USDG);
      expect(await f.tote.read.treasuryOwed([f.usd.address])).to.equal(0n);
    });
  });

  describe("admin", () => {
    it("stake limits and treasury are admin-only and validated; nothing moves player funds", async () => {
      const f = await loadFixture(fixture);
      const asAdmin = await f.as(f.admin);
      const U = f.usd.address;
      await expectRevert(f.asOperator.write.setStakeLimits([U, 1n, 2n, 3n]), "AccessControlUnauthorizedAccount");
      await expectRevert(asAdmin.write.setStakeLimits([U, 0n, 2n, 3n]), "BadConfig");
      await expectRevert(asAdmin.write.setStakeLimits([U, 3n, 2n, 3n]), "BadConfig");
      await expectRevert(asAdmin.write.setStakeLimits([U, 1n, 4n, 3n]), "BadConfig");
      await asAdmin.write.setStakeLimits([U, 2n * USDG, 50n * USDG, 60n * USDG]);
      expect((await f.tote.read.stakeLimits([U]))[1]).to.equal(50n * USDG);
      await expectRevert(f.asOperator.write.setAssetAllowed([ZERO_ADDRESS, true]), "AccessControlUnauthorizedAccount");
      await expectRevert(asAdmin.write.setAssetAllowed([ZERO_ADDRESS, true]), "BadConfig"); // no ETH limits yet
      await expectRevert(f.asOperator.write.setTreasury([f.other.account.address]), "AccessControlUnauthorizedAccount");
      await expectRevert(asAdmin.write.setTreasury([ZERO_ADDRESS]), "ZeroAddress");
      await asAdmin.write.setTreasury([f.other.account.address]);
      expect(getAddress(await f.tote.read.treasury())).to.equal(getAddress(f.other.account.address));
      // The ABI has no function that sends tokens anywhere but a claimant's chosen address or the treasury.
      const outbound = totePoolsAbi.filter((x) => x.type === "function" && (x.stateMutability === "nonpayable" || x.stateMutability === "payable")).map((x) => (x as { name: string }).name);
      expect(outbound.sort()).to.deep.equal(
        [
          "attestResult",
          "bet",
          "cancelMarket",
          "claim",
          "correctResult",
          "createMarket",
          "expireMarket",
          "finalize",
          "lockEntropy",
          "pause",
          "postResult",
          "sealEntropy",
          "setAssetAllowed",
          "setEntropyBeacon",
          "setStakeLimits",
          "setTreasury",
          "unpause",
          "voidMarket",
          "withdrawTreasury",
        ].sort(),
      );
    });
  });

  describe("reentrancy", () => {
    it("a hostile token can't re-enter bet, claim or withdrawTreasury", async () => {
      const f = await deployTote("MockReentrantToteToken");
      const evil = await hre.viem.getContractAt("MockReentrantToteToken", f.usd.address);
      const { raceId, seed, closeTime } = await f.market({ runners: 5 });
      await f.bet(f.bettors[0]!, raceId, 0, WIN, 10n * USDG);
      await f.bet(f.bettors[1]!, raceId, 1, WIN, 10n * USDG);
      const claimCall = encodeFunctionData({ abi: totePoolsAbi, functionName: "claim", args: [raceId, f.bettors[0]!.account.address] });
      await evil.write.arm([f.tote.address, claimCall]);
      await expectRevert(f.bet(f.bettors[2]!, raceId, 0, WIN, USDG), "ReentrancyGuardReentrantCall");
      await evil.write.arm([ZERO_ADDRESS, "0x"]);
      await f.closeAndSeal(raceId, closeTime);
      await f.settle(raceId, seed, [1, 2, 3, 4, 5]);
      await evil.write.arm([f.tote.address, claimCall]);
      await expectRevert((await f.as(f.bettors[0]!)).write.claim([raceId, f.bettors[0]!.account.address]), "ReentrancyGuardReentrantCall");
      const withdrawCall = encodeFunctionData({ abi: totePoolsAbi, functionName: "withdrawTreasury", args: [f.usd.address] });
      await evil.write.arm([f.tote.address, withdrawCall]);
      await expectRevert(f.asOther.write.withdrawTreasury([f.usd.address]), "ReentrancyGuardReentrantCall");
      await evil.write.arm([ZERO_ADDRESS, "0x"]);
      expect(await f.claimAs(f.bettors[0]!, raceId)).to.equal(17n * USDG);
    });
  });

  describe("randomized pools (property check against game-core rules)", () => {
    it("every payout matches the reference (thin pools, heavy favourites and dead heats included), stakes are conserved, and the contract empties", async function () {
      this.timeout(600_000);
      const f = await loadFixture(fixture);
      await (await f.as(f.admin)).write.setStakeLimits([f.usd.address, 1n, 1_000_000n * USDG, 2_000_000n * USDG]);
      let state = 0x9e3779b9;
      const rnd = (n: number) => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) % n;
      };
      let thin = 0;
      for (let round = 0; round < 24; round++) {
        const runners = round === 0 ? 24 : 2 + rnd(13);
        const places = totePlacesFor(runners);
        const take = [0, 1_500, 1_234, 2_500][rnd(4)]!;
        const { raceId, seed, closeTime } = await f.market({ runners, places, take });
        const bets: [number, number, number, bigint][] = [];
        // some rounds have only one or two wallets (thin pools); some a heavy favourite
        const wallets = round % 4 === 3 ? 1 + rnd(2) : f.bettors.length;
        const favourite = rnd(runners);
        for (let b = 0; b < wallets; b++) {
          for (const pool of [WIN, PLACE]) {
            if (pool === PLACE && places === 0) continue;
            if (rnd(4) === 0) continue;
            const heavy = round % 3 === 1 && rnd(3) === 0;
            // stakes from dust to large, odd numbers to stress rounding
            const amount = heavy ? BigInt(1 + rnd(90_000_000)) * 100n : BigInt(1 + rnd(3) * rnd(1_000_000) + rnd(4) * rnd(90_000_000) + rnd(2) * rnd(10) * 100_000_000);
            const runner = heavy ? favourite : rnd(Math.min(runners, 1 + rnd(runners))); // favour low runner numbers (busier runners)
            await f.bet(f.bettors[b]!, raceId, runner, pool, amount);
            bets.push([b, runner, pool, amount]);
          }
        }
        // a finish with dead heats and non-runners
        const order = Array.from({ length: runners }, (_, i) => i).sort(() => rnd(3) - 1);
        const positions = new Array<number>(runners).fill(0);
        let rank = 0;
        let prev = 0;
        for (const r of order) {
          if (rnd(10) === 0) continue; // non-runner
          rank++;
          positions[r] = rank > 1 && rnd(6) === 0 ? prev : rank;
          prev = positions[r]!;
        }
        await f.closeAndSeal(raceId, closeTime);
        await f.settle(raceId, seed, positions);

        // the reference uses permille; the contract bps (1 permille = 10 bps). 1234 bps isn't a whole permille: only conservation is checked then.
        const exact = take % 10 === 0;
        const { expected, house } = exact ? expectedFrom(bets, positions, take / 10) : { expected: new Map<number, bigint>(), house: 0n };
        const totalStakes = bets.reduce((x, [, , , a]) => x + a, 0n);
        thin += (await f.tote.getEvents.PoolRefunded({ raceId }, { fromBlock: 0n })).filter((e) => e.args.reason === reasonOf("thin_pool")).length;
        let paid = 0n;
        for (let b = 0; b < f.bettors.length; b++) {
          if (!bets.some(([x]) => x === b)) continue;
          const got = await f.claimAs(f.bettors[b]!, raceId);
          if (exact) expect(got, `round ${round} bettor ${b}`).to.equal(expected.get(b) ?? 0n);
          paid += got;
        }
        const houseOnChain = await f.tote.read.treasuryOwed([f.usd.address]); // withdrawn at the end of every round
        if (exact) expect(houseOnChain, `round ${round} house`).to.equal(house);
        expect(paid + houseOnChain, `round ${round} conservation`).to.equal(totalStakes);
        await f.asOther.write.withdrawTreasury([f.usd.address]);
        expect(await f.usd.read.balanceOf([f.tote.address]), `round ${round} empty`).to.equal(0n);
      }
      expect(thin, "thin pools exercised").to.be.greaterThan(0);
    });
  });

  describe("stake assets", () => {
    const ETH = 10n ** 18n;
    const ethLimits = [ETH / 1_000n, ETH, 2n * ETH] as const; // 0.001 ETH min, 1 ETH per bet, 2 ETH per wallet per race

    async function withEth() {
      const f = await loadFixture(fixture);
      const asAdmin = await f.as(f.admin);
      await asAdmin.write.setStakeLimits([ZERO_ADDRESS, ...ethLimits]);
      await asAdmin.write.setAssetAllowed([ZERO_ADDRESS, true]);
      return f;
    }

    it("refuses a market in an asset that isn't allow-listed (ETH is off by default; any other token)", async () => {
      const f = await loadFixture(fixture);
      const other = await hre.viem.deployContract("MockStablecoin", []);
      const c = toBytes32(engineCommitSeed(random32()));
      const now = await latestTimestamp();
      await expectRevert(f.asOperator.write.createMarket([toteRaceKey("eth"), ZERO_ADDRESS, now + 3_600n, 8, 3, c, TAKE_BPS, ETH]), "AssetNotAllowed");
      await expectRevert(f.asOperator.write.createMarket([toteRaceKey("tok"), other.address, now + 3_600n, 8, 3, c, TAKE_BPS, USDG]), "AssetNotAllowed");
      // allow-listing needs limits first, then works
      const asAdmin = await f.as(f.admin);
      await expectRevert(asAdmin.write.setAssetAllowed([other.address, true]), "BadConfig");
      await asAdmin.write.setStakeLimits([other.address, 1n, 10n, 20n]);
      await asAdmin.write.setAssetAllowed([other.address, true]);
      await f.asOperator.write.createMarket([toteRaceKey("tok"), other.address, now + 3_600n, 8, 3, c, TAKE_BPS, USDG]);
    });

    it("an ETH market: msg.value bets, dead-heat split, refunds, claims in ETH, take to the treasury, contract balance back to 0", async () => {
      const f = await withEth();
      const { raceId, seed, closeTime } = await f.market({ runners: 6, asset: ZERO_ADDRESS, maxPool: 100n * ETH });
      const [b0, b1, b2, b3, b4] = f.bettors;
      const amounts = [ETH / 3n, (ETH * 7n) / 10n + 1n, ETH / 7n, ETH / 2n, ETH / 9n];
      await f.bet(b0!, raceId, 0, WIN, amounts[0]!);
      await f.bet(b1!, raceId, 1, WIN, amounts[1]!);
      await f.bet(b2!, raceId, 2, WIN, amounts[2]!); // a non-runner: refunded in full
      await f.bet(b3!, raceId, 0, PLACE, amounts[3]!); // the only place bet: a thin pool, refunded in full
      await f.bet(b4!, raceId, 3, WIN, amounts[4]!); // unplaced
      expect(await f.publicClient.getBalance({ address: f.tote.address })).to.equal(amounts.reduce((a, b) => a + b, 0n));
      // wrong payments
      const c0 = await f.as(b0!);
      const p = await f.permit(b0!.account.address, raceId, ETH / 100n, 0, WIN);
      await expectRevert(c0.write.bet([raceId, 0, WIN, ETH / 100n, p.p, p.sig], { value: ETH / 200n }), "WrongEthAmount");
      await expectRevert(c0.write.bet([raceId, 0, WIN, ETH / 100n, p.p, p.sig]), "WrongEthAmount");
      await expectRevert(f.bet(b0!, raceId, 0, WIN, ETH / 10_000n), "StakeBelowMin"); // ETH limits, not USDG's
      await f.closeAndSeal(raceId, closeTime);
      await f.settle(raceId, seed, [1, 1, 0, 3, 4, 5]); // runners 0 and 1 dead-heat for first

      const live = amounts[0]! + amounts[1]! + amounts[4]!;
      const win = amounts[0]! + amounts[1]!;
      let take = (live * 1_500n) / 10_000n;
      if (take > live - win) take = live - win; // winners never lose
      const half = (live - take - win) / 2n;
      const expected = [amounts[0]! + half, amounts[1]! + half, amounts[2]!, amounts[3]!, 0n];
      for (let i = 0; i < 5; i++) {
        const to = `0x${(0xe7000 + i).toString(16).padStart(40, "0")}` as Address; // fresh, gas-free recipients
        await (await f.as(f.bettors[i]!)).write.claim([raceId, to]);
        expect(await f.publicClient.getBalance({ address: to }), `bettor ${i}`).to.equal(expected[i]);
      }
      const owed = await f.tote.read.treasuryOwed([ZERO_ADDRESS]);
      expect(owed + expected.reduce((a, b) => a + b, 0n)).to.equal(amounts.reduce((a, b) => a + b, 0n));
      expect(await f.tote.read.treasuryOwed([f.usd.address])).to.equal(0n); // assets never mix
      const before = await f.publicClient.getBalance({ address: f.treasury.account.address });
      await f.asOther.write.withdrawTreasury([ZERO_ADDRESS]);
      expect((await f.publicClient.getBalance({ address: f.treasury.account.address })) - before).to.equal(owed);
      expect(await f.publicClient.getBalance({ address: f.tote.address })).to.equal(0n);
    });

    it("an ETH market voids to full ETH refunds; a USDG market refuses ETH sent with a bet; plain ETH transfers are refused", async () => {
      const f = await withEth();
      const e = await f.market({ asset: ZERO_ADDRESS, maxPool: 100n * ETH });
      await f.bet(f.bettors[0]!, e.raceId, 0, WIN, ETH / 4n);
      await f.asGuardian.write.voidMarket([e.raceId]);
      const to = "0x00000000000000000000000000000000000e7e7e" as Address;
      await (await f.as(f.bettors[0]!)).write.claim([e.raceId, to]);
      expect(await f.publicClient.getBalance({ address: to })).to.equal(ETH / 4n);
      expect(await f.publicClient.getBalance({ address: f.tote.address })).to.equal(0n);

      const u = await f.market();
      const p = await f.permit(f.bettors[1]!.account.address, u.raceId, USDG, 0, WIN);
      await expectRevert((await f.as(f.bettors[1]!)).write.bet([u.raceId, 0, WIN, USDG, p.p, p.sig], { value: 1n }), "WrongEthAmount");
      await expectAnyRevert(f.other.sendTransaction({ to: f.tote.address, value: 1n }));
    });

    it("a recipient that refuses ETH fails only its own claim (it can claim elsewhere); an ETH re-entry is blocked", async () => {
      const f = await withEth();
      const { raceId, seed, closeTime } = await f.market({ runners: 5, asset: ZERO_ADDRESS, maxPool: 100n * ETH });
      await f.bet(f.bettors[0]!, raceId, 0, WIN, ETH / 2n);
      await f.bet(f.bettors[1]!, raceId, 1, WIN, ETH / 2n);
      await f.closeAndSeal(raceId, closeTime);
      await f.settle(raceId, seed, [1, 2, 3, 4, 5]);
      const recv = await hre.viem.deployContract("MockEthReceiver", []);
      await recv.write.setMode([1]); // Reject
      const c0 = await f.as(f.bettors[0]!);
      await expectRevert(c0.write.claim([raceId, recv.address]), "EthTransferFailed");
      // re-entering from the ETH receive hook is blocked (the receiver records the nested revert, then accepts)
      await recv.write.setReenterAndRecord([f.tote.address, encodeFunctionData({ abi: totePoolsAbi, functionName: "withdrawTreasury", args: [ZERO_ADDRESS] })]);
      await c0.write.claim([raceId, recv.address]);
      expect(await recv.read.reenterError()).to.equal(toFunctionSelector("ReentrancyGuardReentrantCall()"));
      expect(await f.publicClient.getBalance({ address: recv.address })).to.equal(ETH - (ETH * 1_500n) / 10_000n);
      await expectRevert(c0.write.claim([raceId, recv.address]), "AlreadyClaimed");
    });

    it("de-listing an asset stops new markets and bets in it, never refunds or claims", async () => {
      const f = await withEth();
      const asAdmin = await f.as(f.admin);
      const { raceId } = await f.market({ asset: ZERO_ADDRESS, maxPool: 100n * ETH });
      await f.bet(f.bettors[0]!, raceId, 0, WIN, ETH / 10n);
      await asAdmin.write.setAssetAllowed([ZERO_ADDRESS, false]);
      await expectRevert(f.bet(f.bettors[1]!, raceId, 0, WIN, ETH / 10n), "AssetNotAllowed");
      await expectRevert(f.market({ asset: ZERO_ADDRESS }), "AssetNotAllowed");
      await f.asOperator.write.cancelMarket([raceId]);
      const to = "0x00000000000000000000000000000000000e7e02" as Address;
      await (await f.as(f.bettors[0]!)).write.claim([raceId, to]);
      expect(await f.publicClient.getBalance({ address: to })).to.equal(ETH / 10n);
    });
  });

  describe("gas", () => {
    it("prints bet, finalize and claim gas", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 12 });
      const hash = await f.bet(f.bettors[0]!, raceId, 0, WIN, 10n * USDG);
      const betGas = (await f.publicClient.getTransactionReceipt({ hash })).gasUsed;
      for (let b = 1; b < 10; b++) await f.bet(f.bettors[b]!, raceId, b % 12, b % 2, 10n * USDG);
      await f.closeAndSeal(raceId, closeTime);
      const positions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      await f.asOperator.write.postResult([raceId, seed, positions]);
      await f.asAttestor.write.attestResult([raceId, await f.hashFor(raceId, positions)]);
      await time.increase(CHALLENGE);
      const fin = await f.asOther.write.finalize([raceId]);
      const finGas = (await f.publicClient.getTransactionReceipt({ hash: fin })).gasUsed;
      const cl = await (await f.as(f.bettors[0]!)).write.claim([raceId, f.bettors[0]!.account.address]);
      const clGas = (await f.publicClient.getTransactionReceipt({ hash: cl })).gasUsed;
      console.log(`      gas: bet ${betGas}, finalize ${finGas}, claim ${clGas}`);
      expect(finGas < 1_000_000n).to.equal(true);
    });
  });
});
