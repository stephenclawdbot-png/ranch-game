import * as gc from "@thoroughbred/game-core";
import { RULES, defaultCardSlot, entryCostFor } from "@thoroughbred/db";
import { STYLE_LABEL, formatCredits } from "@/lib/format";
import { Callout, Facts, Figure, GameLink, H2, HorseCard, HorseRow, Lead, List, P, Steps, Table, WikiLink, appearanceOfGenome, pct, sampleGenome } from "../kit";

/** The riding plan as the entry sheet words it. */
const PLAN_HINT: Record<"front" | "stalker" | "closer", string> = {
  front: "Jump out and lead all the way. Suits quick horses with stamina to hold on.",
  stalker: "Sit just behind the leaders, then pounce in the straight. The balanced ride.",
  closer: "Settle at the back, save energy, one long late run. Needs a strong finishing burst.",
};
const RIDES: { v: gc.RideIntensity; label: string; hint: string }[] = [
  { v: "conservative", label: "Easy", hint: "Look after the horse: a little less kick, lower injury risk." },
  { v: "normal", label: "Normal", hint: "A proper race ride." },
  { v: "all_out", label: "All-out", hint: "More kick at the end, but a higher injury risk." },
];

/** One real foundation horse of each natural running style. */
function styleExamples() {
  const out = new Map<string, gc.Genome>();
  for (let i = 0; i < 200 && out.size < 3; i++) {
    const g = sampleGenome(`style-${i}`);
    const s = gc.runningStyle(g);
    if (!out.has(s)) out.set(s, g);
  }
  return (["front", "stalker", "closer"] as const).flatMap((s) => (out.has(s) ? [{ style: s, genome: out.get(s)! }] : []));
}

/** The entry sheet's injury risk for one real horse (prime, rested, good ground, a mile) at each ride. */
function riskExample() {
  const genome = sampleGenome("entry-risk-1");
  const born = gc.createHorseState({ id: "wiki-risk", name: "Example", sex: "colt", ownerId: "wiki", sireId: null, damId: null, generation: 0, genome, bornAtMs: 0, bornSeason: 1, careSessions: gc.CARE_TO_RACING });
  const state: gc.HorseState = { ...born, career: { ...born.career, starts: gc.JUVENILE_MAX_STARTS + 4 } };
  const stage = gc.stageOf(state);
  return RIDES.map((r) => ({ ...r, risk: gc.injuryRisk(state, { nowMs: 0, going: "good", distanceM: 1600, intensity: r.v, stage }) }));
}

