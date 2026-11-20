import * as gc from "@thoroughbred/game-core";
import { PLATE_AFTER_SLOTS, RULES, SPONSORSHIP, bps, defaultCardSlot, entryCostFor, sponsoredRaceName, sponsorshipPrice, type RaceConditions } from "@thoroughbred/db";
import { formatCredits } from "@/lib/format";
import { raceTier } from "@/server/horseView";
import { Callout, Facts, Figure, GameLink, H2, H3, Lead, List, P, Table, WikiLink, count } from "../kit";

const MIN = 60_000;
const SEASON_CLOCK = { epochMs: RULES.seasonEpochMs };
const slotAt = (ms: number) => Math.floor((ms - RULES.seasonEpochMs) / RULES.slotMs);
/** Runs of the card's class pattern in the sample below. */
const SAMPLE_RUNS = 2;
/** The first two runs of the card's class pattern on season 1's first day (a Monday, before the 19:00 calendar meeting). */
const SAMPLE_RACES = gc
  .meetingsBetween(SEASON_CLOCK, RULES.seasonEpochMs, RULES.seasonEpochMs + gc.MS_PER_DAY)
  .flatMap((m) => Array.from({ length: m.races }, (_, i) => slotAt(m.startMs + i * m.spacingMs)))
  .slice(0, SAMPLE_RUNS * gc.CARD_PATTERN_RACES);
/** "1 to 4": the ordinary races a meeting can have. */
const MEETING_SIZE = `${gc.CARD_MIN_RACES_PER_MEETING} to ${gc.RACES_PER_MEETING}`;
/** The meeting start times, "01:00, 04:00, … and 22:00 UTC". */
const MEETING_TIMES = `${gc.MEETING_START_TIMES_UTC.slice(0, -1).join(", ")} and ${gc.MEETING_START_TIMES_UTC.at(-1)} UTC`;
/** "every 3 hours", when the meetings are evenly spaced. */
const MEETING_EVERY = gc.MEETINGS_EVENLY_SPACED ? `, one every ${gc.MEETING_INTERVAL_MS / gc.MS_PER_HOUR} hours` : "";
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
 * The Live card's classes (their conditions, purses and entry costs, read from the card's own
 * class definitions), plus both kinds of Feature.
 */
