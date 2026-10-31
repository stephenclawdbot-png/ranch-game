/**
 * @thoroughbred/shared — the contract between every module.
 *
 * Units are integers wherever determinism matters:
 *   distance  -> millimetres (mm)
 *   time      -> microseconds (us) for results, ticks for simulation
 *   stats     -> 0..1000 (permille)
 *   lane      -> milli-lanes (1000 = one lane width, 0 = rail)
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const SurfaceSchema = z.enum(["dirt", "turf", "synthetic"]);
export type Surface = z.infer<typeof SurfaceSchema>;

export const WeatherSchema = z.enum(["clear", "overcast", "rain", "dusk"]);
export type Weather = z.infer<typeof WeatherSchema>;

/** Track condition derived from surface + weather. */
export const GoingSchema = z.enum(["firm", "good", "soft", "heavy"]);
export type Going = z.infer<typeof GoingSchema>;

export const RunningStyleSchema = z.enum(["front", "stalker", "closer"]);
export type RunningStyle = z.infer<typeof RunningStyleSchema>;

export const RaceClassSchema = z.enum(["maiden", "novice", "handicap", "listed", "graded"]);
export type RaceClass = z.infer<typeof RaceClassSchema>;

export const SexSchema = z.enum(["colt", "filly", "stallion", "mare", "gelding"]);
export type Sex = z.infer<typeof SexSchema>;

export const LifeStageSchema = z.enum(["foal", "development", "prime", "veteran", "retired", "deceased"]);
export type LifeStage = z.infer<typeof LifeStageSchema>;

export const CoatSchema = z.enum([
  "bay",
  "dark_bay",
  "chestnut",
  "liver_chestnut",
  "black",
  "grey",
  "dapple_grey",
  "palomino",
  "buckskin",
  "roan",
]);
export type Coat = z.infer<typeof CoatSchema>;

/**
 * Layered coat genetics (coat colours v2): the coat follows the genes instead of one of the
 * ten fixed `Coat` values. Renderers resolve this through `coatPaletteOf` (art-pipeline).
 * Optional: older clients and saved replays only carry `coat`.
 */
export const HorseColourSchema = z.object({
  /** Extension x agouti x liver base pigment. */
  base: z.enum(["bay", "seal_brown", "chestnut", "liver", "black"]),
  /** Cream dilution copies (0, 1, 2). */
  cream: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  /** Dun factor (primitive markings: dorsal stripe, leg barring). */
  dun: z.boolean(),
  roan: z.boolean(),
  /** Grey stage by career progress: born coloured, dapples while racing, white by veteran age. */
  grey: z.enum(["none", "greying", "dapple", "white"]),
  /** Sabino-1 copies (white patterning). */
  sabino: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  // Genetics v2 colour and pattern genes, set only when the coat shows them (absent = wild
  // type or hidden), so horses without them keep the exact same appearance object.
  /** Champagne (Ch, dominant): gold / amber / sable / classic body, pink freckled skin, amber eye. */
  champagne: z.literal(true).optional(),
  /** Silver (Z) on black pigment: chocolate body, flaxen-silver mane (never shown on a red coat). */
  silver: z.literal(true).optional(),
  /** Pearl showing (prl/prl, or prl with cream): pale apricot; green or blue eye with cream. */
  pearl: z.literal(true).optional(),
  /** Tobiano (TO) copies: white crossing the neck from the crest; two copies add ink spots. */
  tobiano: z.union([z.literal(1), z.literal(2)]).optional(),
  /** Leopard complex as shown: LP/n alone (varnish roan), LP/n + PATN1 (leopard), LP/LP (few-spot). */
  leopard: z.enum(["varnish", "leopard", "fewspot"]).optional(),
  /** Splash white (SW) copies: big blaze and blue eyes; two copies a bald face and white throat. */
  splash: z.union([z.literal(1), z.literal(2)]).optional(),
});
export type HorseColour = z.infer<typeof HorseColourSchema>;

export const FaceMarkingSchema = z.enum(["none", "star", "snip", "stripe", "blaze", "bald"]);
export type FaceMarking = z.infer<typeof FaceMarkingSchema>;

export const LegMarkingSchema = z.enum(["none", "coronet", "sock", "stocking"]);
export type LegMarking = z.infer<typeof LegMarkingSchema>;