export default function EnteringARacePage() {
  const styles = styleExamples();
  const risks = riskExample();
  const normal = risks.find((r) => r.v === "normal")!.risk;
  // Credit entry fees on the Live card (one day of it): normally none, races are paid for in entries.
  const maxFee = Math.max(...Array.from({ length: gc.SLOTS_PER_DAY }, (_, i) => defaultCardSlot(10 * gc.SLOTS_PER_DAY + i).entryFee ?? 0));
  return (
    <>
      <Lead>
        Entering a Live race takes a few taps: pick the race on the card, pick the horse, choose how it should be ridden and confirm. Until entries close you can still change your mind. Here is
        what each part of the entry sheet means.
      </Lead>

      <H2 id="how-to">How to enter</H2>
      <Steps
        items={[
          <>
            Open the <GameLink href="/races">race card</GameLink> and choose a race that is still open. Each race shows its class, trip, surface and going.
          </>,
          <>Pick a horse. The sheet shows how well this race suits it, and why a horse can&rsquo;t run if it can&rsquo;t (resting, injured, wrong class, rating out of the band).</>,
          <>Choose the riding plan: a tactic and a ride intensity. The sheet shows the injury risk for the ride you picked before you commit.</>,
          <>
            Confirm. The race costs {entryCostFor("scheduled", "maiden")} stable entry ({entryCostFor("feature", "graded")} for Features, Finals and Group races).
          </>,
          <>Watch it live, or come back later: the result waits in your inbox.</>,
        ]}
      />

      <H2 id="racecard">Reading the racecard</H2>
      <P>
        Every race page has a racecard listing the field, printed like the real thing. Before entries close it shows who has entered so far and says the Club will fill the field; once the field
        locks, every runner has its saddlecloth number and gate.
      </P>
      <Table
        head={["Column", "What it tells you"]}
        rows={[
          ["No.", "The saddlecloth number, which is also the starting gate. Gates are drawn from the race's sealed seed when entries close."],
          ["Horse", "Name and silks, then age, colour, sex and the stable. Your own runner is marked \"You\"."],
          ["Form", "The last three finishes, oldest first. 0 means it finished outside the first nine."],
          ["OR", "The official rating going into this race."],
          ["Plan", "How the horse will be ridden: Front, Stalk or Close."],
          ["Best trip", "The distance the horse prefers."],
          ["Spd · Sta · Brs", "Grades for speed, stamina and burst."],
        ]}
      />
      <P>
        Form and rating come from races already settled, never from this one. More on both in <WikiLink slug="ratings-and-form" />.
      </P>

      <H2 id="entries">Entries, fees and limits</H2>
      <P>
        Live races are paid for from your <b>stable entry bank</b>, not with credits. You get a fresh allowance every local midnight, unused entries roll over up to the bank&rsquo;s cap, and
        missing a day is never punished. Story races and the Daily Cup are free.{" "}
        {maxFee === 0 ? <>Races on the Live card have no credit entry fee.</> : <>A few top races also charge an entry fee of up to {formatCredits(maxFee)} credits.</>} The whole entry economy
        is on <WikiLink slug="credits-and-entries" />.
      </P>
      <Facts
        rows={[
          ["Live race", `${entryCostFor("scheduled", "maiden")} entry`],
          ["Feature, Final or Group race", `${entryCostFor("feature", "graded")} entries`],
          ["New entries each local day", gc.ENTRY_DAILY_BASE],
          ["Bank holds at most", gc.ENTRY_BANK_BASE],
          ["Daily refill", `+${gc.ENTRY_REFILL_AMOUNT} for ${formatCredits(gc.ENTRY_REFILL_COST)} credits, once a day, while below ${gc.ENTRY_REFILL_BELOW}`],
          ["With every entries upgrade", `up to ${gc.ENTRY_DAILY_MAX} a day, bank of ${gc.ENTRY_BANK_MAX}`],
        ]}
      />
      <List
        items={[
          <>
            <b>One horse per stable per Live race.</b> If you already have a runner in a race, enter your next horse in another one.
          </>,
          <>A stable can never make up more than half of a field.</>,
          <>
            A horse can start at most <b>{gc.MAX_STARTS_PER_DAY} times a day</b>, Live and Story races together.
          </>,
          <>Scratching your horse before entries close frees it again, but the entry you spent is gone. If a race is abandoned, your entries come back.</>,
          <>Mares in foal, injured horses and horses that have stopped racing can&rsquo;t be entered.</>,
        ]}
      />

      <H2 id="paddock">The paddock and the off</H2>
      <Figure src="/art/diorama/poster-paddock.png" alt="Horses parading in the paddock" caption="Before the off, the runners parade in the paddock." focus={0.55} />
      <P>
        The race page counts down to the off. While entries are open it shows how long you have left; entries close {RULES.entriesCloseBeforePostMs / 1000} seconds before the off and the field
        locks. The runners parade in the paddock, with a nameplate for each horse showing its stable and form. In the final seconds they go down to post and the gates load. Then the race goes
        off and everybody watches it together.
      </P>

      <H2 id="tactics">Tactics</H2>
      <P>
        Every horse has a <b>natural running style</b>, set by its genes, and the entry sheet picks it for you. Riding to the natural style is usually best, but you can choose another one when
        the race calls for it, say a strong early pace that will suit a closer.
      </P>
      <HorseRow>
        {styles.map((s) => (
          <HorseCard key={s.style} appearance={appearanceOfGenome(s.genome)} name={STYLE_LABEL[s.style]} line={`A natural ${STYLE_LABEL[s.style].toLowerCase()}`} size="sm" />
        ))}
      </HorseRow>
      <Table head={["Tactic", "On the card", "How it rides"]} rows={(["front", "stalker", "closer"] as const).map((t) => [STYLE_LABEL[t], t === "front" ? "Front" : t === "stalker" ? "Stalk" : "Close", PLAN_HINT[t]])} />

      <H2 id="intensity">Ride intensity and injury risk</H2>
      <P>
        The second half of the plan is how hard the jockey rides. A harder ride buys a little more finishing kick and costs a higher chance of injury. The exact risk for your horse is on the entry
        sheet before you confirm. Here it is for a real rested horse in its prime, over a mile on good ground:
      </P>
      <Table
        head={["Ride", "What it does", "Risk ×", "Injury risk", "If injured, career-ending"]}
        rows={risks.map((r) => [r.label, r.hint, `× ${gc.INTENSITY_RISK[r.v] / 1000}`, `${pct(r.risk.permille, 1)} (${r.risk.label})`, pct(r.risk.careerEndingShare)])}
        caption={`Base risk of ${pct(gc.BASE_INJURY_PERMILLE, 1)} per start, adjusted for this horse's durability, then multiplied by the ride.`}
      />
      <P>
        Low durability, tiredness, racing often, firm or heavy going, long trips, veteran legs and fragile legs all raise the risk too. In Live races, {pct(gc.FATAL_SHARE_OF_CAREER_ENDING)} of
        career-ending injuries are fatal; in Story races and training they never are. See <WikiLink slug="injuries-and-insurance" />.
      </P>
      <Callout tone="warn">
        <p>
          An all-out ride multiplies the injury risk by {gc.INTENSITY_RISK.all_out / 1000} and makes a career-ending injury more likely if one happens ({pct(risks[2]!.risk.careerEndingShare)}{" "}
          instead of {pct(normal.careerEndingShare)} here). Save it for the races that matter.
        </p>
      </Callout>
      <Callout tone="tip">
        <p>
          An Easy ride costs a little kick but cuts the risk to {gc.INTENSITY_RISK.conservative / 1000} of normal. It is a good habit for a veteran, a tired horse or a horse with fragile legs
          you want to keep breeding from.
        </p>
      </Callout>
    </>
  );
}
