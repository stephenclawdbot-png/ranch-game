/**
 * Packs (§8, §4b). Packs produce FOALS (19 care days before they can race), always under the
 * season's genetic ceiling, with published odds, pity and commit–reveal seeds.
 *
 *   Paddock Pack: 1 free every 3rd play day (play days need not be consecutive) + up to 3
 *                 bought with credits per week. Common/Uncommon. Pity: Uncommon+ within 5.
 *   Premium Pack: mocked in Phase 1, up to 10 per week. Pity: Rare+ within 10, Epic+ within 50.
 *   A seasonal global foal-crop cap limits all pack foals; the remaining count is public.
 *
 * Fairness: before pulling, the server publishes commitSeed(serverSeed). Each pull's seed is
 * deriveSeed(serverSeed, "pack:<account>:<pack>:<pullIndex>"), so after reveal anyone can
 * recompute the roll, the pity adjustment and the genome.
 */
import type { Binding, Genome, PackPull, PackType, PityState, Rarity } from "./types";
import { RARITY_ORDER } from "./types";
import { generateFoundationGenome, potentialCeiling } from "./genome";
import { commitSeed, deriveSeed, Rng } from "./rng";

/** Published odds in basis points (sum 10,000). */
export const PACK_ODDS: Record<PackType, Record<Rarity, number>> = {
  paddock: { common: 7000, uncommon: 3000, rare: 0, epic: 0, legendary: 0 },
  premium: { common: 3500, uncommon: 3500, rare: 2200, epic: 650, legendary: 150 },
};

export interface PityRule {
  /** Guaranteed minimum rarity... */
  min: Rarity;
  /** ...within this many pulls (the Nth pull is forced if none came earlier). */
  within: number;
  counter: "sinceRare" | "sinceEpic";
}

/**
 * Pity rules. `sinceRare` is the level-1 counter (Paddock: pulls since Uncommon+; Premium:
 * since Rare+); `sinceEpic` is level 2 (Premium only: since Epic+).
 */
export const PACK_PITY: Record<PackType, PityRule[]> = {
  paddock: [{ min: "uncommon", within: 5, counter: "sinceRare" }],
  premium: [
    { min: "epic", within: 50, counter: "sinceEpic" },
    { min: "rare", within: 10, counter: "sinceRare" },
  ],
};

export const PADDOCK_PACK_PRICE = 1200;
export const FREE_PADDOCK_EVERY_PLAY_DAYS = 3;
export const PADDOCK_CREDIT_BUYS_PER_WEEK = 3;
export const PREMIUM_PER_WEEK = 10;
export const SEASON_FOAL_CROP_CAP = 10_000;

export const NEW_PITY: PityState = { sinceRare: 0, sinceEpic: 0, pulls: 0 };

const rank = (r: Rarity) => RARITY_ORDER.indexOf(r);

export function rarityFromRoll(pack: PackType, roll: number): Rarity {
  let acc = 0;
  for (const r of RARITY_ORDER) {
    acc += PACK_ODDS[pack][r];
    if (roll < acc) return r;
  }
  return "common";
}

export function pullSeedFor(serverSeed: string, accountId: string, pack: PackType, pullIndex: number): string {
  return deriveSeed(serverSeed, `pack:${accountId}:${pack}:${pullIndex}`);
}

export interface PullContext {
  serverSeed: string;
  accountId: string;
  season: number;
}

/** One deterministic pull. Pity is applied after the roll and reported. */
export function pullPack(pack: PackType, pity: PityState, ctx: PullContext): { pull: PackPull; pity: PityState } {
  const pullIndex = pity.pulls;
  const pullSeed = pullSeedFor(ctx.serverSeed, ctx.accountId, pack, pullIndex);
  const roll = new Rng(pullSeed).int(10_000);
  let rarity = rarityFromRoll(pack, roll);
  let pityTriggered: PackPull["pityTriggered"] = "none";
  for (const rule of PACK_PITY[pack]) {
    if (rank(rarity) >= rank(rule.min)) continue;
    if (pity[rule.counter] + 1 >= rule.within) {
      rarity = rule.min;
      pityTriggered = rule.counter === "sinceEpic" ? "epic" : "rare";
      break;
    }
  }
  const genome: Genome = generateFoundationGenome(pullSeed, { season: ctx.season, rarity });
  const next: PityState = { pulls: pity.pulls + 1, sinceRare: pity.sinceRare + 1, sinceEpic: pity.sinceEpic + 1 };
  for (const rule of PACK_PITY[pack]) if (rank(rarity) >= rank(rule.min)) next[rule.counter] = 0;
  return {
    pull: { pack, pullIndex, season: ctx.season, seedCommitment: commitSeed(ctx.serverSeed), pullSeed, rarity, pityTriggered, roll, genome },
    pity: next,
  };
}