export const SilkPatternSchema = z.enum(["solid", "hoops", "stripes", "chevron", "diamonds", "sash", "quartered", "stars"]);
export type SilkPattern = z.infer<typeof SilkPatternSchema>;

// ---------------------------------------------------------------------------
// Horse
// ---------------------------------------------------------------------------

const Permille = z.number().int().min(0).max(1000);
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const HorseStatsSchema = z.object({
  /** Top cruising speed. */
  speed: Permille,
  /** Energy reserve; governs how long pace can be held. */
  stamina: Permille,
  /** Acceleration and finishing kick. */
  burst: Permille,
  /** Resistance to fatigue and injury. */
  durability: Permille,
  /** Tolerance of non-preferred surface / going / distance. */
  adaptability: Permille,
  /** Composure; high = consistent, low = erratic and keen. */
  temperament: Permille,
});
export type HorseStats = z.infer<typeof HorseStatsSchema>;

export const SilksSchema = z.object({
  primary: HexColor,
  secondary: HexColor,
  pattern: SilkPatternSchema,
  cap: HexColor,
});
export type Silks = z.infer<typeof SilksSchema>;

export const HorseAppearanceSchema = z.object({
  coat: CoatSchema,
  face: FaceMarkingSchema,
  /** Front-left, front-right, hind-left, hind-right. */
  legs: z.tuple([LegMarkingSchema, LegMarkingSchema, LegMarkingSchema, LegMarkingSchema]),
  /** Dun factor: draw the primitive markings (dorsal stripe, leg barring). Optional for old replays. */
  dun: z.boolean().optional(),
  /** Optional override for mane/tail colour; derived from coat if absent. */
  maneColor: HexColor.optional(),
  /** Layered coat genetics (v2). Absent on older clients and saved replays. */
  colour: HorseColourSchema.optional(),
  silks: SilksSchema,
});
export type HorseAppearance = z.infer<typeof HorseAppearanceSchema>;

export const HorseRecordSchema = z.object({
  starts: z.number().int().min(0),
  wins: z.number().int().min(0),
  places: z.number().int().min(0),
  shows: z.number().int().min(0),
  /** Stable Credits earned (integer). */
  earnings: z.number().int().min(0),
});
export type HorseRecord = z.infer<typeof HorseRecordSchema>;

export const HorseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(32),
  sex: SexSchema,
  /** Age in in-game seasons. */
  age: z.number().int().min(0),
  stage: LifeStageSchema,
  generation: z.number().int().min(0),
  ownerId: z.string().min(1),
  sireId: z.string().nullable(),
  damId: z.string().nullable(),
  stats: HorseStatsSchema,
  /** Preferred race distance in metres. */
  preferredDistanceM: z.number().int().min(800).max(4000),
  preferredSurface: SurfaceSchema,
  style: RunningStyleSchema,
  appearance: HorseAppearanceSchema,
  record: HorseRecordSchema,
});
export type Horse = z.infer<typeof HorseSchema>;

// ---------------------------------------------------------------------------
// Race input (immutable snapshot taken at entry lock)
// ---------------------------------------------------------------------------

export const RaceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  distanceM: z.number().int().min(800).max(4000),
  surface: SurfaceSchema,
  weather: WeatherSchema,
  going: GoingSchema,
  raceClass: RaceClassSchema,
  /** Wall-clock post time (ms since epoch). Viewers sync playback to this. */
  postTimeMs: z.number().int(),
  /** Stable Credits purse, split by finishing position. */
  purse: z.number().int().min(0),
});
export type RaceConfig = z.infer<typeof RaceConfigSchema>;

/**
 * Optional per-runner race-day settings (engine 1.2.0): what a hired jockey and race-day
 * equipment change. Each field is the share (permille) of an existing cost or variance that
 * still applies, so 1000 = no change and lower = less. Kit can only take away a penalty or
 * narrow the day-form spread; it never adds ability beyond the horse's stats. An entry without
 * `kit` runs exactly as in engine 1.1.0.
 */
