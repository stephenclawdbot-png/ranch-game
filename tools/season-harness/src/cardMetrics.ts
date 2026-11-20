/**
 * Live card metrics: does the card fit the horses that exist?
 *
 *   - per day, the ordinary card races (no calendar race): published, run, run with a player,
 *     called off, and the real stables in each race that ran;
 *   - per meeting, an hour before its first race: the share of the active stables' racing horses
 *     that have a race they may enter in that meeting (class conditions and licence; the same
 *     check the entry sheet runs, apps/web game.ts entryReason), and in that meeting or the one
 *     before;
 *   - at each stable's first visit of the day: how long each free horse waits for the next open
 *     race it may enter.
 *
 * "Active" is a stable that visited in the last ACTIVE_WINDOW_MS. All of it is read from the game's
 * own tables and rules; nothing here changes the run.
 */
import * as gc from "@thoroughbred/game-core";
import { RULES, listCardRaces, listStableHorses, slotIndexOf, toHorseState, isGenome, type HorseRow } from "@thoroughbred/db";
import { entryReason } from "@/server/game";
import type { Agent, World } from "./agents";
import { q } from "./metrics";
import { median, pct, round1, sum } from "./stats";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const CLOCK = { epochMs: RULES.seasonEpochMs };
/** A stable counts as active for this long after a visit. */
export const ACTIVE_WINDOW_MS = 3 * DAY;
/** A horse with no race to enter on the whole published card waits "the horizon or longer". */
const NO_RACE_MIN = RULES.cardHorizonMs / MIN;

export interface CardDay {
  day: number;
  /** Stables that visited that day. */
  activeStables: number;
  /** Ordinary card races with a post time that day (sister courses apart). */
  published: number;
  sisters: number;
  ran: number;
  ranWithPlayers: number;
  calledOff: number;
  /** Sum over the races that ran with a player of the real stables in them, and the races with 2+ and 4+. */
  stableStarts: number;
  twoPlus: number;
  fourPlus: number;
  /** Meetings probed that day and the ordinary races they had on the card. */
  meetings: number;
  meetingRaces: number;
  /** Racing horses of active stables over the day's meetings: all, with a race in the meeting, with one in it or the one before. */
  horses: number;
  covered: number;
  coveredInTwo: number;
  /** Minutes each free horse waits for the next race it may enter (first visit of the day). */
  waitsMin: number[];
}

export interface CardTotals {
  days: number;
  activeStablesPerDay: number;
  published: number;
  publishedPerDay: number;
  ran: number;
  ranWithPlayers: number;
  calledOff: number;
  /** % of published ordinary races that ran with a player. */
  ranWithPlayersPct: number;
  calledOffPct: number;
  /** Real stables per race that ran with a player. */
  stablesPerRace: number;
  twoPlusPct: number;
  fourPlusPct: number;
  racesPerMeeting: number;
  /** % of active racing horses with a race they may enter in a meeting / in a meeting or the one before. */
  coveredPct: number;
  coveredInTwoPct: number;
  /** Wait for the next race a free horse may enter, minutes. */
  waitMedianMin: number;
  waitP90Min: number;
  /** % of those horses with no race to enter on the whole published card. */
  noRacePct: number;
}

export interface CardReport {
  days: CardDay[];
  totals: CardTotals;
  /** The same over the days from STEADY_FROM_DAY on (after the sign-up wave of the beta scenario). */
  steady: CardTotals | null;
}

export const STEADY_FROM_DAY = 3;

const blankDay = (day: number): CardDay => ({
  day, activeStables: 0, published: 0, sisters: 0, ran: 0, ranWithPlayers: 0, calledOff: 0, stableStarts: 0, twoPlus: 0, fourPlus: 0, meetings: 0, meetingRaces: 0, horses: 0, covered: 0, coveredInTwo: 0, waitsMin: [],
});

/** A horse that could race today if a race suited it (racing age, in training, sound). */
function canRace(h: HorseRow, nowMs: number): boolean {
  if (h.careerStatus !== "racing" || !isGenome(h.genome)) return false;
  const b = gc.raceBlock(toHorseState(h), nowMs);
  return b === null || b === "daily_limit";
}

export class CardProbe {
  private readonly lastVisit = new Map<number, number>();
  private readonly visitedToday = new Set<number>();
  /** Horse → the last meeting it had a race in. */
  private readonly lastCovered = new Map<string, number>();
  private readonly probed = new Set<number>();
  private cur: CardDay = blankDay(1);
  readonly days: CardDay[] = [];

