import * as gc from "@thoroughbred/game-core";
import { simulateRace } from "@thoroughbred/racing-engine";
import { formatRaceTime, type RunningStyle } from "@thoroughbred/shared";
import { STYLE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import { Callout, Facts, Figure, GameLink, H2, HorseCard, Lead, List, P, Steps, Table, WikiLink, appearanceOfGenome, count, sampleGenome } from "../kit";

const BADGE_TEXT: Record<gc.CupStanding["badge"], string> = { gold: "Gold", silver: "Silver", bronze: "Bronze", top10: "Top 10%", finisher: "Finisher" };
const WIKI_SILKS = { pattern: "hoops", primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#1f4e9c" } as const;

/** A real example Cup (an example day's seed) with one real horse run through it on each tactic. */
function exampleCup() {
  const cup = gc.dailyCupDay("wiki-example-cup", 20_400);
  const genome = sampleGenome("cup-entrant-3");
  const state = gc.createHorseState({ id: "wiki-cup", name: "Wiki Runner", sex: "filly", ownerId: "wiki", sireId: null, damId: null, generation: 0, genome, bornAtMs: 0, bornSeason: 1, careSessions: gc.CARE_TO_RACING });
  const natural = gc.runningStyle(genome) as RunningStyle;
  const runs = (["front", "stalker", "closer"] as RunningStyle[]).map((tactic) => {
    const entrant = gc.raceSnapshot(state, {
      nowMs: 0,
      silks: WIKI_SILKS as Parameters<typeof gc.raceSnapshot>[1]["silks"],
      race: { going: cup.going, fieldSize: gc.CUP_FIELD_SIZE + 1, bigCrowd: false, surface: cup.surface, distanceM: cup.distanceM },
      plan: { tactic, intensity: "normal" },
    }).horse;
    const run = gc.runDailyCup(cup, entrant, tactic, simulateRace);
    const again = gc.runDailyCup(cup, entrant, tactic, simulateRace);
    return { tactic, run, same: again.finishTimeUs === run.finishTimeUs };
  });
  return { cup, genome, natural, runs };
}

/** Which ranks earn which badge on a board of `n` runs (game-core rankCup). */
/** Cup points (game-core rankCup) for the best and worst run of a day, and the bonus for beating the whole Club field. */
function cupPointsScale() {
  const board = (position: number) => gc.rankCup(Array.from({ length: 1001 }, (_, i) => ({ ownerId: `o${i}`, horseId: `h${i}`, finishTimeUs: 90_000_000 + i * 1000, position, enteredAtMs: i })));
  const placed = board(2);
  const won = board(1);
  return { top: placed[0]!.cupPoints, bottom: placed[placed.length - 1]!.cupPoints, bonus: won[0]!.cupPoints - placed[0]!.cupPoints };
}

function badgeBands(n: number) {
  const board = gc.rankCup(Array.from({ length: n }, (_, i) => ({ ownerId: `o${String(i).padStart(4, "0")}`, horseId: `h${i}`, finishTimeUs: 90_000_000 + i * 1000, position: 1, enteredAtMs: i })));
  const out: { badge: gc.CupStanding["badge"]; from: number; to: number }[] = [];
  for (const s of board) {
    const last = out[out.length - 1];
    if (last && last.badge === s.badge) last.to = s.rank;
    else out.push({ badge: s.badge, from: s.rank, to: s.rank });
  }
  return out;
}

export default function DailyCupPage() {
  const ex = exampleCup();
  const n = 200;
  const bands = badgeBands(n);
  const points = cupPointsScale();
  const cupPlaques = gc.ACHIEVEMENTS.filter((a) => a.id === "cup_regular" || a.id === "cup_top10");
  return (
    <>
      <Lead>
        The Daily Cup is one race a day that everyone runs on equal terms. Each stable gets one <b>Cup Run</b> a day with any horse it likes, against the same Club field, in the same conditions,
        with the same luck. The fastest time wins. It is free, it pays a few credits for taking part, and it never tires your horse.
      </Lead>
      <Figure src="/art/diorama/poster-track-dusk.png" alt="The track at dusk" caption="One field, one seed, one day: a time trial against the same rivals." focus={0.35} />

      <H2 id="how-it-works">How it works</H2>
      <Steps
        items={[
          <>
            Open the <GameLink href="/cup">Daily Cup</GameLink>. Today&rsquo;s conditions (trip, surface, going, weather) and the field of {gc.CUP_FIELD_SIZE} Club horses are the same for
            everyone.
          </>,
          <>Choose your runner. The list shows how well today&rsquo;s trip and ground suit each of your horses, and marks its natural style with a star.</>,
          <>
            Choose a tactic and run. Your horse always starts from gate {gc.CUP_ENTRANT_GATE} on a normal ride, and the result is shown straight away.
          </>,
          <>Your time goes on today&rsquo;s board. Your rank can change as more stables run; the board is final when the Cup closes at midnight UTC.</>,
        ]}
      />
      <List
        items={[
          <>One run per stable per day, with any one horse. It must be of racing age, still racing and not injured.</>,
          <>
            The Cup isn&rsquo;t a career start: it doesn&rsquo;t move the career clock, isn&rsquo;t rated, and doesn&rsquo;t count towards a horse&rsquo;s races for the day
            ({count(gc.MAX_LIVE_STARTS_PER_DAY, "Live race")}, {gc.MAX_STARTS_PER_DAY} in all), so a horse can run the Cup and a race on the same day.
          </>,
          <>Your horse comes back exactly as it went out: no fatigue, no injury risk.</>,
          <>It is free: no stable entries, no fee.</>,
        ]}
      />
      <Facts
        rows={[
          ["Cup Runs per stable per day", 1],
          ["Club horses in the field", gc.CUP_FIELD_SIZE],
          ["Your gate", gc.CUP_ENTRANT_GATE],
          ["Credits for taking part", formatCredits(gc.CUP_PARTICIPATION_CREDITS)],
          ["Cost", "free"],
          ["Open for", "24 hours, UTC midnight to midnight"],
        ]}
      />

      <H2 id="example">An example Cup</H2>
      <P>
        This example Cup was built from an example day&rsquo;s seed by the game&rsquo;s own rules: {formatDistance(ex.cup.distanceM)} on {ex.cup.surface}, {ex.cup.going} going. One real horse
        was run through it once on each tactic.
      </P>
      <div className="flex flex-wrap items-start gap-4">
        <HorseCard appearance={appearanceOfGenome(ex.genome)} name="Wiki Runner" line={`A natural ${STYLE_LABEL[ex.natural].toLowerCase()}`} size="sm" />
        <div className="min-w-0 flex-1">
          <Table
            head={["Tactic", "Time", "Finished", "Same time when run again"]}
            rows={ex.runs.map((r) => [
              `${STYLE_LABEL[r.tactic]}${r.tactic === ex.natural ? " (natural)" : ""}`,
              formatRaceTime(r.run.finishTimeUs),
              `${r.run.position} of ${gc.CUP_FIELD_SIZE + 1}`,
              r.same ? "Yes" : "No",
            ])}
          />
        </div>
      </div>
      <P>
        Because everyone meets the same field with the same seed, the only things that differ are your horse and your tactic. Run the same horse the same way and you get the same time to the
        hundredth.
      </P>
      <Callout tone="tip">
        <p>
          You only get one run, so read the conditions first. Pick the horse whose trip and surface fit today&rsquo;s Cup best, not just your highest-rated one, and try the tactic that suits the
          field: a field full of front-runners can fold for a closer.
        </p>
      </Callout>

      <H2 id="board">The board and badges</H2>
      <P>
        Runs are ranked by finish time; a tie goes to the better position against the Club field, then to whoever ran first. Your standing earns a badge. On a day with {n} runs, for example:
      </P>
      <Table head={["Rank", "Badge"]} rows={bands.map((b) => [b.from === b.to ? `${b.from}` : `${b.from}–${b.to}`, BADGE_TEXT[b.badge]])} />
      <P>
        Badges and ranks are for honour only. Every run pays the same {formatCredits(gc.CUP_PARTICIPATION_CREDITS)} credits, and two Trophy Room plaques come from the Cup:{" "}
        {cupPlaques.map((a, i) => (
          <span key={a.id}>
            {i > 0 ? "; " : ""}&ldquo;{a.title}&rdquo;: {a.description.replace(/\.$/, "")}
          </span>
        ))}
        . See <WikiLink slug="hall-and-trophies" />.
      </P>
      <P>
        Each run also earns <b>Cup points</b> from where it finished on the day&rsquo;s board: {points.top} for the fastest, falling with rank to {points.bottom} for the slowest, plus{" "}
        {points.bonus} for a horse that beat the whole Club field. They depend on everyone&rsquo;s runs, so they are worked out once the day is over, when the board is final.
      </P>

      <H2 id="sealed">Sealed for the day</H2>
      <P>
        The Cup&rsquo;s seed is fixed when the Cup opens, and only its fingerprint is shown while it is open, so nobody can rehearse the race in advance. You can watch the replay of your own run
        straight away. After the Cup closes, the seed is revealed with yesterday&rsquo;s winner, so anyone can check the day&rsquo;s races. How sealing works is on{" "}
        <WikiLink slug="how-races-are-run" />.
      </P>
    </>
  );
}
