/**
 * Deterministic demo data: house stables, the rival pool and per-player starter horses.
 *
 * Everything here is a pure function of fixed seeds (or of the playerId), so the demo
 * needs no database: any server instance regenerates exactly the same horses.
 * Milestone B replaces this with Postgres-backed horses behind HorseRepository.
 */
import type {
  Coat,
  FaceMarking,
  Horse,
  HorseRecord,
  HorseStats,
  LegMarking,
  RunningStyle,
  Sex,
  Silks,
  Surface,
} from "@thoroughbred/shared";
import { SILK_COLORS, SILK_PATTERNS } from "@/lib/silks";
import { clamp, createRng, type Rng } from "./prng";

// ---------------------------------------------------------------------------
// House stables (the AI-run rivals)
// ---------------------------------------------------------------------------

export interface HouseStable {
  id: string;
  name: string;
  /** One-line flavour shown on race cards. */
  trainer: string;
  silks: Silks;
}

export const HOUSE_STABLES: readonly HouseStable[] = [
  { id: "house-harrowgate", name: "Harrowgate House", trainer: "E. Harrow", silks: { pattern: "hoops", primary: "#16224d", secondary: "#e2b33c", cap: "#e2b33c" } },
  { id: "house-bellmont", name: "Bellmont Lodge", trainer: "M. Bellamy", silks: { pattern: "sash", primary: "#f4efe3", secondary: "#c8242f", cap: "#c8242f" } },
  { id: "house-copperfield", name: "Copperfield Stud", trainer: "A. Copperfield", silks: { pattern: "chevron", primary: "#e8742a", secondary: "#2d2f33", cap: "#2d2f33" } },
  { id: "house-saltmarsh", name: "Saltmarsh Racing", trainer: "J. Salt", silks: { pattern: "stripes", primary: "#6fb3e6", secondary: "#f4efe3", cap: "#16224d" } },
  { id: "house-kestrel", name: "Kestrel Downs", trainer: "R. Kestrel", silks: { pattern: "diamonds", primary: "#5b2f8f", secondary: "#f2e27a", cap: "#5b2f8f" } },
  { id: "house-ashcombe", name: "Ashcombe Park", trainer: "H. Ashcombe", silks: { pattern: "quartered", primary: "#6e1b2b", secondary: "#a9b0b8", cap: "#6e1b2b" } },
  { id: "house-vicarage", name: "Old Vicarage Stables", trainer: "T. Penrose", silks: { pattern: "solid", primary: "#1f9d5c", secondary: "#1f9d5c", cap: "#f4efe3" } },
  { id: "house-larkspur", name: "Larkspur Farm", trainer: "C. Lark", silks: { pattern: "stars", primary: "#2346a8", secondary: "#f4efe3", cap: "#e47aa5" } },
];

const STABLE_BY_ID = new Map(HOUSE_STABLES.map((s) => [s.id, s]));

