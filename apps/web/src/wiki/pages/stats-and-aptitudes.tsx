import * as gc from "@thoroughbred/game-core";
import type { Going, Surface } from "@thoroughbred/shared";
import { FitList } from "@/components/ui/FitChip";
import { TRIP_BANDS, aptitudes, fitCheck, lossGrade, statGrade } from "@/lib/aptitude";
import { GOING_LABEL, STYLE_BLURB, STYLE_LABEL, SURFACE_LABEL, formatDistance } from "@/lib/format";
import { Callout, Facts, H2, H3, HorseCard, HorseRow, Lead, List, Meter, P, Table, WikiLink, appearanceOfGenome } from "../kit";

const STAT_LABEL: Record<gc.StatKey, string> = {
  speed: "Speed",
  stamina: "Stamina",
  burst: "Burst",
  durability: "Durability",
  adaptability: "Adaptability",
  temperament: "Temperament",
};

/** What each stat really does in a race (packages/racing-engine model.ts) and around the yard. */
const STAT_DOES: Record<gc.StatKey, string> = {
  speed: "Sets the horse's cruising speed, the pace it can travel at comfortably. The most valuable stat at every trip.",
  stamina: "How slowly the horse burns its energy. It barely matters in a sprint and matters more with every furlong after that; a horse that runs out of energy fades.",
  burst: "The kick: how much faster than its cruise the horse can sprint at the finish, and how quickly it accelerates from the gate and in the race.",
  durability: "How much speed is left once the horse is spent, and a little less energy used. Off the track, sound horses get injured less and tire less from a race.",
  adaptability: "How little the horse loses on a surface it doesn't prefer, on soft or heavy going, or at a trip that isn't its best.",
  temperament: "Consistency. A composed horse runs close to its form every time, travels evenly and breaks well. A hot-headed one (below half marks) runs keen early and wastes energy.",
};

const SILKS = { primary: "#1f4e9c", secondary: "#f3e7c9", pattern: "hoops", cap: "#1f4e9c" } as const;
const TRIP_WORD: Record<string, string> = { sprint: "Sprint", mile: "Mile", middle: "Middle", long: "Long" };

/** Lowest value that earns each letter, found by asking the game's own grading function. */
function floors(grade: (v: number) => string, from: number, to: number, step = 1) {
  const out: { grade: string; from: number }[] = [];
  for (let v = from; v <= to; v += step) {
    const g = grade(v);
    if (!out.find((o) => o.grade === g)) out.push({ grade: g, from: v });
  }
  return out;
}

/** A real horse: the Thoroughbred from a starter stable, as the game makes it. */
function sample() {
  const states = gc.createStarterStable({ ownerId: "wiki", seed: "wiki-stats", nowMs: 0, season: 1 });
  const state = states[1]!;
  const horse = gc.toSharedHorse(state, 0, SILKS as Parameters<typeof gc.toSharedHorse>[2]);
  const pot = gc.potentials(state.genome);
  const apt = aptitudes(horse);
  const offSurface = (["turf", "dirt", "synthetic"] as Surface[]).find((s) => s !== horse.preferredSurface)!;
  const race = { distanceM: horse.preferredDistanceM + 400, surface: offSurface, going: "soft" as Going };
  return { state, horse, pot, apt, race, fits: fitCheck(horse, horse.style, race), goodFits: fitCheck(horse, horse.style, { distanceM: horse.preferredDistanceM, surface: horse.preferredSurface, going: "good" }) };
}

