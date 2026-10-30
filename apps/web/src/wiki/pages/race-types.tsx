import * as gc from "@thoroughbred/game-core";
import { PLATE_AFTER_SLOTS, RULES, SPONSORSHIP, bps, defaultCardSlot, entryCostFor, sponsoredRaceName, sponsorshipPrice, type RaceConditions } from "@thoroughbred/db";
import { formatCredits } from "@/lib/format";
import { raceTier } from "@/server/horseView";
import { Callout, Facts, Figure, GameLink, H2, Lead, List, P, Table, WikiLink, count } from "../kit";

const MIN = 60_000;
const SEASON_CLOCK = { epochMs: RULES.seasonEpochMs };
const slotAt = (ms: number) => Math.floor((ms - RULES.seasonEpochMs) / RULES.slotMs);
/** The first two meetings of season 1 (a Monday: the calendar races are in the evening meeting). */
const SAMPLE_MEETINGS = gc.meetingsBetween(SEASON_CLOCK, RULES.seasonEpochMs, RULES.seasonEpochMs + gc.MS_PER_DAY).slice(0, 2);
const meetingRaces = (m: gc.Meeting) => Array.from({ length: gc.RACES_PER_MEETING }, (_, i) => defaultCardSlot(slotAt(m.startMs) + i));
/** The meeting start times, "07:00, 13:00 and 19:00 UTC". */
const MEETING_TIMES = `${gc.MEETING_START_TIMES_UTC.slice(0, -1).join(", ")} and ${gc.MEETING_START_TIMES_UTC.at(-1)} UTC`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const licenceName = (tier: gc.RaceTier, feature: boolean | "final" = false) => gc.licenceDef(gc.licenceForTier(tier, feature)).name;

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

/**
 * The Live card, grouped by race type (the same calendar the game publishes): two real meetings
 * (the top race alternates between a Feature and a Listed race), plus both kinds of Feature.
 * `count` is per two meetings.
 */
