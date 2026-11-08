/**
 * The machine registry is well formed, and docs/state-machines.md shows exactly what it declares.
 *
 * After changing a machine, regenerate the doc's diagram section:
 *
 *   cd packages/game-core && BAKE_MACHINES=1 pnpm exec vitest run src/machines/machines.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { machineProblems, type Machine } from "@thoroughbred/shared";
import { describe, expect, it } from "vitest";
import { JOCKEY_STAGES } from "../jockeys";
import { SERVER_MACHINES, jockeyStageMachine, machinesMarkdown, raceCardPhaseAt, raceCardPhaseMachine, type RaceCardPhase } from "./index";

const DOC = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/state-machines.md");
const BEGIN = "<!-- BEGIN GENERATED: machines (BAKE_MACHINES=1, packages/game-core/src/machines/machines.test.ts) -->";
const END = "<!-- END GENERATED: machines -->";

describe("SERVER_MACHINES", () => {
  const all: [string, Machine<string>][] = Object.entries(SERVER_MACHINES);

  it("every machine is well formed (no unreachable state, no unmarked dead end)", () => {
    for (const [, m] of all) expect(machineProblems(m), m.name).toEqual([]);
  });

  it("is keyed by machine name, and every state has a description", () => {
    for (const [key, m] of all) {
      expect(m.name).toBe(key);
      expect(m.storedIn, m.name).toBeTruthy();
      for (const s of m.states) expect(m.describe?.[s], `${m.name}.${s}`).toBeTruthy();
    }
  });

  it("the jockey stage machine has exactly game-core's JOCKEY_STAGES", () => {
    expect([...jockeyStageMachine.states]).toEqual([...JOCKEY_STAGES]);
  });
});

describe("raceCardPhaseAt", () => {
  it("only moves forward as time passes (every change is a move of raceCardPhaseMachine)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 20_000 }),
        fc.array(fc.integer({ min: 0, max: 40_000 }), { minLength: 2, maxLength: 12 }),
        (closeAt, gapToPost, lockDelay, broadcastLen, times) => {
          const entriesCloseAtMs = closeAt;
          const postTimeMs = closeAt + gapToPost;
          const lockedAt = closeAt + lockDelay; // the field locks at or after entries close
          const overAt = postTimeMs + broadcastLen;
          const at = (nowMs: number): RaceCardPhase =>
            raceCardPhaseAt({ nowMs, postTimeMs, entriesCloseAtMs, fieldLocked: nowMs >= lockedAt, broadcastOver: nowMs >= overAt });
          const sorted = [...times].sort((a, b) => a - b);
          for (let i = 1; i < sorted.length; i++) {
            const from = at(sorted[i - 1]!);
            const to = at(sorted[i]!);
            if (from !== to && !raceCardPhaseMachine.can(from, to)) return false;
          }
          return true;
        },
      ),
      { numRuns: 300 },
    );
  });

  it("matches the documented phases", () => {
    const base = { postTimeMs: 1000, entriesCloseAtMs: 500, fieldLocked: false, broadcastOver: false };
    expect(raceCardPhaseAt({ ...base, nowMs: 0 })).toBe("open");
    expect(raceCardPhaseAt({ ...base, nowMs: 0, fieldLocked: true })).toBe("closed");
    expect(raceCardPhaseAt({ ...base, nowMs: 600 })).toBe("closed");
    expect(raceCardPhaseAt({ ...base, nowMs: 1000 })).toBe("live");
    expect(raceCardPhaseAt({ ...base, nowMs: 1000, broadcastOver: true })).toBe("finished");
  });
});

describe("docs/state-machines.md", () => {
  it("shows exactly the registry (rewrite with BAKE_MACHINES=1)", () => {
    expect(existsSync(DOC), "docs/state-machines.md is missing").toBe(true);
    const doc = readFileSync(DOC, "utf8");
    const a = doc.indexOf(BEGIN);
    const b = doc.indexOf(END);
    expect(a >= 0 && b > a, "the doc lost its generated-section markers").toBe(true);
    const generated = `${BEGIN}\n\n${machinesMarkdown(Object.values(SERVER_MACHINES))}\n${END}`;
    const current = doc.slice(a, b + END.length);
    if (process.env.BAKE_MACHINES === "1" && current !== generated) {
      writeFileSync(DOC, doc.slice(0, a) + generated + doc.slice(b + END.length));
      return;
    }
    expect(current, "docs/state-machines.md is stale: run BAKE_MACHINES=1 (see this file's header)").toBe(generated);
  });
});