  /** Call at every clock step, before the step's visits. */
  async atStep(world: World, tMs: number, stepMs: number): Promise<void> {
    for (const m of gc.meetingsBetween(CLOCK, tMs, tMs + HOUR + stepMs)) {
      if (this.probed.has(m.number) || m.startMs - tMs > HOUR) continue;
      this.probed.add(m.number);
      const slots = new Set<number>();
      for (let r = 0; r < m.races; r++) if (!gc.isSeasonFinalRace({ ...m, race: r })) slots.add(Math.floor((m.startMs + r * m.spacingMs - RULES.seasonEpochMs) / RULES.slotMs));
      const now = new Date(tMs);
      const card = (await listCardRaces(world.db, { from: now, to: new Date(m.lastPostMs) })).filter(
        (r) => slots.has(slotIndexOf(r.slotKey) ?? -1) && r.status === "open" && !(r.conditions as { calendar?: unknown } | null)?.calendar,
      );
      this.cur.meetings++;
      this.cur.meetingRaces += card.filter((r) => /^live\d*m?:\d+$/.test(r.slotKey ?? "")).length;
      for (const a of world.agents) {
        if ((this.lastVisit.get(a.index) ?? -Infinity) < tMs - ACTIVE_WINDOW_MS) continue;
        const licence = (await world.session(a)).stable.licenceLevel;
        for (const h of await listStableHorses(world.db, a.stableId)) {
          if (!canRace(h, tMs)) continue;
          this.cur.horses++;
          // class and licence only: a horse already entered somewhere still "has a race" here
          const free = { ...h, lockKind: null };
          const ok = card.some((r) => entryReason(free, r, now, licence) === null);
          if (ok) this.cur.covered++;
          if (ok || this.lastCovered.get(h.id) === m.number - 1) this.cur.coveredInTwo++;
          if (ok) this.lastCovered.set(h.id, m.number);
        }
      }
    }
  }

  /** Call before each visit. */
  async onVisit(world: World, a: Agent, at: Date, first: boolean): Promise<void> {
    this.lastVisit.set(a.index, at.getTime());
    this.visitedToday.add(a.index);
    if (!first || a.storyOnly) return;
    const nowMs = at.getTime();
    const licence = (await world.session(a)).stable.licenceLevel;
    const horses = (await listStableHorses(world.db, a.stableId)).filter((h) => !h.lockKind && canRace(h, nowMs));
    if (!horses.length) return;
    const card = (await listCardRaces(world.db, { from: at, to: new Date(nowMs + RULES.cardHorizonMs) })).filter((r) => r.status === "open" && r.entriesCloseAt.getTime() > nowMs + MIN);
    for (const h of horses) {
      const next = card.find((r) => entryReason(h, r, at, licence) === null);
      this.cur.waitsMin.push(next ? Math.round((next.postTime.getTime() - nowMs) / MIN) : NO_RACE_MIN);
    }
  }

  /** Call when a simulated day ends: closes the day's sample with its race counts. */
  async endDay(world: World, day: number, fromMs: number, toMs: number): Promise<void> {
    const rows = await q<{ status: string; sister: boolean; st: number }>(
      world.db,
      `select r.status, (r.slot_key ~ ':[0-9]+:[0-9]+$') sister,
              count(distinct e.stable_id) filter (where e.status = 'entered' and e.stable_id is not null)::int st
         from races r left join race_entries e on e.race_id = r.id
        where r.slot_key like 'live%:%' and r.kind in ('scheduled','feature') and (r.conditions->'calendar') is null
          and r.post_time >= '${new Date(fromMs).toISOString()}' and r.post_time < '${new Date(toMs).toISOString()}'
        group by r.id`,
    );
    const d = this.cur;
    d.day = day;
    d.activeStables = this.visitedToday.size;
    for (const r of rows) {
      const st = Number(r.st);
      if (r.sister) d.sisters++;
      else d.published++;
      if (r.status === "cancelled") d.calledOff++;
      if (r.status !== "settled") continue;
      d.ran++;
      if (st > 0) {
        d.ranWithPlayers++;
        d.stableStarts += st;
        if (st >= 2) d.twoPlus++;
        if (st >= 4) d.fourPlus++;
      }
    }
    this.days.push(d);
    this.cur = blankDay(day + 1);
    this.visitedToday.clear();
  }

