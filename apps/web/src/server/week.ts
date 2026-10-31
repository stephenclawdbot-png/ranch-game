/**
 * Road to Saturday (beta loop): the week's Weekend Feature and its conditions (known on Monday),
 * the weekday Feature Qualifiers and the stable's results in them, which horses are qualified
 * (top 3 in a qualifier, or rating 100+), which go to the Saturday Plate, how well each fits
 * the Feature, and the stable's League standing with the gap to the promotion line.
 */
import * as gc from "@thoroughbred/game-core";
import { CALENDAR_HOME_COURSE, CALENDAR_PURSE, PLATE_AFTER_SLOTS, RULES, defaultCardSlot, leagueOf, listStableHorses, seasonNumberAt, settleUpkeep, stableCalendarRuns, startsOnDay, upkeepThisWeek, type Db } from "@thoroughbred/db";
import { conditionRating, lossGrade } from "@/lib/aptitude";
import type { WeekView } from "@/lib/competitionTypes";
import { groundView } from "./ground";
import { horseFromRow, parseSilks } from "./horseView";
import type { Session } from "./session";

const DAY = 86_400_000;
/** A rating gap to the Feature by right is shown when it is this close (further away it is noise). */
const NEAR_RATING = 10;
const SEASON_CLOCK = { epochMs: RULES.seasonEpochMs };
const slotIndexOf = (ms: number) => Math.floor((ms - RULES.seasonEpochMs) / RULES.slotMs);
const slotStartMs = (ms: number) => slotIndexOf(ms) * RULES.slotMs + RULES.seasonEpochMs;

/** Monday 00:00 UTC of the week containing `nowMs`. */
function weekStartMs(nowMs: number): number {
  const day = Math.floor(nowMs / DAY);
  const dow = (((day + 3) % 7) + 7) % 7; // 0 = Monday (1970-01-01 was a Thursday)
  return (day - dow) * DAY;
}

