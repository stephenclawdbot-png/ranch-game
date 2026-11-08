/**
 * How a UI flow applies a move (docs/state-machines-ui.md).
 *
 * `moveOr(machine, from, to)` returns `to` when the machine allows `from -> to`, and `from` when
 * the move is a no-op (`from === to`). An illegal move is a bug in the screen: in development and
 * tests it throws (so the bug is found), in production it logs one console.warn and the move is
 * ignored (a screen never crashes over it; the flow stays where it was).
 */
import { IllegalTransitionError, type Machine } from "@thoroughbred/shared";

export type IllegalMovePolicy = "throw" | "warn";

let override: IllegalMovePolicy | null = null;

/** The policy in force: "throw" outside production builds, "warn" in production. */
export function illegalMovePolicy(): IllegalMovePolicy {
  if (override) return override;
  return process.env.NODE_ENV === "production" ? "warn" : "throw";
}

/** Tests only: force a policy (null restores the default). */
export function setIllegalMovePolicy(p: IllegalMovePolicy | null): void {
  override = p;
}

/** The state after trying `from -> to`: `to` when allowed, else `from` (or a throw, see above). */
export function moveOr<S extends string>(machine: Machine<S>, from: S, to: S, context?: string): S {
  if (from === to || machine.can(from, to)) return to;
  const err = new IllegalTransitionError(machine.name, from, to, context);
  if (illegalMovePolicy() === "throw") throw err;
  console.warn(`[ui-machine] ${err.message}; ignored`);
  return from;
}
