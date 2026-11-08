/**
 * Status moves in services go through the game-core machine registry (docs/state-machines.md).
 *
 * Before a service writes a new status it calls `checkMove(machine, from, to, id)` with the status
 * it already read. A legal move (or no move: from === to, an idempotent rewrite) passes. An illegal
 * move is a bug:
 *   - in tests and development (NODE_ENV !== "production") it throws IllegalTransitionError, so the
 *     bug shows up at once;
 *   - in production it logs ONE structured warning (`illegal_transition`) and returns false, and the
 *     service carries on exactly as it did before the machines existed. Production never starts
 *     failing a player's request because of this check.
 *
 * `fromStates(machine, to)` gives the states that may move into `to`, for a guarded bulk update
 * (`WHERE status IN (...)`), so a double settle or a double fulfil can't happen.
 */
import { IllegalTransitionError, type Machine } from "@thoroughbred/shared";

export { IllegalTransitionError };

/** True in production: illegal moves warn instead of throwing. Read per call (tests flip it). */
const lenient = (): boolean => process.env.NODE_ENV === "production";

export function checkMove<S extends string>(machine: Machine<S>, from: string | null | undefined, to: S, id?: string | null): boolean {
  if (from === to) return true;
  if (typeof from === "string" && machine.is(from) && machine.can(from, to)) return true;
  if (!lenient()) throw new IllegalTransitionError(machine.name, String(from), to, id ? `id ${id}` : undefined);
  console.warn(JSON.stringify({ event: "illegal_transition", machine: machine.name, from: from ?? null, to, id: id ?? null }));
  return false;
}

/** The states that may move into `to` (for `inArray(table.status, fromStates(m, to))`). Never empty. */
export function fromStates<S extends string>(machine: Machine<S>, to: S): S[] {
  const from = machine.sourcesOf(to);
  if (!from.length) throw new Error(`${machine.name}: nothing moves into "${to}"`);
  return [...from];
}