function liveCycle() {
  const slots = SAMPLE_RACES.map((i) => defaultCardSlot(i));
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
  for (const s of SAMPLE_RACES.map((i) => defaultCardSlot(i))) {
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
      <Figure src="/art/scenes/wiki-meeting-day.png" alt="A country race meeting seen from the hill: picnics, tents and the parade ring" caption={`Kestrel Downs on a meeting day: ${MEETING_SIZE} Live races, ${gc.MEETING_RACE_SPACING_MS / MIN} minutes apart.`} focus={0.45} />

      <H2 id="live">Live races</H2>
      <P>
        The <GameLink href="/races">race card</GameLink> runs in <b>race meetings</b>: {gc.MEETINGS_PER_DAY} a day{MEETING_EVERY}, starting at {MEETING_TIMES}, each of{" "}
        {MEETING_SIZE} races {gc.MEETING_RACE_SPACING_MS / MIN} minutes apart, so the next meeting is never more than about{" "}
        {gc.MEETING_INTERVAL_MS / gc.MS_PER_HOUR} hours away. How many races a meeting has, and which, depends on the horses in training: see{" "}
        <a href="#classes" className="link">Race classes on the card</a>. The card is published{" "}
        {RULES.cardHorizonMs / gc.MS_PER_HOUR} hours ahead: entries open as soon as a race is on the card, so one visit a day is enough to enter any meeting before your next visit. Fewer,
        busier races mean you race against other stables, not just the Club. Each race is shared: every stable that enters runs in the same field, and every viewer sees the same race at
        the same moment. The race card shows how many stables have entered each race. Entries close {RULES.entriesCloseBeforePostMs / 1000} seconds before the off; then the Club fills
        the empty gates with its own horses up to the race&rsquo;s field size (between {RULES.minField} and {RULES.maxField} runners). An ordinary race that no stable entered is called
        off quietly; the big days always run. Club horses are seasoned, rated at their real ability and kept like a typical stable's horse of that rating, and they are pitched at the entered horses: most are about as good as
        the middle horse of the stables&rsquo; runners, a few up to {gc.CLUB_ABOVE_MEDIAN_SPAN} points better, always inside the race&rsquo;s rating band, so to win a horse has to
        be better than the race&rsquo;s middle.
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
          ["Race meetings a day", `${gc.MEETINGS_PER_DAY}${MEETING_EVERY}, from ${MEETING_TIMES}`],
          ["Races in a meeting", `${MEETING_SIZE}, ${gc.MEETING_RACE_SPACING_MS / MIN} minutes apart (plus the big-day races)`],
          ["Stables a race is sized for", gc.CARD_TARGET_STABLES_PER_RACE],
          ["Card published ahead", `${RULES.cardHorizonMs / gc.MS_PER_HOUR} hours`],
          ["Entries close before the off", `${RULES.entriesCloseBeforePostMs / 1000} seconds`],
          ["Runners in a Live field", `${RULES.minField}–${RULES.maxField}`],
          ["Live races per horse per day", gc.MAX_LIVE_STARTS_PER_DAY],
          ["Races per horse per day, Live and Story", gc.MAX_STARTS_PER_DAY],
        ]}
      />

      <H2 id="classes">Race classes on the card</H2>
      <P>
        The card is drawn up for the horses in training. When a meeting is published, a day ahead, the racing office looks at the horses of every stable that has played in the last{" "}
        {gc.CARD_DEMAND_ACTIVE_MS / gc.MS_PER_DAY} days and decides three things:
      </P>
      <List
        items={[
          <>
            <b>How many races.</b> One race for every {gc.CARD_TARGET_STABLES_PER_RACE} stables the same meeting drew the day before, at least {gc.CARD_MIN_RACES_PER_MEETING} and at most{" "}
            {gc.RACES_PER_MEETING}. A quiet hour gets one busy race instead of four empty ones; a busy hour gets the full card. A race that fills still opens a sister course, so a
            small card never turns anyone away.
          </>,
          <>
            <b>Which classes.</b> Each race goes to the class that gives the most horses a race they may enter, counting each race&rsquo;s conditions and the licence it needs. Classes
            that suit about as many horses take turns from meeting to meeting. A class is put on only when at least {gc.CARD_MIN_ELIGIBLE_STABLES} stables have a horse for it, so a
            band nobody is in (a Listed race while no horse is rated high enough, say) is not on the card until horses reach it.
          </>,
          <>
            <b>Nobody left out.</b> A horse in a band of its own, with no race it may enter in {gc.CARD_COVER_EVERY_MEETINGS} meetings running, gets one in the next meeting, as an extra
            race.
          </>,
        ]}
      />
      <P>
        Trips and surfaces take turns too, so every horse&rsquo;s trip and surface come round, and a trip that suits no horse in the class is skipped. A <b>Feature</b> is a Listed race or
        a Group 3 with double prize money. In the {gc.CALENDAR_MEETING_START_UTC} UTC meeting the big-day races (a Qualifier, the Weekend Feature or the Saturday Plate) run as well, at
        their fixed times, and on a day when enough horses could be sold in one, one Handicap is a claiming race, where every runner is for sale (see{" "}
        <WikiLink slug="claiming-races" />). A race a stable has sponsored always runs as it was sold. These are the classes:
      </P>
      <Table
        head={["Race", "Who can enter", "Purse", "Entries", "Licence"]}
        rows={[
          [
            "Feature (Listed or Group 3)",
            feats.map((f) => whoCanEnter(f.conditions)).join(" / "),
            feats.map((f) => formatCredits(f.purse ?? 0)).join(" / "),
            [...new Set(feats.map((f) => entryCostFor(f.kind, f.raceClass)))].join(" / "),
            licenceName("listed", true),
          ],
          ...hour.map((h) => [h.label, whoCanEnter(h.conditions), formatCredits(h.purse), h.cost, licenceName(h.tier, h.feature)]),
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
        A season lasts {gc.SEASON_DAYS} days. Its calendar of special races is fixed in advance, and each one runs in the {gc.CALENDAR_MEETING_START_UTC} UTC meeting, taking the
        place of one of its races. On the season&rsquo;s last day that meeting is the Finals meeting: it opens at {gc.FINALS_MEETING_START_UTC} UTC and runs the{" "}
        {gc.DIVISIONS.length} Season Finals {gc.FINALS_MEETING_SPACING_MS / MIN} minutes apart, with the meeting&rsquo;s own races in between. Find them under &ldquo;Big days&rdquo; on
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
        your current chapter. You can also pick the horse and plan yourself. The race secretary usually finds a trip and surface that suit your horse. Until you finish chapter 1 these are small Club fields of {gc.STORY_CLUB_OPEN_RUNNERS[0]} or {gc.STORY_CLUB_OPEN_RUNNERS[1]} runners, and the Club&rsquo;s horses are drawn from{" "}
        {gc.STORY_OPEN_BELOW} marks below your horse&rsquo;s real ability upwards ({gc.STORY_FIRST_BELOW} below for your stable&rsquo;s very first race): a Club runner is a seasoned
        horse, and a young one needs that much start to be level with it. After a loss the Club sends a slightly easier field ({gc.STORY_OPEN_MARKS_PER_STEP} marks a loss in a row, up to{" "}
        {Math.floor(gc.STORY_EASE_MAX / gc.STORY_EASE_PER_LOSS) * gc.STORY_OPEN_MARKS_PER_STEP}); after two wins in a row, a slightly stronger one. After chapter 1 the field is matched to
        your horse&rsquo;s rating, {gc.STORY_OPEN_RUNNERS[0]} to {gc.STORY_OPEN_RUNNERS[1]} runners. Every race is an honest simulation: we choose the field, never the result.
      </P>
      <P>
        <GameLink href="/story">Story mode</GameLink> is a campaign of {gc.STORY_CHAPTER_DEFS.length} chapters, each with {gc.STORY_CHAPTER_DEFS[0]!.races.length} fixed races against named
        rivals. Win {gc.STORY_CHAPTER_DEFS[0]!.winsToComplete} different races of a chapter to complete it and earn the next licence.
      </P>
      <H3>How a Story field is chosen</H3>
      <P>
        We choose the field, never the result. Before each chapter race the rival stables&rsquo; strength is fixed from your runner and your recent Story results, and stored with the race:
      </P>
      <List
        items={[
          <>
            <b>Chapter 1, the Club:</b> the rivals&rsquo; average stat sits {gc.STORY_CLUB_BELOW} points below your runner&rsquo;s own (its stats as your stable shows them). The Club Championship is a
            step up: only {gc.STORY_CLUB_FINAL_BELOW} below.
          </>,
          <>
            <b>Chapter 2, the County:</b> the first races start {gc.STORY_COUNTY_BELOW} below your runner, and each County win closes the gap by {gc.STORY_COUNTY_RAMP_PER_WIN}, up to the
            chapter&rsquo;s own strength. Chapters 3 and 4 are run at their own strength.
          </>,
          <>
            <b>After two or more defeats in a row</b> (chapters 1 and 2) the field eases by {gc.STORY_EASE_PER_LOSS} for each one after the first, up to {gc.STORY_EASE_MAX}: the race card says a
            rival rests its best horse today. <b>After two or more wins in a row</b> it stiffens by {gc.STORY_STIFFEN_PER_WIN} a win, up to {gc.STORY_STIFFEN_MAX}.
          </>,
          <>Rewards don&rsquo;t change: a first win pays once, replays pay the small reward, up to the chapter&rsquo;s cap.</>,
        ]}
      />
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
