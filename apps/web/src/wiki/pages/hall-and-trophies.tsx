import * as gc from "@thoroughbred/game-core";
import { HORSE_LENGTH_MM } from "@thoroughbred/shared";
import { trophyTier } from "@/server/competition";
import { Callout, Facts, Figure, GameLink, H2, Lead, List, P, Table, WikiLink, sampleGenome } from "../kit";

const CATEGORY: Record<gc.HallOfFameReason, string> = {
  champion: "Champion",
  season_winner: "Season winner",
  record_time: "Record holder",
  great_racehorse: "Great racehorse",
  foundation_sire: "Foundation sire",
  foundation_mare: "Foundation mare",
  elite_genetics: "Elite genetics",
};
const TIER_TEXT: Record<ReturnType<typeof trophyTier>, string> = { gold: "Gold cup", silver: "Silver cup", bronze: "Bronze cup", first: "Winner's rosette", second: "Second", third: "Third" };

const NO_HONOURS: gc.HorseHonours = { g1Wins: 0, gradedWins: 0, seasonFinalWins: 0, weekendFeatureWins: 0, recordTimes: 0, gradedWinnerOffspring: 0 };

/** The Hall of Fame thresholds, read off game-core's own criteria by probing them. */
function hallThresholds() {
  const born = gc.createHorseState({ id: "wiki-hall", name: "Probe", sex: "colt", ownerId: "wiki", sireId: null, damId: null, generation: 0, genome: sampleGenome("hall-probe"), bornAtMs: 0, bornSeason: 1, careSessions: gc.CARE_TO_RACING });
  const has = (reason: gc.HallOfFameReason, h: Partial<gc.HorseHonours>, patch: (s: gc.HorseState) => gc.HorseState = (s) => s) => gc.hallOfFameReasons(patch(born), { ...NO_HONOURS, ...h }).includes(reason);
  const least = (test: (n: number) => boolean, max = 200) => {
    for (let n = 0; n <= max; n++) if (test(n)) return n;
    return null;
  };
  const champG1 = least((n) => has("champion", { g1Wins: n }));
  const champGradedWithOne = least((n) => has("champion", { g1Wins: 1, gradedWins: n }));
  const peak = least((n) => has("great_racehorse", {}, (s) => ({ ...s, rating: { ...s.rating, peakOr: n } })), gc.OR_MAX);
  const starts = least((n) => has("great_racehorse", {}, (s) => ({ ...s, record: { ...s.record, starts: n, wins: n } })));
  const wins = starts === null ? null : least((n) => has("great_racehorse", {}, (s) => ({ ...s, record: { ...s.record, starts: 1000, wins: n } })));
  const startsNeeded = wins === null ? null : least((n) => has("great_racehorse", {}, (s) => ({ ...s, record: { ...s.record, starts: n, wins: Math.min(n, wins) } })));
  const finals = least((n) => has("season_winner", { seasonFinalWins: n }));
  const records = least((n) => has("record_time", { recordTimes: n }));
  const offspring = least((n) => has("foundation_sire", { gradedWinnerOffspring: n }));
  return { champG1, champGradedWithOne, peak, wins, startsNeeded, finals, records, offspring };
}

