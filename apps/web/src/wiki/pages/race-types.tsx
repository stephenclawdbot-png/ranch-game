import * as gc from "@thoroughbred/game-core";
import { RULES, bps, defaultCardSlot, entryCostFor, type RaceConditions } from "@thoroughbred/db";
import { formatCredits } from "@/lib/format";
import { raceTier } from "@/server/horseView";
import { Callout, Facts, Figure, GameLink, H2, Lead, List, P, Table, WikiLink } from "../kit";

const MIN = 60_000;
const SEASON_CLOCK = { epochMs: RULES.seasonEpochMs };
/** An ordinary hour of the Live card (10:00 UTC on the first day of season 1: no calendar races). */
const SAMPLE_HOUR_FIRST_SLOT = 10 * (gc.MS_PER_HOUR / RULES.slotMs);

function whoCanEnter(c: RaceConditions): string {
  const parts: string[] = [];
  if (c.maxWins === 0) parts.push("no wins yet");
  else if (c.maxWins !== undefined) parts.push(`at most ${c.maxWins} wins`);
  if (c.minRating !== undefined && c.maxRating !== undefined) parts.push(`rated ${c.minRating}–${c.maxRating}`);
  else if (c.maxRating !== undefined) parts.push(`rated up to ${c.maxRating}`);
  else if (c.minRating !== undefined) parts.push(`rated ${c.minRating}+`);
  const s = parts.join(", ");
  return s ? s[0]!.toUpperCase() + s.slice(1) : "Open";
}

/** The Live card, grouped by race type (the same calendar the game publishes): one real hour, plus both kinds of hourly Feature. */
function liveHour() {
  const slots = Array.from({ length: 20 }, (_, i) => defaultCardSlot(SAMPLE_HOUR_FIRST_SLOT + i));
  // The hourly Feature is a Listed race or a Group 3: find one of each in the same day's earlier hours.
  const features = new Map<string, ReturnType<typeof defaultCardSlot>>();
  for (let h = 0; h < 10 && features.size < 2; h++) {
    const f = defaultCardSlot(h * 20);
    if (f.kind === "feature") features.set(f.raceClass, f);
  }
  const byLabel = new Map<string, { label: string; conditions: RaceConditions; purse: number; cost: number; count: number; tier: gc.RaceTier; feature: boolean }>();
  for (const s of slots) {
    const track = String(s.conditions.track ?? "");
    const label = s.name.startsWith(`${track} `) ? s.name.slice(track.length + 1) : s.name;
    const feature = s.kind === "feature";
    const tier = raceTier({ kind: s.kind, raceClass: s.raceClass, conditions: s.conditions } as Parameters<typeof raceTier>[0]);
    const cur = byLabel.get(label);
    if (cur) cur.count++;
    else byLabel.set(label, { label, conditions: s.conditions, purse: s.purse ?? 0, cost: entryCostFor(s.kind, s.raceClass), count: 1, tier, feature });
  }
  const rows = [...byLabel.values()].filter((r) => !r.feature);
  const feats = [...features.values()].sort((a, b) => (a.purse ?? 0) - (b.purse ?? 0));
  return { rows, feats };
}

const utcClock = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
};