export default function StatsAndAptitudesPage() {
  const ex = sample();
  const statFloors = floors(statGrade, 0, 1000).reverse();
  const lossFloors = floors(lossGrade, 0, 200);
  return (
    <>
      <Lead>
        Every horse has six stats, each on a scale of 0 to 1000, and three preferences: a best trip, a favourite surface and a natural running style. The race engine turns these into
        speed and energy, metre by metre. The aptitude grades on the horse page tell you, in plain letters, where your horse is at its best.
      </Lead>

      <H2 id="six-stats">The six stats</H2>
      <Table head={["Stat", "What it does"]} rows={(Object.keys(STAT_LABEL) as gc.StatKey[]).map((k) => [STAT_LABEL[k], STAT_DOES[k]])} />
      <P>
        Each stat also gets a letter, the way a form guide would sum it up:{" "}
        {statFloors.map((f, i) => (
          <span key={f.grade}>
            <b>{f.grade}</b> from {f.from}
            {i < statFloors.length - 1 ? ", " : "."}
          </span>
        ))}
      </P>

      <H2 id="example">A real horse</H2>
      <P>
        This is a starter Thoroughbred, made by the code that makes yours. Each bar is the stat it races on today; the second number is its genetic potential, the ceiling training and experience
        work towards.
      </P>
      <HorseRow>
        <HorseCard
          appearance={appearanceOfGenome(ex.state.genome)}
          name={ex.state.name}
          line={`${STYLE_LABEL[ex.horse.style]} · best at ${formatDistance(ex.horse.preferredDistanceM)} · ${SURFACE_LABEL[ex.horse.preferredSurface]}`}
        />
      </HorseRow>
      <div className="grid gap-2">
        {(Object.keys(STAT_LABEL) as gc.StatKey[]).map((k) => (
          <Meter key={k} label={`${STAT_LABEL[k]} · ${statGrade(ex.horse.stats[k])}`} value={ex.horse.stats[k]} max={1000} suffix={<span className="caption"> / {ex.pot[k]}</span>} />
        ))}
        <p className="caption">Stat today / potential. A new horse races below its potential; see <WikiLink slug="growing-up" /> and <WikiLink slug="training" />.</p>
      </div>

      <H2 id="preferences">Trip, surface and going</H2>
      <H3>Best trip</H3>
      <P>
        Two distance genes set the trip a horse is happiest at. Each gene pulls towards its own distance, and the horse&rsquo;s best trip lands between them. Shorter than its best, a horse lacks the pace; longer, it runs out of energy. Adaptability softens both.
      </P>
      <Table
        head={["Distance gene", "Pulls towards"]}
        rows={(Object.keys(gc.DISTANCE_CENTER_M) as (keyof typeof gc.DISTANCE_CENTER_M)[]).map((d) => [d[0]!.toUpperCase() + d.slice(1), formatDistance(gc.DISTANCE_CENTER_M[d])])}
      />
      <P>
        The <b>speed gene</b> (MSTN) then moves it: two sprint copies (C/C) take {gc.MSTN_TRIP_M} m off the best trip, two stay copies (T/T) add {gc.MSTN_TRIP_M} m. A horse&rsquo;s breed and size
        shape its stats the same way, moving points between speed, stamina, burst and durability without changing the total. See <WikiLink slug="breeds" />.
      </P>
      <H3>Favourite surface</H3>
      <List
        items={[
          <>
            Two turf genes make a <b>turf</b> horse; two dirt genes a <b>dirt</b> horse.
          </>,
          <>
            One of each makes a versatile <b>synthetic</b> (all-weather) type, with +{gc.SURFACE_HET_ADAPT_BONUS} adaptability.
          </>,
          <>Off its favourite surface every horse loses some cruising speed; a low-adaptability horse loses much more.</>,
        ]}
      />
      <H3>Going</H3>
      <P>
        {GOING_LABEL.firm} and {GOING_LABEL.good} ground cost nothing. {GOING_LABEL.soft} and especially {GOING_LABEL.heavy} going slow everyone, and slow a horse with low adaptability
        most. A horse with the hidden <b>mudlark</b> quirk loves soft and heavy ground (see <WikiLink slug="genetics-and-inheritance" />).
      </P>

      <H2 id="style">Running style</H2>
      <Table head={["Style", "How it runs"]} rows={(Object.keys(STYLE_LABEL) as (keyof typeof STYLE_LABEL)[]).map((s) => [STYLE_LABEL[s], STYLE_BLURB[s]])} />
      <P>
        Every horse has a natural style from its genes. You choose the tactic on the entry sheet; riding a horse in its natural style gives it a small edge in pace and energy, and asking it
        to run another way costs a little. See <WikiLink slug="entering-a-race" />.
      </P>

      <H2 id="grades">Aptitude grades</H2>
      <P>
        The horse page grades each trip, surface, going and riding plan from A to E. A grade is the rating points the horse loses against its own best case, worked out with the same maths
        the race uses: {lossFloors.map((f, i) => (
          <span key={f.grade}>
            <b>{f.grade}</b> {i === 0 ? `up to ${lossFloors[1]!.from - 1}` : i === lossFloors.length - 1 ? `more than ${f.from - 1}` : `up to ${lossFloors[i + 1]!.from - 1}`}
            {i < lossFloors.length - 1 ? ", " : "."}
          </span>
        ))}{" "}
        Here is {ex.state.name}:
      </P>
      <Table head={["Trip", ...TRIP_BANDS.map((b) => `${TRIP_WORD[b.id]} (${b.range})`)]} rows={[["Grade", ...ex.apt.trip.map((c) => c.grade)]]} />
      <Table head={["Surface", ...ex.apt.surface.map((c) => SURFACE_LABEL[c.key])]} rows={[["Grade", ...ex.apt.surface.map((c) => c.grade)]]} />
      <Table head={["Going", ...ex.apt.going.map((c) => GOING_LABEL[c.key])]} rows={[["Grade", ...ex.apt.going.map((c) => c.grade)]]} />
      <Table head={["Plan", ...ex.apt.style.map((c) => STYLE_LABEL[c.key])]} rows={[["Grade", ...ex.apt.style.map((c) => c.grade)]]} />

      <H3>Fit chips</H3>
      <P>
        Before and after a race, the game checks your runner against that race and shows a chip for each of trip, surface, going and plan: <b>✓</b> suits, <b>~</b> so-so, <b>✗</b>{" "}
        against. For {ex.state.name} at its best trip on good going:
      </P>
      <FitList fits={ex.goodFits} showDetail />
      <P>
        And in a {formatDistance(ex.race.distanceM)} race on {SURFACE_LABEL[ex.race.surface].toLowerCase()} with {GOING_LABEL[ex.race.going].toLowerCase()} going:
      </P>
      <FitList fits={ex.fits} showDetail />
      <Facts
        rows={[
          ["Stat scale", "0 to 1000"],
          ["Distance genes pull towards", Object.values(gc.DISTANCE_CENTER_M).map((m) => formatDistance(m)).join(" · ")],
          ["Adaptability bonus, synthetic types", `+${gc.SURFACE_HET_ADAPT_BONUS}`],
          [`${ex.state.name}: best trip`, formatDistance(ex.horse.preferredDistanceM)],
          [`${ex.state.name}: natural style`, STYLE_LABEL[ex.horse.style]],
        ]}
      />
      <Callout tone="tip">
        <p>
          A horse with modest stats in the right race often beats a better horse in the wrong one. Read the fit chips before you enter, and keep a low-adaptability horse to its own trip,
          surface and good ground.
        </p>
      </Callout>
    </>
  );
}
