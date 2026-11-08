/**
 * The entry sheet (EntryProvider): the one modal every "Enter" / "Quick Pick" button opens.
 *
 * What it shows is one value (`EntrySheetState.target`); its view name is the machine state.
 * Every open and every pick carries a token from the provider's counter: a result only lands if
 * no other sheet was opened since (an old Quick Pick finishing late can't replace the form you
 * are now filling in). Closing does not cancel a pick already sent: if it finishes after you
 * closed the sheet, the sheet reopens with the outcome (you were entered, or why not), as it
 * always has.
 */
import { defineMachine } from "@thoroughbred/shared";
import { moveOr } from "./guard";

export const ENTRY_SHEET_MACHINE = defineMachine({
  name: "entrySheet",
  storedIn: "EntryProvider (apps/web/src/components/entry/EntryProvider.tsx, useReducer)",
  states: ["closed", "entry", "live", "pick", "pickEntering", "pickLater", "pickFailed", "livePickFinding", "livePicked", "livePickFailed"],
  initial: "closed",
  transitions: {
    closed: ["entry", "live", "pick", "livePickFinding", "pickLater", "pickFailed", "livePicked", "livePickFailed"],
    entry: ["closed"],
    live: ["closed"],
    pick: ["pickEntering", "closed"],
    pickEntering: ["pickLater", "pickFailed", "closed"],
    pickLater: ["closed"],
    pickFailed: ["pick", "closed"],
    livePickFinding: ["livePicked", "livePickFailed", "closed"],
    livePicked: ["closed"],
    livePickFailed: ["livePickFinding", "closed"],
  },
  describe: {
    closed: "No sheet. A pick that finishes after the sheet was closed reopens it with the outcome. Opening while another sheet is open closes that one first.",
    entry: "Story entry form for one horse (EntryForm; its button is its own submit flow).",
    live: "Live entry form for a card race (its options load, then its own submit flow).",
    pick: "Story Quick Pick card: Watch / Skip to result / Watch later.",
    pickEntering: "The pick is being entered; all three buttons are disabled. Ends by the API timeout at worst. Watch / Skip close the sheet and open the race.",
    pickLater: "Entered to watch later: when it runs, and Watch it now.",
    pickFailed: "Couldn't enter, with Try again (back to the pick card).",
    livePickFinding: "Live Quick Pick: finding and entering the next suitable race. Ends by the API timeout at worst.",
    livePicked: "Entered: the race, when it runs, the phone alerts ask.",
    livePickFailed: "Couldn't enter, with Try again.",
  },
});

export type EntrySheetView = (typeof ENTRY_SHEET_MACHINE.states)[number];
export type WatchMode = "watch" | "instant" | "later";

/** The data each view shows. `R` / `P` are the pick results (generic, so this file stays free of UI types). */
export type EntryTarget<R, P> =
  | { kind: "entry"; horseId: string | null; picker: boolean; nonce: number }
  | { kind: "pick"; status: "choose" | "error"; busy?: WatchMode; error?: unknown }
  | { kind: "pick"; status: "later"; result: R }
  | { kind: "live"; raceId: string; nonce: number }
  | { kind: "livePick"; status: "busy" | "error"; error?: unknown }
  | { kind: "livePick"; status: "done"; result: P };

export interface EntrySheetState<R, P> {
  target: EntryTarget<R, P> | null;
  /** The token of the last open / start: async results carrying an older one are dropped. */
  token: number;
}

export type EntrySheetEvent<R, P> =
  | { type: "openEntry"; token: number; horseId: string | null; picker: boolean; nonce: number }
  | { type: "openLive"; token: number; raceId: string; nonce: number }
  | { type: "openPick"; token: number }
  | { type: "startLivePick"; token: number }
  | { type: "livePickDone"; token: number; result: P }
  | { type: "livePickFailed"; token: number; error: unknown }
  | { type: "startPick"; token: number; mode: WatchMode }
  | { type: "pickLater"; token: number; result: R }
  | { type: "pickFailed"; token: number; error: unknown }
  /** Watch / Skip to result went through: the sheet closes and the race page opens. */
  | { type: "pickLeft"; token: number }
  | { type: "close" };

export function entrySheetView<R, P>(t: EntryTarget<R, P> | null): EntrySheetView {
  if (!t) return "closed";
  switch (t.kind) {
    case "entry":
      return "entry";
    case "live":
      return "live";
    case "pick":
      return t.status === "later" ? "pickLater" : t.status === "error" ? "pickFailed" : t.busy ? "pickEntering" : "pick";
    case "livePick":
      return t.status === "done" ? "livePicked" : t.status === "error" ? "livePickFailed" : "livePickFinding";
  }
}

export const ENTRY_SHEET_CLOSED: EntrySheetState<never, never> = { target: null, token: 0 };

export function entrySheetReducer<R, P>(state: EntrySheetState<R, P>, event: EntrySheetEvent<R, P>): EntrySheetState<R, P> {
  const from = entrySheetView(state.target);
  const ctx = `entrySheet:${event.type}`;
  /** A guarded move to `target`; an illegal move leaves the state as it was. */
  const go = (target: EntryTarget<R, P> | null, token = state.token): EntrySheetState<R, P> => {
    const to = entrySheetView(target);
    return moveOr(ENTRY_SHEET_MACHINE, from, to, ctx) === to ? { target, token } : state;
  };
  /** Open a sheet: directly when the machine allows it (closed, or a Try again), else close the open one first. */
  const open = (target: EntryTarget<R, P>, token: number): EntrySheetState<R, P> => {
    const to = entrySheetView(target);
    const base = from === "closed" || ENTRY_SHEET_MACHINE.can(from, to) ? from : moveOr(ENTRY_SHEET_MACHINE, from, "closed", ctx);
    if (base !== "closed" && !ENTRY_SHEET_MACHINE.can(base, to)) return state;
    return moveOr(ENTRY_SHEET_MACHINE, base, to, ctx) === to ? { target, token } : state;
  };
  const stale = (token: number) => token !== state.token;

  switch (event.type) {
    case "openEntry":
      return open({ kind: "entry", horseId: event.horseId, picker: event.picker, nonce: event.nonce }, event.token);
    case "openLive":
      return open({ kind: "live", raceId: event.raceId, nonce: event.nonce }, event.token);
    case "openPick":
      return open({ kind: "pick", status: "choose" }, event.token);
    case "startLivePick":
      return open({ kind: "livePick", status: "busy" }, event.token);
    case "startPick":
      // Only from the pick card; a second tap while entering is ignored (the buttons are disabled too).
      return from === "pick" ? go({ kind: "pick", status: "choose", busy: event.mode }, event.token) : state;
    case "livePickDone":
      return stale(event.token) ? state : go({ kind: "livePick", status: "done", result: event.result });
    case "livePickFailed":
      return stale(event.token) ? state : go({ kind: "livePick", status: "error", error: event.error });
    case "pickLater":
      return stale(event.token) ? state : go({ kind: "pick", status: "later", result: event.result });
    case "pickFailed":
      return stale(event.token) ? state : go({ kind: "pick", status: "error", error: event.error });
    case "pickLeft":
      return stale(event.token) || from === "closed" ? state : go(null);
    case "close":
      return from === "closed" ? state : go(null);
  }
}
