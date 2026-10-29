import * as gc from "@thoroughbred/game-core";
import { formatDistance } from "@/lib/format";
import { Callout, Facts, Figure, GameLink, H2, H3, Lead, List, Meter, P, Table, WikiLink, pct } from "../kit";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FEED_TEXT: Record<gc.Feed, [string, string]> = {
  growth_mix: ["Growth mix", "Foals, weanlings and yearlings"],
  performance: ["Performance", "Horses in work and racing"],
  recovery: ["Recovery", "Tired or injured horses"],
  maintenance: ["Maintenance", "A safe all-rounder; the right feed at stud"],
};

/** Real horses from game-core: a racing-age starter and a newborn foal of the same genes. */
function samples() {
  const [racer] = gc.createStarterStable({ ownerId: "wiki", seed: "wiki-care", nowMs: 0, season: 1 });
  const foal = gc.createHorseState({ id: "wiki-foal", name: "Foal", sex: "filly", ownerId: "wiki", sireId: null, damId: null, generation: 1, genome: racer!.genome, bornAtMs: 0, bornSeason: 1 });
  return { racer: racer!, foal };
}

export default function CareAndConditionPage() {
  const { racer, foal } = samples();
  const fullRecoveryH = Math.ceil(1000 / gc.FATIGUE_RECOVERY_PER_HOUR);
  const bestCareBonus = gc.careBonus({ care: { sessions: 0, lastCareDay: null, quality: 1000 } });
  const fatigueRows = [0, gc.TIRED_THRESHOLD, 500, 800, 1000].map((f) => [
    f === 0 ? "Fresh (0%)" : `${f / 10}%`,
    gc.tiredPenalty(f) === 0 ? "none" : `−${pct(gc.tiredPenalty(f), 1)}`,
    f <= gc.TIRED_THRESHOLD ? "–" : `${Math.ceil((f - gc.TIRED_THRESHOLD) / gc.FATIGUE_RECOVERY_PER_HOUR)} h`,
  ]);
  const peakDays = Array.from({ length: 9 }, (_, d) => ({ d, bonus: gc.freshnessBonus(0, d * DAY) }));
  const raceTired = [1200, 2000, 2800].map((m) => ({ m, f: gc.raceFatigue(racer, m) }));
  const unfit = gc.fitnessFactor(0);
  const fit = gc.fitnessFactor(1000);
  const startFitness = racer.condition.fitness;
  const runs = (positions: number[]) => positions.map((position, i) => ({ atMs: i, position, fieldSize: 10, raceId: `r${i}` }));
  const moraleRows: [string, number][] = [
    ["Never raced, no bond yet", gc.morale({ recentRuns: [], condition: racer.condition })],
    ["Won, 2nd, 3rd in its last three", gc.morale({ recentRuns: runs([1, 2, 3]), condition: racer.condition })],
    ["8th, 9th, 7th of 10 in its last three", gc.morale({ recentRuns: runs([8, 9, 7]), condition: racer.condition })],
    ["Same poor runs, full bond", gc.morale({ recentRuns: runs([8, 9, 7]), condition: { ...racer.condition, bond: 1000 } })],
  ];
  return (
    <>
      <Lead>
        Care is the one thing to do for every horse every day. It grows your youngsters, builds bond and speeds healing. Condition is how ready a horse is to race today: how fresh it is,
        how fit, and how it feels about its recent runs.
      </Lead>
      <Figure src="/art/diorama/poster-barn.png" alt="Horses in their stalls in the barn" caption="Feed, groom and turnout, once a day." focus={0.55} />

      <H2 id="daily-care">Daily care</H2>
      <P>
        Open a horse&rsquo;s <b>Care</b> tab, choose a feed, and tap <b>Care for</b> the horse. One session per horse counts each day (your local day, the same one your goals use). Caring
        again the same day changes nothing, and missing a day only pauses growth; it never harms the horse.
      </P>
      <List
        items={[
          <>
            <b>Youngsters grow.</b> Each counted session moves a foal one step towards racing age ({gc.CARE_TO_RACING} in all). See <WikiLink slug="growing-up" />.
          </>,
          <>
            <b>Bond grows</b> with every session, and bond lifts morale.
          </>,
          <>
            <b>Injuries heal faster:</b> each session takes {gc.CARE_HEAL_BONUS_H} hours off the recovery. See <WikiLink slug="injuries-and-insurance" />.
          </>,
          <>
            <b>Care quality</b> builds up from the feeds you choose. Top-quality care adds up to {pct(bestCareBonus)} to every stat&rsquo;s training realisation, so the horse shows a little more of its potential. See{" "}
            <WikiLink slug="training" />.
          </>,
          <>
            Caring for a horse completes one of <b>today&rsquo;s goals</b> ({gc.DAILY_GOAL_CREDITS} credits).
          </>,
        ]}
      />

      <H2 id="feeds">Feeds</H2>
      <P>
        There are {gc.FEEDS.length} feeds. The game marks the one that suits the horse right now. The right feed gives a perfect session; Maintenance is a safe middle choice; anything
        else is a poor one. Care quality is a running average, so one wrong feed only dents it.
      </P>
      <Table
        head={["Feed", "Suits", "Session quality: a racehorse", "Session quality: a foal"]}
        rows={gc.FEEDS.map((f) => [FEED_TEXT[f][0], FEED_TEXT[f][1], pct(gc.careQualityFor(racer, f, 0)), pct(gc.careQualityFor(foal, f, 0))])}
        caption="Worked out by the game's own care rules for a real starter and a newborn foal."
      />
      <Callout tone="tip">
        <p>
          A tired or injured horse wants <b>Recovery</b>, even in the middle of a racing career. Look for the tick next to the feed that suits it.
        </p>
      </Callout>

      <H2 id="fatigue">Fatigue and freshness</H2>
      <P>
        Racing and hard training make a horse tired. Fatigue goes down by <b>{gc.FATIGUE_RECOVERY_PER_HOUR}</b> points (out of 1000) every hour in real time, whether you are playing or not,
        so even an exhausted horse is fully rested after about {fullRecoveryH} hours. Above <b>{gc.TIRED_THRESHOLD / 10}%</b> fatigue a horse counts as tired: it races below its best and
        its injury risk rises.
      </P>
      <Table head={["Fatigue", "Racing penalty (speed, stamina, burst)", "Time until no longer tired"]} rows={fatigueRows} />
      <P>
        A race tires a horse more the longer the trip, and less if it is a sound, durable type. For a real starter:{" "}
        {raceTired.map((r, i) => (
          <span key={r.m}>
            {formatDistance(r.m)} adds {r.f / 10}%{i < raceTired.length - 1 ? ", " : "."}
          </span>
        ))}
      </P>
      <H3>The freshness peak</H3>
      <P>
        Hard work does more than tire a horse: it sets up a <b>freshness peak</b>. Nothing shows for two days; then the horse comes to its peak, worth up to +{pct(gc.FRESHNESS_PEAK_BONUS, 1)}{" "}
        on speed, stamina and burst, and it fades away after that. The Care tab tells you when the peak is building and when it is on.
      </P>
      <div className="grid gap-2">
        {peakDays.map((p) => (
          <Meter key={p.d} label={`Day ${p.d} after hard work`} value={p.bonus} max={gc.FRESHNESS_PEAK_BONUS} suffix={<span className="caption"> ({pct(p.bonus, 1)})</span>} />
        ))}
        <p className="caption">Freshness bonus by day, from the game&rsquo;s own freshness curve.</p>
      </div>

      <H2 id="fitness">Fitness</H2>
      <P>
        Fitness goes up with every training session that builds it and with every race. A completely unfit horse races at {pct(unfit)} of its speed, stamina and burst; a fully fit one at{" "}
        {pct(fit)}. A new horse starts at {startFitness / 10}% fitness. Fitness never drops while you are away.
      </P>
      <Table
        head={["Workout", "Fitness gained"]}
        rows={(Object.keys(gc.WORKOUTS) as gc.Workout[]).filter((w) => gc.WORKOUTS[w].fitness > 0).map((w) => [gc.WORKOUTS[w].label, `+${gc.WORKOUTS[w].fitness / 10}%`])}
      />

      <H2 id="bond-morale">Bond and morale</H2>
      <P>
        <b>Bond</b> (0 to 100%) is how well the horse knows you. It grows with care, training and racing, and it never fades. <b>Morale</b> runs from −100 to +100: wins and places in the
        last five runs lift it, finishing in the back half of the field dents it, and bond adds a steady cushion. On race day morale is worth up to ±{pct(gc.moraleEffect(100), 1)} on
        speed, stamina and burst, and it also steadies (or unsettles) the horse&rsquo;s temperament.
      </P>
      <Table head={["Recent form", "Morale"]} rows={moraleRows.map(([k, v]) => [k, v > 0 ? `+${v}` : v < 0 ? `−${-v}` : v])} caption="Real morale values from the game's rules." />
      <Facts
        rows={[
          ["Counted care sessions per horse per day", 1],
          ["Healing from a care session", `${gc.CARE_HEAL_BONUS_H} h`],
          ["Fatigue recovered per hour", gc.FATIGUE_RECOVERY_PER_HOUR],
          ["Tired above", `${gc.TIRED_THRESHOLD / 10}% fatigue`],
          ["Largest tiredness penalty", pct(gc.TIRED_MAX_PENALTY)],
          ["Freshness peak bonus", pct(gc.FRESHNESS_PEAK_BONUS, 1)],
          ["Unfit to fully fit", `${pct(unfit)} to ${pct(fit)}`],
          ["Morale effect, at most", `±${pct(gc.moraleEffect(100), 1)}`],
        ]}
      />
      <Callout tone="rule" title="Time only helps">
        <p>
          Fatigue recovers and injuries heal in real time. Nothing else changes while you are away: fitness, bond and morale stay where they were. Find the Care tab on any horse from{" "}
          <GameLink href="/stable">your stable</GameLink>.
        </p>
      </Callout>
      <P>
        Next: <WikiLink slug="training" />.
      </P>
    </>
  );
}
