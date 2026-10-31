import * as gc from "@thoroughbred/game-core";
import { HORSE_LENGTH_MM } from "@thoroughbred/shared";
import { cardSlotAt } from "@thoroughbred/db";
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

/** The rating bands on the Live card (its first two days). */
function cardBands() {
  const seen = new Map<string, { min?: number; max?: number; maxWins?: number }>();
  for (let i = 0; i < 2 * gc.SLOTS_PER_DAY; i++) {
    const s = cardSlotAt(i);
    if (!s) continue;
    const track = String(s.conditions.track ?? "");
    const label = (s.name.startsWith(`${track} `) ? s.name.slice(track.length + 1) : s.name).replace(/^Feature /, "");
    if (!seen.has(label)) seen.set(label, { min: s.conditions.minRating, max: s.conditions.maxRating, maxWins: s.conditions.maxWins });
  }
  return [...seen.entries()];
}


/** The game's trip bands (game-core distanceBand), read off by scanning every 50 m. */
function tripBands(): [string, number, number][] {
  const out: [string, number, number][] = [];
  for (let m = 1000; m <= 3200; m += 50) {
    const b = gc.distanceBand(m);
    const last = out[out.length - 1];
    if (last && last[0] === b) last[2] = m;
    else out.push([b, m, m]);
  }
  return out;
}

const TRIP_NAME: Record<string, string> = { sprint: "Sprint", mile: "Mile", middle: "Middle", staying: "Long" };

/** A worked form book: a filly's seven runs through the game's own formSplits. */
function splitsExample() {
  const day = 86_400_000;
  const runs: gc.SplitRun[] = [
    { going: "good", position: 1, beatenMm: 0, gate: 2, at: 0 },
    { going: "good", position: 2, beatenMm: 700, gate: 5, at: 4 },
    { going: "good", position: 1, beatenMm: 0, gate: 9, at: 9 },
    { going: "soft", position: 6, beatenMm: 9600, gate: 3, at: 13 },
    { going: "soft", position: 3, beatenMm: 2400, gate: 7, at: 13.2 },
    { going: "soft", position: 8, beatenMm: 14_400, gate: 1, at: 20 },
    { going: "firm", position: 2, beatenMm: 1200, gate: 4, at: 24 },
  ].map((r, i) => ({
    horseId: "filly",
    raceId: `r${i}`,
    postTimeMs: Math.round(r.at * day),
    position: r.position,
    fieldSize: 10,
    beatenMm: r.beatenMm,
    going: r.going,
    surface: "turf",
    course: "Kestrel Downs",
    distanceM: 1600,
    tactic: "stalker",
    jockey: "apprentice",
    gate: r.gate,
  }));
  return gc.formSplits(runs);
}

const lengths = (mm: number | null) => (mm === null ? "–" : `${(mm / HORSE_LENGTH_MM).toFixed(1)} L`);

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
  const trips = tripBands();
  const book = splitsExample();
  const going = book.groups.find((g) => g.dimension === "going")!;
  const draws = Array.from({ length: 10 }, (_, i) => gc.drawBucket(i + 1, 10));
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

      <H2 id="form-book">Reading the form book</H2>
      <P>
        Every horse page carries the full <b>form lines</b>: one row per start with the date, course and race, trip, surface and going, how many ran and the draw (gate), the tactic and
        jockey, the weight carried in a Live handicap, the finishing position, how far it was beaten, its time and the winner&rsquo;s, the official rating before and after, and the purse
        won. Its owner also sees the ride intensity, the race-day extras and how fresh it was at the off. On a phone a row shows the key facts; tap it for the rest. A race still to run shows
        <b> Declared</b>, one being run shows <b>Running</b>: the result appears only once the race has finished and settled.
      </P>
      <Facts
        rows={[
          ["Beaten distance", `the margins of every horse ahead added up, in lengths of ${HORSE_LENGTH_MM / 1000} m (to the nearest quarter); short ones read nose, short head (s.hd), head (hd), neck (nk)`],
          ["Time", "the horse's own time and, in the detail, how far behind the winner's it was"],
          ["Rating", "the official rating it ran off, then where the race left it"],
        ]}
      />
      <H3>Splits</H3>
      <P>
        Under the form lines, the <b>form book</b> splits every settled run by the conditions it was run under and counts wins, seconds and thirds (W-2-3), runs and the average distance
        beaten (a win counts as 0). The same view covers your whole stable on My races, and a stallion&rsquo;s page shows his offspring&rsquo;s splits as a <b>sire line</b>.
      </P>
      <Table
        head={["Split", "Buckets"]}
        rows={[
          ["Going", "Firm, Good, Soft, Heavy"],
          ["Trip", trips.map(([b, lo, hi]) => `${TRIP_NAME[b]} ${lo === 1000 ? `up to ${hi.toLocaleString("en-GB")}` : hi === 3200 ? `${lo.toLocaleString("en-GB")}+` : `${lo.toLocaleString("en-GB")}–${hi.toLocaleString("en-GB")}`} m`).join(", ")],
          ["Surface, course, tactic", "as run"],
          ["Jockey", "the jockey booked (apprentice, journeyman, top jockey)"],
          ["Draw", `the gate's third of the field: in a 10-runner race gates 1–${draws.lastIndexOf("low") + 1} are low, ${draws.indexOf("mid") + 1}–${draws.lastIndexOf("mid") + 1} middle, ${draws.indexOf("high") + 1}–10 high`],
          ["Rest", "days since the horse's previous run: same day, 1–2, 3–6, 7+ (its first run in the book stands apart)"],
        ]}
      />
      <P>
        A bucket with fewer than <b>{gc.MIN_SPLIT_RUNS} runs</b> is greyed: too few to read much into. The <b>best</b> and <b>worst</b> conditions are picked only from buckets with at least{" "}
        {gc.MIN_SPLIT_RUNS} runs, and only where two of them can be compared. The smaller average beaten distance wins; ties go to the higher win rate, then the higher place rate, then
        the bigger sample. Here is a real filly&rsquo;s going split, worked out by the game&rsquo;s own rules:
      </P>
      <Table
        head={["Going", "W-2-3", "Runs", "Beaten (average)"]}
        rows={going.buckets.map((b) => [
          `${b.key[0]!.toUpperCase()}${b.key.slice(1)}${b.small ? " (small sample)" : ""}`,
          `${b.wins}-${b.seconds}-${b.thirds}`,
          b.runs,
          lengths(b.avgBeatenMm),
        ])}
        caption={
          book.best && book.worst
            ? `Best: ${book.best.bucket.key} ground, ${gc.splitRecord(book.best.bucket)}. Worst: ${book.worst.bucket.key} ground, ${gc.splitRecord(book.worst.bucket)}. The single firm run is too few to count.`
            : "Nothing stands out yet."
        }
      />
      <H3>The horse&rsquo;s log</H3>
      <P>
        The <b>Log</b> tab on your own horses keeps everything else in one timeline, newest first: each training session with what it gained per stat and its fatigue before and after,
        care days, every race with its replay and rating change, injuries and the vet, quirks revealed, an improver&rsquo;s step up (only once it has happened), covers and foals, sales,
        claims and lease periods. Training and care are explained on <WikiLink slug="training" /> and <WikiLink slug="care-and-condition" />.
      </P>
      <P>
        Ratings decide the classes; the classes and their purses are on <WikiLink slug="race-types" />. A horse&rsquo;s ability rises and falls over its career too: see{" "}
        <WikiLink slug="racing-career" />.
      </P>
    </>
  );
}
