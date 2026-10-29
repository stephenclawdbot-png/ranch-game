import * as gc from "@thoroughbred/game-core";
import { defaultCardSlot } from "@thoroughbred/db";
import { Callout, Facts, H2, H3, HorseCard, HorseRow, Lead, List, P, Table, WikiLink, appearanceOfGenome, sampleGenome } from "../kit";

/** Form figures as the racecard prints them: last three finishes, oldest first, 0 = outside the first nine. */
function formFigures(newestFirst: number[]): string {
  return newestFirst.length
    ? [...newestFirst.slice(0, 3)]
        .reverse()
        .map((p) => (p > 9 ? "0" : String(p)))
        .join("-")
    : "–";
}

/** A real rating update: an eight-runner race scored by the game's own updateRatings. */
function ratingExample() {
  const field = [
    { horseId: "Copper Lark", or: 58, ratedRuns: 12, position: 1 },
    { horseId: "Velvet Echo", or: 64, ratedRuns: 20, position: 2 },
    { horseId: "First Timer", or: gc.INITIAL_OR, ratedRuns: 0, position: 3 },
    { horseId: "Harbour Tide", or: 55, ratedRuns: 9, position: 4 },
    { horseId: "Quiet Banner", or: 61, ratedRuns: 15, position: 5 },
    { horseId: "Paper Comet", or: 50, ratedRuns: 7, position: 6 },
    { horseId: "Iron Sonnet", or: 66, ratedRuns: 25, position: 7 },
    { horseId: "Lucky Willow", or: 52, ratedRuns: 3, position: 8 },
  ];
  const changes = gc.updateRatings(field);
  return field.map((f) => ({ ...f, change: changes.find((c) => c.horseId === f.horseId)! }));
}

/** The rating bands on the Live card (one real hour of it). */
function cardBands() {
  const seen = new Map<string, { min?: number; max?: number; maxWins?: number }>();
  for (let i = 0; i < 200; i++) {
    const s = defaultCardSlot(i);
    const track = String(s.conditions.track ?? "");
    const label = (s.name.startsWith(`${track} `) ? s.name.slice(track.length + 1) : s.name).replace(/^Feature /, "");
    if (!seen.has(label)) seen.set(label, { min: s.conditions.minRating, max: s.conditions.maxRating, maxWins: s.conditions.maxWins });
  }
  return [...seen.entries()];
}

const PRIME_EXAMPLE_STARTS = 12;

/** Real horses: where their running ability says they belong (the newcomer floor). */
function abilityExamples() {
  return ["rating-a", "rating-b", "rating-c"].map((seed) => {
    const genome = sampleGenome(seed);
    const born = gc.createHorseState({ id: `wiki-${seed}`, name: seed, sex: "filly", ownerId: "wiki", sireId: null, damId: null, generation: 0, genome, bornAtMs: 0, bornSeason: 1, careSessions: gc.CARE_TO_RACING });
    const mark = gc.abilityMark({ ...born, career: { ...born.career, starts: PRIME_EXAMPLE_STARTS } });
    return { seed, genome, mark, band: gc.TIER_RULES[gc.classBand(mark)].label };
  });
}

