import * as gc from "@thoroughbred/game-core";
import { CALENDAR_PURSE, PLATE_AFTER_SLOTS, RULES, defaultCardSlot, entryCostFor, runPoints, weekScore } from "@thoroughbred/db";
import { formatCredits, formatDistance } from "@/lib/format";
import { Callout, Facts, Figure, GameLink, H2, Icon, Lead, List, P, Table, WikiLink } from "../kit";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SEASON_CLOCK = { epochMs: RULES.seasonEpochMs };

/** The Season Final as the Live card publishes it (season 1): trip per division, purse, rating floor. */
function seasonFinals() {
  const finals = gc.featureCalendar(SEASON_CLOCK, 1).filter((r) => r.kind === "season_final");
  return finals.map((f) => {
    const card = defaultCardSlot(Math.floor((f.postTimeMs - RULES.seasonEpochMs) / RULES.slotMs));
    return { division: f.division!, distanceM: f.distanceM, surface: f.surface, purse: card.purse ?? 0, minRating: card.conditions.minRating, runners: card.maxRunners, utc: new Date(card.postTime).toISOString().slice(11, 16) };
  });
}

/** A real week's score through the League's own weekScore: a busy stable's runs, only the best count. */
function busyWeek() {
  const places = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const runs = Array.from({ length: gc.BEST_RUNS_COUNTED + 10 }, (_, i) => ({ position: places[(i * 7) % places.length]!, fieldSize: 10, raceClass: "novice" }));
  const all = runs.reduce((a, r) => a + runPoints(r), 0);
  return { runs: runs.length, all, scored: weekScore(runs).points };
}

