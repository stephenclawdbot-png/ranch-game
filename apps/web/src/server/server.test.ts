import { describe, expect, it } from "vitest";
import { HorseSchema, RaceInputSchema } from "@thoroughbred/shared";
import { commitSeed } from "./engine";
import { HOUSE_STABLES, RIVAL_POOL, isValidPlayerId, parsePlayerHorseId, starterHorses } from "./demoData";
import {
  RaceNotFoundError,
  SLOT_MS,
  TooEarlyError,
  createQuickRace,
  currentSlot,
  decodeQuickRaceId,
  getRace,
  getRaceInput,
  getReplay,
  listScheduled,
  slotPostTime,
  verifyRace,
} from "./races";
import { DemoRepository } from "./repository";

const PLAYER = "abc123def456ghij";
const NOW = Date.UTC(2026, 9, 25, 15, 0, 0);

describe("demo data", () => {
  it("rival pool is deterministic, valid and spread across house stables", () => {
    expect(RIVAL_POOL).toHaveLength(48);
    expect(HOUSE_STABLES).toHaveLength(8);
    for (const h of RIVAL_POOL) expect(HorseSchema.safeParse(h).success).toBe(true);
    expect(new Set(RIVAL_POOL.map((h) => h.name)).size).toBe(48);
    expect(new Set(RIVAL_POOL.map((h) => h.id)).size).toBe(48);
    // Rivals have historic records; stats have trade-offs (nobody maxed everywhere).
    expect(RIVAL_POOL.every((h) => h.record.starts > 0)).toBe(true);
    for (const h of RIVAL_POOL) {
      const s = Object.values(h.stats);
      expect(Math.max(...s) - Math.min(...s)).toBeGreaterThanOrEqual(60);
    }
  });

  it("starter horses are a pure function of playerId and valid against HorseSchema", () => {
    const a = starterHorses(PLAYER);
    const b = starterHorses(PLAYER);
    expect(a).toEqual(b);
    expect(a).toHaveLength(6);
    for (const h of a) {
      expect(HorseSchema.safeParse(h).success).toBe(true);
      expect(h.ownerId).toBe(PLAYER);
      expect(h.record).toEqual({ starts: 0, wins: 0, places: 0, shows: 0, earnings: 0 });
      expect(parsePlayerHorseId(h.id)?.playerId).toBe(PLAYER);
    }
    expect(new Set(a.map((h) => h.name)).size).toBe(6);
    const other = starterHorses("zzz999yyy888xxx7");
    expect(other.map((h) => h.name)).not.toEqual(a.map((h) => h.name));
  });

  it("validates player ids", () => {
    expect(isValidPlayerId(PLAYER)).toBe(true);
    expect(isValidPlayerId("short")).toBe(false);
    expect(isValidPlayerId("UPPER-case-id-x")).toBe(false);
    expect(() => starterHorses("nope")).toThrow();
  });
});

describe("schedule", () => {
  it("is deterministic per slot and spaced every 3 minutes", () => {
    const k = currentSlot(NOW);
    const a = getRace(`s-${k + 1}`, NOW);
    const b = getRace(`s-${k + 1}`, NOW + 12_345);
    expect(a.config).toEqual(b.config);
    expect(a.field).toEqual(b.field);
    expect(a.seedCommitment).toBe(b.seedCommitment);
    expect(slotPostTime(k + 1) - slotPostTime(k)).toBe(SLOT_MS);
    expect(a.field.length).toBeGreaterThanOrEqual(8);
    expect(a.field.length).toBeLessThanOrEqual(12);
    expect(new Set(a.field.map((e) => e.gate)).size).toBe(a.field.length);
    expect(RaceInputSchema.safeParse(getRaceInput(a.id)).success).toBe(true);
  });

  it("lists upcoming races in the future and recent ones in the past", () => {
    const { upcoming, recent } = listScheduled(NOW);
    expect(upcoming.every((r) => r.postTimeMs > NOW && r.phase === "upcoming")).toBe(true);
    expect(recent.every((r) => r.postTimeMs <= NOW)).toBe(true);
    for (const r of recent) if (r.phase === "finished") expect(r.winner).toBeDefined();
    expect(listScheduled(NOW)).toEqual(listScheduled(NOW));
  });
});

