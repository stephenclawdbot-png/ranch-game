// A dependency-free copy of game-core `settleTotePool` (packages/game-core/src/tote.ts), the
// reference the TotePools contract is tested against (tote-pools.test.ts). Hardhat runs tests as
// CommonJS and can't load the ESM game-core package, so game-core's own vitest suite
// (tote.parity.test.ts) proves this copy gives exactly the same numbers as the original.
// Keep it in step with game-core: a rule change there fails that parity test.

export type RefPoolKind = "win" | "place";

export interface RefBet {
  id: string;
  /** Who placed it (a wallet on chain): the minimum pool counts distinct bettors. */
  bettor: string;
  horseId: string;
  stake: number;
}

export interface RefFinisher {
  horseId: string;
  position: number;
}

export interface RefSettlement {
  places: number;
  total: number;
  takeout: number;
  standardTakeout: number;
  net: number;
  payouts: { betId: string; amount: number }[];
  refunds: { betId: string; amount: number }[];
  remainder: number;
  outcome: "paid" | "no_winner" | "void" | "empty";
  voidReason: "no_place_pool" | "thin_pool" | "winners_short" | null;
}

const DEAD_HEAT_DENOM = 5_354_228_880n;

export function refPlaces(runners: number): number {
  if (runners >= 8) return 3;
  if (runners >= 5) return 2;
  return 0;
}

export function refSettle(kind: RefPoolKind, bets: readonly RefBet[], finishers: readonly RefFinisher[], permille: number): RefSettlement {
  const ran = new Map(finishers.map((f) => [f.horseId, f.position]));
  const places = kind === "win" ? 1 : refPlaces(finishers.length);
  const sorted = [...bets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const zero = { places, payouts: [] as RefSettlement["payouts"], total: 0, takeout: 0, standardTakeout: 0, net: 0, remainder: 0 };
  const voidAll = (voidReason: NonNullable<RefSettlement["voidReason"]>): RefSettlement => ({ ...zero, refunds: sorted.map((b) => ({ betId: b.id, amount: b.stake })), outcome: "void", voidReason });
  if (places === 0) return sorted.length ? voidAll("no_place_pool") : { ...zero, refunds: [], outcome: "empty", voidReason: null };
  const refunds: RefSettlement["refunds"] = [];
  const live: RefBet[] = [];
  for (const b of sorted) {
    if (!ran.has(b.horseId)) refunds.push({ betId: b.id, amount: b.stake });
    else live.push(b);
  }
  const total = live.reduce((s, b) => s + b.stake, 0);
  if (total === 0) return { ...zero, refunds, outcome: "empty", voidReason: null };
  if (new Set(live.map((b) => b.bettor)).size < 2 || new Set(live.map((b) => b.horseId)).size < 2) return voidAll("thin_pool");
  const standardTakeout = Math.floor((total * permille) / 1000);

  const onRunner = new Map<string, number>();
  for (const b of live) onRunner.set(b.horseId, (onRunner.get(b.horseId) ?? 0) + b.stake);
  const tie = new Map<number, number>();
  for (const p of ran.values()) tie.set(p, (tie.get(p) ?? 0) + 1);
  const weight = new Map<string, bigint>();
  for (const [horseId, p] of ran) {
    const k = tie.get(p)!;
    const covered = Math.max(0, Math.min(places, p + k - 1) - p + 1);
    if (covered > 0) weight.set(horseId, (BigInt(covered) * DEAD_HEAT_DENOM) / BigInt(k));
  }
  const paying = [...weight.entries()].filter(([id]) => (onRunner.get(id) ?? 0) > 0).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const W = paying.reduce((s, [, w]) => s + w, 0n);
  const payouts: RefSettlement["payouts"] = [];
  if (W === 0n) {
    const net = total - standardTakeout;
    const totalB = BigInt(total);
    for (const b of live) {
      const amount = Number((BigInt(net) * BigInt(b.stake)) / totalB);
      if (amount > 0) payouts.push({ betId: b.id, amount });
    }
    const paid = payouts.reduce((s, p) => s + p.amount, 0);
    return { places, refunds, payouts, total, takeout: standardTakeout, standardTakeout, net, remainder: net - paid, outcome: "no_winner", voidReason: null };
  }
  const winningStakes = paying.reduce((s, [id]) => s + onRunner.get(id)!, 0);
  const takeout = Math.min(standardTakeout, total - winningStakes);
  const net = total - takeout;
  if (net < winningStakes) return voidAll("winners_short");
  const profitB = BigInt(net - winningStakes);
  for (const [horseId, w] of paying) {
    const S = onRunner.get(horseId)!;
    const amount = S + Number((profitB * w) / W);
    for (const b of live) {
      if (b.horseId !== horseId) continue;
      const a = Number((BigInt(amount) * BigInt(b.stake)) / BigInt(S));
      if (a > 0) payouts.push({ betId: b.id, amount: a });
    }
  }
  const paid = payouts.reduce((s, p) => s + p.amount, 0);
  return { places, refunds, payouts, total, takeout, standardTakeout, net, remainder: net - paid, outcome: "paid", voidReason: null };
}
