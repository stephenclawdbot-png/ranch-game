import * as gc from "@thoroughbred/game-core";
import { Callout, Facts, Figure, H2, HorseCard, HorseRow, Lead, List, P, Table, WikiLink, appearanceOfGenome, count, pct, sampleGenome } from "../kit";

const TYPE_LABEL: Record<gc.MaturityType, [string, string]> = {
  early: ["Early peaker", "Comes to hand quickly and is at its best in the first half of its career."],
  normal: ["Normal maturity", "Peaks through the middle of its career."],
  late: ["Late developer", "Keeps improving and is at its best later in its career."],
};
const TYPES: gc.MaturityType[] = ["early", "normal", "late"];

/** The display age printed on the racecard for each stretch of the career clock. */
function ageBands() {
  const out: { age: number; from: number; to: number }[] = [];
  for (let s = 0; s <= gc.CAREER_MAX_STARTS; s++) {
    const age = gc.displayAge({ care: { sessions: gc.CARE_TO_RACING, lastCareDay: null, quality: 600 }, career: { starts: s, racingRetired: null, pastured: false, insured: false } });
    const last = out[out.length - 1];
    if (last && last.age === age) last.to = s;
    else out.push({ age, from: s, to: s });
  }
  return out;
}

/** One real horse of each maturity type. */
function maturityHorses() {
  const found = new Map<gc.MaturityType, gc.Genome>();
  for (let i = 0; i < 300 && found.size < 3; i++) {
    const g = sampleGenome(`maturity-${i}`);
    const t = gc.maturityType(g);
    if (!found.has(t)) found.set(t, g);
  }
  return TYPES.flatMap((t) => (found.has(t) ? [{ type: t, genome: found.get(t)! }] : []));
}

/** Veteran legs: the entry sheet's injury-risk factor for the same horse in prime and as a veteran. */
function veteranRisk() {
  const genome = sampleGenome("career-risk");
  const born = gc.createHorseState({ id: "wiki-career", name: "Example", sex: "colt", ownerId: "wiki", sireId: null, damId: null, generation: 0, genome, bornAtMs: 0, bornSeason: 1, careSessions: gc.CARE_TO_RACING });
  const at = (starts: number) => {
    const s: gc.HorseState = { ...born, career: { ...born.career, starts } };
    return gc.injuryRisk(s, { nowMs: 0, going: "good", distanceM: 1600, intensity: "normal", stage: gc.stageOf(s) });
  };
  const prime = at(gc.JUVENILE_MAX_STARTS + 1);
  const veteran = at(gc.PRIME_MAX_STARTS + 1);
  return { prime, veteran, factor: veteran.factors.find((f) => f.key === "veteran")?.multiplier ?? 1000 };
}