export const RaceKitSchema = z.object({
  /** Share of the going's pace penalty (soft/heavy ground, scaled by adaptability) that applies. */
  goingPenaltyPermille: z.number().int().min(0).max(1000).optional(),
  /** Share of the day-form amplitude (the main source of upsets) that applies. */
  formAmpPermille: z.number().int().min(0).max(1000).optional(),
  /** Share of the keen-early extra energy drain (low temperament) that applies. */
  keenPermille: z.number().int().min(0).max(1000).optional(),
  /**
   * Jockey (gate skill): share of the horse's slow-start chance that applies. Scales the same
   * single draw, so no stream shifts. Absent = the horse's own chance.
   */
  slowStartPermille: z.number().int().min(0).max(1000).optional(),
  /** Jockey (pace judgement): share of the horse's energy drain that applies. Absent = all of it. */
  drainPermille: z.number().int().min(0).max(1000).optional(),
  /**
   * Jockey (finishing drive): share of the horse's late-battle response (1.4.0 model) the rider
   * gets out of it. Absent = all of it; a jockey never adds fight the horse doesn't have.
   */
  battlePermille: z.number().int().min(0).max(1000).optional(),
});
export type RaceKit = z.infer<typeof RaceKitSchema>;

export const RaceEntrySchema = z.object({
  /** Starting gate, 1-based. Gate 1 is nearest the rail. */
  gate: z.number().int().min(1).max(16),
  /** Tactic chosen for this race (may differ from horse's natural style). */
  tactic: RunningStyleSchema,
  /** Immutable copy of the horse at entry lock. */
  horse: HorseSchema,
  /** Jockey and equipment for this race (engine 1.2.0). Absent = the 1.1.0 ride. */
  kit: RaceKitSchema.optional(),
});
export type RaceEntry = z.infer<typeof RaceEntrySchema>;

/**
 * Optional course profile (engine 1.3.0): the racecourse's shape as the engine sees it, frozen
 * into the field at entry lock (game-core `courseProfile`, from courses.ts). A race without
 * `course` runs exactly as before (1.2.0 with kit, 1.1.0 without). The profile is part of the
 * hashed result of a 1.3.0 race, so a course cannot be swapped after the off.
 */
export const RaceCourseSchema = z.object({
  /** Course id (game-core CourseId), sealed with the result. */
  id: z.string().min(1).max(32),
  /** Which way the field runs round the bends. Cosmetic: no horse prefers a direction. */
  direction: z.enum(["left", "right"]),
  /** One lap, metres. */
  circumferenceM: z.number().int().min(1000).max(5000),
  /** Last bend to the line, metres. */
  homeStraightM: z.number().int().min(150).max(1500),
  /** Bends per lap (an oval has two, a triangle three). */
  bendsPerLap: z.number().int().min(1).max(4),
  /** 0 = sweeping, 1000 = very tight. */
  bendTightness: z.number().int().min(0).max(1000),
  /** Rise of the home straight, permille (positive = uphill finish). */
  finishGradientPermille: z.number().int().min(-50).max(50),
});
export type RaceCourse = z.infer<typeof RaceCourseSchema>;

/**
 * Race models a race can be locked for (engine 1.4.0 onwards): "1.4.0" is the close-finish
 * model (racing in a pack, late battles, steadier day form). Frozen into a Live field at entry
 * lock; a race without one runs exactly as before (1.3.0 with a course, 1.2.0 with kit, 1.1.0).
 */
export const RaceModelSchema = z.enum(["1.4.0"]);
export type RaceModel = z.infer<typeof RaceModelSchema>;
/** The model Live races lock with today. */
export const LIVE_RACE_MODEL: RaceModel = "1.4.0";

export const RaceInputSchema = z.object({
  race: RaceConfigSchema,
  /** The course's shape (engine 1.3.0). Absent = no course character (1.2.0 / 1.1.0). */
  course: RaceCourseSchema.optional(),
  /** The race model (engine 1.4.0+), sealed with the result. Absent = the model the kit/course pick. */
  model: RaceModelSchema.optional(),
  entries: z.array(RaceEntrySchema).min(2).max(16),
  /** Revealed seed, 64 hex chars. Its sha256 is the published commitment. */
  seed: z.string().regex(/^[0-9a-f]{64}$/),
});
export type RaceInput = z.infer<typeof RaceInputSchema>;

// ---------------------------------------------------------------------------
// Race output / replay
// ---------------------------------------------------------------------------

