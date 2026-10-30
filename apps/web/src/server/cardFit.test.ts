/**
 * Content check for the Live card calendar (packages/db `defaultCardSlot`): every starter
 * horse finds a race it may enter (class, licence) that suits its surface and trip (form-guide
 * fit grade C or better) somewhere in the published card (a day: three race meetings, 24 races),
 * wherever you start looking.
 * Before the fix the card ran turf and dirt only, at up to 2,400 m, and most synthetic or
 * staying starters never found a suitable race.
 */
import { describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { CALENDAR_PURSE, RULES, cardSlotAt, defaultCardSlot, slotIndexAt, type CreateRaceInput } from "@thoroughbred/db";
import { conditionRating } from "@/lib/aptitude";
import { raceConds, raceTier } from "./horseView";

const SILKS = { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" } as const;
const T = Date.UTC(2026, 10, 2, 12, 0, 7);
/** The published card: every race a player can enter right now (RULES.cardHorizonMs: a day of meetings). */
const WINDOW = gc.LIVE_RACES_PER_DAY;

function slotOf(input: CreateRaceInput): gc.RaceSlot {
  const c = raceConds(input);
  return {
    id: input.slotKey ?? "slot",
    name: input.name,
    kind: input.kind === "final" ? "season_final" : input.kind === "feature" ? "weekend_feature" : "regular",
    tier: raceTier(input),
    season: input.seasonNumber ?? 1,
    postTimeMs: input.postTime.getTime(),
    entryCloseMs: input.entriesCloseAt.getTime(),
    distanceM: c.distanceM,
    surface: c.surface,
    goingForecast: c.going,
    weather: c.weather,
    purse: input.purse ?? 0,
    entryFee: 0,
    maxRunners: input.maxRunners ?? 12,
    handicap: input.raceClass === "handicap",
    division: null,
  };
}

describe("Live card content fits the horses players actually have", () => {
  it("every starter has an enterable race with grade C fit or better in the published card (B for nearly all)", { timeout: 60_000 }, () => {
    const base = slotIndexAt(new Date(T));
    // the meeting races of 60 days in order (slots between meetings have no race)
    const card = Array.from({ length: gc.SLOTS_PER_DAY * 60 }, (_, i) => cardSlotAt(base + i)).filter((s) => s !== null);
    expect(card.length).toBeGreaterThan(gc.LIVE_RACES_PER_DAY * 59);
    expect(new Set(card.map((s) => s.conditions.surface))).toEqual(new Set(["turf", "dirt", "synthetic"]));
    let checks = 0;
    let bWithin = 0;
    for (let s = 0; s < 120; s++) {
      for (const state of gc.createStarterStable({ ownerId: `owner-${s}`, seed: `card-fit-${s}`, nowMs: T, season: 1 })) {
        const horse = gc.toSharedHorse(state, T, SILKS);
        const ideal = conditionRating(horse, horse.style, { distanceM: horse.preferredDistanceM, surface: horse.preferredSurface, going: "good" });
        for (let off = 0; off + WINDOW < card.length; off += 37) {
          const first = (maxLoss: number) =>
            card.slice(off, off + WINDOW).findIndex((input) => {
              const slot = slotOf(input);
              const now = slot.entryCloseMs - 60_000;
              if (gc.entryBlock(state, slot, now) !== null) return false;
              if (gc.licenceBlock(1, slot.tier, input.kind === "feature" || input.kind === "final")) return false;
              const loss = ideal - conditionRating(horse, horse.style, { distanceM: slot.distanceM, surface: slot.surface, going: slot.goingForecast });
              return loss <= maxLoss;
            });
          checks++;
          const c = first(45);
          if (c < 0) throw new Error(`${horse.name} (${horse.preferredDistanceM} m, ${horse.preferredSurface}) found no suitable race in slots ${off}..${off + WINDOW}`);
          if (first(25) >= 0) bWithin++;
        }
      }
    }
    expect(checks).toBeGreaterThan(1000);
    // the published card always holds a day of meetings
    expect(RULES.cardHorizonMs).toBe(gc.MS_PER_DAY);
    expect(bWithin / checks).toBeGreaterThan(0.9);
  });

  it("the season calendar's Weekend Feature and Season Final are on the card", () => {
    const season = gc.seasonOf({ epochMs: Date.UTC(2026, 0, 5) }, T);
    const cal = gc.featureCalendar({ epochMs: Date.UTC(2026, 0, 5) }, season);
    for (const sp of cal.filter((r) => r.kind !== "feature_qualifier")) {
      const slot = defaultCardSlot(slotIndexAt(new Date(sp.postTimeMs)));
      expect(slot.kind).toBe(sp.kind === "season_final" ? "final" : "feature");
      expect(slot.name).toContain(sp.name);
      expect(slot.purse).toBe(CALENDAR_PURSE[sp.kind as keyof typeof CALENDAR_PURSE]);
    }
  });
});