export function houseStable(id: string): HouseStable | undefined {
  return STABLE_BY_ID.get(id);
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const FIRST = [
  "Midnight", "Copper", "Velvet", "Silver", "Amber", "Harbour", "Winter", "Gilded", "Quiet", "Northern",
  "Scarlet", "Ivory", "Hollow", "Distant", "Wild", "Brass", "Paper", "Saffron", "Iron", "Lucky",
  "Morning", "Sable", "Cinder", "Royal", "Willow", "Tidal", "Storm", "Gentle", "Crimson", "Golden",
  "Stolen", "Sunday", "Last", "Hidden", "Electric", "Ember", "Ancient", "Painted", "Restless", "Moonlit",
];
const SECOND = [
  "Ledger", "Reverie", "Promise", "Sonnet", "Comet", "Verdict", "Lantern", "Meridian", "Covenant", "Rhapsody",
  "Parade", "Tempest", "Echo", "Anthem", "Gambit", "Monarch", "Overture", "Thunder", "Pilgrim", "Mirage",
  "Cipher", "Banner", "Courier", "Crown", "Waltz", "Ransom", "Sovereign", "Riddle", "Voyage", "Lullaby",
  "Kingdom", "Harvest", "Duchess", "Rebel", "Shanty", "Sparrow", "Orchard", "Compass", "Charter", "Regatta",
];
const SAINTS = ["Ambrose", "Columba", "Brendan", "Agnes", "Clement", "Hilda", "Aidan", "Cuthbert", "Bridget", "Oswin", "Benedict", "Petroc"];
const TITLES = ["Lord", "Lady", "Captain", "Miss", "Sir", "Duke", "Madame", "Colonel"];
const SURNAMES = ["Halloway", "Pemberton", "Ashgrove", "Fairweather", "Blackwood", "Whitlock", "Marlowe", "Ravensworth", "Thorne", "Kingsley", "Devereux", "Langley"];
const PLACES = ["Kildare", "Ellingham", "Corrib", "Whitby", "Galloway", "Arden", "Tintagel", "Glenmore", "Avalon", "Lismore"];

function makeName(rng: Rng, taken: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const pattern = rng.weighted<string>([
      ["an", 12],
      ["saint", 2],
      ["title", 2],
      ["of", 2],
    ]);
    let name: string;
    switch (pattern) {
      case "saint":
        name = `Saint ${rng.pick(SAINTS)}`;
        break;
      case "title":
        name = `${rng.pick(TITLES)} ${rng.pick(SURNAMES)}`;
        break;
      case "of":
        name = `${rng.pick(SECOND)} of ${rng.pick(PLACES)}`;
        break;
      default:
        name = `${rng.pick(FIRST)} ${rng.pick(SECOND)}`;
    }
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  // Practically unreachable; keeps the function total.
  const fallback = `${rng.pick(FIRST)} ${rng.pick(SECOND)} ${rng.int(2, 9)}`;
  taken.add(fallback);
  return fallback;
}

// ---------------------------------------------------------------------------
// Stats, archetypes, appearance
// ---------------------------------------------------------------------------

export type Archetype = "sprinter" | "miler" | "stayer" | "closer" | "frontrunner" | "allrounder" | "firebrand" | "mudlark";

interface ArchetypeDef {
  mods: HorseStats;
  distances: readonly number[];
  styles: readonly RunningStyle[];
}

/**
 * Stat modifiers per archetype. Balanced so each archetype rates about the same at its own trips
 * (see tools/balance/archetypes.report.ts): they differ in WHERE they are good, not how good.
 */
export const ARCHETYPES: Record<Archetype, ArchetypeDef> = {
  sprinter: { mods: { speed: 80, stamina: -190, burst: 120, durability: -20, adaptability: -40, temperament: -30 }, distances: [1000, 1200], styles: ["front", "front", "stalker"] },
  miler: { mods: { speed: 80, stamina: 20, burst: 40, durability: -40, adaptability: -40, temperament: 30 }, distances: [1400, 1600], styles: ["stalker", "stalker", "front"] },
  stayer: { mods: { speed: -40, stamina: 210, burst: -40, durability: 90, adaptability: 20, temperament: 60 }, distances: [2000, 2400], styles: ["closer", "stalker"] },
  closer: { mods: { speed: 60, stamina: 60, burst: 180, durability: 0, adaptability: -20, temperament: -40 }, distances: [1600, 2000], styles: ["closer"] },
  frontrunner: { mods: { speed: 130, stamina: 80, burst: -150, durability: 20, adaptability: -10, temperament: -60 }, distances: [1200, 1400, 1600], styles: ["front"] },
  allrounder: { mods: { speed: 55, stamina: 10, burst: -30, durability: 40, adaptability: 150, temperament: 60 }, distances: [1400, 1600, 2000], styles: ["stalker", "closer", "front"] },
  firebrand: { mods: { speed: 140, stamina: -40, burst: 90, durability: -110, adaptability: -60, temperament: -230 }, distances: [1200, 1400, 1600], styles: ["front", "stalker"] },
  mudlark: { mods: { speed: 20, stamina: 90, burst: -10, durability: 170, adaptability: 120, temperament: 40 }, distances: [1600, 2000, 2400], styles: ["stalker", "closer"] },
};
const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as Archetype[];

const STAT_KEYS: readonly (keyof HorseStats)[] = ["speed", "stamina", "burst", "durability", "adaptability", "temperament"];

function makeStats(rng: Rng, quality: number, archetype: Archetype, cap = 990): HorseStats {
  const mods = ARCHETYPES[archetype].mods;
  const out = {} as HorseStats;
  for (const key of STAT_KEYS) {
    out[key] = clamp(quality + mods[key] + rng.int(-70, 70), 80, cap);
  }
  return out;
}

const COATS: readonly (readonly [Coat, number])[] = [
  ["bay", 22], ["dark_bay", 16], ["chestnut", 18], ["liver_chestnut", 6], ["black", 8],
  ["grey", 10], ["dapple_grey", 6], ["palomino", 4], ["buckskin", 4], ["roan", 6],
];
const FACES: readonly (readonly [FaceMarking, number])[] = [
  ["none", 24], ["star", 20], ["snip", 10], ["stripe", 16], ["blaze", 22], ["bald", 6],
];
const LEGS: readonly (readonly [LegMarking, number])[] = [
  ["none", 52], ["coronet", 18], ["sock", 20], ["stocking", 10],
];

function makeLegs(rng: Rng): [LegMarking, LegMarking, LegMarking, LegMarking] {
  return [rng.weighted(LEGS), rng.weighted(LEGS), rng.weighted(LEGS), rng.weighted(LEGS)];
}

function makeSex(rng: Rng, age: number): Sex {
  if (age <= 3) return rng.pick(["colt", "filly", "colt", "filly", "gelding"] as const);
  return rng.pick(["stallion", "mare", "gelding", "mare", "gelding"] as const);
}

function preferredSurface(rng: Rng, archetype: Archetype): Surface {
  if (archetype === "mudlark") return rng.pick(["dirt", "turf"] as const);
  return rng.weighted<Surface>([["turf", 5], ["dirt", 4], ["synthetic", 2]]);
}

function emptyRecord(): HorseRecord {
  return { starts: 0, wins: 0, places: 0, shows: 0, earnings: 0 };
}

function historicRecord(rng: Rng, age: number, quality: number): HorseRecord {
  const starts = Math.max(1, (age - 1) * rng.int(3, 7));
  // Better horses win more: roughly 8% at quality 380, 30% at quality 720.
  const winPermille = clamp(Math.round(((quality - 300) * 750) / 1000) + rng.int(-40, 40), 20, 400);
  const wins = Math.round((starts * winPermille) / 1000);
  const places = Math.min(starts - wins, Math.round((starts * rng.int(100, 220)) / 1000));
  const shows = Math.min(starts - wins - places, Math.round((starts * rng.int(100, 200)) / 1000));
  const earnings = wins * rng.int(1800, 4200) + places * rng.int(500, 1100) + shows * rng.int(250, 600);
  return { starts, wins, places, shows, earnings };
}

// ---------------------------------------------------------------------------
// Rival pool
// ---------------------------------------------------------------------------

export const RIVALS_PER_STABLE = 8;
const POOL_SEED = "thoroughbred/rival-pool/v2";
/**
 * Quality tiers. Every house stable gets one horse per tier and one horse per archetype (paired
 * by a per-stable shuffle), so no stable is stacked, every archetype appears at every level across
 * the pool, and each race class (see races.ts) has enough horses for any distance and surface.
 * Starters (quality 520-620) sit around the novice/handicap tiers.
 */
const RIVAL_TIERS: readonly number[] = [460, 495, 530, 565, 600, 640, 680, 720];
const TIER_JITTER = 25;

function buildRivalPool(): { horses: Horse[]; names: Set<string> } {
  const rng = createRng(POOL_SEED);
  const names = new Set<string>();
  const horses: Horse[] = [];
  let n = 0;
  for (const stable of HOUSE_STABLES) {
    const archetypes = rng.shuffle(ARCHETYPE_IDS);
    const tiers = rng.shuffle(RIVAL_TIERS);
    for (let i = 0; i < RIVALS_PER_STABLE; i++) {
      n++;
      const archetype = archetypes[i % archetypes.length]!;
      const def = ARCHETYPES[archetype];
      const quality = tiers[i % tiers.length]! + rng.int(-TIER_JITTER, TIER_JITTER);
      const age = rng.int(2, 7);
      horses.push({
        id: `r-${String(n).padStart(2, "0")}`,
        name: makeName(rng, names),
        sex: makeSex(rng, age),
        age,
        stage: age <= 2 ? "development" : age >= 7 ? "veteran" : "prime",
        generation: 0,
        ownerId: stable.id,
        sireId: null,
        damId: null,
        stats: makeStats(rng, quality, archetype),
        preferredDistanceM: rng.pick(def.distances),
        preferredSurface: preferredSurface(rng, archetype),
        style: rng.pick(def.styles),
        appearance: {
          coat: rng.weighted(COATS),
          face: rng.weighted(FACES),
          legs: makeLegs(rng),
          silks: stable.silks,
        },
        record: historicRecord(rng, age, quality),
      });
    }
  }
  return { horses, names };
}

const POOL = buildRivalPool();
export const RIVAL_POOL: readonly Horse[] = POOL.horses;
const RIVAL_BY_ID = new Map(RIVAL_POOL.map((h) => [h.id, h]));

export function rivalById(id: string): Horse | undefined {
  return RIVAL_BY_ID.get(id);
}

// ---------------------------------------------------------------------------
// Player starters
// ---------------------------------------------------------------------------

export const STARTER_COUNT = 6;
export const PLAYER_ID_RE = /^[a-z0-9]{10,24}$/;
const PLAYER_HORSE_RE = /^p-([a-z0-9]{10,24})-([0-5])$/;

export function isValidPlayerId(id: string): boolean {
  return PLAYER_ID_RE.test(id);
}

export function playerHorseId(playerId: string, index: number): string {
  return `p-${playerId}-${index}`;
}

export function parsePlayerHorseId(id: string): { playerId: string; index: number } | null {
  const m = PLAYER_HORSE_RE.exec(id);
  if (!m) return null;
  return { playerId: m[1]!, index: Number(m[2]) };
}

/** Default silks for a player (the client normally overrides them with the silks picked at /play). */
export function defaultPlayerSilks(playerId: string): Silks {
  const rng = createRng(`silks:${playerId}`);
  const primary = rng.pick(SILK_COLORS).hex;
  let secondary = rng.pick(SILK_COLORS).hex;
  if (secondary === primary) secondary = "#f4efe3";
  return { pattern: rng.pick(SILK_PATTERNS).id, primary, secondary, cap: secondary };
}

/** Starter base quality range and per-stat ceiling (~70% of the 1000 scale: a "C grade" at best). */
export const STARTER_QUALITY: readonly [number, number] = [500, 570];
export const STARTER_STAT_CAP = 700;

/** One distinct archetype per starter so every stable has a sprinter, a stayer, a closer... */
const STARTER_ARCHETYPES: readonly Archetype[] = ["sprinter", "miler", "stayer", "closer", "frontrunner", "allrounder"];

/** Archetype of each starter, by horse index (the same shuffle starterHorses makes). */
export function starterArchetypes(playerId: string): Archetype[] {
  return createRng(`starters:${playerId}`).shuffle(STARTER_ARCHETYPES);
}

/**
 * Six starter horses derived only from playerId. Records start empty — the player's
 * progress (starts, wins, earnings) lives client-side until the Milestone C ledger.
 */
export function starterHorses(playerId: string, silks?: Silks): Horse[] {
  if (!isValidPlayerId(playerId)) throw new Error("invalid playerId");
  const rng = createRng(`starters:${playerId}`);
  const names = new Set(POOL.names);
  const playerSilks = silks ?? defaultPlayerSilks(playerId);
  const archetypes = rng.shuffle(STARTER_ARCHETYPES);
  return archetypes.map((archetype, i) => {
    const def = ARCHETYPES[archetype];
    const age = rng.int(3, 4);
    return {
      id: playerHorseId(playerId, i),
      name: makeName(rng, names),
      sex: makeSex(rng, age),
      age,
      stage: "prime",
      generation: 0,
      ownerId: playerId,
      sireId: null,
      damId: null,
      // Starters are modest (progression starts from the ground up): maiden/novice level,
      // with an archetype niche rather than raw power, and no stat above STARTER_STAT_CAP.
      stats: makeStats(rng, rng.int(STARTER_QUALITY[0], STARTER_QUALITY[1]), archetype, STARTER_STAT_CAP),
      preferredDistanceM: rng.pick(def.distances),
      preferredSurface: preferredSurface(rng, archetype),
      style: rng.pick(def.styles),
      appearance: {
        coat: rng.weighted(COATS),
        face: rng.weighted(FACES),
        legs: makeLegs(rng),
        silks: playerSilks,
      },
      record: emptyRecord(),
    } satisfies Horse;
  });
}

/** Display name of the stable that owns a horse (house stables only; players name their own). */
export function ownerStableName(ownerId: string): string | null {
  return STABLE_BY_ID.get(ownerId)?.name ?? null;
}