export default function LeaguePage() {
  const finals = seasonFinals();
  const positions = [1, 2, 3, 4, 5, 6, 7];
  const field = 10;
  const tiers = gc.LEAGUE_TIERS;
  const floorTiers = tiers.slice(0, tiers.indexOf(gc.RELEGATION_FROM_TIER));
  const busy = busyWeek();
  const plateMinutes = PLATE_AFTER_SLOTS * (RULES.slotMs / 60_000);
  const weekend = gc.featureCalendar(SEASON_CLOCK, 1).find((r) => r.kind === "weekend_feature")!;
  const weekendBand = defaultCardSlot(Math.floor((weekend.postTimeMs - RULES.seasonEpochMs) / RULES.slotMs)).conditions.minRating;
  return (
    <>
      <Lead>
        The League is where your stable competes with other owners. Every week you race in a league of up to {gc.LEAGUE_SIZE} stables, scoring points from your Live races. Finish near the top
        and you go up a tier; the weeks add up to a {gc.SEASON_DAYS}-day season that ends with the Season Final.
      </Lead>
      <Figure src="/art/diorama/poster-paddock.png" alt="The paddock at Kestrel Downs" caption="League tables are settled on the track: only Live races score." focus={0.4} />

      <H2 id="weekly">Weekly leagues</H2>
      <P>
        You join this week&rsquo;s league the first time you enter a Live race in it. New stables start in {cap(tiers[0]!)}. Each week runs from Monday 00:00 UTC to the next Monday, and the
        table on the <GameLink href="/league">League</GameLink> page shows where you stand, with a countdown to the end of the week.
      </P>
      <Table
        head={["Tier", "Name"]}
        rows={tiers.map((t, i) => [
          <span key={t} className="inline-flex items-center gap-2">
            <Icon name={t === "bronze" ? "badge-bronze" : t === "silver" ? "badge-silver" : "badge-gold"} size={32} /> {i + 1}
          </span>,
          `${cap(t)} League`,
        ])}
      />

      <H2 id="points">Points</H2>
      <P>
        Every settled Live race you run in scores points for your stable: {gc.START_POINT} for taking part, plus points for finishing in the first {gc.RACE_POINTS.length} when the field has at
        least 4 runners. Placing in the top three of a Listed or Group race scores extra. Story races and the Daily Cup don&rsquo;t score.
      </P>
      <Table
        head={["Finish", "Maiden, Novice or Handicap", "Listed", "Group"]}
        rows={positions.map((p) => [`${p}${["st", "nd", "rd"][p - 1] ?? "th"}`, runPoints({ position: p, fieldSize: field, raceClass: "novice" }), runPoints({ position: p, fieldSize: field, raceClass: "listed" }), runPoints({ position: p, fieldSize: field, raceClass: "graded" })])}
        caption={`Points in a ${field}-runner Live race. In a field of 3 or fewer, every runner scores ${runPoints({ position: 1, fieldSize: 3, raceClass: "novice" })}.`}
      />
      <P>
        Only a stable&rsquo;s <b>best {gc.BEST_RUNS_COUNTED} runs</b> of the week count, so a bad race never costs you points and extra entries add little. On top of that a stable can score
        at most <b>{gc.WEEKLY_RACE_POINTS_CAP} points a week</b>, so racing more can&rsquo;t buy a league on its own. Ties are split by wins, then best finish.
      </P>
      <P>
        For example, a stable that ran {busy.runs} times in a week in 10-runner Novice races, finishing everywhere from 1st to 10th, earned {busy.all} points in all. Its week scores{" "}
        {busy.scored}: the points of its best {gc.BEST_RUNS_COUNTED} runs.
      </P>

      <H2 id="promotion">Promotion and relegation</H2>
      <P>When the week ends, the table is settled:</P>
      <List
        items={[
          <>
            The top <b>{gc.PROMOTE}</b> (with at least one point) go up a tier. In the {cap(tiers[tiers.length - 1]!)} League there is nowhere higher to go.
          </>,
          <>
            From the {cap(gc.RELEGATION_FROM_TIER)} League up, the bottom <b>{gc.RELEGATE}</b> of the stables that raced go down a tier, as long as more than {gc.PROMOTE + gc.RELEGATE}{" "}
            stables raced.
          </>,
          <>
            {floorTiers.map(cap).join(" and ")} {floorTiers.length === 1 ? "is a floor" : "are floors"}: nobody is relegated from {floorTiers.length === 1 ? "it" : "them"}, so a new
            stable can learn the game without dropping.
          </>,
          <>A stable that didn&rsquo;t race that week never goes down. Being away is never punished.</>,
          <>Next week you start in your new tier.</>,
        ]}
      />
      <P>
        Every stable that raced gets a <b>week recap</b> in its inbox when the week is settled: where it finished, whether it went up or down, and how many points short of the promotion
        places it was. During the week, <GameLink href="/week">This week</GameLink> shows the same gap live.
      </P>
      <Facts
        rows={[
          ["Stables per league", `up to ${gc.LEAGUE_SIZE}`],
          ["Tiers", tiers.length],
          ["Promoted each week", gc.PROMOTE],
          ["Relegated each week", `${gc.RELEGATE}, from ${cap(gc.RELEGATION_FROM_TIER)} up`],
          ["Runs that count each week", `best ${gc.BEST_RUNS_COUNTED}`],
          ["Points cap per week", gc.WEEKLY_RACE_POINTS_CAP],
          ["Season length", `${gc.SEASON_DAYS} days`],
        ]}
      />
      <Callout tone="tip">
        <p>
          The cap rewards good races over many races. A few well-placed runners in races that suit them beat a stable that throws every horse at every race, and they keep your horses sound.
        </p>
      </Callout>

      <H2 id="season">The season</H2>
      <P>
        A season lasts {gc.SEASON_DAYS} days ({gc.SEASON_DAYS / 7} weeks). The season table adds up each stable&rsquo;s weekly scores, each counted the same way, and the stable on top when the season
        ends is inducted into the Hall of Fame as that season&rsquo;s champion owner. Seasons are only for competition: horses never age with them.
      </P>
      <H2 id="road-to-saturday">The road to Saturday</H2>
      <P>
        Through the season the calendar has its big days: a Feature Qualifier every weekday and a Group 1 Weekend Feature every Saturday. Saturday&rsquo;s trip and surface are known
        from Monday, with the likely going from the weather outlook, so you can pick the horse for it early. A top-3 finish in any of that week&rsquo;s Qualifiers gets a horse in, and so does an official rating of 100 or more; the race is still for
        horses rated {weekendBand}+.
      </P>
      <P>
        A horse that ran in a Qualifier and missed out isn&rsquo;t done: the <b>Saturday Plate</b>, a Listed race over the same trip worth {formatCredits(CALENDAR_PURSE.feature_qualifier)}{" "}
        credits, goes off {plateMinutes} minutes after the Weekend Feature and is only for those horses. Both races score League points like any Live race, with the bonus for a top three
        in a Listed or Group race.
      </P>
      <P>
        <GameLink href="/week">This week</GameLink>, under Racing (and the Road to Saturday tile on the Estate), puts it together: the Weekend Feature, the Qualifiers with your
        runners&rsquo; places, each horse&rsquo;s status (in, Plate or not yet) and how well it suits Saturday, and your League gap to promotion. Times and purses are on{" "}
        <WikiLink slug="race-types" />, and the next big days are also listed on the League page.
      </P>

      <H2 id="season-final">The Season Final</H2>
      <P>
        The last day of every season belongs to the Season Final: one championship for each distance division, each worth {formatCredits(finals[0]!.purse)} credits. They are Group races for
        horses rated {finals[0]!.minRating}+, need a {gc.licenceDef(gc.licenceForTier("g1", "final")).name} and cost {entryCostFor("final", "graded")} stable entries.
      </P>
      <Table
        head={["Championship", "Trip", "Surface", "Off (UTC)", "Runners"]}
        rows={finals.map((f) => [`${cap(f.division)} Championship`, formatDistance(f.distanceM), cap(f.surface), f.utc, `up to ${f.runners}`])}
      />
      <P>
        Winning one earns the &ldquo;Season Champion&rdquo; plaque in your Trophy Room, a gold cup, and a place in the Hall of Fame for the horse. See <WikiLink slug="hall-and-trophies" />.
      </P>
      <Callout tone="rule">
        <p>League and season rewards are honours, not credits: titles, plaques and Hall of Fame places. Prize money comes from the races themselves.</p>
      </Callout>
    </>
  );
}