export default function RatingsAndFormPage() {
  const ex = ratingExample();
  const bands = cardBands();
  const horses = abilityExamples();
  const peakCases: [number, number][] = [
    [52, 52],
    [52, 60],
    [52, 68],
    [70, 74],
  ];
  return (
    <>
      <Lead>
        Every racing horse carries an <b>official rating</b> (OR), the handicapper&rsquo;s mark of how good it is, from {gc.OR_MIN} to {gc.OR_MAX}. It moves after every rated race, decides
        which races your horse may enter, and appears next to its name on the racecard along with its recent <b>form</b>.
      </Lead>

      <H2 id="or">The official rating</H2>
      <P>
        Every horse starts on <b>{gc.INITIAL_OR}</b>, whatever its breeding. After each race it is compared with every other runner in the field: finishing ahead of a horse rated above you
        earns more than beating one rated below, and losing to a lower-rated horse costs more than losing to a higher-rated one. Over a few races, the rating settles where the horse really
        belongs.
      </P>
      <List
        items={[
          <>
            A gap of {gc.OR_SCALE} rating points means the higher-rated horse is expected to finish ahead about ten times in eleven.
          </>,
          <>
            For its first {gc.PROVISIONAL_RUNS} rated runs a horse is <b>provisional</b> and its rating moves {gc.K_PROVISIONAL / gc.K_ESTABLISHED} times as fast, so newcomers find their level
            quickly.
          </>,
          <>
            One race can lift a rating by at most {gc.MAX_GAIN_PER_RACE} and drop it by at most {gc.MAX_LOSS_PER_RACE}.
          </>,
          <>The gains and losses in a race roughly cancel out, so ratings don&rsquo;t creep up over time: they only rise by beating other horses.</>,
          <>Live races and Story races are rated. The Daily Cup is not.</>,
        ]}
      />
      <Facts
        rows={[
          ["Rating scale", `${gc.OR_MIN}–${gc.OR_MAX}`],
          ["First rating", gc.INITIAL_OR],
          ["Provisional for", `${gc.PROVISIONAL_RUNS} rated runs`],
          ["Most gained in one race", `+${gc.MAX_GAIN_PER_RACE}`],
          ["Most lost in one race", `−${gc.MAX_LOSS_PER_RACE}`],
          ["Band checks look this far below the peak", gc.PEAK_DROP],
        ]}
      />
      <P>Here is a real eight-runner race scored by the game&rsquo;s own rating rules:</P>
      <Table
        head={["Finish", "Horse", "OR before", "Change", "OR after"]}
        rows={ex.map((r) => [r.position, `${r.horseId}${r.ratedRuns < gc.PROVISIONAL_RUNS ? " (provisional)" : ""}`, r.or, r.change.delta > 0 ? `+${r.change.delta}` : r.change.delta, r.change.after])}
        caption="The provisional newcomer moves furthest; a well-beaten top-rated horse drops."
      />

      <H2 id="bands">Rating bands</H2>
      <P>
        Classes on the Live card are open to horses in a rating band. The Handicap bands overlap, so a horse on the boundary can choose. Maidens and Novices also limit how many races a horse
        has won.
      </P>
      <Table
        head={["Race", "Rating", "Wins"]}
        rows={bands.map(([label, b]) => [
          label,
          b.min !== undefined && b.max !== undefined ? `${b.min}–${b.max}` : b.max !== undefined ? `up to ${b.max}` : b.min !== undefined ? `${b.min}+` : "any",
          b.maxWins === 0 ? "none yet" : b.maxWins !== undefined ? `at most ${b.maxWins}` : "any",
        ])}
      />
      <H3>The peak rating</H3>
      <P>
        To stop anyone losing on purpose to drop into an easier band, the top of a band is checked against more than today&rsquo;s rating. The check uses the highest of three numbers: the
        current rating, the horse&rsquo;s <b>peak rating</b> less {gc.PEAK_DROP}, and a floor from its current running ability. A horse that has truly faded with age is let back down; one that
        is only losing on purpose is not.
      </P>
      <Table
        head={["Rating today", "Peak rating", "Checked against the band at"]}
        rows={peakCases.map(([or, peak]) => [or, peak, gc.bandRating({ or, peakOr: peak })])}
        caption={<>Before the ability floor. If the peak is what binds, the entry sheet says so, for example &ldquo;rated 58 at best&rdquo;.</>}
      />

      <H2 id="newcomers">Where a newcomer belongs</H2>
      <P>
        Because every horse starts on {gc.INITIAL_OR}, a strong newcomer could beat up the lowest bands until its rating caught up. The ability floor stops that: the game works out the rating
        a horse of its current ability would settle at (its <b>ability mark</b>), and checks the band against that too, give or take {gc.ABILITY_MARGIN}.
      </P>
      <Table
        head={["Running ability (speed, stamina, burst)", "Settles at about", "Belongs in"]}
        rows={gc.ABILITY_OR_TABLE.filter(([score]) => score % 100 === 0).map(([score, or]) => [score, or, gc.TIER_RULES[gc.classBand(or)].label])}
        caption="Running ability is a blend of the three racing stats, weighted for the horse's best trip, on the 0–1000 stat scale."
      />
      <P>Foundation horses, with no breeding behind them, settle low. These real ones are in their prime:</P>
      <HorseRow>
        {horses.map((h) => (
          <HorseCard key={h.seed} appearance={appearanceOfGenome(h.genome)} name={`Ability mark ${h.mark}`} line={`Belongs around ${h.band}`} size="sm" />
        ))}
      </HorseRow>
      <P>
        A well-bred horse is a different story: its ability mark can rule it out of the low bands from its very first start. If you try a band it is too strong for, the entry sheet
        points you to a better one, or to Novice races while its rating catches up. Good breeding is how you get there: <WikiLink slug="genetics-and-inheritance" />.
      </P>

      <H2 id="form">Form figures</H2>
      <P>
        The <b>Form</b> column on the racecard shows a horse&rsquo;s last three finishes, oldest first, separated by dashes. A <b>0</b> means it finished outside the first nine. A dash on its
        own means it hasn&rsquo;t run yet. Form counts every settled race, Live or Story, run before this one.
      </P>
      <Table
        head={["Last finishes (newest first)", "Printed on the card"]}
        rows={[[[1], formFigures([1])], [[2, 4, 1], formFigures([2, 4, 1])], [[11, 3, 3, 6], formFigures([11, 3, 3, 6])], [[], formFigures([])]].map(([runs, fig]) => [
          (runs as number[]).length ? (runs as number[]).join(", ") : "No runs yet",
          fig as string,
        ])}
      />
      <Callout tone="tip">
        <p>
          Read form with the rating. A horse showing 1-1 but still rated low is improving fast and may soon be too good for its band. A horse with a high rating and form of 0-0-0 may be out of its
          depth, on the wrong trip or simply tired.
        </p>
      </Callout>
      <P>
        Ratings decide the classes; the classes and their purses are on <WikiLink slug="race-types" />. A horse&rsquo;s ability rises and falls over its career too: see{" "}
        <WikiLink slug="racing-career" />.
      </P>
    </>
  );
}