export async function weekView(db: Db, session: Session, now: Date): Promise<WeekView> {
  // last week's upkeep is charged lazily on the first look at the new week (idempotent)
  await settleUpkeep(db, now, { stableId: session.stable.id }).catch((e) => console.error("[upkeep] settle failed", e));
  const nowMs = now.getTime();
  const from = weekStartMs(nowMs);
  const to = from + 7 * DAY;
  const season = seasonNumberAt(now);
  const cal = [...gc.featureCalendar(SEASON_CLOCK, season - 1), ...gc.featureCalendar(SEASON_CLOCK, season), ...gc.featureCalendar(SEASON_CLOCK, season + 1)].filter(
    (r) => r.postTimeMs >= from && r.postTimeMs < to,
  );
  const wf = cal.find((r) => r.kind === "weekend_feature") ?? null;
  const finals = cal.filter((r) => r.kind === "season_final");
  const card = (ms: number) => defaultCardSlot(slotIndexOf(ms));

  const runs = await stableCalendarRuns(db, session.stable.id, new Date(from), new Date(to));
  const rows = (await listStableHorses(db, session.stable.id)).filter((r) => r.careerStatus === "racing");
  const names = new Map(rows.map((r) => [r.id, r.name]));
  const qualifierRuns = runs.filter((r) => r.kind === "feature_qualifier");

  const qualifiers = cal
    .filter((r) => r.kind === "feature_qualifier")
    .map((q) => {
      const at = slotStartMs(q.postTimeMs);
      const mine = qualifierRuns.filter((r) => slotStartMs(r.postTime.getTime()) === at).map((r) => ({ horseName: names.get(r.horseId) ?? "Your horse", position: r.position }));
      return { postTimeMs: at, done: at + RULES.slotMs < nowMs, purse: CALENDAR_PURSE.feature_qualifier, mine };
    });

  const ground = groundView(now);
  let feature: WeekView["feature"] = null;
  if (wf) {
    const c = card(wf.postTimeMs);
    const cond = c.conditions as { distanceM: number; surface: string; going: string };
    // The going is the weather on the day: real once the race is on the published card, the
    // outlook's likely going at its home course before that (the climate is never read ahead).
    const published = wf.postTimeMs <= nowMs + RULES.cardHorizonMs;
    const home = ground.courses.find((x) => x.name === CALENDAR_HOME_COURSE.weekend_feature);
    const raceDay = Math.floor(wf.postTimeMs / DAY);
    const exact = home?.days.find((d) => d.day === raceDay)?.going[wf.surface] ?? null;
    const likely = home?.outlook.find((o) => o.day === raceDay)?.likelyGoing[wf.surface] ?? null;
    const going = published ? cond.going : (exact ?? likely);
    const name = published ? c.name : `${CALENDAR_HOME_COURSE.weekend_feature} ${wf.name}`;
    feature = { name, postTimeMs: slotStartMs(wf.postTimeMs), distanceM: cond.distanceM, surface: published ? cond.surface : wf.surface, going, goingSettled: published || exact !== null, division: wf.division, purse: c.purse ?? 0, entryFee: c.entryFee ?? 0 };
  }

  const silks = parseSilks(session.stable.silks);
  const horses: WeekView["horses"] = [];
  for (const row of rows) {
    const finishes = qualifierRuns.filter((r) => r.horseId === row.id && r.position !== null).map((r) => r.position!);
    const top3 = finishes.some((p) => p <= gc.FEATURE_QUALIFY_TOP);
    const byRating = row.rating >= gc.FEATURE_RATING_BY_RIGHT;
    const status: WeekView["horses"][number]["status"] = top3 || byRating ? "qualified" : finishes.length ? "plate" : "not_yet";
    let fit: WeekView["horses"][number]["fit"] = null;
    if (feature) {
      const horse = horseFromRow(row, silks, nowMs);
      const ideal = conditionRating(horse, horse.style, { distanceM: horse.preferredDistanceM, surface: horse.preferredSurface, going: "good" });
      const here = conditionRating(horse, horse.style, { distanceM: feature.distanceM, surface: feature.surface as never, going: (feature.going ?? "good") as never });
      fit = lossGrade(Math.max(0, ideal - here)) as NonNullable<WeekView["horses"][number]["fit"]>;
    }
    const canRaceToday = (await startsOnDay(db, row.id, now, { liveOnly: true })) < RULES.liveStartsPerDay && !row.lockKind && !(row.injuredUntil && row.injuredUntil > now);
    const best = finishes.length ? Math.min(...finishes) : null;
    // Near misses, in the rules' own numbers: places short in a Qualifier, rating short of getting in by right
    const nearMiss: string[] = [];
    if (status !== "qualified") {
      const q = gc.qualifierNearMiss(best);
      if (q) nearMiss.push(q.text);
      const r = gc.featureRatingGap(row.rating);
      if (r.short > 0 && r.short <= NEAR_RATING) nearMiss.push(`${r.text} to get in by rating`);
    }
    horses.push({ id: row.id, name: row.name, rating: row.rating, status, via: top3 ? "top3" : byRating ? "rating" : null, bestQualifierFinish: best, fit, canRaceToday, nearMiss });
  }
  horses.sort((a, b) => (a.status === b.status ? (a.fit ?? "Z").localeCompare(b.fit ?? "Z") || b.rating - a.rating : a.status === "qualified" ? -1 : b.status === "qualified" ? 1 : 0));

  const table = await leagueOf(db, session.accountId, now);
  let league: WeekView["league"] = null;
  if (table) {
    const rank = table.rows.findIndex((r) => r.accountId === session.accountId) + 1;
    const me = table.rows[rank - 1];
    const line = table.rows[gc.PROMOTE - 1];
    const floor = gc.LEAGUE_TIERS.indexOf(table.tierName as gc.LeagueTier) < gc.LEAGUE_TIERS.indexOf(gc.RELEGATION_FROM_TIER);
    league = {
      tierName: table.tierName,
      rank,
      of: table.rows.length,
      points: me?.points ?? 0,
      promoteLine: line ? line.points : null,
      gapToPromotion: rank > 0 && rank <= gc.PROMOTE ? 0 : line ? Math.max(0, line.points - (me?.points ?? 0) + 1) : null,
      floor,
    };
    // the real distances to both lines, by settleLeague's own rules
    const near = gc.leagueNearMiss(
      table.rows.map((r) => ({ ownerId: r.accountId, points: r.points, wins: r.wins, bestFinish: r.bestFinish })),
      session.accountId,
      table.tierName as gc.LeagueTier,
    );
    if (near) {
      league.gapToPromotion = near.toPromotion;
      league.promotion = gc.promotionText(near);
      league.relegation = gc.relegationText(near);
    }
  }

  // The Season Final: its rating floor and the stable's closest horses (shown all season, so the gap is a target)
  const final = gc.featureCalendar(SEASON_CLOCK, season).find((r) => r.kind === "season_final") ?? null;
  const seasonFinal: WeekView["seasonFinal"] =
    final && final.postTimeMs > nowMs
      ? {
          postTimeMs: slotStartMs(final.postTimeMs),
          minRating: gc.SEASON_FINAL_MIN_RATING,
          horses: [...rows]
            .sort((a, b) => b.rating - a.rating)
            .slice(0, 3)
            .map((r) => ({ id: r.id, name: r.name, rating: r.rating, ...gc.seasonFinalGap(r.rating) })),
        }
      : null;

  const licenceOk = session.stable.licenceLevel >= gc.licenceForTier("g1", true);
  const qualified = horses.filter((h) => h.status === "qualified");
  const nextQ = qualifiers.find((q) => !q.done);
  let headline: string;
  if (!wf && finals.length) headline = "Season Final week: the championships run on the last day of the season.";
  else if (!licenceOk) headline = `Earn the ${gc.licenceDef(gc.licenceForTier("g1", true)).name} in Story mode to run on Saturday.`;
  else if (qualified.length) headline = `${qualified.map((h) => h.name).join(", ")} ${qualified.length === 1 ? "is" : "are"} in for Saturday${feature ? ` (${feature.distanceM} m, ${feature.surface}${feature.going ? `, ${feature.goingSettled ? "" : "likely "}${feature.going}` : ""})` : ""}.`;
  else if (nextQ) {
    const best = horses.find((h) => h.canRaceToday && (h.fit === "A" || h.fit === "B"));
    headline = `Not qualified yet. Next Feature Qualifier ${new Date(nextQ.postTimeMs).toUTCString().slice(0, 11)} ${new Date(nextQ.postTimeMs).toISOString().slice(11, 16)} UTC: a top 3 gets you in${best ? `; ${best.name} suits Saturday's trip` : ""}.`;
  } else headline = horses.some((h) => h.status === "plate") ? "Missed the Feature this week: your qualifier runners can take the Saturday Plate." : "No Feature Qualifiers left this week. Next week's conditions arrive on Monday.";

  return {
    serverNowMs: nowMs,
    weekStartMs: from,
    feature,
    plate: wf ? { postTimeMs: slotStartMs(wf.postTimeMs) + PLATE_AFTER_SLOTS * RULES.slotMs, purse: CALENDAR_PURSE.feature_qualifier } : null,
    finalDay: finals.length ? { postTimeMs: slotStartMs(finals[0]!.postTimeMs) } : null,
    qualifiers,
    licenceOk,
    licenceNeeded: gc.licenceDef(gc.licenceForTier("g1", true)).name,
    horses,
    league,
    upkeep: await upkeepThisWeek(db, session.stable.id, now),
    ground,
    headline,
    seasonFinal,
  };
}
