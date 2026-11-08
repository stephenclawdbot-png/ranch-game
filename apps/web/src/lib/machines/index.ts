/**
 * Every explicit UI state machine (docs/state-machines-ui.md). The docs' diagrams are generated
 * from this list (doc.test.ts), and every machine here must be well formed (machines.test.ts).
 * Components import the machine files directly; this registry is for tests, docs and agents.
 *
 * Adding a flow: declare it with `defineMachine` in a file here, drive it with `moveOr` (or the
 * `useSubmit` / `useLoad` hooks), add it below, then `BAKE_MACHINES=1 pnpm exec vitest run
 * src/lib/machines/doc.test.ts` to refresh the doc.
 */
import type { Machine } from "@thoroughbred/shared";
import { PLAYBACK_MACHINE, VIEWER_LOAD_MACHINE } from "@thoroughbred/race-viewer/machines";
import { CHECKOUT_MACHINE } from "./checkout";
import { ENTRY_SHEET_MACHINE } from "./entrySheet";
import { FOUNDING_MACHINE } from "./founding";
import { LOAD_MACHINE } from "./load";
import { PUSH_ASK_MACHINE } from "./pushAsk";
import { FINALE_MACHINE, RACE_PAGE_MACHINE } from "./racePage";
import { SUBMIT_MACHINE } from "./submit";

export { moveOr, illegalMovePolicy, setIllegalMovePolicy } from "./guard";

/** In reading order: the two shared flows first, then screen by screen, then the race viewer. */
export const UI_MACHINES: readonly Machine<string>[] = [
  SUBMIT_MACHINE,
  LOAD_MACHINE,
  ENTRY_SHEET_MACHINE,
  FOUNDING_MACHINE,
  CHECKOUT_MACHINE,
  PUSH_ASK_MACHINE,
  RACE_PAGE_MACHINE,
  FINALE_MACHINE,
  VIEWER_LOAD_MACHINE,
  PLAYBACK_MACHINE,
] as unknown as readonly Machine<string>[];
