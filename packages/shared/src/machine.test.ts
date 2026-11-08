import { describe, expect, it } from "vitest";
import { IllegalTransitionError, defineMachine, machineProblems } from "./machine";

const door = defineMachine({
  name: "door",
  storedIn: "test",
  states: ["closed", "open", "locked", "removed"],
  initial: "closed",
  terminal: ["removed"],
  transitions: { closed: ["open", "locked", "removed"], open: ["closed"], locked: ["closed"] },
});

describe("defineMachine", () => {
  it("answers can / next / sourcesOf / is", () => {
    expect(door.can("closed", "open")).toBe(true);
    expect(door.can("open", "locked")).toBe(false);
    expect(door.can("open", "open")).toBe(false);
    expect(door.next("closed")).toEqual(["open", "locked", "removed"]);
    expect(door.next("removed")).toEqual([]);
    expect(door.sourcesOf("closed")).toEqual(["open", "locked"]);
    expect(door.is("open")).toBe(true);
    expect(door.is("ajar")).toBe(false);
    expect(door.is(3)).toBe(false);
    expect(door.isTerminal("removed")).toBe(true);
  });

  it("assert throws a typed error on an illegal move", () => {
    expect(() => door.assert("closed", "open")).not.toThrow();
    try {
      door.assert("locked", "open", "test case");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalTransitionError);
      expect((err as IllegalTransitionError).message).toBe('door: cannot move from "locked" to "open" (test case)');
    }
  });

  it("rejects unknown states and terminal states with exits", () => {
    expect(() => defineMachine({ name: "bad", states: ["a"], initial: "a", transitions: { a: ["b" as "a"] } })).toThrow(/unknown state "b"/);
    expect(() => defineMachine({ name: "bad", states: ["a", "b"], initial: "a", terminal: ["a"], transitions: { a: ["b"] } })).toThrow(/terminal state "a" has transitions/);
  });

  it("finds unreachable states and unmarked dead ends", () => {
    expect(machineProblems(door)).toEqual([]);
    const m = defineMachine({ name: "m", states: ["a", "b", "c"], initial: "a", transitions: { a: ["b"] } });
    expect(machineProblems(m)).toEqual(['m: "b" is a dead end but not marked terminal', 'm: "c" cannot be reached from a', 'm: "c" is a dead end but not marked terminal']);
  });

  it("draws a Mermaid diagram", () => {
    expect(door.toMermaid()).toBe(
      ["stateDiagram-v2", "  [*] --> closed", "  closed --> open", "  closed --> locked", "  closed --> removed", "  open --> closed", "  locked --> closed", "  removed --> [*]"].join("\n"),
    );
  });
});