/** Number of integers stored per horse per frame in RaceReplay.frames. */
export const FRAME_STRIDE = 4;
/** Field offsets inside a horse's FRAME_STRIDE slice. */
export const FRAME_FIELD = {
  /** Distance covered from the start, mm. Clamped to trackLengthMm after finishing. */
  distanceMm: 0,
  /** Lateral position, milli-lanes from the rail (0 = rail). */
  laneMilli: 1,
  /** Current speed, mm/s. */
  speedMmS: 2,
  /** Remaining energy, 0..1000. */
  energy: 3,
} as const;

export const RaceEventTypeSchema = z.enum([
  "start",
  "slow_start",
  "lead_change",
  "move",
  "boxed_in",
  "kick",
  "tiring",
  "final_furlong",
  "finish",
  "photo_finish",
]);
export type RaceEventType = z.infer<typeof RaceEventTypeSchema>;

export const RaceEventSchema = z.object({
  tick: z.number().int().min(0),
  type: RaceEventTypeSchema,
  horseId: z.string().optional(),
  /** Short commentary line, ready to display. */
  text: z.string(),
});
export type RaceEvent = z.infer<typeof RaceEventSchema>;

export const FinishRecordSchema = z.object({
  horseId: z.string(),
  position: z.number().int().min(1),
  /** Exact finish time in microseconds from the start. */
  finishTimeUs: z.number().int().min(0),
  /** Distance behind the horse directly ahead, mm (0 for the winner). */
  marginMm: z.number().int().min(0),
  /** Racing-style margin label: "nose", "head", "neck", "1/2", "1 1/4", "dist" ... */
  marginLabel: z.string(),
  /** Stable Credits awarded from the purse. */
  prize: z.number().int().min(0),
});
export type FinishRecord = z.infer<typeof FinishRecordSchema>;