describe("quick races", () => {
  it("creates signed ids that decode to the request, post time ~10 s out", () => {
    const { raceId, postTimeMs } = createQuickRace({ playerId: PLAYER, horseIndex: 2, tactic: "closer", stableName: "Larkrise Lodge" }, NOW);
    expect(postTimeMs - NOW).toBeGreaterThanOrEqual(10_000);
    expect(postTimeMs - NOW).toBeLessThan(11_000);
    const p = decodeQuickRaceId(raceId);
    expect(p).toMatchObject({ p: PLAYER, h: 2, t: "closer", ts: postTimeMs, sn: "Larkrise Lodge" });
    const card = getRace(raceId, NOW);
    const mine = card.field.filter((e) => e.isPlayer);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.tactic).toBe("closer");
    expect(mine[0]!.horse.id).toBe(starterHorses(PLAYER)[2]!.id);
    expect(card.field.length).toBeGreaterThanOrEqual(8);
    expect(card.field.length).toBeLessThanOrEqual(12);
  });

  it("rejects tampered or forged ids", () => {
    const { raceId } = createQuickRace({ playerId: PLAYER, horseIndex: 0, tactic: "front" }, NOW, "nonce12345");
    const [body, sig] = raceId.split(".") as [string, string];
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const forgedBody = Buffer.from(JSON.stringify({ ...payload, h: 5 }), "utf8").toString("base64url");
    const flippedSig = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    for (const bad of [`${forgedBody}.${sig}`, `${body}.${flippedSig}`, body, `${body}.`, "s-abc", "x", `${body}.${sig}.x`]) {
      expect(decodeQuickRaceId(bad)).toBeNull();
      expect(() => getRace(bad, NOW)).toThrow(RaceNotFoundError);
    }
  });

  it("withholds the replay before post time", () => {
    const { raceId, postTimeMs } = createQuickRace({ playerId: PLAYER, horseIndex: 1, tactic: "stalker" }, NOW, "early00001");
    expect(() => getReplay(raceId, postTimeMs - 1)).toThrow(TooEarlyError);
    expect(getRace(raceId, postTimeMs - 1).status).toBe("upcoming");
    expect(getRace(raceId, postTimeMs).status).toBe("live");
  });

  it("same race id gives an identical replay every time, and it verifies", () => {
    const { raceId, postTimeMs } = createQuickRace({ playerId: PLAYER, horseIndex: 3, tactic: "front" }, NOW, "same000001");
    const a = getReplay(raceId, postTimeMs + 600_000);
    // Fresh repository + uncached path produce the same bytes.
    const input = getRaceInput(raceId);
    expect(input.seed).toBe(a.seed);
    expect(commitSeed(a.seed)).toBe(a.seedCommitment);
    expect(getRace(raceId, NOW).seedCommitment).toBe(a.seedCommitment);
    const b = JSON.parse(JSON.stringify(getReplay(raceId, postTimeMs + 660_000)));
    expect(b).toEqual(JSON.parse(JSON.stringify(a)));
    const v = verifyRace(raceId, postTimeMs + 600_000, { commitment: a.seedCommitment, resultHash: a.result.resultHash });
    expect(v.commitmentOk).toBe(true);
    expect(v.resultHashOk).toBe(true);
    const wrong = verifyRace(raceId, postTimeMs + 600_000, { commitment: "0".repeat(64) });
    expect(wrong.commitmentOk).toBe(false);
  });

  it("the card never exposes the seed", async () => {
    const repo = new DemoRepository();
    const { raceId } = await repo.createQuickRace({ playerId: PLAYER, horseIndex: 0, tactic: "front" }, NOW);
    const card = await repo.getRace(raceId, NOW);
    const seed = getRaceInput(raceId).seed;
    expect(JSON.stringify(card)).not.toContain(seed);
  });
});
