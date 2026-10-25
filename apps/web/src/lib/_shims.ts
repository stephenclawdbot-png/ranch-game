// TEMPORARY shim for local iteration until @thoroughbred/racing-engine lands. DELETE before finishing.
import { createHash, createHmac } from "node:crypto";
import type { RaceInput, RaceReplay, FinishRecord } from "@thoroughbred/shared";
import { FRAME_STRIDE } from "@thoroughbred/shared";

export const ENGINE_VERSION = "shim-0";
export const commitSeed = (seedHex: string) => createHash("sha256").update(Buffer.from(seedHex, "hex")).digest("hex");
export const deriveSeed = (secret: string, label: string) => createHmac("sha256", secret).update(label).digest("hex");

export function simulateRace(input: RaceInput): RaceReplay {
  const tickHz = 20, sampleEvery = 2;
  const track = input.race.distanceM * 1000;
  let s = parseInt(input.seed.slice(0, 8), 16);
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const n = input.entries.length;
  const dist = new Array(n).fill(0), fin: (number | null)[] = new Array(n).fill(null);
  const base = input.entries.map((e) => 15000 + e.horse.stats.speed * 3 + Math.floor(rnd() * 600));
  const frames: number[][] = [];
  let tick = 0;
  while (fin.some((f) => f === null) && tick < 100000) {
    for (let i = 0; i < n; i++) {
      if (fin[i] !== null) continue;
      const v = base[i]! + Math.floor((rnd() - 0.5) * 1500);
      const prev = dist[i]!;
      dist[i] = prev + Math.floor(v / tickHz);
      if (dist[i]! >= track) {
        fin[i] = Math.floor(((tick + (track - prev) / (dist[i]! - prev)) * 1_000_000) / tickHz);
        dist[i] = track;
      }
    }
    if (tick % sampleEvery === 0) {
      const f: number[] = [];
      for (let i = 0; i < n; i++) f.push(dist[i]!, (input.entries[i]!.gate - 1) * 1000, base[i]!, 800);
      frames.push(f);
    }
    tick++;
  }
  void FRAME_STRIDE;
  const order = input.entries.map((e, i) => ({ e, t: fin[i]! })).sort((a, b) => a.t - b.t);
  const purse = [0.6, 0.2, 0.1, 0.05, 0.05];
  const finishOrder: FinishRecord[] = order.map((o, i) => ({
    horseId: o.e.horse.id, position: i + 1, finishTimeUs: o.t,
    marginMm: i === 0 ? 0 : Math.round(((o.t - order[i - 1]!.t) * 16) / 1000),
    marginLabel: i === 0 ? "" : ["nose", "head", "neck", "1/2", "1", "2"][i % 6]!,
    prize: Math.floor(input.race.purse * (purse[i] ?? 0)),
  }));
  const resultHash = createHash("sha256").update(JSON.stringify(finishOrder) + input.seed).digest("hex");
  return {
    version: 1, engineVersion: ENGINE_VERSION, race: input.race, seedCommitment: commitSeed(input.seed), seed: input.seed,
    tickHz, sampleEvery, trackLengthMm: track, laneCount: Math.max(8, n),
    horses: input.entries.map((e) => ({ horseId: e.horse.id, name: e.horse.name, gate: e.gate, tactic: e.tactic, appearance: e.horse.appearance })),
    frames, totalTicks: tick, events: [{ tick: 0, type: "start", text: "They're off!" }],
    result: { finishOrder, winningTimeUs: order[0]!.t, photoFinish: false, resultHash },
  };
}
export function verifyReplay(input: RaceInput, replay: RaceReplay): boolean {
  return simulateRace(input).result.resultHash === replay.result.resultHash && commitSeed(input.seed) === replay.seedCommitment;
}