export const RaceResultSchema = z.object({
  finishOrder: z.array(FinishRecordSchema),
  winningTimeUs: z.number().int().min(0),
  /** True when the first two finishers are within PHOTO_FINISH_MM. */
  photoFinish: z.boolean(),
  /** sha256 hex over the canonical result (finish order + times) and seed. */
  resultHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type RaceResult = z.infer<typeof RaceResultSchema>;

export const ReplayHorseSchema = z.object({
  horseId: z.string(),
  name: z.string(),
  gate: z.number().int(),
  tactic: RunningStyleSchema,
  appearance: HorseAppearanceSchema,
});
export type ReplayHorse = z.infer<typeof ReplayHorseSchema>;

export const RaceReplaySchema = z.object({
  version: z.literal(1),
  engineVersion: z.string(),
  race: RaceConfigSchema,
  /** sha256(seed) hex, publishable before the race. */
  seedCommitment: z.string().regex(/^[0-9a-f]{64}$/),
  /** Revealed seed (only served after post time). */
  seed: z.string().regex(/^[0-9a-f]{64}$/),
  /** Simulation rate. */
  tickHz: z.number().int().positive(),
  /** Frames are stored every `sampleEvery` ticks. Frame i = tick i*sampleEvery. */
  sampleEvery: z.number().int().positive(),
  trackLengthMm: z.number().int().positive(),
  /** Lanes available across the track (gates usually map to lanes). */
  laneCount: z.number().int().positive(),
  /** Order matches the per-frame horse order. */
  horses: z.array(ReplayHorseSchema),
  /** frames[f][h * FRAME_STRIDE + FRAME_FIELD.x] — integers only. */
  frames: z.array(z.array(z.number().int())),
  /** Tick at which the final horse finished (sim ended). */
  totalTicks: z.number().int().min(0),
  events: z.array(RaceEventSchema),
  result: RaceResultSchema,
});
export type RaceReplay = z.infer<typeof RaceReplaySchema>;

// ---------------------------------------------------------------------------
// Live broadcast: a race is streamed up to "now" so the outcome is never
// sent to clients before it happens on the broadcast clock.
// ---------------------------------------------------------------------------

/** Seconds the broadcast trails the simulation clock (absorbs polling latency). */
export const BROADCAST_DELAY_S = 2;

/** Everything a viewer needs before frames arrive. Contains no outcome information. */
export const RaceBroadcastHeaderSchema = z.object({
  version: z.literal(1),
  engineVersion: z.string(),
  race: RaceConfigSchema,
  seedCommitment: z.string().regex(/^[0-9a-f]{64}$/),
  tickHz: z.number().int().positive(),
  sampleEvery: z.number().int().positive(),
  trackLengthMm: z.number().int().positive(),
  laneCount: z.number().int().positive(),
  horses: z.array(ReplayHorseSchema),
});
export type RaceBroadcastHeader = z.infer<typeof RaceBroadcastHeaderSchema>;

/**
 * GET /api/races/:id/live?from=<frameIndex> response.
 * Frame f is shown at wall time postTimeMs + BROADCAST_DELAY_S*1000 + f*sampleEvery/tickHz*1000.
 * `frames` holds frames [fromFrame, liveEdgeFrame] only; `events` only those with
 * tick <= liveEdgeFrame*sampleEvery. `final` is present only once the whole field has
 * finished on the broadcast clock. Until then, nothing in the payload reveals the result.
 */
export const RaceBroadcastChunkSchema = z.object({
  raceId: z.string(),
  serverNowMs: z.number().int(),
  /** Wall-clock ms at which frame 0 is shown (postTimeMs + BROADCAST_DELAY_S*1000). */
  broadcastStartMs: z.number().int(),
  header: RaceBroadcastHeaderSchema,
  fromFrame: z.number().int().min(0),
  frames: z.array(z.array(z.number().int())),
  events: z.array(RaceEventSchema),
  /** Highest frame index the server will reveal right now (-1 before the off). */
  liveEdgeFrame: z.number().int().min(-1),
  /** The complete replay (result, seed reveal, all frames): only after the race is over. */
  final: RaceReplaySchema.nullable(),
});
export type RaceBroadcastChunk = z.infer<typeof RaceBroadcastChunkSchema>;

/**
 * Client-side live feed consumed by <RaceViewer feed={...} />.
 * Implemented in apps/web (polls the live endpoint); arrays only ever grow.
 */
export interface LiveRaceFeed {
  readonly raceId: string;
  readonly header: RaceBroadcastHeader;
  /** Wall-clock ms at which frame 0 is shown. */
  readonly broadcastStartMs: number;
  /** Frames received so far (frame i = tick i*sampleEvery). */
  readonly frames: ReadonlyArray<ReadonlyArray<number>>;
  readonly events: ReadonlyArray<RaceEvent>;
  /** Highest frame index currently available (-1 before the off). */
  readonly liveEdgeFrame: number;
  /** Set once the race is over; viewer switches to full replay mode. */
  readonly final: RaceReplay | null;
  /** Called whenever frames/events/final change. Returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void;
}

// ---------------------------------------------------------------------------
// Constants shared by engine and viewer
// ---------------------------------------------------------------------------

export const MM_PER_M = 1000;
export const US_PER_S = 1_000_000;
/** A standard horse length (~2.4 m), used for margins and spacing. */
export const HORSE_LENGTH_MM = 2400;
/** Margins under this count as a photo finish. */
export const PHOTO_FINISH_MM = 150;
/** One furlong in mm (201.168 m), for markers and commentary. */
export const FURLONG_MM = 201_168;

// ---------------------------------------------------------------------------
// Public engine/viewer API shapes (implemented in their packages)
// ---------------------------------------------------------------------------

/** Implemented by @thoroughbred/racing-engine. Must be pure and deterministic. */
export type SimulateRace = (input: RaceInput) => RaceReplay;

/** Format microseconds as m:ss.ss (e.g. 1:36.42). */
export function formatRaceTime(us: number): string {
  const totalCs = Math.floor(us / 10_000);
  const minutes = Math.floor(totalCs / 6000);
  const seconds = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  const ss = `${seconds}`.padStart(minutes > 0 ? 2 : 1, "0");
  return `${minutes > 0 ? `${minutes}:` : ""}${ss}.${`${cs}`.padStart(2, "0")}`;
}

/** Read one field for horse `h` at frame `f`. */
export function frameValue(replay: RaceReplay, f: number, h: number, field: keyof typeof FRAME_FIELD): number {
  const frame = replay.frames[f];
  if (!frame) return 0;
  return frame[h * FRAME_STRIDE + FRAME_FIELD[field]] ?? 0;
}