export default function HallAndTrophiesPage() {
  const t = hallThresholds();
  const sGrade = gc.GRADE_FLOORS.find(([g]) => g === "S")![1];
  const examples: [string, string, string, number][] = [
    ["Season Final win", "final", "graded", 1],
    ["Feature or Group race win", "feature", "graded", 1],
    ["Listed race win", "scheduled", "listed", 1],
    ["Other Live race win", "scheduled", "novice", 1],
    ["Story race win", "quick", "novice", 1],
    ["Second, any race", "scheduled", "novice", 2],
    ["Third, any race", "quick", "maiden", 3],
  ];
  return (
    <>
      <Lead>
        Two places keep your racing history. The <b>Hall of Fame</b> is the Club&rsquo;s permanent roll of honour, shared by every stable. Your <b>Trophy Room</b> is your own: every cup,
        rosette and plaque your stable has won, on the shelves.
      </Lead>
      <Figure src="/art/diorama/trophy-room.png" alt="A wood-panelled trophy room with shelves of cups" caption="Your Trophy Room: everything your stable has won." height={240} focus={0.5} />

      <H2 id="hall">The Hall of Fame</H2>
      <P>
        Open the <GameLink href="/hall">Hall of Fame</GameLink> from the Club menu. Its sections are:
      </P>
      <List
        items={[
          <>
            <b>Inductees</b>: horses and owners inducted for what they achieved (see below). Entries are permanent.
          </>,
          <>
            <b>Champions</b>: the winningest Live horses. Every Live win counts.
          </>,
          <>
            <b>Season winners</b>: the owner with the most League points in each finished season.
          </>,
          <>
            <b>Famous bloodlines</b>: sires and dams whose offspring win.
          </>,
          <>
            <b>Record times</b>: the fastest Live winner at each trip and surface. The first winner sets the time to beat.
          </>,
          <>
            <b>Your rivals</b>: finish within {gc.RIVAL_MARGIN_MM === HORSE_LENGTH_MM ? "a length" : `${gc.RIVAL_MARGIN_MM / 1000} m`} of the same stable {gc.RIVAL_MIN_CLOSE} times in Live races and they
            become your rival.
          </>,
        ]}
      />

      <H2 id="induction">How a horse is inducted</H2>
      <P>A horse of yours is inducted, once and for good, for each of these it achieves. Only stables&rsquo; horses count, not the Club&rsquo;s.</P>
      <Table
        head={["Honour", "Earned by"]}
        rows={[
          [CATEGORY.champion, `${t.champG1} top-level wins, or 1 top-level win and ${t.champGradedWithOne} Group wins. Top level: a Group Feature or a Season Final.`],
          [CATEGORY.season_winner, t.finals === 1 ? "Winning a Season Final." : `Winning ${t.finals} Season Finals.`],
          [CATEGORY.record_time, t.records === 1 ? "Holding a record time." : `Holding ${t.records} record times.`],
          [CATEGORY.great_racehorse, `A peak rating of ${t.peak} or more, or ${t.wins} wins from at least ${t.startsNeeded} starts.`],
          [`${CATEGORY.foundation_sire} / ${CATEGORY.foundation_mare}`, `${t.offspring} offspring that have won a Group race.`],
          [CATEGORY.elite_genetics, `Grade S genes: overall potential of ${sGrade} or more.`],
        ]}
      />
      <P>
        The owner who tops the season&rsquo;s League table is inducted too, as that season&rsquo;s champion owner. Once in, a legend never leaves: not when it retires to stud, not on the{" "}
        <WikiLink slug="legacy-farm">Legacy Farm</WikiLink>, not in memoriam.
      </P>
      <Callout tone="tip">
        <p>
          Breeding is a road to the Hall as well as racing. A mare who never won a big race can still become a Foundation mare through her foals, and an S-grade foal is inducted for its genes
          alone. See <WikiLink slug="genetics-and-inheritance" />.
        </p>
      </Callout>

      <H2 id="trophy-room">Your Trophy Room</H2>
      <P>
        The <GameLink href="/trophies">Trophy Room</GameLink> shows your stable&rsquo;s wins, cups, places and prize money at the top, then the shelves. Every trophy links to its race, so you can
        watch the finish again.
      </P>
      <Figure src="/art/diorama/trophies.png" alt="Gold, silver and bronze cups, three rosettes, a plaque and a medal" caption="Cups, rosettes, a plaque and a medal." height={120} contain />
      <Table head={["Result", "On the shelf"]} rows={examples.map(([label, kind, cls, pos]) => [label, TIER_TEXT[trophyTier(kind, cls, pos)]])} />
      <List
        items={[
          <>
            <b>Cups</b> are for Live race wins.
          </>,
          <>
            <b>Rosettes</b> are for Story wins and for every second and third.
          </>,
          <>
            <b>Plaques</b> are achievements: {gc.ACHIEVEMENTS.length} of them. The ones still to win stand dimmed, with what earns them.
          </>,
          <>
            <b>Honours</b> are medals for Story chapter titles and your Hall of Fame inductions.
          </>,
          <>
            <b>Pride of the stable</b> frames your three most successful winners, whether they are racing, at stud, retired or in memoriam.
          </>,
        ]}
      />

      <H2 id="plaques">Every plaque</H2>
      <Table head={["Plaque", "How to earn it"]} rows={gc.ACHIEVEMENTS.map((a) => [a.title, a.description])} />
      <Facts
        rows={[
          ["Achievements to earn", gc.ACHIEVEMENTS.length],
          ["Close finishes to make a rival", gc.RIVAL_MIN_CLOSE],
        ]}
      />
      <P>
        Cups come from the races on <WikiLink slug="race-types" />; the League and its Season Final are on <WikiLink slug="league" />, and the Daily Cup&rsquo;s plaques on{" "}
        <WikiLink slug="daily-cup" />.
      </P>
    </>
  );
}
