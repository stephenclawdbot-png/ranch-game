import * as gc from "@thoroughbred/game-core";
import { Callout, Facts, Figure, H2, H3, Lead, List, P, Steps, Table, WikiLink, pct } from "../kit";

const STAT_LABEL: Record<gc.StatKey, string> = { speed: "Speed", stamina: "Stamina", burst: "Burst", durability: "Durability", adaptability: "Adaptability", temperament: "Temperament" };
const NOW = 30 * 24 * 3_600_000;

const gainText = (g: Partial<Record<gc.StatKey, number>>) =>
  (Object.entries(g) as [gc.StatKey, number][])
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `+${pct(v, 1)} ${STAT_LABEL[k]}`)
    .join(", ") || "–";

/** A real starter, previewed by game-core's previewTraining at different levels of tiredness. */
function board() {
  const [horse] = gc.createStarterStable({ ownerId: "wiki", seed: "wiki-training", nowMs: 0, season: 1 });
  const h = horse!;
  const ctx = { nowMs: NOW, trainerLevel: 0, vetLevel: 0, credits: 100_000 };
  const at = (fatigue: number) => gc.withFatigue(h, fatigue, NOW, false);
  // Where the rules change, found by asking previewTraining itself.
  let overworkAbove = 1000;
  let knockAbove = 1000;
  for (let f = 1000; f >= 0; f--) {
    const p = gc.previewTraining(at(f), "speed_work", ctx);
    if (p.overworked) overworkAbove = f - 1;
    if (p.injuryPermille > 0) knockAbove = f - 1;
  }
  const levels = [0, knockAbove + 60, overworkAbove + 150].map((f) => ({ f, previews: (Object.keys(gc.WORKOUTS) as gc.Workout[]).map((w) => gc.previewTraining(at(f), w, ctx)) }));
  return { horse: h, overworkAbove, knockAbove, levels };
}

/** Diminishing returns: successive speed-work gains from a new horse's starting realisation. */
function curve(start: number) {
  const base = gc.WORKOUTS.speed_work.gains.speed!;
  const out: { n: number; r: number; gain: number }[] = [];
  let r = start;
  for (let n = 1; n <= 40 && r < 1000; n++) {
    const gain = gc.realisationGain(r, base);
    r = Math.min(1000, r + gain);
    out.push({ n, r, gain });
  }
  return out;
}

