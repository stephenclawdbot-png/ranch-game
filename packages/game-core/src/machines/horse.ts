/**
 * Horse lifecycles (docs/state-machines.md): the racing career, the career-clock stage and a
 * pregnancy. The database backs the career rules with a trigger (0001_integrity_guards.sql:
 * pasture is permanent, racing retirement is final), so this machine and the trigger must agree.
 */
import { defineMachine, type StateOf } from "@thoroughbred/shared";

/** horses.career_status (pgEnum career_status). */
export const horseCareerMachine = defineMachine({
  name: "horseCareer",
  storedIn: "horses.career_status (pgEnum career_status; DB trigger enforces the same moves)",
  states: ["racing", "retired", "pasture"],
  initial: "racing",
  terminal: ["pasture"],
  transitions: {
    racing: ["retired", "pasture"],
    retired: ["pasture"],
  },
  describe: {
    racing: "In training and racing (or still in the nursery).",
    retired: "Racing retirement (choice, max starts, injury): final; may still breed.",
    pasture: "Pasture / Legend on the Legacy Farm: permanent, needs no stall (also a fatal injury).",
  },
});
export type HorseCareerStatus = StateOf<typeof horseCareerMachine>;

/**
 * horses.stage (pgEnum horse_stage): the career clock (care sessions in the nursery, then starts;
 * db rules.ts stageFor). Both counters only grow, so the stage only moves forward, and a write
 * can jump several stages at once (a horse made at any stage starts there).
 */
const HORSE_STAGES = ["foal", "weanling", "yearling", "juvenile", "prime", "veteran"] as const;
export const horseStageMachine = defineMachine({
  name: "horseStage",
  storedIn: "horses.stage (pgEnum horse_stage), from stageFor(careSessions, starts)",
  states: HORSE_STAGES,
  initial: HORSE_STAGES,
  terminal: ["veteran"],
  transitions: {
    foal: ["weanling", "yearling", "juvenile", "prime", "veteran"],
    weanling: ["yearling", "juvenile", "prime", "veteran"],
    yearling: ["juvenile", "prime", "veteran"],
    juvenile: ["prime", "veteran"],
    prime: ["veteran"],
  },
  describe: {
    foal: "Nursery: fewer than CARE_TO_WEAN counted care sessions.",
    weanling: "Nursery: weaned, not yet a yearling.",
    yearling: "Nursery: not yet enough care sessions to race.",
    juvenile: "Racing age, early starts.",
    prime: "Racing, the middle of the career by starts.",
    veteran: "Racing, late career by starts.",
  },
});
export type HorseStage = StateOf<typeof horseStageMachine>;

/** pregnancies.status (pgEnum pregnancy_status). services/breeding.ts. */
export const pregnancyMachine = defineMachine({
  name: "pregnancy",
  storedIn: "pregnancies.status (pgEnum pregnancy_status)",
  states: ["carrying", "foaled", "lost"],
  initial: "carrying",
  terminal: ["foaled", "lost"],
  transitions: { carrying: ["foaled", "lost"] },
  describe: {
    carrying: "In foal until dueAt (the mare can't race or be sold meanwhile).",
    foaled: "The foal was born (foalId set, inheritance seed revealed).",
    lost: "Reserved in the enum: no code path writes it today (foals are never lost).",
  },
});
export type PregnancyStatus = StateOf<typeof pregnancyMachine>;