  report(): CardReport {
    const steady = this.days.filter((d) => d.day >= STEADY_FROM_DAY);
    return { days: this.days, totals: cardTotals(this.days), steady: steady.length && steady.length < this.days.length ? cardTotals(steady) : null };
  }
}

export function cardTotals(days: readonly CardDay[]): CardTotals {
  const s = (f: (d: CardDay) => number) => sum(days.map(f));
  const all = s((d) => d.published) + s((d) => d.sisters);
  const waits = days.flatMap((d) => d.waitsMin).sort((a, b) => a - b);
  const withPlayers = s((d) => d.ranWithPlayers);
  return {
    days: days.length,
    activeStablesPerDay: round1(s((d) => d.activeStables) / Math.max(1, days.length)),
    published: all,
    publishedPerDay: round1(all / Math.max(1, days.length)),
    ran: s((d) => d.ran),
    ranWithPlayers: withPlayers,
    calledOff: s((d) => d.calledOff),
    ranWithPlayersPct: pct(withPlayers, all),
    calledOffPct: pct(s((d) => d.calledOff), all),
    stablesPerRace: withPlayers ? Math.round((100 * s((d) => d.stableStarts)) / withPlayers) / 100 : 0,
    twoPlusPct: pct(s((d) => d.twoPlus), withPlayers),
    fourPlusPct: pct(s((d) => d.fourPlus), withPlayers),
    racesPerMeeting: Math.round((100 * s((d) => d.meetingRaces)) / Math.max(1, s((d) => d.meetings))) / 100,
    coveredPct: pct(s((d) => d.covered), s((d) => d.horses)),
    coveredInTwoPct: pct(s((d) => d.coveredInTwo), s((d) => d.horses)),
    waitMedianMin: median(waits),
    waitP90Min: waits.length ? waits[Math.min(waits.length - 1, Math.floor(waits.length * 0.9))]! : 0,
    noRacePct: pct(waits.filter((w) => w >= NO_RACE_MIN).length, waits.length),
  };
}

/** The Live card section of summary.md. */
export function cardSummary(c: CardReport, base: CardReport | null, tag: string, baseTag: string | null): string[] {
  const L: string[] = ["", "## Live card: does it fit the horses that exist?", ""];
  const rows: [string, (t: CardTotals) => string][] = [
    ["Stables playing a day", (t) => String(t.activeStablesPerDay)],
    ["Ordinary races published (a day)", (t) => `${t.published} (${t.publishedPerDay})`],
    ["Ordinary races per meeting", (t) => String(t.racesPerMeeting)],
    ["Ran with a player", (t) => `${t.ranWithPlayers} (${t.ranWithPlayersPct}%)`],
    ["Called off (no player)", (t) => `${t.calledOff} (${t.calledOffPct}%)`],
    ["Real stables per race run", (t) => String(t.stablesPerRace)],
    ["Races run with 2+ / 4+ real stables", (t) => `${t.twoPlusPct}% / ${t.fourPlusPct}%`],
    ["Active racing horses with a race in a meeting", (t) => `${t.coveredPct}%`],
    ["... in a meeting or the one before", (t) => `${t.coveredInTwoPct}%`],
    ["Wait to the next race a free horse may enter (median / p90)", (t) => `${t.waitMedianMin} / ${t.waitP90Min} min`],
    ["Free horses with no race to enter on the card", (t) => `${t.noRacePct}%`],
  ];
  const cols: [string, CardTotals][] = [[`${tag}: all ${c.totals.days} days`, c.totals]];
  if (c.steady) cols.push([`${tag}: day ${STEADY_FROM_DAY} on`, c.steady]);
  if (base) {
    cols.push([`${baseTag}: all days`, base.totals]);
    if (base.steady) cols.push([`${baseTag}: day ${STEADY_FROM_DAY} on`, base.steady]);
  }
  L.push(`| | ${cols.map(([h]) => h).join(" | ")} |`, `|---|${cols.map(() => "---:").join("|")}|`);
  for (const [label, f] of rows) L.push(`| ${label} | ${cols.map(([, t]) => f(t)).join(" | ")} |`);
  L.push("", "| day | stables playing | published | ran with a player | called off | stables per race | races per meeting | horses with a race in the meeting | median wait (min) |", "|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const d of c.days) {
    const t = cardTotals([d]);
    L.push(`| ${d.day} | ${d.activeStables} | ${t.published} | ${t.ranWithPlayers} | ${t.calledOff} | ${t.stablesPerRace} | ${t.racesPerMeeting} | ${t.coveredPct}% | ${t.waitMedianMin} |`);
  }
  return L;
}
