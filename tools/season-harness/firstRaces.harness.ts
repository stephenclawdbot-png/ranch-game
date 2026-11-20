/**
 * First races probe: brand-new stables run their first Story races through the real server code
 * (src/firstRaces.ts). Finishing positions in race 1, 2, 3 ..., a win within the first five, and
 * what the rating does over a horse's first three starts.
 *
 *   npx vitest run --config tools/season-harness/vitest.config.ts firstRaces
 *   env: FIRST_STABLES (default 200), FIRST_SEED ("first-1"), FIRST_POLICY (open | chapter, default open),
 *        FIRST_RACES (9 open / 6 chapter), FIRST_PER_DAY (5), FIRST_BATCH (100),
 *        FIRST_OUT (a JSON file: summary and every run). To use several cores, run several seeds and merge
 *        the files (FIRST_MERGE=a.json,b.json prints the summary of the merged runs without simulating).
 *
 * Kept out of the default suites (a *.harness.ts file).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { installDeterministicRandom } from "./src/determinism";
import { defaultStartMs } from "./src/config";

it("first races", async () => {
  const stables = Number(process.env.FIRST_STABLES ?? 200);
  const seed = process.env.FIRST_SEED ?? "first-1";
  const policy = process.env.FIRST_POLICY === "chapter" ? "chapter" : "open";
  const races = Number(process.env.FIRST_RACES ?? (policy === "open" ? 9 : 6));
  installDeterministicRandom(seed);
  const { probeFirstRaces, summariseFirstRaces, replayRatings } = await import("./src/firstRaces");
  const gc = await import("@thoroughbred/game-core");
  const t0 = Date.now();
  // Merge mode: the runs of several finished files (each stable renumbered so none collide).
  const merged = (process.env.FIRST_MERGE ?? "").split(",").filter(Boolean).flatMap((f, k) => {
    const file = JSON.parse(readFileSync(f, "utf8")) as { runs: Awaited<ReturnType<typeof probeFirstRaces>> };
    return file.runs.map((r) => ({ ...r, stable: r.stable + k * 1_000_000, horseId: `${k}:${r.horseId}`, runners: r.runners.map((x) => ({ ...x, horseId: `${k}:${x.horseId}` })) }));
  });
  const runs = merged.length ? merged : await probeFirstRaces({
    stables,
    policy,
    races,
    perDay: Number(process.env.FIRST_PER_DAY ?? 5),
    startMs: defaultStartMs(),
    batch: Number(process.env.FIRST_BATCH ?? 100),
    log: (l) => console.log(l),
  });
  const summary = summariseFirstRaces(policy, runs);
  console.log(JSON.stringify(summary, null, 1));
  // The same runs with every debutant seated at its real ability mark (what-if, no new simulation).
  console.log("rating from the ability mark (replayed):", JSON.stringify(replayRatings(runs, (m) => m)));
  console.log(`rating from INITIAL_OR ${gc.INITIAL_OR} (replayed):`, JSON.stringify(replayRatings(runs, () => gc.INITIAL_OR)));
  console.log(`wall ${Math.round((Date.now() - t0) / 1000)} s`);
  if (process.env.FIRST_OUT) writeFileSync(process.env.FIRST_OUT, JSON.stringify({ seed, policy, summary, runs }));
});
