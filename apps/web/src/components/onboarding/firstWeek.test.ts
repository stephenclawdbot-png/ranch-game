/**
 * The first-week list on Home (first-hour playtest): one checklist, the next few jobs each one tap
 * to where they're done, today's goals folded in, and the tester's login code moved off the
 * welcome screen to after the first result.
 */
import React from "react";
(globalThis as unknown as { React: typeof React }).React = React;
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import type { PlayerState } from "@/lib/player";
import type { DailyGoalView, FirstWeekView } from "@/lib/types";

// Mentor.tsx draws JSX at module level (classic runtime in these tests): load after React is global.
const { LOGIN_CODE_MARK, showLoginCodeAfterResult } = await import("../chain/LoginCodeCard");
const { keyCardLine, SIGN_IN_ADDRESS } = await import("../chain/ComeBackKey");
const { StableSteps, stepHref } = await import("./StableSteps");
const { STEP_COPY } = await import("./guide");

const horse = (id: string, starts: number) => ({ id, careerStatus: "racing", starts, lease: null, horse: { id, name: id, stats: { speed: 500, stamina: 500 } }, block: null, condition: "fresh", ranToday: 0 });
const state = {
  horses: [horse("raced", 3), horse("unraced", 0)],
  active: [],
  inbox: [],
  goals: [],
} as unknown as PlayerState;

function week(done: Set<string>, facts: Partial<gc.FirstWeekFacts> = {}): FirstWeekView {
  const l = gc.firstWeekList(gc.stableStepsProgress(done, { quickRaces: true }), {
    guided: true,
    daysSinceFounding: 1,
    firstRace: true,
    renamed: false,
    canRename: true,
    qualifier: false,
    careerStory: false,
    ...facts,
  });
  return { ...l, endsAtMs: 0 };
}

const goals: DailyGoalView[] = [
  { goal: "race", label: "Run a Story or Live race", done: true, credits: 45 },
  { goal: "care", label: "Care for a horse", done: false, credits: 45 },
  { goal: "cup", label: "Run the Daily Cup", done: false, credits: 45 },
];

describe("the first-week card", () => {
  it("shows the next three jobs in order, each a tap to the right place, with today's goals folded in", () => {
    const w = week(new Set(["read_why", "care", "train_plan", "enter_live", "watch_live"]));
    expect(w.next).toEqual(["rename", "daily_cup", "qualifier"]);
    const html = renderToStaticMarkup(React.createElement(StableSteps, { week: w, steps: null, state, plain: false, goals }));
    expect(html).toContain("Your first week");
    expect(html).toContain(`${w.done} of ${w.total} done`);
    const todo = html.slice(html.indexOf('data-testid="steps-todo"'), html.indexOf('data-testid="daily-goals"'));
    expect(todo.indexOf(STEP_COPY.rename!.title)).toBeLessThan(todo.indexOf(STEP_COPY.daily_cup!.title));
    expect(todo.indexOf(STEP_COPY.daily_cup!.title)).toBeLessThan(todo.indexOf(STEP_COPY.qualifier!.title));
    expect(todo).toContain('href="/horse/unraced/career"');
    expect(todo).toContain('href="/cup"');
    expect(todo).toContain('href="/week"');
    expect(todo).toContain('data-testid="steps-next"');
    // Wilf says what the next job is for.
    expect(html).toContain(STEP_COPY.rename!.text.replace(/'/g, "&#x27;"));
    // Today's goals: one line each, ticked from the server, inside the same card.
    expect(html).toContain('data-testid="daily-goals"');
    expect(html).toContain('data-testid="goal-race" data-done="1"');
    expect(html).toContain('data-testid="goal-care" data-done="0"');
    expect(html).toContain("2 to do");
  });

  it("a Live entry is a button (the quick-pick sheet), not a link", () => {
    const w = week(new Set(["read_why", "care", "train_plan"]));
    expect(w.next[0]).toBe("enter_live");
    const html = renderToStaticMarkup(React.createElement(StableSteps, { week: w, steps: null, state, plain: false }));
    expect(html).toMatch(/<button[^>]*data-testid="steps-next"/);
  });

  it("every job on the list has words and a place to go", () => {
    for (const k of gc.FIRST_WEEK_ORDER) {
      expect(STEP_COPY[k]?.title, k).toBeTruthy();
      expect(STEP_COPY[k]?.text, k).toBeTruthy();
      expect(stepHref(k, state), k).not.toBe("/");
    }
    expect(stepHref("career_story", state)).toBe("/horse/raced#story-h");
    expect(stepHref("rename", state)).toBe("/horse/unraced/career");
    expect(stepHref("breeding_preview", state)).toBe("/breeding#finder");
  });
});

describe("the tester's login code", () => {
  it("shows after a result to testers only, until dismissed", () => {
    expect(showLoginCodeAfterResult(true, [])).toBe(true);
    expect(showLoginCodeAfterResult(false, [])).toBe(false);
    expect(showLoginCodeAfterResult(undefined, [])).toBe(false);
    expect(showLoginCodeAfterResult(true, undefined)).toBe(false);
    expect(showLoginCodeAfterResult(true, [LOGIN_CODE_MARK])).toBe(false);
    // An existing stable's "*" (coach marks off) doesn't hide it: only its own dismissal does.
    expect(showLoginCodeAfterResult(true, ["*"])).toBe(true);
  });

  it("comes first as the key screen right after naming the stable, then Profile and the after-result reminder", () => {
    const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
    const play = src("../../../app/play/PlayClient.tsx");
    // Not the big card on the starters screen; the one-screen key instead, before the mentor.
    expect(play).not.toContain("LoginCodeCard");
    expect(play).toContain("<ComeBackKey");
    expect(play.indexOf('setStage("key")')).toBeGreaterThan(play.indexOf("await createStable("));
    expect(play).toMatch(/stage === "key"[\s\S]*setStage\("mentor"\)/);
    expect(src("../../../app/me/page.tsx")).toContain("<LoginCodeCard");
    expect(src("../race/RaceExperience.tsx")).toContain("<LoginCodeAfterResult");
  });

  it("the key screen: the stable name with the code, one brass button; copying or saving marks it kept", () => {
    const src = readFileSync(fileURLToPath(new URL("../chain/ComeBackKey.tsx", import.meta.url)), "utf8");
    expect(keyCardLine("Moss Lane", "PT-AAAAA-BBBBB-CCCCC-DDDDD")).toBe("Moss Lane · PT-AAAAA-BBBBB-CCCCC-DDDDD");
    expect(src).toContain("Your key to come back");
    expect(src).toContain("Save this code: it is how you get back in.");
    expect(src.match(/btn-brass/g)).toHaveLength(1);
    // Copy, image and share each record the mark; the brass button alone doesn't.
    expect(src.match(/markLoginCodeSaved\(\);/g)?.length).toBe(3);
    expect(SIGN_IN_ADDRESS).toBe("posttime.family/link");
  });
});
