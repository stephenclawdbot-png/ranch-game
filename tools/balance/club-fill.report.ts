/**
 * Club fill (2026-10-30): how strong the Club's runners in a Live race are, before and after the
 * fix that makes them honest and median-and-above (game-core clubFill.ts, db races.ts
 * pickHouseHorses).
 *   npx vitest run --config tools/balance/vitest.config.ts club-fill
 *   CLUBFILL_RACES=100 npx vitest run --config tools/balance/vitest.config.ts club-fill   # quick look
 *
 * For each card band it builds fields of realistic player entrants plus Club runners, runs them
 * through the racing engine the way a Live race does (game-core raceSnapshot at the race's
 * conditions, each horse on its natural style or the entry's tactic, a course profile, level
 * weights) and compares:
 *   before: Club runners as minted until now (an untrained racing-age novice of any trip and
 *           surface, stamped with the band's midpoint as its rating, ridden to a random tactic);
 *   after:  honest seasoned Club runners at targets spread across the race's window
 *           (clubTargets), suited to the trip and surface, ridden to their natural style.
 * The same players, conditions and race seed run in both, so the rows differ by the Club alone.
 *
 * Player entrants: horses of the natural mint (season 12) at assorted career points (0-25 starts,
 * training realisation 600-1000), suited to the race (players enter races that suit their
 * horses). Each gets a rating in the band's player range below (where the harness's players sit);
 * its real ability is that rating minus 0-8 (the old Club inflated player ratings: they beat
 * horses rated far above their ability), capped by what the player population can reach
 * ("today": no season-12 player horse is really better than ~67, so the 70+ bands are out of
 * reach). "Settled": each player's real ability is its rating (once the Club is honest, ratings
 * settle there); where no foundation horse is that good, its genome is lifted (a bred horse).
 *
 * Measures per band: the Club's real marks vs its window, winner-to-last spread, winning margins,
 * the share of races a player wins, the win rate per player start, and how often the player at
 * the players' median wins (fair share = 1 / field). A parity table checks that a Club horse and a
 * player horse of the same real mark win alike.
 *
 * Races run on the Live race model (engine 1.4.0, LIVE_RACE_MODEL). Handicaps carry weights as
 * Live handicaps do since 1.4.0 (game-core handicapWeights from the stored ratings at the lock,
 * 1 lb = 1 OR via carryWeight); the "level weights" rows are the what-if without them.
 */
import { it, expect } from "vitest";
import { HORSE_LENGTH_MM, LIVE_RACE_MODEL, type Going, type RaceCourse, type RunningStyle, type Surface } from "@thoroughbred/shared";
import { simulateRace, deriveSeed } from "../../packages/racing-engine/src/index";
import {
  CARE_TO_RACING,
  COURSES,
  Rng,
  STAT_KEYS,
  abilityMark,
  clubFitsRace,
  clubSeasonedState,
  clubTargets,
  clubWindow,
  clubNominalRating,
  courseProfile,
  createHorseState,
  generateFoundationGenome,
  handicapWeights,
  liftGenome,
  mintClubGenome,
  raceSnapshot,
  runningStyle,
  seedFrom,
  type ClubFillKind,
  type ClubWindow,
  type HorseState,
} from "../../packages/game-core/src/index";
import { writeReport, yieldNow } from "./out";

const RACES = Number(process.env.CLUBFILL_RACES ?? 300);
const SEASON = 12;
const T0 = 1_800_000_000_000;
const SILKS = { primary: "#112233", secondary: "#ffffff", pattern: "hoops", cap: "#aa0000" } as const;
const TRIPS = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2800];
const SURFACES: Surface[] = ["turf", "dirt", "synthetic"];
const TACTICS: RunningStyle[] = ["front", "stalker", "closer"];
const POPULATION = 4000;
const INFLATION_MAX = 8;

interface Band {
  key: string;
  label: string;
  kind: ClubFillKind;
  raceClass: string;
  minRating?: number;
  maxRating?: number;
  handicap: boolean;
  /** Where the players entered in this band are rated. */
  playerOr: [number, number];
  players: number;

}

