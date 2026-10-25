/** Test helpers (not exported from the package entry). */
import type { Silks } from "@thoroughbred/shared";
import type { HorseState, PedigreeEntry, Rarity } from "./types";
import { generateFoundationGenome } from "./genome";
import { CARE_TO_RACING, createHorseState } from "./lifecycle";

export const T0 = 1_800_000_000_000 - (1_800_000_000_000 % 86_400_000); // a UTC midnight
export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const SILKS: Silks = { primary: "#112233", secondary: "#ffffff", pattern: "hoops", cap: "#aa0000" };

export interface MakeOpts {
  id?: string;
  sex?: "colt" | "filly";
  rarity?: Rarity;
  care?: number;
  starts?: number;
  retired?: boolean;
  sireId?: string | null;
  damId?: string | null;
  generation?: number;
  ownerId?: string;
}

export function makeHorse(seed: string, o: MakeOpts = {}): HorseState {
  const h = createHorseState({
    id: o.id ?? `h-${seed}`,
    name: `Horse ${seed}`.slice(0, 32),
    sex: o.sex ?? "colt",
    ownerId: o.ownerId ?? "owner-1",
    sireId: o.sireId ?? null,
    damId: o.damId ?? null,
    generation: o.generation ?? 0,
    genome: generateFoundationGenome(seed, { season: 1, rarity: o.rarity ?? "common" }),
    bornAtMs: T0,
    bornSeason: 1,
    careSessions: o.care ?? CARE_TO_RACING,
  });
  let out: HorseState = { ...h, career: { ...h.career, starts: o.starts ?? 0 } };
  if (o.retired) out = { ...out, career: { ...out.career, racingRetired: { reason: "choice", atStarts: out.career.starts } } };
  return out;
}

export function pedOf(...horses: HorseState[]): Record<string, PedigreeEntry> {
  const out: Record<string, PedigreeEntry> = {};
  for (const h of horses) out[h.id] = { sireId: h.sireId, damId: h.damId, generation: h.generation };
  return out;
}
