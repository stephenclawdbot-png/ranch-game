/**
 * The database holds exactly the states the game-core machines declare (docs/state-machines.md):
 * every pgEnum's values, and every text status column's CHECK list, equal its machine's states.
 * Plus the service guard (checkMove): strict in tests and development, a warning in production.
 */
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import * as gc from "@thoroughbred/game-core";
import { IllegalTransitionError } from "@thoroughbred/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkMove, fromStates } from "../machines";
import { RULES, stageFor } from "../rules";
import * as schema from "../schema";

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("pgEnums equal their machines' states", () => {
  const cases: [string, readonly string[], readonly string[]][] = [
    ["race_status", schema.raceStatusEnum.enumValues, gc.raceMachine.states],
    ["entry_status", schema.entryStatusEnum.enumValues, gc.raceEntryMachine.states],
    ["career_status", schema.careerStatusEnum.enumValues, gc.horseCareerMachine.states],
    ["horse_stage", schema.horseStageEnum.enumValues, gc.horseStageMachine.states],
    ["pregnancy_status", schema.pregnancyStatusEnum.enumValues, gc.pregnancyMachine.states],
    ["season_status", schema.seasonStatusEnum.enumValues, gc.seasonMachine.states],
    ["listing_status", schema.listingStatusEnum.enumValues, gc.listingMachine.states],
    ["tote_bet_status", schema.toteBetStatusEnum.enumValues, gc.toteBetMachine.states],
  ];
  for (const [name, values, states] of cases) {
    it(name, () => expect(sorted(values)).toEqual(sorted(states)));
  }
});

describe("text status CHECK constraints equal their machines' states", () => {
  const dialect = new PgDialect();
  /** The quoted values of `<column> in ('a', 'b', ...)` in the named CHECK. */
  const checkValues = (table: PgTable, checkName: string): string[] => {
    const c = getTableConfig(table).checks.find((x) => x.name === checkName);
    if (!c) throw new Error(`no CHECK ${checkName}`);
    const text = dialect.sqlToQuery(c.value).sql;
    const list = /\bin\s*\(([^)]*)\)/i.exec(text);
    if (!list) throw new Error(`CHECK ${checkName} is not an IN list: ${text}`);
    return [...list[1]!.matchAll(/'([^']*)'/g)].map((m) => m[1]!);
  };
  const cases: [PgTable, string, readonly string[]][] = [
    [schema.raceClaims, "race_claims_status", gc.raceClaimMachine.states],
    [schema.horseLeases, "horse_leases_status", gc.leaseMachine.states],
    [schema.usdgListings, "usdg_listings_status", gc.usdgListingMachine.states],
    [schema.usdgBids, "usdg_bids_status", gc.usdgBidMachine.states],
    [schema.usdgOrders, "usdg_orders_status", gc.usdgOrderMachine.states],
    [schema.jockeyContracts, "jockey_contracts_status", gc.jockeyContractMachine.states],
    [schema.jockeyOffers, "jockey_offers_status", gc.jockeyOfferMachine.states],
    [schema.racePicks, "race_picks_outcome", gc.racePickMachine.states],
    [schema.realToteRaces, "real_tote_races_status", gc.realToteRaceMachine.states],
    [schema.chainOrders, "chain_orders_status", gc.chainOrderMachine.states],
    [schema.poolEpochs, "pool_epochs_status", gc.poolEpochMachine.states],
    [schema.betaRewards, "beta_rewards_status", gc.betaRewardMachine.states],
    [schema.feedback, "feedback_status", gc.feedbackMachine.states],
  ];
  for (const [table, name, states] of cases) {
    it(name, () => expect(sorted(checkValues(table, name))).toEqual(sorted(states)));
  }

  it("columns without a CHECK still default to their machine's initial state", () => {
    expect(gc.pushDeliveryMachine.initialStates).toEqual(["pending"]);
    expect(gc.jockeyStageMachine.is(schema.jockeys.stage.default)).toBe(true);
  });
});

describe("derived stages only move forward", () => {
  it("stageFor (horses.stage): one more care session or one more start is never a backward move", () => {
    for (let care = 0; care <= RULES.careToRacing + 3; care++) {
      for (let starts = 0; starts <= RULES.maxStarts + 2; starts++) {
        const here = stageFor(care, starts);
        for (const next of [stageFor(care + 1, starts), stageFor(care, starts + 1)]) {
          expect(next === here || gc.horseStageMachine.can(here, next), `${care}/${starts}: ${here} -> ${next}`).toBe(true);
        }
      }
    }
  });

  it("jockeyStageAt (jockeys.stage): later is never a backward move", () => {
    const WEEK = 7 * 86_400_000;
    let prev = gc.jockeyStageAt(0, 0);
    for (let w = 0; w <= 600; w++) {
      const s = gc.jockeyStageAt(0, w * WEEK + 1);
      expect(s === prev || gc.jockeyStageMachine.can(prev, s), `week ${w}: ${prev} -> ${s}`).toBe(true);
      prev = s;
    }
  });
});

describe("checkMove", () => {
  const env = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = env;
    vi.restoreAllMocks();
  });

  it("passes legal moves and no-moves", () => {
    expect(checkMove(gc.raceMachine, "open", "locked", "r1")).toBe(true);
    expect(checkMove(gc.raceMachine, "settled", "settled", "r1")).toBe(true);
  });

  it("throws IllegalTransitionError outside production (tests, development)", () => {
    expect(() => checkMove(gc.raceMachine, "settled", "cancelled", "r1")).toThrow(IllegalTransitionError);
    expect(() => checkMove(gc.raceMachine, "settled", "cancelled", "r1")).toThrow(/race: cannot move from "settled" to "cancelled" \(id r1\)/);
    expect(() => checkMove(gc.toteBetMachine, "nonsense", "won")).toThrow(IllegalTransitionError);
    expect(() => checkMove(gc.usdgBidMachine, undefined, "won")).toThrow(IllegalTransitionError);
  });

  it("in production: one structured warning, returns false, never throws", () => {
    process.env.NODE_ENV = "production";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(checkMove(gc.raceMachine, "settled", "cancelled", "r1")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toEqual({ event: "illegal_transition", machine: "race", from: "settled", to: "cancelled", id: "r1" });
    expect(checkMove(gc.raceMachine, "open", "locked")).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("fromStates gives the guarded-update sources", () => {
    expect(fromStates(gc.toteBetMachine, "won")).toEqual(["open"]);
    expect(sorted(fromStates(gc.chainOrderMachine, "paid"))).toEqual(["expired", "quoted", "submitted"]);
    expect(() => fromStates(gc.raceMachine, "open")).toThrow(/nothing moves into/);
  });
});