const BANDS: Band[] = [
  { key: "maiden", label: "Maiden (0-60)", kind: "banded", raceClass: "maiden", maxRating: 60, handicap: false, playerOr: [40, 48], players: 5, field: 10 },
  { key: "novice", label: "Novice (0-70)", kind: "banded", raceClass: "novice", maxRating: 70, handicap: false, playerOr: [40, 55], players: 5, field: 10 },
  { key: "hcp55", label: "Handicap 0-55", kind: "banded", raceClass: "handicap", minRating: 0, maxRating: 55, handicap: true, playerOr: [35, 55], players: 5, field: 10 },
  { key: "hcp75", label: "Handicap 50-75", kind: "banded", raceClass: "handicap", minRating: 50, maxRating: 75, handicap: true, playerOr: [50, 70], players: 5, field: 10 },
  { key: "hcp95", label: "Handicap 70-95", kind: "banded", raceClass: "handicap", minRating: 70, maxRating: 95, handicap: true, playerOr: [70, 80], players: 3, field: 10 },
  { key: "listed", label: "Listed (85+)", kind: "banded", raceClass: "listed", minRating: 85, handicap: false, playerOr: [85, 90], players: 2, field: 10 },
  { key: "fq", label: "Feature Qualifier (open)", kind: "open", raceClass: "listed", handicap: false, playerOr: [38, 70], players: 6, field: 12 },
];

/** A player's horse somewhere in its career. */
function playerHorse(i: number): HorseState {
  const rng = new Rng(seedFrom("clubfill-player", i));
  const genome = generateFoundationGenome(seedFrom("clubfill-player-genome", i), { season: SEASON });
  const s = createHorseState({ id: `p${i}`, name: `Player ${i}`, sex: rng.chance(500) ? "colt" : "filly", ownerId: "player", sireId: null, damId: null, generation: 0, genome, bornAtMs: T0, bornSeason: SEASON, careSessions: CARE_TO_RACING });
  const real = rng.range(600, 1000);
  const realisation = Object.fromEntries(STAT_KEYS.map((k) => [k, real])) as HorseState["training"]["realisation"];
  const starts = rng.range(0, 25);
  return { ...s, career: { ...s.career, starts }, record: { ...s.record, starts }, training: { ...s.training, realisation }, condition: { ...s.condition, fitness: rng.range(600, 1000) } };
}

/** The player horse with every stat locus moved so its ability mark is about `want` (stands for a bred horse). */
function liftPlayer(s: HorseState, want: number): HorseState {
  let lo = -400;
  let hi = 400;
  const at = (l: number) => abilityMark({ ...s, genome: liftGenome(s.genome, l) });
  while (hi - lo > 1) {
    const mid = lo + ((hi - lo) >> 1);
    if (at(mid) >= want) hi = mid;
    else lo = mid;
  }
  return { ...s, genome: liftGenome(s.genome, hi) };
}

/** A Club runner as minted until now: an untrained racing-age novice of the natural mint (gameCore.ts houseHorse before the fix). */
function oldClubHorse(seed: string, i: number): HorseState {
  const genome = generateFoundationGenome(seedFrom("house", seed, i), { season: SEASON, evenBreeds: true });
  return createHorseState({ id: `old-${i}`, name: `Old ${i}`, sex: "colt", ownerId: "club", sireId: null, damId: null, generation: 0, genome, bornAtMs: T0, bornSeason: SEASON, location: "club", careSessions: CARE_TO_RACING });
}

interface Runner {
  state: HorseState;
  tactic: RunningStyle;
  /** Stored rating (handicap weights). */
  or: number;
  player: boolean;
}

interface Outcome {
  spreadMm: number;
  winMarginMm: number;
  playerWon: boolean;
  /** The player horse at the players' median rating won. */
  medianWon: boolean;
  playerStarts: number;
  winnerId: string;
}

