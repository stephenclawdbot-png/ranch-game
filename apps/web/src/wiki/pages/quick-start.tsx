import * as gc from "@thoroughbred/game-core";
import { LINK_CODE_TTL_MS, MISS_IT_AFTER_DAYS } from "@thoroughbred/db";
import { formatCredits, formatDistance, ordinal, STYLE_LABEL, SURFACE_LABEL } from "@/lib/format";
import { STABLE_NAME_MAX, STABLE_NAME_MAX_WORDS, STABLE_NAME_MIN } from "@/lib/stableName";
import { Callout, Facts, Figure, GameLink, H2, HorseCard, HorseRow, Lead, List, P, Steps, Table, WikiLink, appearanceOfGenome, count } from "../kit";

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

/** The first-week list: each job as Home words it, and how it ticks (game-core FIRST_WEEK_ORDER holds the order, STABLE_STEPS the credits). */
const WEEK_ROWS: Record<gc.FirstWeekKey, [title: string, how: string]> = {
  first_race: ["Run your first race", "Any race of yours with a result, Story or Live"],
  read_why: ["Read \u201cWhy it went that way\u201d", "The card under your own watched result, on screen for a moment"],
  care: ["Care for a horse", "Your first care session"],
  train_plan: ["Set a training plan", "Saving a week's plan on the gallops board"],
  enter_live: ["Enter a Live race", "Your first Live entry"],
  watch_live: ["Watch your Live race", "Watching its result"],
  rename: ["Name a horse your way", "Renaming a horse (listed only while one of yours hasn't started yet)"],
  daily_cup: ["Run the Daily Cup", "Your first Cup run"],
  qualifier: ["Enter a Feature Qualifier", "Your first Qualifier entry"],
  pick: ["Pick a winner", "Your first pick in a Live race"],
  quick_race: ["Try a quick race", "Your first quick race"],
  pin_target: ["Pin a target race", "Pinning a race on This week's planner"],
  breeding_preview: ["Look at the stallion finder", "A breeding preview or the stallion finder"],
  career_story: ["Read a career story", "Reading the career story of one of your horses"],
};
const WILF = gc.MENTOR.name.split(" ")[0]!;