export default function TrainingPage() {
  const b = board();
  const start = b.horse.training.realisation.speed;
  const cv = curve(start);
  const to = (target: number) => cv.find((c) => c.r >= target)?.n;
  const fatigueWord = (f: number) => (f > b.overworkAbove ? "Overworked" : f > gc.TIRED_THRESHOLD ? "Tired" : "Fresh");
  const maxTrainer = gc.FACILITY_COSTS.trainer.length;
  return (
    <>
      <Lead>
        Training brings a horse closer to its genetic potential. Each horse has a weekly plan of {gc.BASE_SLOTS} sessions, and you run each one when you choose. Every workout is a
        trade-off: what it builds, how tired it leaves the horse, what it costs, and whether it risks a knock.
      </Lead>
      <Figure src="/art/scenes/gallops-morning.png" alt="Horses working up the gallops in the morning mist" caption="The gallops: one session at a time, never while you are away." focus={0.68} />

      <H2 id="plan">The weekly plan</H2>
      <Steps
        items={[
          <>
            Open a horse&rsquo;s <b>Training</b> tab. The plan has {gc.BASE_SLOTS} slots a week ({gc.slotsFor(1)} with a Trainer). Saving the plan is free.
          </>,
          <>Read the trade-off board: what the next session would do for each workout, before you spend anything.</>,
          <>Pick a workout for the slot and run it. Its credit cost is charged when the session runs.</>,
          <>A new week starts on Monday (UTC) with fresh sessions. Unused sessions don&rsquo;t carry over, and nothing runs or costs anything while you are away.</>,
        ]}
      />
      <Table
        head={["Workout", "Builds", "Fatigue", "Fitness", "Hard work", "Yearlings", "Cost"]}
        rows={(Object.keys(gc.WORKOUTS) as gc.Workout[]).map((w) => {
          const s = gc.WORKOUTS[w];
          const builds = (Object.keys(s.gains) as gc.StatKey[]).map((k) => STAT_LABEL[k]).join(", ") || "Recovery";
          return [s.label, builds, s.fatigue > 0 ? `+${s.fatigue / 10}%` : `${s.fatigue / 10}%`, s.fitness ? `+${s.fitness / 10}%` : "–", s.hard ? "Yes" : "No", s.light ? "Yes" : "No", s.cost ? `${s.cost} cr` : "free"];
        })}
      />
      <P>
        Hard work (speed work, stamina gallops, race prep) tires a horse most, but it also sets up the <b>freshness peak</b> three to five days later. See{" "}
        <WikiLink slug="care-and-condition" />.
      </P>

      <H2 id="realisation">Realisation: how training shows</H2>
      <P>
        Each stat has a <b>realisation</b>, shown as a percentage. A new horse starts at {pct(start)}. Realisation governs the top {pct(gc.TRAINING_WEIGHT_PERMILLE)} of the stat, so an
        untrained horse still shows {pct(gc.trainingFactor(start))} of its grown-up potential and a fully trained one shows all of it. Training can never take a stat past the horse&rsquo;s
        potential.
      </P>
      <P>
        Gains shrink as realisation rises: the closer to 100%, the less each session adds. For speed work on the speed stat, starting from {pct(start)}:
      </P>
      <Table
        head={["Session", "Gain", "Realisation after"]}
        rows={[...cv.slice(0, 5), ...(to(900) ? [cv[to(900)! - 1]!] : [])].map((c) => [c.n, `+${pct(c.gain, 1)}`, pct(c.r, 1)])}
        caption={`Worked out with the game's own curve. Reaching ${pct(900)} takes ${to(900) ?? "–"} sessions; the last few points take longest.`}
      />
      <P>
        Racing counts too: every start realises a little of every stat, adaptability and temperament most ({(Object.keys(gc.RACE_EXPERIENCE) as gc.StatKey[])
          .map((k) => `${STAT_LABEL[k]} ${pct(gc.RACE_EXPERIENCE[k], 1)}`)
          .join(", ")}{" "}
        at the start of a career). Good daily care adds a little on top: <WikiLink slug="care-and-condition" />.
      </P>

      <H2 id="board">The trade-off board</H2>
      <P>
        The board on the Training tab shows, for each workout, exactly what the next session would do. It is worked out by the same code that runs the session. Here it is for a real
        starter, fresh and then tired:
      </P>
      {b.levels.map((lv) => (
        <Table
          key={lv.f}
          caption={`${fatigueWord(lv.f)}: fatigue ${lv.f / 10}%`}
          head={["Workout", "Gain", "Fatigue after", "Knock risk", "Peak in 3-5 days"]}
          rows={lv.previews.map((p) => [
            gc.WORKOUTS[p.workout].label,
            gainText(p.gains) + (p.overworked ? " (tired: half)" : ""),
            `${p.fatigueAfter / 10}%`,
            p.injuryPermille > 0 ? pct(p.injuryPermille, 1) : "none",
            p.peak ? (p.peak.setsUp ? "Yes" : "Keeps pending") : "–",
          ])}
        />
      ))}

      <H2 id="overwork">Overwork</H2>
      <List
        items={[
          <>
            Above <b>{b.overworkAbove / 10}%</b> fatigue a horse is <b>overworked</b>: hard work gains only half.
          </>,
          <>
            Above <b>{Math.round(b.knockAbove / 10)}%</b> fatigue, hard work carries a chance of a training knock, rising to about {pct(gc.OVERWORK_INJURY_MAX_PERMILLE)} for an exhausted, average
            horse. Durable horses are at less risk, fragile ones at more.
          </>,
          <>
            A training knock is always a <b>minor</b> injury: a few days off, never career-ending and never fatal.
          </>,
          <>Light work (gate practice, swimming) and rest never risk a knock. Rest takes fatigue down.</>,
        ]}
      />
      <Callout tone="warn">
        <p>
          Two hard sessions back to back can tip a horse over. Watch the fatigue meter on the board: once it crosses the tired line, swap in swimming, gate practice or rest.
        </p>
      </Callout>

      <H2 id="who-trains">Who can train, and how well</H2>
      <Table
        head={["Horse", "Training"]}
        rows={[
          ["Foal or weanling", "Not yet"],
          ["Yearling", "Light work only (gate practice, swimming, rest), at half effect and with no knock risk"],
          ["Racing age", "Every workout"],
          ["At stud or retired", "No training"],
          ["Injured", "Rest only"],
        ]}
      />
      <P>
        A <b>Trainer</b> facility adds a weekly slot and makes every workout {pct(gc.TRAINER_EFFICIENCY_PER_LEVEL)} more effective per level, up to {maxTrainer} levels. See{" "}
        <WikiLink slug="facilities" />.
      </P>
      <Facts
        rows={[
          ["Sessions a week", `${gc.BASE_SLOTS} (${gc.slotsFor(1)} with a Trainer)`],
          ["Trainer: extra effect per level", pct(gc.TRAINER_EFFICIENCY_PER_LEVEL)],
          ["Starting realisation", pct(start)],
          ["Share of a stat set by training", pct(gc.TRAINING_WEIGHT_PERMILLE)],
          ["Overworked", `above ${b.overworkAbove / 10}% fatigue`],
          ["Knock risk", `above ${Math.round(b.knockAbove / 10)}% fatigue`],
          ["Highest knock risk", pct(gc.OVERWORK_INJURY_MAX_PERMILLE)],
        ]}
      />
      <H3>A simple routine</H3>
      <Callout tone="tip">
        <p>
          Train hard early in the week, keep the last slot light or rest, and race in the freshness peak three to five days after the hard work. Spend speed work on horses whose speed is
          still well short of 100% realisation; near the top it buys very little.
        </p>
      </Callout>
    </>
  );
}
