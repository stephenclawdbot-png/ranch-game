import * as gc from "@thoroughbred/game-core";
import { formatCredits, formatDistance, STYLE_LABEL, SURFACE_LABEL } from "@/lib/format";
import { Callout, Facts, Figure, GameLink, H2, HorseCard, HorseRow, Lead, List, P, Steps, WikiLink, appearanceOfGenome, count } from "../kit";

const SILKS = { primary: "#1f4e9c", secondary: "#f3e7c9", pattern: "hoops", cap: "#1f4e9c" } as const;
const MINUTES = (ms: number) => Math.round(ms / 60_000);

/** A real starter stable, made by the same code that makes yours. */
function exampleStarters() {
  const states = gc.createStarterStable({ ownerId: "wiki", seed: "wiki-starters", nowMs: 0, season: 1 });
  return states.map((s, i) => {
    const horse = gc.toSharedHorse(s, 0, SILKS as Parameters<typeof gc.toSharedHorse>[2]);
    return { state: s, horse, breed: gc.STARTER_PLAN[i]!.breed };
  });
}

export default function QuickStartPage() {
  const starters = exampleStarters();
  const goalsPay = gc.DAILY_GOAL_CREDITS * gc.DAILY_GOALS_PER_DAY;
  return (
    <>
      <Lead>
        Post Time is a racing stable you run a few minutes at a time. You found a stable, meet three horses that are ready to race, and send one to the gates straight away. After that, each day
        is a short round: care for your horses, run a race or two, and watch your yard grow.
      </Lead>
      <Figure src="/art/diorama/poster-yard.png" alt="The stable yard on a sunny morning" caption="Your estate: the yard, the barn and the way to the racecourse." focus={0.55} />

      <H2 id="found">Found your stable</H2>
      <Steps
        items={[
          <>
            Go to <GameLink href="/play">Found a stable</GameLink>. The game suggests a stable name and racing colours; keep them, roll new colours, or customise them.
          </>,
          <>
            Tap <b>Register &amp; get my horses</b>. It is free and your stable is linked to this browser. You start with <b>{formatCredits(gc.STARTER_GRANT)}</b> Stable Credits and
            your first day&rsquo;s Live entries.
          </>,
          <>Three stall doors open. You can rename any of your horses before its first race.</>,
        ]}
      />

      <H2 id="starters">Your three starters</H2>
      <P>
        Every new stable gets the same mix of breeds: a Quarter Horse, bred for speed over short trips, a Thoroughbred and an Arabian, bred to stay. Each horse&rsquo;s own genes
        still decide its best trip, so read the cards. They arrive at racing age (all {gc.CARE_TO_RACING} care sessions as a youngster are
        already done), so they can race today. Starters are Club-bred, which means they can&rsquo;t be sold. Here is a real starter stable, made by the code that made yours:
      </P>
      <HorseRow>
        {starters.map(({ state, horse, breed }) => (
          <HorseCard
            key={state.id}
            appearance={appearanceOfGenome(state.genome)}
            name={state.name}
            line={`${gc.BREED_LABEL[breed]} · ${STYLE_LABEL[horse.style]} · ${formatDistance(horse.preferredDistanceM)} · ${SURFACE_LABEL[horse.preferredSurface]}`}
          />
        ))}
      </HorseRow>
      <P>
        Each card shows the horse&rsquo;s natural running style, its best trip and its favourite surface. Those three things decide which races suit it. See{" "}
        <WikiLink slug="stats-and-aptitudes" />.
      </P>

      <H2 id="first-race">Your first race</H2>
      <P>
        Right after you register, the game picks the starter best suited to a race and offers <b>Race now</b>. That first race is a free Story race against the Club, ridden in the
        horse&rsquo;s natural style. You can change the plan first if you like. Story races cost no Live entries.
      </P>
      <Steps
        items={[
          <>
            Tap <b>Race [your horse] now</b>, or <b>Change the plan</b> to pick a different tactic or ride.
          </>,
          <>Watch the race. The result is decided by the race engine from a sealed seed, the same way for everyone.</>,
          <>
            Win or lose, the horse learns from the run. Later, pick races from the <GameLink href="/races">Race card</GameLink> or carry on through the{" "}
            <GameLink href="/story">Story</GameLink> chapters.
          </>,
        ]}
      />
      <Callout tone="tip">
        <p>
          Match the race to the horse. A sprinter in a long race, or a dirt horse on turf, gives away ground before the gates open. The entry sheet puts your best-suited fresh horse first,
          and the race page shows a fit check for trip, surface, going and plan.
        </p>
      </Callout>

      <H2 id="each-day">What to do each day</H2>
      <List
        items={[
          <>
            <b>Care for each horse</b> once a day (feed, groom, turnout). Foals only grow up through care; grown horses build bond. See <WikiLink slug="care-and-condition" />.
          </>,
          <>
            <b>Today&rsquo;s goals</b> on the Estate: run a race, care for a horse and run the Daily Cup. Each pays <b>{gc.DAILY_GOAL_CREDITS}</b> credits, {goalsPay} in all.
          </>,
          <>
            <b>Race.</b> A Live race goes off every {MINUTES(gc.SLOT_INTERVAL_MS)} minutes and costs stable entries; Story races are free. Each horse can run{" "}
            <b>{count(gc.MAX_LIVE_STARTS_PER_DAY, "Live race")} a day</b>, and at most {gc.MAX_STARTS_PER_DAY} races a day counting Story races, so spread your entries across your
            string. See <WikiLink slug="credits-and-entries" />.
          </>,
          <>
            <b>Train.</b> Each horse has {gc.BASE_SLOTS} training sessions a week. Hard work now sets up a freshness peak a few days later. See <WikiLink slug="training" />.
          </>,
          <>
            <b>Run the Daily Cup</b> under Club: one run a day for every stable. See <WikiLink slug="daily-cup" />.
          </>,
        ]}
      />
      <Facts
        rows={[
          ["Starting credits", formatCredits(gc.STARTER_GRANT)],
          ["Starter horses", gc.STARTER_PLAN.length],
          ["Credits per daily goal", gc.DAILY_GOAL_CREDITS],
          ["Daily goals", gc.DAILY_GOALS_PER_DAY],
          ["Live entries each day", gc.ENTRY_DAILY_BASE],
          ["Live races per horse per day", gc.MAX_LIVE_STARTS_PER_DAY],
          ["Races per horse per day, Live and Story", gc.MAX_STARTS_PER_DAY],
          ["Training sessions per horse per week", gc.BASE_SLOTS],
        ]}
      />
      <Callout tone="rule" title="Being away never hurts">
        <p>
          Nothing in the game punishes a missed day. Fatigue recovers and injuries heal while you are away, care only pauses growth, and unused entries roll over into your bank. There are no
          stable running costs.
        </p>
      </Callout>

      <H2 id="next">What comes next</H2>
      <List
        items={[
          <>
            Win Story races to earn licences that open better classes on the Live card: <WikiLink slug="race-types" />.
          </>,
          <>
            Aim a horse at Saturday&rsquo;s Weekend Feature: <GameLink href="/week">This week</GameLink> under Racing shows the race, the weekday Qualifiers and where your horses stand.
            See <WikiLink slug="league" />.
          </>,
          <>
            Breed your own foals once your horses have raced enough: <WikiLink slug="breeding-basics" />.
          </>,
          <>
            Add stalls and facilities as credits come in: <WikiLink slug="facilities" />.
          </>,
          <>
            Learn where everything lives: <WikiLink slug="the-estate" />.
          </>,
        ]}
      />
    </>
  );
}