function liveCycle() {
  const slots = SAMPLE_MEETINGS.flatMap(meetingRaces);
  // The Feature is a Listed race or a Group 3: find one of each in the first days' meetings.
  const features = new Map<string, ReturnType<typeof defaultCardSlot>>();
  for (const m of gc.meetingsBetween(SEASON_CLOCK, RULES.seasonEpochMs, RULES.seasonEpochMs + 10 * gc.MS_PER_DAY)) {
    if (features.size >= 2) break;
    const f = defaultCardSlot(slotAt(m.startMs));
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

const SPONSORSHIP_DAYS = Math.round(SPONSORSHIP.windowMs / gc.MS_PER_DAY);

/** Sponsorship prices by race type (the card's own purses through sponsorshipPrice), cheapest first. */
function sponsorTable(hour: ReturnType<typeof liveCycle>["rows"], feats: ReturnType<typeof liveCycle>["feats"]) {
  const rows = [
    ...hour.map((h) => ({ label: h.label, purse: h.purse })),
    ...feats.map((f) => ({ label: `Feature (${f.raceClass === "graded" ? "Group 3" : "Listed"})`, purse: f.purse ?? 0 })),
  ];
  return rows.map((r) => ({ ...r, price: sponsorshipPrice(r.purse) })).sort((a, b) => a.price - b.price || a.label.localeCompare(b.label));
}

/** A real handicap from the sample cycle, before and after a sponsor's name. */
function sponsorNameExample() {
  for (const s of meetingRaces(SAMPLE_MEETINGS[0]!)) {
    if (s.raceClass !== "handicap") continue;
    return { from: s.name, to: sponsoredRaceName("Glenmorrow House", s.name, String(s.conditions.track ?? "")) };
  }
  return { from: "Ashcombe Handicap (0-55)", to: sponsoredRaceName("Glenmorrow House", "Ashcombe Handicap (0-55)", "Ashcombe") };
}

export default function RaceTypesPage() {
  const { rows: hour, feats } = liveCycle();
  const sponsorPrices = sponsorTable(hour, feats);
  const sponsorExample = sponsorNameExample();
  // the calendar races as the Live card publishes them (its purses and fees)
  const calendar = gc.featureCalendar(SEASON_CLOCK, 1).map((r) => {
    const card = defaultCardSlot(Math.floor((r.postTimeMs - RULES.seasonEpochMs) / RULES.slotMs));
    return { ...r, purse: card.purse ?? 0, entryFee: card.entryFee ?? 0 };
  });
  const qualifier = calendar.find((r) => r.kind === "feature_qualifier")!;
  const weekend = calendar.find((r) => r.kind === "weekend_feature")!;
  const finals = calendar.filter((r) => r.kind === "season_final");
  const slotStart = (ms: number) => Math.floor((ms - RULES.seasonEpochMs) / RULES.slotMs) * RULES.slotMs + RULES.seasonEpochMs;
  // the Saturday Plate, as the card publishes it: PLATE_AFTER_SLOTS slots after the Weekend Feature
  const plateAt = slotStart(weekend.postTimeMs) + PLATE_AFTER_SLOTS * RULES.slotMs;
  const plate = defaultCardSlot(Math.floor((plateAt - RULES.seasonEpochMs) / RULES.slotMs));
  const plateTier = raceTier({ kind: plate.kind, raceClass: plate.raceClass, conditions: plate.conditions } as Parameters<typeof raceTier>[0]);
  const band = (c: { minRating?: number }) => (c.minRating !== undefined ? `rated ${c.minRating}+` : "no rating band");
  const qualifierCard = defaultCardSlot(Math.floor((qualifier.postTimeMs - RULES.seasonEpochMs) / RULES.slotMs));
  const weekendCard = defaultCardSlot(Math.floor((weekend.postTimeMs - RULES.seasonEpochMs) / RULES.slotMs));
  const split = RULES.purseSplitBps;
  const examplePurse = hour.find((h) => h.label.startsWith("Maiden"))?.purse ?? 0;
  return (
    <>
      <Lead>
        There are three ways to race in Post Time. <b>Live races</b> go off on a shared card in race meetings, {gc.MEETINGS_PER_DAY} a day, and everyone watches together. <b>Quick races</b> and{" "}
        <b>Story chapters</b> are solo races against the Club&rsquo;s rival stables that you can run whenever you like. On top of that sit the card&rsquo;s Features and the scheduled big
        days: the weekday Qualifiers, the Weekend Feature, the Saturday Plate and the Season Final.
      </Lead>
      <Figure src="/art/diorama/poster-grandstand.png" alt="The grandstand at Kestrel Downs on race day" caption={`Kestrel Downs on a meeting day: ${gc.RACES_PER_MEETING} Live races, ${gc.MEETING_RACE_SPACING_MS / MIN} minutes apart.`} focus={0.45} />

      <H2 id="live">Live races</H2>
      <P>
        The <GameLink href="/races">race card</GameLink> runs in <b>race meetings</b>: {gc.MEETINGS_PER_DAY} a day, starting at {MEETING_TIMES}, each of{" "}
        {gc.RACES_PER_MEETING} races {gc.MEETING_RACE_SPACING_MS / MIN} minutes apart ({gc.LIVE_RACES_PER_DAY} Live races a day). The card is published{" "}
        {RULES.cardHorizonMs / gc.MS_PER_HOUR} hours ahead: entries open as soon as a race is on the card, so one visit a day is enough to enter any meeting before your next visit. Fewer,
        busier races mean you race against other stables, not just the Club. Each race is shared: every stable that enters runs in the same field, and every viewer sees the same race at
        the same moment. The race card shows how many stables have entered each race. Entries close {RULES.entriesCloseBeforePostMs / 1000} seconds before the off; then the Club fills
        the empty gates with its own horses up to the race&rsquo;s field size (between {RULES.minField} and {RULES.maxField} runners). An ordinary race that no stable entered is called
        off quietly; the big days always run.
      </P>
      <List
        items={[
          <>A Live race counts as a career start, moves the horse&rsquo;s official rating and adds to its record.</>,
          <>
            Each horse can run <b>{count(gc.MAX_LIVE_STARTS_PER_DAY, "Live race")} a day</b>, by the race&rsquo;s UTC date.
          </>,
          <>
            It costs stable entries, not credits: see <WikiLink slug="credits-and-entries" />.
          </>,
          <>
            Each race runs at a course that races its surface, on that course&rsquo;s going and weather that day: summer cards ride fast, winter ones heavy. See{" "}
            <WikiLink slug="weather-and-going" />.
          </>,
          <>
            When a race is one gate from full, the same race (same trip and ground) opens on a sister course in the same slot that races its surface, so nobody is turned away; once every
            such course has one, a second division opens.
          </>,
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
          ["Race meetings a day", `${gc.MEETINGS_PER_DAY}, from ${MEETING_TIMES}`],
          ["Races in a meeting", `${gc.RACES_PER_MEETING}, ${gc.MEETING_RACE_SPACING_MS / MIN} minutes apart`],
          ["Live races a day", gc.LIVE_RACES_PER_DAY],
          ["Card published ahead", `${RULES.cardHorizonMs / gc.MS_PER_HOUR} hours`],
          ["Entries close before the off", `${RULES.entriesCloseBeforePostMs / 1000} seconds`],
          ["Runners in a Live field", `${RULES.minField}–${RULES.maxField}`],
          ["Live races per horse per day", gc.MAX_LIVE_STARTS_PER_DAY],
          ["Races per horse per day, Live and Story", gc.MAX_STARTS_PER_DAY],
        ]}
      />

      <H2 id="classes">Race classes on the card</H2>
      <P>
        Every meeting runs the same pattern of {gc.RACES_PER_MEETING} races. The first is the meeting&rsquo;s top race: at every other meeting the <b>Feature</b>, a Listed race or a
        Group 3 with double prize money, and a Listed race at the others. Then Maiden and Novice races, which every new horse can run, alternate with the three Handicap bands. Between
        them, a day&rsquo;s {gc.MEETINGS_PER_DAY} meetings run Maidens and Novices over every trip and surface. In the evening meeting a big-day race (a Qualifier, the Weekend Feature,
        the Saturday Plate or a Season Final) takes the place of the top race or a Handicap. These are real meetings from the card:
      </P>
      <Table
        head={["Race", "Who can enter", "Purse", "Entries", "Per meeting", "Licence"]}
        rows={[
          [
            "Feature (Listed or Group 3)",
            feats.map((f) => whoCanEnter(f.conditions)).join(" / "),
            feats.map((f) => formatCredits(f.purse ?? 0)).join(" / "),
            [...new Set(feats.map((f) => entryCostFor(f.kind, f.raceClass)))].join(" / "),
            "every other meeting",
            licenceName("listed", true),
          ],
          ...hour.map((h) => [h.label, whoCanEnter(h.conditions), formatCredits(h.purse), h.cost, h.count === 1 ? "every other meeting" : h.count / SAMPLE_MEETINGS.length, licenceName(h.tier, h.feature)]),
        ]}
        caption="Purses in credits. Entries: stable entries spent to run."
      />
      <P>
        <b>Maidens</b> are for horses that have never won. <b>Novices</b> are for horses with only a couple of wins. <b>Handicaps</b> are grouped by official rating into overlapping bands, so
        a horse on the edge of two bands can choose. <b>Listed</b> and <b>Group</b> races are the top level. Your horse&rsquo;s rating decides which bands it may run in: see{" "}
        <WikiLink slug="ratings-and-form" />. Each race&rsquo;s own conditions (wins, rating band) decide who may run; the entry sheet shows the
        reason when a horse can&rsquo;t.
      </P>
      <P>
        Some classes also need a <b>licence</b>. You start with the {gc.licenceDef(1).name}; each Story chapter you complete earns the next one.
      </P>
      <Table head={["Licence", "Opens up"]} rows={gc.LICENCES.map((l) => [l.name, l.unlocks[0]!.toUpperCase() + l.unlocks.slice(1)])} />

      <H2 id="scheduled">Scheduled cards: the big days</H2>
      <P>
        A season lasts {gc.SEASON_DAYS} days. Its calendar of special races is fixed in advance, and each one runs in the evening meeting, taking the place of one of its races (on
        the season&rsquo;s last day the evening meeting starts at {gc.FINALS_DAY_EVENING_START_UTC} UTC so all {gc.DIVISIONS.length} Season Finals are part of it). Find them under &ldquo;Big days&rdquo; on
        the <GameLink href="/league">League</GameLink> page.
      </P>
      <Table
        head={["Race", "When", "Who can enter", "Purse", "Runners", "Entries", "Entry fee", "Licence"]}
        rows={[
          [
            "Feature Qualifier (Listed)",
            `Monday to Friday, ${utcClock(slotStart(qualifier.postTimeMs))}`,
            cap(band(qualifierCard.conditions)),
            formatCredits(qualifier.purse),
            `up to ${qualifier.maxRunners}`,
            entryCostFor("scheduled", "listed"),
            `${formatCredits(qualifier.entryFee)} cr`,
            licenceName("listed"),
          ],
          [
            "Weekend Feature (Group 1)",
            `Saturday, ${utcClock(slotStart(weekend.postTimeMs))}`,
            `Qualified, ${band(weekendCard.conditions)}`,
            formatCredits(weekend.purse),
            `up to ${weekend.maxRunners}`,
            entryCostFor("feature", "graded"),
            `${formatCredits(weekend.entryFee)} cr`,
            licenceName("g1", true),
          ],
          [
            "Saturday Plate (Listed)",
            `Saturday, ${utcClock(plateAt)}`,
            `Ran in a Qualifier, didn't qualify; ${band(plate.conditions)}`,
            formatCredits(plate.purse ?? 0),
            `up to ${plate.maxRunners}`,
            entryCostFor(plate.kind, plate.raceClass),
            `${formatCredits(plate.entryFee ?? 0)} cr`,
            licenceName(plateTier),
          ],
          [
            "Season Final (one per division)",
            `Last day of the season, ${finals.map((f) => utcClock(slotStart(f.postTimeMs))).join(", ")}`,
            cap(band(defaultCardSlot(Math.floor((finals[0]!.postTimeMs - RULES.seasonEpochMs) / RULES.slotMs)).conditions)),
            formatCredits(finals[0]!.purse),
            `up to ${finals[0]!.maxRunners}`,
            entryCostFor("final", "graded"),
            `${formatCredits(finals[0]!.entryFee)} cr`,
            licenceName("g1", "final"),
          ],
        ]}
        caption="Times are when the race goes off. Purses in credits."
      />
      <P>
        Each week&rsquo;s Feature has a distance division (sprint, mile, middle or staying), and the Season Final runs one championship for each of the {gc.DIVISIONS.length} divisions. More on
        the season in <WikiLink slug="league" />.
      </P>
      <Callout tone="rule" title="Qualifying for the Weekend Feature">
        <p>
          A horse needs a top-3 finish in one of that week&rsquo;s Feature Qualifiers, or an official rating of 100 or more, and the race&rsquo;s own band ({band(weekendCard.conditions)}).
          The entry sheet tells you if a horse hasn&rsquo;t qualified.
        </p>
      </Callout>
      <P>
        A horse that ran in a Qualifier that week and missed out gets a second chance in the <b>Saturday Plate</b>, a Listed race over the Weekend Feature&rsquo;s own trip and surface,{" "}
        {PLATE_AFTER_SLOTS * (RULES.slotMs / MIN)} minutes after it. A horse that did qualify runs in the Feature instead. <GameLink href="/week">This week</GameLink> under Racing shows
        Saturday&rsquo;s trip and surface from Monday with its likely going from the weather outlook (the real going once the race is on the card), your places in the Qualifiers and which
        of your horses are in, in the Plate or not yet. The going on the day is the weather&rsquo;s: see <WikiLink slug="weather-and-going" />.
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
          <>
            They still tire your horse, still move its official rating and still count towards the {gc.MAX_STARTS_PER_DAY} races a day, but not towards the{" "}
            {count(gc.MAX_LIVE_STARTS_PER_DAY, "Live race")} a day.
          </>,
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

      <H2 id="sponsor">Sponsor a race</H2>
      <P>
        Put your stable&rsquo;s name on a Live race. Choose any ordinary race on the card up to {SPONSORSHIP_DAYS} days ahead and pay for it: for that one race,{" "}
        {sponsorExample.from} becomes <b>{sponsorExample.to}</b>. Your silks go on the racecard, you get a note with the result, and the race goes up on a plaque in your{" "}
        <WikiLink slug="hall-and-trophies">Trophy Room</WikiLink>. If other courses run the same race, they keep their own names and say who sponsored it.
      </P>
      <Table
        head={["Race", "Purse", "To sponsor"]}
        rows={sponsorPrices.map((r) => [r.label, formatCredits(r.purse), formatCredits(r.price)])}
        caption={`The price is ${SPONSORSHIP.purseMultiple} times the purse, and never less than ${formatCredits(SPONSORSHIP.minPrice)} credits.`}
      />
      <List
        items={[
          <>One sponsor per race: the first stable to pay gets it.</>,
          <>
            A stable can have up to <b>{SPONSORSHIP.maxUpcomingPerStable}</b> sponsored races coming up at a time.
          </>,
          <>Big-day races are not for sale: the Feature Qualifiers, the Weekend Feature, the Saturday Plate and the Season Finals.</>,
          <>You can sponsor a race until its entries close. The credits are spent for good, unless the race is abandoned; then you get them all back.</>,
        ]}
      />
      <Callout tone="rule" title="The name, nothing else">
        <p>Sponsoring changes nothing about the race: not the field, the purse, the result, or your own horses&rsquo; chances. It is a way to spend credits on your stable&rsquo;s name.</p>
      </Callout>
      <P>
        Start from the <GameLink href="/races/sponsor">Sponsor a race</GameLink> page, linked from the race card.
      </P>
    </>
  );
}
