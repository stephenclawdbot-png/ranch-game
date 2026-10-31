import * as gc from "@thoroughbred/game-core";
import { simulateRace } from "@thoroughbred/racing-engine";
import { formatRaceTime, type RunningStyle } from "@thoroughbred/shared";
import { STYLE_LABEL, formatDistance } from "@/lib/format";
import { Callout, Facts, GameLink, H2, HorseCard, Lead, List, P, Steps, Table, WikiLink, count } from "../kit";

const GRADES = ["A", "B", "C", "D", "E"] as const;
const EXAMPLE_DAY = 20_400;
/** An example seed for the worked example (a real day's seed is drawn at random and sealed). */
const EXAMPLE_SEED = "5eed".repeat(16);

/** An example day's puzzle run with a few plans against one seed (game-core dailyChallengeSpec/Input). */
function exampleChallenge() {
  const spec = gc.dailyChallengeSpec(EXAMPLE_DAY);
  const course = gc.courseById(spec.conditions.courseId);
  const horse = gc.toSharedHorse(spec.horse, spec.opensAtMs, gc.DAILY_CHALLENGE_SILKS);
  const plans: gc.DailyChoice[] = [
    { tactic: "front", intensity: "normal", grade: "A" },
    { tactic: "stalker", intensity: "normal", grade: "C" },
    { tactic: "closer", intensity: "all_out", grade: "E" },
  ];
  const runs = plans.map((p) => {
    const r = simulateRace(gc.dailyChallengeInput(spec, p, EXAMPLE_SEED));
    const again = simulateRace(gc.dailyChallengeInput(spec, p, EXAMPLE_SEED));
    const f = r.result.finishOrder.find((x) => x.horseId === gc.dailyHorseId(EXAMPLE_DAY))!;
    return { p, position: f.position, timeUs: f.finishTimeUs, same: again.result.resultHash === r.result.resultHash };
  });
  return { spec, course, horse, runs };
}

const INTENSITY: Record<gc.QuickIntensity, string> = { conservative: "steady", normal: "normal", all_out: "all out" };