export default function RacingCareerPage() {
  const ages = ageBands();
  const horses = maturityHorses();
  const risk = veteranRisk();
  const checkpoints = [0, 5, 10, 15, 20, 25, 30, 35, gc.CAREER_MAX_STARTS];
  return (
    <>
      <Lead>
        A racehorse in Post Time has a career of <b>{gc.CAREER_MAX_STARTS} starts</b>. Horses age by racing, never by the calendar: a horse you leave in its stall for a month comes back exactly as
        you left it. The career clock counts the starts, and every horse moves from juvenile to prime to veteran on the way to retirement.
      </Lead>
      <Figure src="/art/scenes/starting-stalls.png" alt="Runners being loaded into the starting stalls" caption="Every start moves the career clock on by one." focus={0.65} />

      <H2 id="clock">The career clock</H2>
      <P>
        Open a horse and go to its Career tab. The big number shows its starts out of {gc.CAREER_MAX_STARTS}. Below it, a bar split into the three stages shows where the horse is now, with a green
        band marking its <b>peak window</b>, and a line telling you how many starts are left.
      </P>
      <Table
        head={["Stage", "Starts", "What it means"]}
        rows={[
          ["Juvenile", `0–${gc.JUVENILE_MAX_STARTS}`, "Learning the job. Runs Maidens, Novices, Story races and the Daily Cup, not Handicaps or above yet."],
          ["Prime", `${gc.JUVENILE_MAX_STARTS + 1}–${gc.PRIME_MAX_STARTS}`, "The heart of the career. Every class it is rated for is open."],
          ["Veteran", `${gc.PRIME_MAX_STARTS + 1}–${gc.CAREER_MAX_STARTS}`, "Still competitive, but speed starts to fade and the legs are older."],
        ]}
      />
      <List
        items={[
          <>
            Only <b>Live races</b> count as starts. Story races and the Daily Cup never move the clock.
          </>,
          <>
            A horse can run {count(gc.MAX_LIVE_STARTS_PER_DAY, "Live race")} a day, so a career takes at least{" "}
            <b>{Math.ceil(gc.CAREER_MAX_STARTS / gc.MAX_LIVE_STARTS_PER_DAY)} days</b> of racing (a season is {gc.SEASON_DAYS} days). Most horses take longer still, and that is
            fine: nothing decays while you are away. A string of several horses keeps you racing every day while each one rests.
          </>,
          <>
            After {gc.BREED_FROM_STARTS} starts a racing horse may also breed, and a colt becomes a stallion, a filly a mare. See <WikiLink slug="breeding-basics" />.
          </>,
        ]}
      />
      <Table
        head={["Starts", "Age on the racecard"]}
        rows={ages.map((a) => [a.from === a.to ? `${a.from}` : `${a.from}–${a.to}`, `${a.age} years old`])}
        caption="The age shown on the card follows the career clock, not the date."
      />

      <H2 id="peak">Maturity and the peak window</H2>
      <P>
        Every horse has a maturity type in its genes. It decides when the horse reaches its best: its stats grow towards their potential until the peak window, hold there, then ease off towards
        the end of the career. Speed and burst peak a couple of starts earlier, stamina and temperament a few later.
      </P>
      <HorseRow>
        {horses.map((h) => (
          <HorseCard
            key={h.type}
            appearance={appearanceOfGenome(h.genome)}
            name={TYPE_LABEL[h.type][0]}
            line={`Peak around starts ${gc.PEAK_WINDOW[h.type][0]}–${gc.PEAK_WINDOW[h.type][1]}`}
            size="sm"
          />
        ))}
      </HorseRow>
      <Table
        head={["Starts", ...TYPES.map((t) => TYPE_LABEL[t][0])]}
        rows={checkpoints.map((s) => [s, ...TYPES.map((t) => pct(gc.maturityAt("speed", t, gc.CARE_TO_RACING, s)))])}
        caption="How much of its speed potential a horse shows at each point of the career, by maturity type (before training)."
      />
      <P>
        {TYPES.map((t) => `${TYPE_LABEL[t][0]}: ${TYPE_LABEL[t][1]}`).join(" ")} You can see your horse&rsquo;s type and peak window on its Career tab. Training lifts how much of the potential
        it shows: see <WikiLink slug="training" /> and <WikiLink slug="growing-up" />.
      </P>
      <Callout tone="tip">
        <p>
          Plan the big races for the peak window. An early peaker is worth running hard and often while it is young; a late developer is better kept to easier races until its best years arrive.
        </p>
      </Callout>

      <H2 id="veteran">Veteran years</H2>
      <P>
        From start {gc.PRIME_MAX_STARTS + 1} a horse is a veteran. Its speed eases first while its stamina holds up longer. Veteran legs also raise
        the injury risk: the same horse in the same race goes from {pct(risk.prime.permille, 1)} to {pct(risk.veteran.permille, 1)} a start on the entry sheet (× {risk.factor / 1000}).
      </P>

      <H2 id="retirement">Retirement</H2>
      <P>A racing career ends in one of three ways:</P>
      <List
        items={[
          <>
            <b>The full {gc.CAREER_MAX_STARTS} starts.</b> Retirement is mandatory: after its {gc.CAREER_MAX_STARTS}th start the horse retires from racing on its own, and the card says &ldquo;Career
            complete&rdquo;.
          </>,
          <>
            <b>Your choice.</b> At any time you can end the racing career from the Career tab: &ldquo;Send to stud&rdquo;, &ldquo;Make a broodmare&rdquo; or, for a gelding, &ldquo;End racing&rdquo;.
          </>,
          <>
            <b>A career-ending injury.</b> The horse retires from racing at once; it can still breed. See <WikiLink slug="injuries-and-insurance" />.
          </>,
        ]}
      />
      <P>
        What comes after is on <WikiLink slug="stud-and-broodmares" /> and <WikiLink slug="legacy-farm" />.
      </P>
      <Facts
        rows={[
          ["Career length", `${gc.CAREER_MAX_STARTS} starts`],
          ["Juvenile", `0–${gc.JUVENILE_MAX_STARTS} starts`],
          ["Prime", `${gc.JUVENILE_MAX_STARTS + 1}–${gc.PRIME_MAX_STARTS} starts`],
          ["Veteran", `${gc.PRIME_MAX_STARTS + 1}–${gc.CAREER_MAX_STARTS} starts`],
          ["Live starts per day, at most", gc.MAX_LIVE_STARTS_PER_DAY],
          ["Shortest possible career", `${Math.ceil(gc.CAREER_MAX_STARTS / gc.MAX_LIVE_STARTS_PER_DAY)} days`],
          ["May breed while racing from", `${gc.BREED_FROM_STARTS} starts`],
        ]}
      />
      <Callout tone="rule">
        <p>Retiring from racing is final. A horse sent to stud or made a broodmare never races again, so decide while it still has starts worth running.</p>
      </Callout>
    </>
  );
}