export default function RaceTypesPage() {
  const { rows: hour, feats } = liveHour();
  const calendar = gc.featureCalendar(SEASON_CLOCK, 1);
  const qualifier = calendar.find((r) => r.kind === "feature_qualifier")!;
  const weekend = calendar.find((r) => r.kind === "weekend_feature")!;
  const finals = calendar.filter((r) => r.kind === "season_final");
  const slotStart = (ms: number) => Math.floor((ms - RULES.seasonEpochMs) / RULES.slotMs) * RULES.slotMs + RULES.seasonEpochMs;
  const split = RULES.purseSplitBps;
  const examplePurse = hour.find((h) => h.label.startsWith("Maiden"))?.purse ?? 0;
  return (
    <>
      <Lead>
        There are three ways to race in Post Time. <b>Live races</b> go off on a shared card every {RULES.slotMs / MIN} minutes and everyone watches together. <b>Quick races</b> and{" "}
        <b>Story chapters</b> are solo races against the Club&rsquo;s rival stables that you can run whenever you like. On top of that sit the scheduled big days: hourly Features, the Weekend
        Feature and the Season Final.
      </Lead>
      <Figure src="/art/diorama/poster-grandstand.png" alt="The grandstand at Kestrel Downs on race day" caption="Kestrel Downs: a Live race goes off every few minutes, all day." focus={0.45} />

      <H2 id="live">Live races</H2>
      <P>
        The <GameLink href="/races">race card</GameLink> publishes a race every {RULES.slotMs / MIN} minutes, {gc.SLOTS_PER_DAY} a day. Each race is shared: every stable that enters runs in the
        same field, and every viewer sees the same race at the same moment. Entries close {RULES.entriesCloseBeforePostMs / 1000} seconds before the off, and the Club fills any empty gates
        with its own horses so a field always has between {RULES.minField} and {RULES.maxField} runners.
      </P>
      <List
        items={[
          <>A Live race counts as a career start, moves the horse&rsquo;s official rating and adds to its record.</>,
          <>
            It costs stable entries, not credits: see <WikiLink slug="credits-and-entries" />.
          </>,
          <>When a race is one gate from full, the same race opens on a sister course in the same slot, so nobody is turned away.</>,
          <>
            Live races are the only races where a career-ending injury can, rarely, be fatal. See <WikiLink slug="injuries-and-insurance" />.
          </>,
          <>
            Only Live races score <WikiLink slug="league">League</WikiLink> points.
          </>,
        ]}
      />
      <Facts
        rows={[
          ["A Live race every", `${RULES.slotMs / MIN} minutes`],
          ["Live races a day", gc.SLOTS_PER_DAY],
          ["Entries close before the off", `${RULES.entriesCloseBeforePostMs / 1000} seconds`],
          ["Runners in a Live field", `${RULES.minField}–${RULES.maxField}`],
          ["Starts per horse per day (any race)", gc.MAX_STARTS_PER_DAY],
        ]}
      />

      <H2 id="classes">Race classes on the card</H2>
      <P>
        Every hour of the Live card follows the same pattern of {hour.reduce((a, h) => a + h.count, 1)} races. The first race of the hour is the <b>Feature</b>, a Listed race or a Group 3
        with double prize money. Most of the rest are Maiden and Novice races, which every new horse can run, with the three Handicap bands and a Listed race in between. This is one real hour
        of the card:
      </P>
      <Table
        head={["Race", "Who can enter", "Purse", "Entries", "Per hour", "Licence"]}
        rows={[
          [
            "Feature (Listed or Group 3)",
            feats.map((f) => whoCanEnter(f.conditions)).join(" / "),
            feats.map((f) => formatCredits(f.purse ?? 0)).join(" / "),
            [...new Set(feats.map((f) => entryCostFor(f.kind, f.raceClass)))].join(" / "),
            1,
            gc.licenceDef(gc.licenceForTier("listed", true)).name,
          ],
          ...hour.map((h) => [h.label, whoCanEnter(h.conditions), formatCredits(h.purse), h.cost, h.count, gc.licenceDef(gc.licenceForTier(h.tier, h.feature)).name]),
        ]}
        caption="Purses in credits. Entries: stable entries spent to run."
      />
      <P>
        <b>Maidens</b> are for horses that have never won. <b>Novices</b> are for horses with only a couple of wins. <b>Handicaps</b> are grouped by official rating into overlapping bands, so
        a horse on the edge of two bands can choose. <b>Listed</b> and <b>Group</b> races are the top level. Your horse&rsquo;s rating decides which bands it may run in: see{" "}
        <WikiLink slug="ratings-and-form" />. Juveniles (up to {gc.JUVENILE_MAX_STARTS} starts) can run Maidens and Novices but not Handicaps or above yet.
      </P>
      <P>
        Some classes also need a <b>licence</b>. You start with the {gc.licenceDef(1).name}; each Story chapter you complete earns the next one.
      </P>
      <Table head={["Licence", "Opens up"]} rows={gc.LICENCES.map((l) => [l.name, l.unlocks[0]!.toUpperCase() + l.unlocks.slice(1)])} />

      <H2 id="scheduled">Scheduled cards: the big days</H2>
      <P>
        A season lasts {gc.SEASON_DAYS} days. Its calendar of special races is fixed in advance, and each one takes over the Live slot it falls in. Find them under &ldquo;Big days&rdquo; on
        the <GameLink href="/league">League</GameLink> page.
      </P>
      <Table
        head={["Race", "When", "Purse", "Runners", "Entries"]}
        rows={[
          ["Feature Qualifier (Listed)", `Monday to Friday, ${utcClock(slotStart(qualifier.postTimeMs))}`, formatCredits(qualifier.purse), `up to ${qualifier.maxRunners}`, entryCostFor("scheduled", "listed")],
          ["Weekend Feature (Group 1)", `Saturday, ${utcClock(slotStart(weekend.postTimeMs))}`, formatCredits(weekend.purse), `up to ${weekend.maxRunners}`, entryCostFor("feature", "graded")],
          [
            "Season Final (one per division)",
            `Last day of the season, ${finals.map((f) => utcClock(slotStart(f.postTimeMs))).join(", ")}`,
            formatCredits(finals[0]!.purse),
            `up to ${finals[0]!.maxRunners}`,
            entryCostFor("final", "graded"),
          ],
        ]}
      />
      <P>
        Each week&rsquo;s Feature has a distance division (sprint, mile, middle or staying), and the Season Final runs one championship for each of the {gc.DIVISIONS.length} divisions. More on
        the season in <WikiLink slug="league" />.
      </P>

      <H2 id="quick">Quick races and Story chapters</H2>
      <P>
        Under &ldquo;Race the Club now&rdquo; on the race card, <b>Quick Pick</b> finds your best-suited fresh horse and runs it straight away in a solo Story race against the rival stables of
        your current chapter. You can also pick the horse and plan yourself. The race secretary usually finds a trip and surface that suit your horse, and the field is matched to its rating.
      </P>
      <P>
        <GameLink href="/story">Story mode</GameLink> is a campaign of {gc.STORY_CHAPTER_DEFS.length} chapters, each with {gc.STORY_CHAPTER_DEFS[0]!.races.length} fixed races against named
        rivals. Win {gc.STORY_CHAPTER_DEFS[0]!.winsToComplete} different races of a chapter to complete it and earn the next licence.
      </P>
      <Table
        head={["Chapter", "Runners", "First win pays", "Replays pay", "Chapter pays at most"]}
        rows={gc.STORY_CHAPTER_DEFS.map((c) => [
          `${c.number}. ${c.title}`,
          c.races[0]!.fieldSize,
          formatCredits(gc.STORY_FIRST_WIN_REWARD[c.id]),
          formatCredits(gc.STORY_REPLAY_REWARD),
          formatCredits(gc.STORY_CHAPTER_CAP[c.id]),
        ])}
        caption="Story rewards in credits. The first win of each chapter race pays in full; every other finish pays the small replay reward, up to the chapter's cap."
      />
      <P>Quick races and Story chapters work the same way, and differ from Live races in a few important ways:</P>
      <List
        items={[
          <>They are free: no stable entries, no entry fee. They pay a Story reward instead of a purse.</>,
          <>
            They don&rsquo;t use up a career start, so they never bring your horse closer to its {gc.CAREER_MAX_STARTS}-start retirement, and they don&rsquo;t add to its race record.
          </>,
          <>An injury is possible, but never a fatal one.</>,
          <>They still tire your horse, still move its official rating and still count towards the {gc.MAX_STARTS_PER_DAY} starts a day.</>,
        ]}
      />
      <Callout tone="tip">
        <p>
          Story races are the safe place to learn a horse: try a new trip, surface or tactic without spending a start or an entry. Save the Live card for when you know where it belongs.
        </p>
      </Callout>

      <H2 id="purses">Purses</H2>
      <P>
        A Live race&rsquo;s purse is shared among the first {split.length} home. Only stables&rsquo; horses are paid: when a Club horse finishes in the money, nobody collects its share.
      </P>
      <Table
        head={["Place", "Share of the purse", `In a ${formatCredits(examplePurse)} race`]}
        rows={split.map((b, i) => [`${i + 1}${["st", "nd", "rd"][i] ?? "th"}`, `${b / 100}%`, formatCredits(bps(examplePurse, b))])}
      />
      <P>
        Purses are paid in Stable Credits as soon as the race is settled. Your winnings also go on your horse&rsquo;s record and into your <WikiLink slug="hall-and-trophies">Trophy Room</WikiLink>
        .
      </P>
      <Callout tone="rule" title="Fair to everyone">
        <p>
          Every race, Live or Story, is an honest simulation. The game chooses who is in the field, never who wins. See <WikiLink slug="how-races-are-run" />.
        </p>
      </Callout>
    </>
  );
}
