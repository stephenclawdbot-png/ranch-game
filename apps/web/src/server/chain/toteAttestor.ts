/**
 * The real-money tote's RESULT ATTESTOR: a DORMANT scaffold (docs/usdg-tote.md), and deliberately
 * separate from the operator (toteChain.ts). Server only.
 *
 * TotePools pays a result only when two keys agree: the OPERATOR posts it, and this attestor,
 * with its own key (RESULT_ATTESTOR_ROLE) and ideally its own RPC endpoint and deployment,
 * re-runs the race independently and attests the hash of what it got. For every posted result it:
 *   1. reads the market from the chain (finalSeed, the posted positions), never the operator's
 *      stored result;
 *   2. re-simulates the race with the deterministic engine on the race's locked field from that
 *      finalSeed (game.ts replayPositionsFromSeed);
 *   3. attests keccak256(abi.encode(raceId, finalSeed, its own positions)). If the positions
 *      match the posted ones that is a matching attestation and the market can finalize after
 *      its window; if not, the mismatching attestation freezes the market on chain and an alert
 *      asks the guardian multisig to correct or void it.
 *
 * Residual trust: the attestor reads the locked field (the runners and their engine inputs) from
 * the same database as the operator. It catches a wrong or forged result, not a tampered field.
 *
 *   TOTE_ATTESTOR_PRIVATE_KEY   SECRET: RESULT_ATTESTOR_ROLE key. Must differ from the operator
 *                               and permit-signer keys (the contract refuses one key in two roles).
 *   TOTE_ATTESTOR_RPC_URL       its own RPC endpoint (defaults to ROBINHOOD_RPC_URL; a separate
 *                               provider is better: a lying node can't fool both services)
 * plus the switch (REAL_TOTE_ENABLED, WEB3_ENABLED, TOTE_POOLS_ADDRESS) and CHAIN_ID.
 */