export default function QuickStartPage() {
  const starters = exampleStarters();
  const goalsPay = gc.DAILY_GOAL_CREDITS * gc.DAILY_GOALS_PER_DAY;
  return (
    <>
      <Lead>
        Post Time is a racing stable you run a few minutes at a time. You found a stable, meet three horses that are ready to race, and send one to the gates straight away. After that, each day
        is a short round: care for your horses, run a race or two, and watch your yard grow.
      </Lead>
      <Figure src="/art/scenes/wiki-first-horse.png" alt="A new owner patting their first racehorse in the yard" caption="Your estate: the yard, the barn and the way to the racecourse." focus={0.55} />

      <H2 id="found">Found your stable</H2>
      <Steps
        items={[
          <>
            Go to <GameLink href="/play">Found a stable</GameLink> and <b>name your stable</b>. The name is yours to choose: one to {STABLE_NAME_MAX_WORDS} words, {STABLE_NAME_MIN} to{" "}
            {STABLE_NAME_MAX} characters. Stuck? Tap the dice for a suggestion. Your racing colours are rolled for you; keep them, roll new ones, or customise them.
          </>,
          <>
            Tap <b>Register &amp; get my horses</b>. It is free and your stable is linked to this browser. You start with <b>{formatCredits(gc.STARTER_GRANT)}</b> Stable Credits and
            your first day&rsquo;s Live entries. Got a wallet? You can found the stable with it instead, and the wallet becomes your login.
          </>,
          <>
            <b>Testing round only:</b> one short screen, <b>Your key to come back</b>. It shows your stable name and your permanent login code. Copy it or save it as an image, then
            tap <b>I&rsquo;ve saved it, let&rsquo;s race</b>. See <a href="#signing-in" className="link">Signing in on another device</a>.
          </>,
          <>
            {gc.MENTOR.name}, the {gc.MENTOR.role.toLowerCase()}, says hello: three short screens on what the game is, how a day works and what to do first, then one question,
            &ldquo;New to horse racing?&rdquo; Say yes and racing words get a tap-for-meaning and key screens use plainer words. Skip him if you like; he&rsquo;s at{" "}
            <GameLink href="/welcome">Welcome</GameLink> any time.
          </>,
          <>Three stall doors open. You can rename any of your horses before its first race.</>,
        ]}
      />

      <Callout tone="rule" title="Stable names">
        <p>
          Letters, numbers, spaces and &rsquo; &amp; . - only, with at least one letter. No two stables share a name, whatever the capitals: if another stable already has it, pick
          another. Names that pass for the game itself, the Club or its staff are kept back. You can rename your stable later on your <GameLink href="/me">profile</GameLink>, under the
          same rules.
        </p>
      </Callout>

      <H2 id="signing-in">Signing in on another device</H2>
      <P>
        Your stable lives on the game&rsquo;s server, not in your browser. The browser you play on keeps you signed in for a year. To come back on another phone or browser, or after
        clearing this one, tap <GameLink href="/link">Sign in</GameLink>. During the testing round there are three ways back in:
      </P>
      <Steps
        items={[
          <>
            <b>Your invite link.</b> The link you were invited with (it ends in <b>?invite=TB-…</b>) takes you straight back into your stable. Open it again, or type its code in the
            box at Sign in. This only works for an invite sent to you alone; a shared invite or a friend&rsquo;s personal code never signs anyone in.
          </>,
          <>
            <b>Your login code.</b> Right after you name your stable, <b>Your key to come back</b> shows it with your stable name: PT- and twenty letters and numbers. Copy it or save
            it as an image. It never changes and it&rsquo;s always on your <GameLink href="/me">profile</GameLink>. Type it at Sign in on any browser, as often as you like. Keep it to
            yourself.
          </>,
          <>
            <b>Your wallet.</b> If you founded or linked your stable with a wallet, tap <b>Connect wallet</b>. One free signature signs you in: no transaction, no fee.
          </>,
        ]}
      />
      <P>
        Signed in on another device already? Your <GameLink href="/me">profile</GameLink> there gives you a one-time device code for Sign in. It works for{" "}
        {Math.round(LINK_CODE_TTL_MS / 60_000)} minutes, once.
      </P>
      <P>
        After you sign in you land on the page you were trying to open. Otherwise Home says welcome back, with one button for the thing worth doing next: a result to watch, your next
        Live race, your Story chapter or your next first-week job.
      </P>
      <Callout tone="rule" title="Testing round only">
        <p>The invite link and the login code work while the testing round runs. After it, sign in with a wallet or a device code.</p>
      </Callout>

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
      <H2 id="verdict">Why it went that way</H2>
      <P>
        Under your result, {WILF} gives his verdict in one sentence: why the race went the way it did, from the pace, your horse&rsquo;s energy, its position and how well the race
        suited it. Then he names <b>one change</b> to try, with a button that does it: <b>Try again as a stalker</b> (or another riding plan), <b>Try again at a race that suits</b>,{" "}
        <b>Race [another horse] instead</b> when yours needs a rest, or simply <b>Race [your horse] again</b>. The button runs a free Story race against the Club straight away, so you
        can see the change work before your next Live race.
      </P>
      <P>
        Below it, <b>The race in numbers</b> shows the detail. Its <b>energy line</b> draws your horse&rsquo;s energy from the off to the finish beside a typical rival&rsquo;s, with a
        dotted line where a horse starts running on empty and a mark where yours ran low. Tap <b>In words</b> for the same thing as a sentence.
      </P>
      <Callout tone="tip">
        <p>
          Match the race to the horse. A sprinter in a long race, or a dirt horse on turf, gives away ground before the gates open. The entry sheet puts your best-suited fresh horse first,
          and the race page shows a fit check for trip, surface, going and plan.
        </p>
      </Callout>

      <H2 id="first-week">Your first week</H2>
      <P>
        For your first {gc.FIRST_WEEK_DAYS} days (founding day included), Home shows one list: <b>Your first week</b>. It holds every job worth trying once, in the order most new
        trainers meet them, with {WILF} saying what the next one is for. The next {count(gc.FIRST_WEEK_SHOWN, "job")} show, each one tap away; the rest wait under <b>All</b>.
        Today&rsquo;s goals sit at the bottom of the same list. Each job ticks itself off when you actually do it (the game checks, so there&rsquo;s nothing to claim), and the list goes
        away once everything is done or the week is over.
      </P>
      <Table
        head={["Job", "How it ticks", "Credits"]}
        rows={gc.FIRST_WEEK_ORDER.filter((key) => !gc.isStableStepKey(key) || gc.stableStepsFor({ quickRaces: true }).some((x) => x.key === key)).map((key) => [
          WEEK_ROWS[key][0],
          WEEK_ROWS[key][1],
          gc.isStableStepKey(key) ? gc.STABLE_STEPS.find((x) => x.key === key)!.credits : "–",
        ])}
      />
      <P>
        The jobs with credits are the <b>Stable steps</b>. Each pays once, and finishing them all pays a bonus of <b>{formatCredits(gc.STABLE_STEPS_BONUS)}</b> and the{" "}
        <b>Learned the Ropes</b> plaque in your Trophy Room: {formatCredits(gc.stableStepsTotal({ quickRaces: true }))} credits in all with the bonus. The other jobs just point the
        way. The quick race job only appears once quick races are in the game. Stables founded before the list arrived don&rsquo;t get it, and keep everything they had.
      </P>

      <H2 id="bloodline">Starting a bloodline</H2>
      <P>
        From your stable&rsquo;s {ordinal(gc.BLOODLINE_NUDGE_DAYS + 1)} day, {WILF} suggests a bloodline on Home. He picks one of your fillies: a mare already retired comes first,
        otherwise your lowest-rated racing filly, so your best racers keep racing. Retire her to the broodmares and she can be covered the same day; the button takes you straight to the
        stallion finder. Retiring is for good, so the game asks first. <b>Not now</b> puts the suggestion away for good, and it never shows once you have bred. See{" "}
        <WikiLink slug="breeding-basics" />.
      </P>
      <Callout tone="tip" title="Testers: one question after a week">
        <p>
          After your first {MISS_IT_AFTER_DAYS} days, Home asks testers once: &ldquo;If Post Time disappeared tomorrow, would you miss it?&rdquo; Pick <b>Very much</b>,{" "}
          <b>Somewhat</b> or <b>Not really</b>, and add why if you like. It helps decide what to work on next.
        </p>
      </Callout>

      <H2 id="unlocks">What opens later</H2>
      <P>A new stable meets a few features a little later, so the first day isn&rsquo;t everything at once. Nothing you have already used is ever taken away.</P>
      <Table
        head={["Feature", "Opens"]}
        rows={[
          ["The tote (betting with credits on Live races)", "After you watch one of your own Live races"],
          ["The market, leasing and buying Premium Packs", `On your stable's ${ordinal(gc.UNLOCK_MARKET_DAYS + 1)} day, or when you finish Story chapter 1`],
          ["Claiming races and jockey contracts (and the transfer window)", "When you finish Story chapter 1"],
          ["Show numbers (the detailed stats)", "Always open"],
        ]}
      />
      <P>
        Each opening arrives as an <b>Unlocked</b> note in Stable news. If you sign in with a wallet, the tote and the market are open from the start. Stables founded before
        this guide keep everything open.
      </P>

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
            <b>Race.</b> Live races run in {gc.MEETINGS_PER_DAY} race meetings a day ({gc.MEETING_START_TIMES_UTC.join(", ")} UTC, {gc.RACES_PER_MEETING} races{" "}
            {MINUTES(gc.MEETING_RACE_SPACING_MS)} minutes apart), published a day ahead, and cost stable entries; Story races are free. Each horse can run{" "}
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
          After a few hours or more away, the Estate opens with a <b>While you were away</b> card: what happened since your last visit (a result you haven&rsquo;t watched
          stays a surprise), what&rsquo;s due, and one thing worth doing next. At the foot of the Estate, <b>Tomorrow at your yard</b> says what will be new tomorrow.
        </p>
        <p>
          Nothing in the game punishes a missed day. Fatigue recovers and injuries heal while you are away, care only pauses growth, and unused entries roll over into your bank. Upkeep is charged only for horses you used that
          week, so a week away is free.
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