function run(runners: Runner[], race: { distanceM: number; surface: Surface; going: Going; course: RaceCourse; seed: string; field: number }, weights: boolean): Outcome {
  const lb = new Map(handicapWeights(runners.map((r) => ({ horseId: r.state.id, or: r.or })), weights).map((w) => [w.horseId, w.extraLb]));
  const entries = runners.map((r, i) => {
    const horse = raceSnapshot(r.state, {
      nowMs: T0,
      silks: SILKS,
      race: { going: race.going, fieldSize: race.field, bigCrowd: false, surface: race.surface, distanceM: race.distanceM },
      plan: { tactic: r.tactic, intensity: "normal" },
      extraWeightLb: lb.get(r.state.id) ?? 0,
    }).horse;
    return { gate: i + 1, tactic: r.tactic, horse };
  });
  const replay = simulateRace({
    race: { id: "cf", name: "Club fill", distanceM: race.distanceM, surface: race.surface, weather: "clear", going: race.going, raceClass: "handicap", postTimeMs: T0, purse: 0 },
    course: race.course,
    model: LIVE_RACE_MODEL,
    entries,
    seed: race.seed,
  });
  const fo = replay.result.finishOrder;
  const spreadMm = fo.reduce((s, f) => s + f.marginMm, 0);
  const winner = runners.find((r) => r.state.id === fo[0]!.horseId)!;
  const ps = runners.filter((x) => x.player).sort((a, b) => a.or - b.or || (a.state.id < b.state.id ? -1 : 1));
  const median = ps[(ps.length - 1) >> 1];
  return { spreadMm, winMarginMm: fo[1]?.marginMm ?? 0, playerWon: winner.player, medianWon: winner === median, playerStarts: ps.length, winnerId: winner.state.id };
}

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]! : 0;
};
const m = (mm: number) => (mm / 1000).toFixed(1);
const len = (mm: number) => (mm / HORSE_LENGTH_MM).toFixed(1);
const pct = (x: number, of: number) => ((100 * x) / Math.max(1, of)).toFixed(1);

interface Tally {
  spread: number[];
  margin: number[];
  playerWins: number;
  races: number;
  medianWins: number;
  playerStarts: number;

}
const blank = (): Tally => ({ spread: [], margin: [], playerWins: 0, races: 0, medianWins: 0, playerStarts: 0 });
function add(t: Tally, o: Outcome) {
  t.spread.push(o.spreadMm);
  t.margin.push(o.winMarginMm);
  t.races++;
  if (o.playerWon) t.playerWins++;
  if (o.medianWon) t.medianWins++;
  t.playerStarts += o.playerStarts;
}
function marginBuckets(xs: number[]): string {
  const L = HORSE_LENGTH_MM;
  const b = [xs.filter((x) => x <= L).length, xs.filter((x) => x > L && x <= 3 * L).length, xs.filter((x) => x > 3 * L && x <= 6 * L).length, xs.filter((x) => x > 6 * L).length];
  return b.map((n) => pct(n, xs.length).padStart(5)).join(" ");
}