import { concat, createPublicClient, createWalletClient, getAddress, http, isAddress, keccak256, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as gc from "@thoroughbred/game-core";
import { getRealToteRace, raiseRealToteAlert, realToteAttestWork, type Db } from "@thoroughbred/db";
import { totePoolsAbi } from "@/lib/chain/contracts.generated";
import { viemChain } from "@/lib/chain/chains";
import { replayPositionsFromSeed } from "../game";
import { RealToteOffError } from "./toteChain";

type Env = Record<string, string | undefined>;

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

export interface AttestorConfig {
  chainId: number;
  rpcUrl: string;
  totePools: Address;
  attestorKey: Hex;
}

/** The attestor's own configuration, or RealToteOffError naming what is missing (never echoing a key). */
export function readAttestorConfig(env: Env = process.env): AttestorConfig {
  const missing: string[] = [...gc.realToteGate(env).missing];
  const pools = env.TOTE_POOLS_ADDRESS?.trim() ?? "";
  if (pools && !isAddress(pools, { strict: false })) missing.push("TOTE_POOLS_ADDRESS (not an address)");
  const rpcUrl = env.TOTE_ATTESTOR_RPC_URL?.trim() || env.ROBINHOOD_RPC_URL?.trim() || "";
  if (!rpcUrl) missing.push("TOTE_ATTESTOR_RPC_URL");
  const key = env.TOTE_ATTESTOR_PRIVATE_KEY?.trim() ?? "";
  if (!KEY_RE.test(key)) missing.push("TOTE_ATTESTOR_PRIVATE_KEY");
  const others = [env.TOTE_OPERATOR_PRIVATE_KEY, env.TOTE_PERMIT_SIGNER_PRIVATE_KEY].map((k) => k?.trim().toLowerCase());
  if (KEY_RE.test(key) && others.includes(key.toLowerCase())) missing.push("TOTE_ATTESTOR_PRIVATE_KEY (must differ from the operator and permit-signer keys)");
  const chainId = Number(env.CHAIN_ID?.trim() || env.ROBINHOOD_CHAIN_ID?.trim() || 46630);
  if (!Number.isInteger(chainId) || chainId <= 0) missing.push("CHAIN_ID");
  if (missing.length) throw new RealToteOffError(missing);
  return { chainId, rpcUrl, totePools: getAddress(pools), attestorKey: key as Hex };
}

/** Packs finishing positions like TotePools (byte i, little-endian, = runner i's position). */
export function packPositions(positions: readonly number[]): Hex {
  let word = 0n;
  positions.forEach((p, i) => {
    if (!Number.isInteger(p) || p < 0 || p > 255) throw new Error("bad position");
    word |= BigInt(p) << BigInt(8 * i);
  });
  return `0x${word.toString(16).padStart(64, "0")}`;
}

/** TotePools.resultHashOf: keccak256(abi.encode(raceId, finalSeed, positions)), three bytes32 words. */
export function toteResultHash(marketKey: Hex, finalSeed: Hex, packed: Hex): Hex {
  return keccak256(concat([marketKey, finalSeed, packed]));
}

export interface AttestorMarket {
  /** TotePools.Status: 2 = a result is posted. */
  status: number;
  finalSeed: Hex;
  positions: Hex;
  runnerCount: number;
}

export interface AttestorChain {
  getMarket(marketKey: Hex): Promise<AttestorMarket>;
  attestResult(marketKey: Hex, hash: Hex): Promise<Hex>;
}

export function evmAttestorChain(cfg: AttestorConfig): AttestorChain {
  const chain = viemChain(cfg.chainId, cfg.rpcUrl);
  const pc = createPublicClient({ chain, transport: http(cfg.rpcUrl) }) as PublicClient;
  const account = privateKeyToAccount(cfg.attestorKey);
  const wc = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  return {
    getMarket: async (k) => {
      const m = await pc.readContract({ address: cfg.totePools, abi: totePoolsAbi, functionName: "getMarket", args: [k] });
      return { status: Number(m.status), finalSeed: m.finalSeed, positions: m.positions, runnerCount: Number(m.runnerCount) };
    },
    attestResult: (k, hash) => wc.writeContract({ address: cfg.totePools, abi: totePoolsAbi, functionName: "attestResult", args: [k, hash], account, chain }),
  };
}

export interface AttestorDeps {
  env?: Env;
  chain?: AttestorChain;
  /** Injected in tests; game.ts replayPositionsFromSeed otherwise. */
  replay?: (db: Db, raceId: string, seedHex: string, now: Date) => Promise<number[]>;
}

export interface AttestorReport {
  skipped?: "off";
  attested: string[];
  /** Replays that disagreed with the posted result: attested with the replay's hash (the market freezes) and alerted. */
  mismatched: string[];
  errors: { raceId: string; error: string }[];
}

/**
 * One attestor pass over the posted results it hasn't matched yet. Returns at once while the tote
 * is off. Never trusts the operator: the seed and the posted positions come from the chain, the
 * finish from its own replay.
 */
export async function realToteAttestorRun(db: Db, now: Date, deps: AttestorDeps = {}): Promise<AttestorReport> {
  const env = deps.env ?? process.env;
  if (!gc.realToteGate(env).enabled) return { skipped: "off", attested: [], mismatched: [], errors: [] };
  const cfg = readAttestorConfig(env);
  const chain = deps.chain ?? evmAttestorChain(cfg);
  const replay = deps.replay ?? replayPositionsFromSeed;
  const report: AttestorReport = { attested: [], mismatched: [], errors: [] };
  for (const raceId of await realToteAttestWork(db)) {
    try {
      const rt = await getRealToteRace(db, raceId);
      if (!rt) continue;
      const k = rt.marketKey as Hex;
      const m = await chain.getMarket(k);
      if (m.status !== 2) continue; // not (or no longer) a posted result
      const mine = await replay(db, raceId, m.finalSeed.slice(2).toLowerCase(), now);
      if (mine.length !== m.runnerCount) throw new Error(`replay has ${mine.length} runners, the market ${m.runnerCount}`);
      const packed = packPositions(mine);
      await chain.attestResult(k, toteResultHash(k, m.finalSeed, packed));
      if (packed.toLowerCase() === m.positions.toLowerCase()) report.attested.push(raceId);
      else {
        report.mismatched.push(raceId);
        console.error("[real-tote][ALERT] posted result differs from the independent replay", raceId);
        await raiseRealToteAlert(db, { raceId, kind: "result_mismatch", detail: `posted ${m.positions}, replay ${packed}` }, now);
      }
    } catch (err) {
      const error = (err as Error).message.slice(0, 200);
      report.errors.push({ raceId, error });
      await raiseRealToteAlert(db, { raceId, kind: "attestor_error", detail: error }, now).catch(() => undefined);
    }
  }
  return report;
}