export default function QuickRacesPage() {
  const ex = exampleChallenge();
  const trips = gc.QUICK_TRIPS;
  const natural = gc.runningStyle(ex.spec.horse.genome) as RunningStyle;
  return (
    <>
      <Lead>
        Quick races are races you can run in a two-minute visit: a <b>match race</b> against another stable&rsquo;s horse, a <b>ghost race</b> against the best of a real race, and the{" "}
        <b>daily challenge</b>, one puzzle a day for everyone. They run straight away, play in the race viewer, and are always unofficial: careers, Live races and the Cup stay the main game.
      </Lead>

      <H2 id="unofficial">Unofficial, every time</H2>
      <P>Quick races use the same race engine, courses and race model as a Live race of today, but nothing they do touches the rest of the game:</P>
      <List
        items={[
          <>No rating change, no form line, no record: a quick race is never a start and never on the form book.</>,
          <>No fatigue, no injury risk and no growth: your horse comes back exactly as it went out.</>,
          <>No credits, entries or fees; nothing on the ledger. No league points, jockey rides or experience, tote or picks.</>,
          <>The replay plays with a badge on the stage (MATCH RACE · UNOFFICIAL, GHOST RACE or DAILY CHALLENGE), the race call and the battle graphic, but no finale or prize-giving.</>,
        ]}
      />

      <H2 id="match">Match races</H2>
      <Steps
        items={[
          <>
            Open <GameLink href="/quick?tab=match">Quick races</GameLink> and pick one of your racing horses. To choose a rival, tap <b>Challenge</b> on a horse&rsquo;s page, a runner on a
            racecard or a stable&rsquo;s page, or search by horse or stable name.
          </>,
          <>
            Race one-on-one, or pick up to {gc.MATCH_FIELD_MAX - 1} rivals for a field of {gc.MATCH_FIELD_MAX}. Any other stable&rsquo;s racing horse can be challenged; the owner doesn&rsquo;t need
            to be online.
          </>,
          <>
            Choose the course, the surface (one that course races on), the trip ({formatDistance(trips[0]!)} to {formatDistance(trips[trips.length - 1]!)}) and the going, and your horse&rsquo;s
            tactic. The all-weather always rides good.
          </>,
          <>The race runs at once with fresh luck (a new random seed each time) and opens in the viewer.</>,
        ]}
      />
      <P>
        Every horse runs as it is today: its current fitness and form, a normal ride, a typical {gc.QUICK_DEFAULT_GRADE}-grade Club rider. Rivals run their natural style. If a rival beats your
        horse, its owner gets one quiet line a day (&ldquo;Copper Comet beat Paper Moon in a match race&rdquo;). Each pair of horses keeps a <b>match record</b>, shown on the result and the
        horse&rsquo;s page, separate from the official head-to-heads.
      </P>

      <H2 id="ghost">Ghost races</H2>
      <P>
        A ghost race asks &ldquo;would my horse have been placed?&rdquo;. Pick one of your horses and a settled Live race from yesterday or today (UTC): your horse races the first {gc.GHOST_TOP} home
        exactly as they ran in that field (their fitness, weights, tactics and riders on the day), on that race&rsquo;s course, trip and going, with fresh luck. The result reads as &ldquo;You&rsquo;d
        have finished 2nd&rdquo;. If your horse ran in that race, the ghosts are the first {gc.GHOST_TOP} others. The real result stands.
      </P>

      <H2 id="daily">The daily challenge</H2>
      <P>
        One puzzle a day, published at 00:00 UTC and the same for everyone: a Club horse, a field of {gc.DAILY_CHALLENGE_FIELD} and the conditions. You don&rsquo;t pick the horse: you pick only
        three things, then ride.
      </P>
      <List
        items={[
          <>The tactic: front-runner, stalker or closer.</>,
          <>The ride: steady (saves stamina), normal, or all out (more burst, a hotter head).</>,
          <>
            The rider grade, A to E. A better rider costs weight: the horse carries {gc.DAILY_TOP_WEIGHT_LB} lb less its rider&rsquo;s claim, so{" "}
            {GRADES.map((g) => `${g} ${gc.dailyWeightLb(g)} lb`).join(", ")}. Each pound costs about one rating point.
          </>,
        ]}
      />
      <P>
        One attempt per stable per day. Every attempt that day runs with the <b>same seed</b>, so the same plan always gives the same result: the only difference between players is the plan.
      </P>

      <H2 id="example">An example day</H2>
      <P>
        This example was built from an example day by the game&rsquo;s own rules: {ex.spec.horse.name} at {ex.course.name}, {formatDistance(ex.spec.conditions.distanceM)} on{" "}
        {ex.spec.conditions.surface}, {ex.spec.conditions.going} going, from gate {ex.spec.gate}, against {count(ex.spec.rivals.length, "Club rival")}. Three plans, one example seed:
      </P>
      <div className="flex flex-wrap items-start gap-4">
        <HorseCard appearance={ex.horse.appearance} name={ex.spec.horse.name} line={`A natural ${STYLE_LABEL[natural].toLowerCase()}`} size="sm" />
        <div className="min-w-0 flex-1">
          <Table
            head={["Plan", "Finished", "Time", "Same again"]}
            rows={ex.runs.map((r) => [`${STYLE_LABEL[r.p.tactic]}, ${INTENSITY[r.p.intensity]}, ${r.p.grade} rider`, `${r.position} of ${gc.DAILY_CHALLENGE_FIELD}`, formatRaceTime(r.timeUs), r.same ? "Yes" : "No"])}
          />
        </div>
      </div>

      <H2 id="board">Board, points, streaks and badges</H2>
      <P>
        The day&rsquo;s board ranks attempts by finishing position, then time, then who rode first. Points come from the finishing position:{" "}
        {gc.DAILY_POINTS.map((p, i) => `${p} for ${["a win", "2nd", "3rd", "4th"][i] ?? `${i + 1}th`}`).join(", ")}, and {gc.DAILY_POINTS_TAKING_PART} for taking part. The best{" "}
        {gc.DAILY_TOP_SHARE_PERMILLE / 10}% of the day (always at least the leader) earn a <b>Top 10% badge</b> once the day is over. A <b>streak</b> counts days in a row with an attempt; it
        isn&rsquo;t lost until a whole UTC day passes without one, and missing a day costs nothing else.
      </P>
      <Callout tone="rule">
        <p>No credits: the daily challenge is for points, streaks and badges only.</p>
      </Callout>

      <H2 id="fair">Fair play: the sealed seed</H2>
      <P>
        The day&rsquo;s luck is a random seed drawn when the challenge is published. Only its fingerprint (a SHA-256 hash) is shown during the day, so nobody can try plans offline; other
        stables&rsquo; plans and replays stay hidden until the day is over, too. The next day the seed is revealed next to its fingerprint, so anyone can check it, and every attempt can be replayed
        exactly. Sealed seeds are explained in <WikiLink slug="how-races-are-run" />.
      </P>

      <Facts
        rows={[
          ["Match races per stable per day", gc.MATCH_RACES_PER_DAY],
          ["Ghost races per stable per day", gc.GHOST_RACES_PER_DAY],
          ["Runners in a match race", `2 to ${gc.MATCH_FIELD_MAX}`],
          ["Ghosts in a ghost race", gc.GHOST_TOP],
          ["Ghost races offered for", `Live races from the last ${count(gc.GHOST_SOURCE_DAYS, "UTC day")}`],
          ["Daily challenge field", gc.DAILY_CHALLENGE_FIELD],
          ["Daily challenge attempts per stable", "1 a day"],
          ["Credits, fatigue, rating", "none"],
        ]}
      />
      <P>
        The Daily Cup is a different daily race: your own horse against a Club field for a time, see <WikiLink slug="daily-cup" />.
      </P>
    </>
  );
}
