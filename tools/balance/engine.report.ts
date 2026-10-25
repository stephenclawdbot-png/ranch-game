/**
 * Engine-level feel with controlled fields: winning margins, photo finishes, tactic shares and
 * comebacks for (a) identical 650 horses, (b) the engine's typicalField (+-60 spread),
 * (c) a wide field (quality spread like the old random rival draws).
 */
import { it } from "vitest";
import type { RunningStyle } from "@thoroughbred/shared";
import { FRAME_STRIDE } from "@thoroughbred/shared";
import { simulateRace } from "../../packages/racing-engine/src/index";
import { makeInput, seedFor, typicalField, type EntryOpts } from "../../packages/racing-engine/src/test-fixtures";
import { median, mean, pct } from "../../apps/web/src/server/balance/sim";
import { writeReport } from "./out";

const N = Number(process.env.BAL_N ?? 150);
const STYLES: RunningStyle[] = ["front", "stalker", "closer"];

function run(name: string, mk: (s: number, d: number) => EntryOpts[], d: number) {
  const margins: number[] = [];
  const tac: Record<RunningStyle, number> = { front: 0, stalker: 0, closer: 0 };
  let photo = 0;
  let comeback = 0;
  let spread = 0;
  for (let s = 0; s < N; s++) {
    const field = mk(s, d);
    const entries = field.map((e, i) => ({ ...e, gate: ((i + s) % field.length) + 1 }));
    const input = makeInput(entries, { distanceM: d, seed: seedFor(500_000 + s) });
    const r = simulateRace(input);
    const fo = r.result.finishOrder;
    margins.push(fo[1]!.marginMm);
    if (fo[1]!.marginMm < 150) photo++;
    spread += (fo[fo.length - 1]!.finishTimeUs - fo[0]!.finishTimeUs) / 1e6;
    const w = input.entries.find((e) => e.horse.id === fo[0]!.horseId)!;
    tac[w.tactic]++;
    const wi = r.horses.findIndex((h) => h.horseId === fo[0]!.horseId);
    for (const f of r.frames) {
      let lead = 0;
      for (let i = 0; i < r.horses.length; i++) lead = Math.max(lead, f[i * FRAME_STRIDE]!);
      if (lead * 4 >= r.trackLengthMm * 3) {
        let ahead = 0;
        for (let i = 0; i < r.horses.length; i++) if (f[i * FRAME_STRIDE]! > f[wi * FRAME_STRIDE]!) ahead++;
        if (ahead >= 4) comeback++;
        break;
      }
    }
  }
  const row = {
    name,
    d,
    medianMarginL: median(margins) / 2400,
    meanMarginL: mean(margins) / 2400,
    photo: photo / N,
    comeback: comeback / N,
    fieldSpreadS: spread / N,
    front: tac.front / N,
    stalker: tac.stalker / N,
    closer: tac.closer / N,
  };
  return row;
}

it("engine feel", () => {
  const rows = [];
  const equal = (_s: number, d: number): EntryOpts[] => Array.from({ length: 10 }, (_, k) => ({ stats: 650, style: STYLES[k % 3]!, preferredDistanceM: d }));
  const typical = (_s: number, d: number) => typicalField(10, d);
  const wide = (s: number, d: number): EntryOpts[] =>
    Array.from({ length: 10 }, (_, k) => ({ stats: 450 + Math.round((((k * 7 + s) % 10) * 300) / 9), style: STYLES[k % 3]!, preferredDistanceM: d }));
  for (const d of [1000, 1600, 2400]) {
    rows.push(run("equal650", equal, d));
    rows.push(run("typical", typical, d));
    rows.push(run("wide450-750", wide, d));
  }
  const lines = [
    `# Engine feel, 10 runners, N=${N} per row`,
    ...rows.map(
      (r) =>
        `${r.name.padEnd(12)} ${r.d}m: margin median ${r.medianMarginL.toFixed(2)} L mean ${r.meanMarginL.toFixed(2)} L | photo ${pct(r.photo)} | comeback ${pct(r.comeback)} | first-last ${r.fieldSpreadS.toFixed(1)} s | wins F/S/C ${pct(r.front, 0)}/${pct(r.stalker, 0)}/${pct(r.closer, 0)}`,
    ),
  ];
  writeReport("engine", rows, lines);
});