/** Re-derive a revealed pull and check every field. */
export function verifyPull(pull: PackPull, revealedServerSeed: string, accountId: string, pityBefore: PityState): boolean {
  try {
    if (commitSeed(revealedServerSeed) !== pull.seedCommitment) return false;
    if (pityBefore.pulls !== pull.pullIndex) return false;
    const again = pullPack(pull.pack, pityBefore, { serverSeed: revealedServerSeed, accountId, season: pull.season }).pull;
    return JSON.stringify(again) === JSON.stringify(pull);
  } catch {
    return false;
  }
}

/** Published odds table with pity text, for the pack screen. */
export function oddsTable(pack: PackType): { rarity: Rarity; percent: string }[] {
  return RARITY_ORDER.filter((r) => PACK_ODDS[pack][r] > 0).map((r) => ({ rarity: r, percent: `${(PACK_ODDS[pack][r] / 100).toFixed(2)}%` }));
}

/** Ceiling disclosure: every pack foal's potential per stat is at most this. */
export function packCeiling(season: number): number {
  return potentialCeiling(season);
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export type PackMode = "free" | "credits" | "premium";

export interface PackAllowance {
  /** Distinct real days with any play activity, lifetime. */
  playDays: number;
  freePaddockClaimed: number;
  paddockBoughtThisWeek: number;
  premiumThisWeek: number;
  /** Pack foals minted this season (global) and the cap. */
  seasonCropUsed: number;
  seasonCropCap?: number;
  /** Free stalls in the stable (packs need a stall; the nursery is only for foaling). */
  stallsFree: number;
  credits: number;
  /** Premium packs are geo-blocked where paid loot boxes are restricted. */
  premiumAllowedInRegion: boolean;
}

export type PackBlock = "no_free_pack" | "weekly_limit" | "crop_cap" | "no_stall" | "insufficient_credits" | "region_blocked";

export function freePaddockEarned(playDays: number): number {
  return Math.floor(Math.max(0, playDays) / FREE_PADDOCK_EVERY_PLAY_DAYS);
}

export function packBlock(mode: PackMode, a: PackAllowance): PackBlock | null {
  if (a.stallsFree <= 0) return "no_stall";
  if (a.seasonCropUsed >= (a.seasonCropCap ?? SEASON_FOAL_CROP_CAP)) return "crop_cap";
  if (mode === "free") return freePaddockEarned(a.playDays) > a.freePaddockClaimed ? null : "no_free_pack";
  if (mode === "credits") {
    if (a.paddockBoughtThisWeek >= PADDOCK_CREDIT_BUYS_PER_WEEK) return "weekly_limit";
    return a.credits >= PADDOCK_PACK_PRICE ? null : "insufficient_credits";
  }
  if (!a.premiumAllowedInRegion) return "region_blocked";
  return a.premiumThisWeek >= PREMIUM_PER_WEEK ? "weekly_limit" : null;
}

export function packTypeFor(mode: PackMode): PackType {
  return mode === "premium" ? "premium" : "paddock";
}

/** Free-pack foals are Club-bred (never tradeable); bought ones are free to trade. */
export function packBinding(mode: PackMode): Binding {
  return mode === "free" ? "club_bred" : "free";
}

/** Foal sex for a pull (seeded). */
export function pullSex(pull: Pick<PackPull, "pullSeed">): "colt" | "filly" {
  return new Rng(`${pull.pullSeed}|sex`).chance(500) ? "colt" : "filly";
}
