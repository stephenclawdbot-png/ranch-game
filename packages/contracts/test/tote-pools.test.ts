import { expect } from "chai";
import hre from "hardhat";
import { loadFixture, mine, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { encodeFunctionData, getAddress, hashTypedData, keccak256, sha256, toBytes, type Address, type Hex } from "viem";
import { totePoolsAbi } from "../adapter/abi";
import { toBytes32 } from "../adapter/merkle";
import {
  betPermitTypedData,
  packTotePositions,
  toteFinalSeed,
  toteOddsMilli,
  totePlacesFor,
  toteRaceKey,
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
const TAKE_BPS = 1_500; // game-core TOTE_TAKEOUT_PERMILLE 150
const STATUS = { none: 0, open: 1, posted: 2, finalized: 3, void: 4 } as const;
const role = (name: string) => keccak256(toBytes(name));
const reasonOf = (s: string): Hex => `0x${Buffer.from(s).toString("hex").padEnd(64, "0")}`;

async function deployTote(tokenName: "MockStablecoin" | "MockReentrantToteToken" = "MockStablecoin", arbSys: Address = ZERO_ADDRESS) {
  const wallets = await hre.viem.getWalletClients();
  const [admin, operator, guardian, treasury, other] = wallets;
  const bettors = wallets.slice(5);
  const publicClient = await hre.viem.getPublicClient();
  const signer = await localServerWallet();
  // Typed as MockStablecoin either way (the hostile token shares the ERC-20 calls the tests use).
  const deployed = tokenName === "MockStablecoin" ? await hre.viem.deployContract("MockStablecoin", []) : await hre.viem.deployContract("MockReentrantToteToken", []);
  const usd = await hre.viem.getContractAt("MockStablecoin", deployed.address);
  const tote = await hre.viem.deployContract("TotePools", [
    admin!.account.address,
    operator!.account.address,
    signer.account.address,
    guardian!.account.address,
    treasury!.account.address,
    usd.address,
    arbSys,
    CLOSE_MARGIN,
    CHALLENGE,
    MAX_SETTLE,
    ENTROPY_DELAY,
  ]);
  for (const w of bettors) {
    await usd.write.mint([w.account.address, 100_000n * USDG]);
    const t = await hre.viem.getContractAt("MockStablecoin", usd.address, { client: { wallet: w } });
    await t.write.approve([tote.address, 2n ** 256n - 1n]);
  }
  const as = (w: (typeof wallets)[number]) => hre.viem.getContractAt("TotePools", tote.address, { client: { wallet: w } });
  const asOperator = await as(operator!);
  const asGuardian = await as(guardian!);
  const asOther = await as(other!);
  const chainId = await publicClient.getChainId();

  async function permit(bettor: Address, raceId: Hex, maxAmount: bigint, o: Partial<BetPermit> = {}): Promise<{ p: BetPermit; sig: Hex }> {
    const p: BetPermit = { bettor: getAddress(bettor), raceId, maxAmount, nonce: BigInt(random32()), expiry: (await latestTimestamp()) + 300n, ...o };
    const sig = await signer.wallet.signTypedData({ account: signer.account, ...betPermitTypedData(p, chainId, getAddress(tote.address)) });
    return { p, sig };
  }

  async function bet(w: (typeof wallets)[number], raceId: Hex, runner: number, pool: number, amount: bigint) {
    const { p, sig } = await permit(w.account.address, raceId, amount);
    const c = await as(w);
    return c.write.bet([raceId, runner, pool, amount, p, sig]);
  }

  async function market(o: { runners?: number; places?: number; take?: number; maxPool?: bigint; closeIn?: bigint } = {}) {
    const seed = random32();
    const raceId = toteRaceKey(crypto.randomUUID());
    const closeTime = (await latestTimestamp()) + (o.closeIn ?? 3_600n);
    const runners = o.runners ?? 8;
    await asOperator.write.createMarket([raceId, closeTime, runners, o.places ?? totePlacesFor(runners), toBytes32(engineCommitSeed(seed)), o.take ?? TAKE_BPS, o.maxPool ?? 1_000_000n * USDG]);
    return { raceId, seed, closeTime, runners };
  }

  async function closeAndSeal(raceId: Hex, closeTime: bigint) {
    await time.increaseTo(closeTime);
    await asOther.write.lockEntropy([raceId]);
    await mine(Number(ENTROPY_DELAY) + 1);
    await asOther.write.sealEntropy([raceId]);
  }

  async function settle(raceId: Hex, seed: Hex, positions: number[]) {
    await asOperator.write.postResult([raceId, seed, positions]);
    await time.increase(CHALLENGE);
    await asOther.write.finalize([raceId]);
  }

  async function claimAs(w: (typeof wallets)[number], raceId: Hex): Promise<bigint> {
    const before = await usd.read.balanceOf([w.account.address]);
    await (await as(w)).write.claim([raceId, w.account.address]);
    return (await usd.read.balanceOf([w.account.address])) - before;
  }

  return { tote, usd, admin: admin!, operator: operator!, guardian: guardian!, treasury: treasury!, other: other!, bettors, signer, publicClient, chainId, as, asOperator, asGuardian, asOther, permit, bet, market, closeAndSeal, settle, claimAs };
}

const fixture = () => deployTote();

describe("TotePools", () => {
  describe("deployment", () => {
    it("grants each role to its own key and starts with conservative stake limits", async () => {
      const { tote, admin, operator, guardian, signer, treasury } = await loadFixture(fixture);
      expect(await tote.read.hasRole([role("OPERATOR_ROLE"), operator.account.address])).to.equal(true);
      expect(await tote.read.hasRole([role("GUARDIAN_ROLE"), guardian.account.address])).to.equal(true);
      expect(await tote.read.hasRole([role("PERMIT_SIGNER_ROLE"), signer.account.address])).to.equal(true);
      expect(await tote.read.hasRole([role("PAUSER_ROLE"), admin.account.address])).to.equal(true);
      expect(await tote.read.hasRole([role("OPERATOR_ROLE"), admin.account.address])).to.equal(false);
      expect(getAddress(await tote.read.treasury())).to.equal(getAddress(treasury.account.address));
      expect(await tote.read.minStake()).to.equal(1n * USDG);
      expect(await tote.read.maxStakePerBet()).to.equal(100n * USDG);
      expect(await tote.read.maxStakePerWalletPerRace()).to.equal(250n * USDG);
      expect(await tote.read.CLOSE_MARGIN()).to.equal(CLOSE_MARGIN);
    });

    it("rejects zero addresses and unsafe timing", async () => {
      const [a] = await hre.viem.getWalletClients();
      const x = a!.account.address;
      const usd = await hre.viem.deployContract("MockStablecoin", []);
      const args = (o: Partial<Record<number, unknown>>) => [x, x, x, x, x, usd.address, ZERO_ADDRESS, 60n, 3_600n, 86_400n, 2n].map((v, i) => (i in o ? o[i] : v));
      await expectRevert(hre.viem.deployContract("TotePools", args({ 0: ZERO_ADDRESS }) as never), "ZeroAddress");
      await expectRevert(hre.viem.deployContract("TotePools", args({ 5: ZERO_ADDRESS }) as never), "ZeroAddress");
      await expectRevert(hre.viem.deployContract("TotePools", args({ 7: 0n }) as never), "BadConfig");
      await expectRevert(hre.viem.deployContract("TotePools", args({ 8: 60n }) as never), "BadConfig");
      await expectRevert(hre.viem.deployContract("TotePools", args({ 9: 60n }) as never), "BadConfig");
      await expectRevert(hre.viem.deployContract("TotePools", args({ 10: 0n }) as never), "BadConfig");
      await expectRevert(hre.viem.deployContract("TotePools", args({ 10: 65n }) as never), "BadConfig");
    });

    it("BetPermit digest matches the adapter's EIP-712 definition", async () => {
      const { tote, chainId, bettors } = await loadFixture(fixture);
      const p: BetPermit = { bettor: getAddress(bettors[0]!.account.address), raceId: toteRaceKey("abc"), maxAmount: 5n * USDG, nonce: 42n, expiry: 1_900_000_000n };
      expect(await tote.read.hashBetPermit([p])).to.equal(hashTypedData(betPermitTypedData(p, chainId, getAddress(tote.address))));
    });

    it("finalSeedOf, placesFor and the position packing match the adapter", async () => {
      const { tote } = await loadFixture(fixture);
      const s = random32();
      const e = random32();
      expect(await tote.read.finalSeedOf([s, e])).to.equal(`0x${toteFinalSeed(s, e)}`);
      expect(toteFinalSeed(s, e)).to.equal(sha256(`0x${s.slice(2)}${e.slice(2)}`).slice(2));
      for (const n of [0, 4, 5, 7, 8, 24]) expect(Number(await tote.read.placesFor([BigInt(n)]))).to.equal(totePlacesFor(n));
      const pos = [3, 1, 0, 2, 4];
      expect(unpackTotePositions(packTotePositions(pos), 5)).to.deep.equal(pos);
    });
  });

  describe("markets", () => {
    it("only the operator creates, once per race, with sane terms", async () => {
      const { tote, asOther, asOperator, market } = await loadFixture(fixture);
      const { raceId, closeTime, seed } = await market();
      const m = await tote.read.getMarket([raceId]);
      expect(m.status).to.equal(STATUS.open);
      expect(m.seedCommitment).to.equal(toBytes32(engineCommitSeed(seed)));
      expect(m.placeTerms).to.equal(3);
      const c = toBytes32(engineCommitSeed(random32()));
      const now = await latestTimestamp();
      await expectRevert(asOther.write.createMarket([toteRaceKey("x"), now + 3_600n, 8, 3, c, TAKE_BPS, USDG]), "AccessControlUnauthorizedAccount");
      await expectRevert(asOperator.write.createMarket([raceId, closeTime, 8, 3, c, TAKE_BPS, USDG]), "MarketExists");
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
      for (const args of bad) await expectRevert(asOperator.write.createMarket(args), "BadMarket");
    });
  });

  describe("full lifecycle", () => {
    it("bets, entropy, result, challenge window, finalize, claims: payouts match game-core and the contract ends empty", async () => {
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
      const block = await publicClient.getBlock({ blockNumber: m1.entropyBlock });
      expect(m1.entropy).to.equal(block.hash);
      // finishing order by runner index: runner 0 won, 3 second, 5 third
      const positions = [1, 4, 5, 2, 6, 3, 7, 8];
      await settle(raceId, seed, positions);
      const m2 = await tote.read.getMarket([raceId]);
      expect(m2.status).to.equal(STATUS.finalized);
      expect(m2.revealedSeed).to.equal(seed);
      expect(m2.finalSeed).to.equal(`0x${toteFinalSeed(seed, m1.entropy)}`);
      expect(unpackTotePositions(m2.positions, 8)).to.deep.equal(positions);

      const finishers: RefFinisher[] = positions.map((p, i) => ({ horseId: `r${i}`, position: p }));
      const expected = new Map<number, bigint>();
      let house = 0n;
      for (const [pool, kind] of [[WIN, "win"], [PLACE, "place"]] as const) {
        const refBets: RefBet[] = plan.filter(([, , p]) => p === pool).map(([b, r, , a]) => ({ id: `b${b}`, horseId: `r${r}`, stake: Number(a) }));
        const s = refSettle(kind, refBets, finishers, 150);
        house += BigInt(s.takeout + s.remainder);
        for (const x of [...s.payouts, ...s.refunds]) expected.set(Number(x.betId.slice(1)), (expected.get(Number(x.betId.slice(1))) ?? 0n) + BigInt(x.amount));
      }
      let paid = 0n;
      for (let b = 0; b < plan.length; b++) {
        const preview = await tote.read.claimable([raceId, bettors[b]!.account.address]);
        const got = await claimAs(bettors[b]!, raceId);
        expect(got, `bettor ${b}`).to.equal(expected.get(b) ?? 0n);
        expect(preview).to.equal(got);
        paid += got;
      }
      expect(await tote.read.treasuryOwed()).to.equal(house);
      const total = plan.reduce((s, [, , , a]) => s + a, 0n);
      expect(paid + house).to.equal(total);
      await asOther.write.withdrawTreasury();
      expect(await usd.read.balanceOf([treasury.account.address])).to.equal(house);
      expect(await usd.read.balanceOf([tote.address])).to.equal(0n);
    });
  });

  describe("bet refusals", () => {
    it("accepts a bet one second before closeTime - CLOSE_MARGIN", async () => {
      const { bettors, market, permit, as, tote } = await loadFixture(fixture);
      const { raceId, closeTime } = await market();
      const { p, sig } = await permit(bettors[0]!.account.address, raceId, USDG, { expiry: closeTime });
      await time.setNextBlockTimestamp(closeTime - CLOSE_MARGIN - 1n);
      await (await as(bettors[0]!)).write.bet([raceId, 0, WIN, USDG, p, sig]);
      expect(await tote.read.walletTotal([raceId, bettors[0]!.account.address])).to.equal(USDG);
    });

    it("refuses a bet whose block lands at or after closeTime - CLOSE_MARGIN, and after the close", async () => {
      const f = await loadFixture(fixture);
      const { raceId, closeTime } = await f.market();
      const w = f.bettors[0]!;
      const c = await f.as(w);
      const a = await f.permit(w.account.address, raceId, USDG, { expiry: closeTime });
      await time.setNextBlockTimestamp(closeTime - CLOSE_MARGIN);
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, a.p, a.sig]), "BettingClosed");
      await time.increaseTo(closeTime + 10n);
      const b = await f.permit(w.account.address, raceId, USDG);
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, b.p, b.sig]), "BettingClosed");
    });

    it("refuses missing, expired, reused, foreign and wrong-signer permits", async () => {
      const f = await loadFixture(fixture);
      const { raceId } = await f.market();
      const { raceId: otherRace } = await f.market();
      const w = f.bettors[0]!;
      const c = await f.as(w);
      const ok = await f.permit(w.account.address, raceId, 5n * USDG);
      // no signature at all
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, ok.p, "0x"]), "InvalidSignature");
      // tampered amount ceiling
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, { ...ok.p, maxAmount: 50n * USDG }, ok.sig]), "InvalidSignature");
      // signed by a key without PERMIT_SIGNER_ROLE
      const rogue = await localServerWallet();
      const rogueSig = await rogue.wallet.signTypedData({ account: rogue.account, ...betPermitTypedData(ok.p, f.chainId, getAddress(f.tote.address)) });
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, ok.p, rogueSig]), "InvalidSignature");
      // someone else's permit
      const theirs = await f.permit(f.bettors[1]!.account.address, raceId, USDG);
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, theirs.p, theirs.sig]), "NotPermitBettor");
      // a permit for another race
      const elsewhere = await f.permit(w.account.address, otherRace, USDG);
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, elsewhere.p, elsewhere.sig]), "PermitRaceMismatch");
      // above the permit's maxAmount
      await expectRevert(c.write.bet([raceId, 0, WIN, 6n * USDG, ok.p, ok.sig]), "AboveMaxAmount");
      // too long a lifetime
      const long = await f.permit(w.account.address, raceId, USDG, { expiry: (await latestTimestamp()) + 3_600n });
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, long.p, long.sig]), "PermitTtlTooLong");
      // expired
      const short = await f.permit(w.account.address, raceId, USDG, { expiry: (await latestTimestamp()) + 5n });
      await time.increase(10);
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, short.p, short.sig]), "PermitExpired");
      // single use
      const once = await f.permit(w.account.address, raceId, 5n * USDG);
      await c.write.bet([raceId, 0, WIN, USDG, once.p, once.sig]);
      expect(await f.tote.read.nonceUsed([w.account.address, once.p.nonce])).to.equal(true);
      await expectRevert(c.write.bet([raceId, 0, WIN, USDG, once.p, once.sig]), "NonceUsed");
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
    it("can't be locked before the close, is locked once, sealed once, only after its block exists", async () => {
      const f = await loadFixture(fixture);
      const { raceId, closeTime } = await f.market();
      await expectRevert(f.asOther.write.lockEntropy([raceId]), "EntropyTooEarly");
      await expectRevert(f.asOther.write.sealEntropy([raceId]), "EntropyNotLocked");
      await time.increaseTo(closeTime);
      await f.asOther.write.lockEntropy([raceId]);
      await expectRevert(f.asOther.write.lockEntropy([raceId]), "EntropyAlreadyLocked");
      await expectRevert(f.asOther.write.sealEntropy([raceId]), "EntropyNotReady");
      await mine(3);
      await f.asOther.write.sealEntropy([raceId]);
      await expectRevert(f.asOther.write.sealEntropy([raceId]), "EntropyAlreadySealed");
      await expectRevert(f.asOther.write.lockEntropy([toteRaceKey("none")]), "MarketNotOpen");
    });

    it("voids the market when nobody sealed while the block hash was readable", async () => {
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

    it("uses ArbSys block numbers and hashes when configured (and voids when its hash is out of range)", async () => {
      const arb = await hre.viem.deployContract("MockArbSys", []);
      const f = await deployTote("MockStablecoin", arb.address);
      const a = await f.market();
      await f.bet(f.bettors[0]!, a.raceId, 0, WIN, 10n * USDG);
      await f.closeAndSeal(a.raceId, a.closeTime);
      const m = await f.tote.read.getMarket([a.raceId]);
      expect(m.entropy).to.equal((await f.publicClient.getBlock({ blockNumber: m.entropyBlock })).hash);
      await f.settle(a.raceId, a.seed, [1, 2, 3, 4, 5, 6, 7, 8]);
      expect(await f.claimAs(f.bettors[0]!, a.raceId)).to.equal(8_500_000n);

      const b = await f.market();
      await time.increaseTo(b.closeTime);
      await f.asOther.write.lockEntropy([b.raceId]);
      await mine(300);
      await f.asOther.write.sealEntropy([b.raceId]);
      expect((await f.tote.read.getMarket([b.raceId])).status).to.equal(STATUS.void);
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

    it("lets the guardian correct only during the challenge window", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 5 });
      await f.bet(f.bettors[0]!, raceId, 1, WIN, 10n * USDG);
      await f.bet(f.bettors[1]!, raceId, 0, WIN, 10n * USDG);
      await f.closeAndSeal(raceId, closeTime);
      await f.asOperator.write.postResult([raceId, seed, [1, 2, 3, 4, 5]]);
      await expectRevert(f.asOperator.write.correctResult([raceId, [2, 1, 3, 4, 5]]), "AccessControlUnauthorizedAccount");
      await f.asGuardian.write.correctResult([raceId, [2, 1, 3, 4, 5]]);
      await expectRevert(f.asGuardian.write.correctResult([raceId, [1, 2, 3, 4]]), "BadPositions");
      await time.increase(CHALLENGE);
      await expectRevert(f.asGuardian.write.correctResult([raceId, [1, 2, 3, 4, 5]]), "ChallengeWindowOver");
      await expectRevert(f.asGuardian.write.voidMarket([raceId]), "ChallengeWindowOver");
      await f.asOther.write.finalize([raceId]);
      await expectRevert(f.asOther.write.finalize([raceId]), "NotResultPosted");
      await expectRevert(f.asGuardian.write.correctResult([raceId, [1, 2, 3, 4, 5]]), "NotResultPosted");
      // runner 1 won after the correction: bettor 0 takes the whole net pool
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
      expect(await f.tote.read.treasuryOwed()).to.equal(0n);
      expect(await f.usd.read.balanceOf([f.tote.address])).to.equal(0n);
    });

    it("the operator can cancel only before the entropy is sealed", async () => {
      const f = await loadFixture(fixture);
      const a = await f.market();
      await f.bet(f.bettors[0]!, a.raceId, 0, WIN, 10n * USDG);
      await expectRevert(f.asOther.write.cancelMarket([a.raceId]), "AccessControlUnauthorizedAccount");
      await f.asOperator.write.cancelMarket([a.raceId]);
      expect(await f.claimAs(f.bettors[0]!, a.raceId)).to.equal(10n * USDG);
      const b = await f.market();
      await f.closeAndSeal(b.raceId, b.closeTime);
      await expectRevert(f.asOperator.write.cancelMarket([b.raceId]), "NotVoidable");
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
  });

  describe("settlement rules", () => {
    it("dead heat for first in the WIN pool: the two runners' backers share half the net pool each", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 6 });
      await f.bet(f.bettors[0]!, raceId, 0, WIN, 10n * USDG);
      await f.bet(f.bettors[1]!, raceId, 1, WIN, 30n * USDG);
      await f.bet(f.bettors[2]!, raceId, 2, WIN, 60n * USDG);
      await f.closeAndSeal(raceId, closeTime);
      await f.settle(raceId, seed, [1, 1, 3, 4, 5, 6]);
      expect(await f.claimAs(f.bettors[0]!, raceId)).to.equal(42_500_000n); // (100 - 15) / 2
      expect(await f.claimAs(f.bettors[1]!, raceId)).to.equal(42_500_000n);
      expect(await f.claimAs(f.bettors[2]!, raceId)).to.equal(0n);
    });

    it("dead heat for the last paying place shares that place (8 runners, 3 places)", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 8 });
      for (let r = 0; r < 4; r++) await f.bet(f.bettors[r]!, raceId, r, PLACE, 10n * USDG);
      await f.closeAndSeal(raceId, closeTime);
      await f.settle(raceId, seed, [1, 2, 3, 3, 5, 6, 7, 8]);
      // net 34: thirds of 11.333333 for 1st and 2nd; the third place split between two runners.
      const net = 34n * USDG;
      const w = [6n, 6n, 3n, 3n];
      const expected = w.map((x) => (net * x) / 18n);
      for (let r = 0; r < 4; r++) expect(await f.claimAs(f.bettors[r]!, raceId)).to.equal(expected[r]);
      await f.asOther.write.withdrawTreasury();
      expect(await f.usd.read.balanceOf([f.tote.address])).to.equal(0n);
    });

    it("an unbacked paying runner's share goes to the other paying runners", async () => {
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
      await f.asOther.write.withdrawTreasury();
      expect(await f.usd.read.balanceOf([f.tote.address])).to.equal(0n);
    });

    it("non-runners are refunded in full and outside the pool", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 6 });
      await f.bet(f.bettors[0]!, raceId, 0, WIN, 10n * USDG);
      await f.bet(f.bettors[1]!, raceId, 2, WIN, 20n * USDG); // scratched
      await f.bet(f.bettors[2]!, raceId, 1, WIN, 10n * USDG);
      await f.bet(f.bettors[1]!, raceId, 0, PLACE, 5n * USDG);
      await f.closeAndSeal(raceId, closeTime);
      // runner 2 a non-runner: 5 ran, so the place pool pays 2 places
      await f.settle(raceId, seed, [1, 2, 0, 3, 4, 5]);
      expect(await f.claimAs(f.bettors[0]!, raceId)).to.equal(17n * USDG); // all of the 20 live, less 15 %
      expect(await f.claimAs(f.bettors[1]!, raceId)).to.equal(20n * USDG + 4_250_000n);
      expect(await f.claimAs(f.bettors[2]!, raceId)).to.equal(0n);
    });

    it("too few runners left for a place pool: every place stake refunded", async () => {
      const f = await loadFixture(fixture);
      const { raceId, seed, closeTime } = await f.market({ runners: 5 });
      await f.bet(f.bettors[0]!, raceId, 0, PLACE, 10n * USDG);
      await f.bet(f.bettors[1]!, raceId, 0, WIN, 10n * USDG);
      await f.closeAndSeal(raceId, closeTime);
      await f.settle(raceId, seed, [1, 2, 3, 4, 0]); // 4 ran: no place pool
      expect(await f.claimAs(f.bettors[0]!, raceId)).to.equal(10n * USDG);
      expect(await f.claimAs(f.bettors[1]!, raceId)).to.equal(8_500_000n);
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
      await f.asOther.write.withdrawTreasury();
      expect(await f.usd.read.balanceOf([f.tote.address])).to.equal(0n);
    });
  });

  describe("admin", () => {
    it("stake limits and treasury are admin-only and validated; nothing moves player funds", async () => {
      const f = await loadFixture(fixture);
      const asAdmin = await f.as(f.admin);
      await expectRevert(f.asOperator.write.setStakeLimits([1n, 2n, 3n]), "AccessControlUnauthorizedAccount");
      await expectRevert(asAdmin.write.setStakeLimits([0n, 2n, 3n]), "BadConfig");
      await expectRevert(asAdmin.write.setStakeLimits([3n, 2n, 3n]), "BadConfig");
      await expectRevert(asAdmin.write.setStakeLimits([1n, 4n, 3n]), "BadConfig");
      await asAdmin.write.setStakeLimits([2n * USDG, 50n * USDG, 60n * USDG]);
      expect(await f.tote.read.maxStakePerBet()).to.equal(50n * USDG);
      await expectRevert(f.asOperator.write.setTreasury([f.other.account.address]), "AccessControlUnauthorizedAccount");
      await expectRevert(asAdmin.write.setTreasury([ZERO_ADDRESS]), "ZeroAddress");
      await asAdmin.write.setTreasury([f.other.account.address]);
      expect(getAddress(await f.tote.read.treasury())).to.equal(getAddress(f.other.account.address));
      // The ABI has no function that sends tokens anywhere but a claimant's chosen address or the treasury.
      const outbound = totePoolsAbi.filter((x) => x.type === "function" && x.stateMutability === "nonpayable").map((x) => (x as { name: string }).name);
      expect(outbound.sort()).to.deep.equal(
        ["bet", "cancelMarket", "claim", "correctResult", "createMarket", "expireMarket", "finalize", "lockEntropy", "pause", "postResult", "sealEntropy", "setStakeLimits", "setTreasury", "unpause", "voidMarket", "withdrawTreasury"].sort(),
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
      const withdrawCall = encodeFunctionData({ abi: totePoolsAbi, functionName: "withdrawTreasury", args: [] });
      await evil.write.arm([f.tote.address, withdrawCall]);
      await expectRevert(f.asOther.write.withdrawTreasury(), "ReentrancyGuardReentrantCall");
      await evil.write.arm([ZERO_ADDRESS, "0x"]);
      expect(await f.claimAs(f.bettors[0]!, raceId)).to.equal(17n * USDG);
    });
  });

  describe("randomized pools (property check against game-core rules)", () => {
    it("every payout matches the reference, sum(payouts) + take + remainder == stakes, and the contract empties", async function () {
      this.timeout(600_000);
      const f = await loadFixture(fixture);
      await (await f.as(f.admin)).write.setStakeLimits([1n, 1_000_000n * USDG, 2_000_000n * USDG]);
      let state = 0x9e3779b9;
      const rnd = (n: number) => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) % n;
      };
      for (let round = 0; round < 20; round++) {
        const runners = round === 0 ? 24 : 2 + rnd(13);
        const places = totePlacesFor(runners);
        const take = [0, 1_500, 1_234, 2_500][rnd(4)]!;
        const { raceId, seed, closeTime } = await f.market({ runners, places, take });
        const bets: [number, number, number, bigint][] = [];
        for (let b = 0; b < f.bettors.length; b++) {
          for (const pool of [WIN, PLACE]) {
            if (pool === PLACE && places === 0) continue;
            if (rnd(4) === 0) continue;
            // stakes from dust to large, odd numbers to stress rounding
            const amount = BigInt(1 + rnd(3) * rnd(1_000_000) + rnd(4) * rnd(90_000_000) + rnd(2) * rnd(10) * 100_000_000);
            const runner = rnd(Math.min(runners, 1 + rnd(runners))); // favour low runner numbers (busier runners)
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

        const finishers: RefFinisher[] = positions.flatMap((p, i) => (p > 0 ? [{ horseId: `r${i}`, position: p }] : []));
        const expected = new Map<number, bigint>();
        let house = 0n;
        let totalStakes = 0n;
        for (const [pool, kind] of [[WIN, "win"], [PLACE, "place"]] as const) {
          const refBets: RefBet[] = bets.filter(([, , p]) => p === pool).map(([b, r, , a]) => ({ id: `b${String(b).padStart(2, "0")}`, horseId: `r${r}`, stake: Number(a) }));
          if (refBets.length === 0) continue;
          // the reference uses permille; the contract bps (1 permille = 10 bps). 1234 bps isn't a whole permille: model it exactly.
          const s = take % 10 === 0 ? refSettle(kind, refBets, finishers, take / 10) : null;
          const stakes = refBets.reduce((x, b) => x + BigInt(b.stake), 0n);
          totalStakes += stakes;
          if (s) {
            house += BigInt(s.takeout + s.remainder);
            for (const x of [...s.payouts, ...s.refunds]) {
              const b = Number(x.betId.slice(1));
              expected.set(b, (expected.get(b) ?? 0n) + BigInt(x.amount));
            }
          }
        }
        let paid = 0n;
        for (let b = 0; b < f.bettors.length; b++) {
          if (!bets.some(([x]) => x === b)) continue;
          const got = await f.claimAs(f.bettors[b]!, raceId);
          if (take % 10 === 0) expect(got, `round ${round} bettor ${b}`).to.equal(expected.get(b) ?? 0n);
          paid += got;
        }
        const houseOnChain = await f.tote.read.treasuryOwed(); // withdrawn at the end of every round
        if (take % 10 === 0) expect(houseOnChain, `round ${round} house`).to.equal(house);
        expect(paid + houseOnChain, `round ${round} conservation`).to.equal(totalStakes);
        await f.asOther.write.withdrawTreasury();
        expect(await f.usd.read.balanceOf([f.tote.address]), `round ${round} empty`).to.equal(0n);
      }
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
      await f.asOperator.write.postResult([raceId, seed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]]);
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
