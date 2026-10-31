import { concat, encodeAbiParameters, keccak256, sha256, toBytes, type Address, type Hex, type TypedDataDefinition } from "viem";
import { toBytes32 } from "./merkle";

// TotePools.sol helpers (the DORMANT real-USDG tote, docs/usdg-tote.md). MUST match the contract:
// EIP712("PostTimeTotePools", "1"), BET_PERMIT_TYPEHASH, the little-endian position packing,
// finalSeed = sha256(serverSeed ‖ entropy) and the attested result hash. test/tote-pools.test.ts checks every one of them
// against the compiled contract. apps/web gets a copy through scripts/export-web.ts.

export const TOTE_EIP712_NAME = "PostTimeTotePools";
export const TOTE_EIP712_VERSION = "1";

/** TotePools.Pool */
export const TOTE_POOL = { win: 0, place: 1 } as const;
export type TotePoolName = keyof typeof TOTE_POOL;

/** TotePools.Status */
export const TOTE_MARKET_STATUS = ["none", "open", "result_posted", "finalized", "void"] as const;
export type ToteMarketStatus = (typeof TOTE_MARKET_STATUS)[number];

export const betPermitTypes = {
  BetPermit: [
    { name: "bettor", type: "address" },
    { name: "raceId", type: "bytes32" },
    { name: "runner", type: "uint8" },
    { name: "pool", type: "uint8" },
    { name: "maxAmount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

export interface BetPermit {
  /** The wallet that will send the bet (msg.sender). */
  bettor: Address;
  /** toteRaceKey(raceId) */
  raceId: Hex;
  /** The runner index (gate - 1) the bet must be on. */
  runner: number;
  /** TOTE_POOL: the pool the bet must be in. */
  pool: number;
  /** Base units (USDG: 6 decimals): the bet may be at most this. */
  maxAmount: bigint;
  /** Single-use per bettor; random 256-bit. */
  nonce: bigint;
  /** unix seconds: not valid before. */
  issuedAt: bigint;
  /** unix seconds: not valid after; at most MAX_PERMIT_TTL (10 min) after issuedAt. */
  expiry: bigint;
}

export function betPermitTypedData(p: BetPermit, chainId: number, totePools: Address): TypedDataDefinition<typeof betPermitTypes, "BetPermit"> {
  return {
    domain: { name: TOTE_EIP712_NAME, version: TOTE_EIP712_VERSION, chainId, verifyingContract: totePools },
    types: betPermitTypes,
    primaryType: "BetPermit",
    message: { ...p },
  };
}

/** On-chain race reference: keccak256(utf8("posttime:race:<uuid>")), lowercase uuid. */
export function toteRaceKey(raceId: string): Hex {
  return keccak256(toBytes(`posttime:race:${raceId.toLowerCase()}`));
}

/** The engine's seed format: 64 lowercase hex characters, no 0x. */
export function toEngineHex(b32: Hex): string {
  return toBytes32(b32).slice(2);
}

/**
 * The seed a real-tote race runs on: sha256(serverSeed bytes ‖ entropy bytes), lowercase hex
 * without 0x (the engine's seed format). Same as TotePools.finalSeedOf and racing-engine
 * `mixSeedEntropy`.
 */
export function toteFinalSeed(serverSeedHex: string, entropyHex: string): string {
  return sha256(concat([toBytes32(serverSeedHex), toBytes32(entropyHex)])).slice(2);
}

/** Packs finishing positions (index = runner = gate - 1; 0 = non-runner) like the contract. */
export function packTotePositions(positions: readonly number[]): Hex {
  if (positions.length > 32) throw new Error("at most 32 runners");
  let word = 0n;
  positions.forEach((p, i) => {
    if (!Number.isInteger(p) || p < 0 || p > 255) throw new Error("bad position");
    word |= BigInt(p) << BigInt(8 * i);
  });
  return `0x${word.toString(16).padStart(64, "0")}`;
}

export function unpackTotePositions(packed: Hex, runnerCount: number): number[] {
  const word = BigInt(packed);
  return Array.from({ length: runnerCount }, (_, i) => Number((word >> BigInt(8 * i)) & 0xffn));
}

/**
 * What the result attestor attests and finalize checks: keccak256(abi.encode(raceId, finalSeed,
 * packed positions)) (TotePools.resultHashOf).
 */
export function toteResultHash(raceId: Hex, finalSeed: Hex, packedPositions: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }], [raceId, toBytes32(finalSeed), packedPositions]));
}

/** Paying places of the place pool for `ran` runners (game-core totePlaces). */
export function totePlacesFor(ran: number): 0 | 2 | 3 {
  if (ran >= 8) return 3;
  if (ran >= 5) return 2;
  return 0;
}

/**
 * Decimal odds x 1000 per runner from on-chain stakes (same formula as game-core
 * totePoolView): net / (stake x parts), never below 1.00 (winners never lose); null for an
 * unbacked runner. Live odds only: they move until betting closes.
 */
export function toteOddsMilli(stakes: readonly bigint[], takeoutBps: number, paying: number): (number | null)[] {
  const total = stakes.reduce((a, b) => a + b, 0n);
  const net = total - (total * BigInt(takeoutBps)) / 10_000n;
  const backed = stakes.filter((s) => s > 0n).length;
  const parts = BigInt(Math.max(1, Math.min(paying, backed)));
  return stakes.map((s) => (s > 0n && paying > 0 ? Math.max(1000, Number((net * 1000n) / (s * parts))) : null));
}