it("club fill report", async () => {
  const population = Array.from({ length: POPULATION }, (_, i) => playerHorse(i)).map((s) => ({ s, mark: abilityMark(s) }));
  const lines: string[] = [];
  const data: Record<string, unknown> = {};
  const rows: string[] = [];
  const hcpRows: string[] = [];
  const rng = new Rng("club-fill-report");
  const parity = new Map<string, { starts: number; wins: number }>();

  for (const band of BANDS) {
    const before = blank();
    const after = blank();
    const beforeW = blank();
    const afterW = blank();
    const settled = blank();
    const clubMarksBefore: number[] = [];
    const clubMarksAfter: number[] = [];
    let outside = 0;
    let unfitted = 0;
    let windows: ClubWindow[] = [];
    for (let r = 0; r < RACES; r++) {
      const distanceM = rng.pick(TRIPS);
      const surface = rng.pick(SURFACES);
      const going: Going = surface === "turf" ? rng.pick<Going>(["good", "good", "firm", "soft"]) : "good";
      const course = courseProfile(rng.pick(COURSES));
      const seed = deriveSeed("club-fill-report", `${band.key}-${r}`);
      const fits = population.filter((p) => clubFitsRace(p.s.genome, { distanceM, surface }));
      // Players: a rating in the band's player range, real ability that minus 0-8 (today), or
      // equal to it (settled: once the Club is honest, ratings settle at the real ability).
      const pickPlayers = (inflate: boolean): Runner[] => {
        const out: Runner[] = [];
        const used = new Set<string>();
        for (let i = 0; i < band.players; i++) {
          const or = rng.range(band.playerOr[0], band.playerOr[1]);
          const want = or - (inflate ? rng.range(0, INFLATION_MAX) : 0);
          const free = fits.filter((p) => !used.has(p.s.id));
          let best = free[0]!;
          for (const p of free) if (Math.abs(p.mark - want) < Math.abs(best.mark - want)) best = p;
          used.add(best.s.id);
          // Settled: a horse rated this high really is this good (in the upper bands, a bred
          // horse no foundation mint reaches yet: the genome is lifted to the rating).
          const state = !inflate && Math.abs(best.mark - want) > 2 ? liftPlayer(best.s, want) : best.s;
          const mark = abilityMark(state);
          out.push({ state: { ...state, id: `${best.s.id}-r${r}` }, tactic: runningStyle(state.genome), or: inflate ? Math.max(or, mark) : mark, player: true });
        }
        return out;
      };
      const players = pickPlayers(true);
      const settledPlayers = pickPlayers(false);
      const nClub = band.field - band.players;
      // Before: novices stamped at the band's midpoint, random tactics.
      const mid = Math.round(((band.minRating ?? 0) + (band.maxRating ?? Math.max(band.minRating ?? 0, 40))) / 2);
      const oldClub: Runner[] = Array.from({ length: nClub }, (_, i) => {
        const st = oldClubHorse(seed, i);
        clubMarksBefore.push(abilityMark(st));
        return { state: st, tactic: TACTICS[rng.int(3)]!, or: mid, player: false };
      });
      // After: honest seasoned runners spread across the window.
      const clubFor = (ps: Runner[], record: boolean): { w: ClubWindow; club: Runner[] } => {
        const w = clubWindow({
          kind: band.kind,
          minRating: band.minRating,
          maxRating: band.maxRating,
          playerRatings: ps.map((p) => abilityMark(p.state)),
          nominal: clubNominalRating(band.raceClass),
        });
        const club = clubTargets(w, nClub, seed).map((target, i) => {
          const mint = mintClubGenome({ seed, index: i, target, window: w, season: SEASON, distanceM, surface });
          const st = { ...clubSeasonedState(mint.genome), id: `club-${i}` };
          if (record) {
            clubMarksAfter.push(mint.mark);
            if (mint.mark < w.lo || mint.mark > w.hi) outside++;
            if (!mint.fits) unfitted++;
          }
          return { state: st, tactic: runningStyle(mint.genome), or: mint.mark, player: false };
        });
        return { w, club };
      };
      const { w, club: newClub } = clubFor(players, true);
      if (r < 3) windows.push(w);
      const race = { distanceM, surface, going, course, seed, field: band.field };
      add(before, run([...players, ...oldClub], race, band.handicap));
      add(after, run([...players, ...newClub], race, band.handicap));
      const settledField = [...settledPlayers, ...clubFor(settledPlayers, false).club];
      const so = run(settledField, race, band.handicap);
      add(settled, so);
      // Parity: win rate by real mark relative to the players' median, Club vs players.
      const p = settledPlayers.map((x) => abilityMark(x.state)).sort((a, b) => a - b)[(settledPlayers.length - 1) >> 1]!;
      for (const x of settledField) {
        const b = Math.max(-8, Math.min(12, Math.floor((abilityMark(x.state) - p) / 4) * 4));
        const k = `${x.player ? "player" : "club"} ${b}`;
        const c = parity.get(k) ?? { starts: 0, wins: 0 };
        c.starts++;
        if (so.winnerId === x.state.id) c.wins++;
        parity.set(k, c);
      }
      if (band.handicap) {
        add(beforeW, run([...players, ...oldClub], race, false));
        add(afterW, run([...players, ...newClub], race, false));
      }
      if (r % 10 === 0) await yieldNow();
    }
    const wDesc = `e.g. ${windows.map((w) => `${w.lo}-${w.hi}`).join(", ")}`;
    rows.push(
      `${band.label.padEnd(26)} ${wDesc.padEnd(34)} | club real ${q(clubMarksBefore, 0.5)} (${q(clubMarksBefore, 0.1)}-${q(clubMarksBefore, 0.9)}) -> ${q(clubMarksAfter, 0.5)} (${q(clubMarksAfter, 0.1)}-${q(clubMarksAfter, 0.9)}), outside ${outside}, unsuited ${unfitted}` +
        ` | spread m ${m(q(before.spread, 0.5))} -> ${m(q(after.spread, 0.5))} (settled ${m(q(settled.spread, 0.5))}) | player wins ${pct(before.playerWins, before.races)}% -> ${pct(after.playerWins, after.races)}% (settled ${pct(settled.playerWins, settled.races)}%)` +
        ` | per start ${pct(after.playerWins, after.playerStarts)}% (settled ${pct(settled.playerWins, settled.playerStarts)}%) | median player ${pct(after.medianWins, after.races)}% (settled ${pct(settled.medianWins, settled.races)}%, fair ${pct(1, band.field)}%)`,
    );
    for (const [label, t] of [
      ["before, as Live", before],
      ["after, as Live", after],
      ["after, players settled", settled],
      ...(band.handicap
        ? ([
            ["before, level weights", beforeW],
            ["after, level weights", afterW],
          ] as const)
        : []),
    ]) {
      hcpRows.push(
        `${band.label.padEnd(24)} ${label.padEnd(24)} | spread ${m(q(t.spread, 0.5)).padStart(5)} m ${len(q(t.spread, 0.5)).padStart(5)} L (p90 ${len(q(t.spread, 0.9)).padStart(5)} L) | win margin median ${len(q(t.margin, 0.5)).padStart(4)} L; <=1L 1-3L 3-6L >6L: ${marginBuckets(t.margin)} | player wins ${pct(t.playerWins, t.races).padStart(5)}%, per start ${pct(t.playerWins, t.playerStarts).padStart(5)}%, median player ${pct(t.medianWins, t.races).padStart(5)}%`,
      );
    }
    data[band.key] = {
      window: windows[0],
      clubMarkBefore: { p10: q(clubMarksBefore, 0.1), median: q(clubMarksBefore, 0.5), p90: q(clubMarksBefore, 0.9) },
      clubMarkAfter: { p10: q(clubMarksAfter, 0.1), median: q(clubMarksAfter, 0.5), p90: q(clubMarksAfter, 0.9) },
      outsideWindow: outside,
      unsuited: unfitted,
      spreadMedianMm: { before: q(before.spread, 0.5), after: q(after.spread, 0.5) },
      winMarginMedianMm: { before: q(before.margin, 0.5), after: q(after.margin, 0.5) },
      playerWinShare: { before: before.playerWins / before.races, after: after.playerWins / after.races, settled: settled.playerWins / settled.races },
      settledSpreadMedianMm: q(settled.spread, 0.5),
      ...(band.handicap
        ? {
            levelWeights: {
              spreadMedianMm: { before: q(beforeW.spread, 0.5), after: q(afterW.spread, 0.5) },
              winMarginMedianMm: { before: q(beforeW.margin, 0.5), after: q(afterW.margin, 0.5) },
              playerWinShare: { before: beforeW.playerWins / beforeW.races, after: afterW.playerWins / afterW.races },
            },
          }
        : {}),
    };
    expect.soft(outside, `${band.label}: Club runners outside the window`).toBe(0);
  }
  lines.push(`# Club fill: ${RACES} races per band, field ${BANDS.map((b) => `${b.players}+${b.field - b.players}`).join("/")} (players+Club); before -> after`);
  lines.push(`band                       Club window                        | Club real ability median (p10-p90)            | winner-to-last (median) | player win share`);
  lines.push(...rows);
  lines.push("", "# Winner-to-last spread and winning margins per band (L = lengths of 2.4 m). Live handicaps carry weights (engine 1.4.0: handicapWeights from the stored ratings, 1 lb = 1 OR); 'level weights' is the what-if without them.");
  lines.push(...hcpRows);
  lines.push("", "# Parity (players settled, all bands): win rate per start by real mark minus the players' median, players vs Club (equal marks should win alike)");
  for (const b of [-8, -4, 0, 4, 8, 12]) {
    const pl = parity.get(`player ${b}`) ?? { starts: 0, wins: 0 };
    const cl = parity.get(`club ${b}`) ?? { starts: 0, wins: 0 };
    lines.push(`${String(b).padStart(3)}..${b + 3}: players ${pct(pl.wins, pl.starts).padStart(5)}% (${pl.starts}), Club ${pct(cl.wins, cl.starts).padStart(5)}% (${cl.starts})`);
  }
  writeReport("club-fill", data, lines);
});
