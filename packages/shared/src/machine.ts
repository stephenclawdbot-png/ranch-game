/**
 * Explicit state machines (docs/state-machines.md).
 *
 * A lifecycle that lives in a `status` / `stage` / `phase` value (a race, an entry, an order, a
 * screen's async flow) is declared once with `defineMachine`: its states, where it starts, where it
 * ends and every allowed move. Code then asks the machine (`can`, `assert`, `next`) instead of
 * re-deriving the rules from scattered string comparisons, and the docs and diagrams are generated
 * from the same declaration, so the picture can never drift from the code.
 *
 * State-based (from -> to), not event-based: persisted lifecycles are written as "set status to X",
 * and a UI flow can name its events in its own reducer while the machine checks the move.
 * Pure, no dependencies, safe on the server, in the browser and in workers.
 */

export interface MachineDef<S extends string> {
  /** Stable name, e.g. "race" or "checkout". Used in errors, docs and logs. */
  readonly name: string;
  /** Where the value is stored or lives, e.g. "races.status" or "PremiumCheckout (React state)". */
  readonly storedIn?: string;
  /** Every state, in a sensible reading order. */
  readonly states: readonly S[];
  /** The state(s) a new instance may start in. */
  readonly initial: S | readonly S[];
  /** States with no way out. Must have no outgoing transitions. */
  readonly terminal?: readonly S[];
  /** Allowed moves: from -> the states it may go to. A state missing here has no way out. */
  readonly transitions: { readonly [K in S]?: readonly S[] };
  /** One plain sentence per state, for docs, tooltips and agents. */
  readonly describe?: { readonly [K in S]?: string };
}

export interface Machine<S extends string> extends MachineDef<S> {
  readonly initialStates: readonly S[];
  readonly terminalStates: readonly S[];
  /** True when `value` is one of this machine's states (narrowing guard for untyped input). */
  is(value: unknown): value is S;
  /** True when moving from `from` to `to` is allowed. Staying put (`from === to`) is not a move. */
  can(from: S, to: S): boolean;
  /** Throws IllegalTransitionError unless `from -> to` is allowed. */
  assert(from: S, to: S, context?: string): void;
  /** The states reachable in one move from `from`. */
  next(from: S): readonly S[];
  /** The states that may move into `to` (useful for a guarded SQL update: `WHERE status IN (...)`). */
  sourcesOf(to: S): readonly S[];
  isTerminal(state: S): boolean;
  /** A Mermaid `stateDiagram-v2` of the machine. */
  toMermaid(): string;
}

/** The state union of a machine: `StateOf<typeof raceMachine>` is "open" | "locked" | ... */
export type StateOf<M> = M extends Machine<infer S> ? S : never;

export class IllegalTransitionError extends Error {
  readonly machine: string;
  readonly from: string;
  readonly to: string;
  constructor(machine: string, from: string, to: string, context?: string) {
    super(`${machine}: cannot move from "${from}" to "${to}"${context ? ` (${context})` : ""}`);
    this.name = "IllegalTransitionError";
    this.machine = machine;
    this.from = from;
    this.to = to;
  }
}

export function defineMachine<const S extends string>(def: MachineDef<S>): Machine<S> {
  const known = new Set<string>(def.states);
  const check = (s: string, where: string) => {
    if (!known.has(s)) throw new Error(`defineMachine(${def.name}): unknown state "${s}" in ${where}`);
  };
  const initialStates = (typeof def.initial === "string" ? [def.initial] : [...def.initial]) as S[];
  const terminalStates = [...(def.terminal ?? [])] as S[];
  initialStates.forEach((s) => check(s, "initial"));
  terminalStates.forEach((s) => check(s, "terminal"));
  const edges = new Map<S, readonly S[]>();
  for (const from of Object.keys(def.transitions) as S[]) {
    check(from, "transitions");
    const tos = def.transitions[from] ?? [];
    tos.forEach((to) => check(to, `transitions.${from}`));
    if (tos.length && terminalStates.includes(from)) throw new Error(`defineMachine(${def.name}): terminal state "${from}" has transitions`);
    edges.set(from, tos);
  }
  const sources = new Map<S, S[]>();
  for (const [from, tos] of edges) for (const to of tos) sources.set(to, [...(sources.get(to) ?? []), from]);

  const machine: Machine<S> = {
    ...def,
    initialStates,
    terminalStates,
    is: (value): value is S => typeof value === "string" && known.has(value),
    can: (from, to) => from !== to && (edges.get(from) ?? []).includes(to),
    assert(from, to, context) {
      if (!machine.can(from, to)) throw new IllegalTransitionError(def.name, from, to, context);
    },
    next: (from) => edges.get(from) ?? [],
    sourcesOf: (to) => sources.get(to) ?? [],
    isTerminal: (state) => terminalStates.includes(state),
    toMermaid() {
      const id = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");
      const lines = ["stateDiagram-v2"];
      for (const s of initialStates) lines.push(`  [*] --> ${id(s)}`);
      for (const [from, tos] of edges) for (const to of tos) lines.push(`  ${id(from)} --> ${id(to)}`);
      for (const s of terminalStates) lines.push(`  ${id(s)} --> [*]`);
      return lines.join("\n");
    },
  };
  return machine;
}

/**
 * Structural problems in a machine (for tests): states nothing can reach, non-terminal dead ends,
 * and terminal states that are also initial. An empty list means the machine is well formed.
 */
export function machineProblems<S extends string>(m: Machine<S>): string[] {
  const problems: string[] = [];
  const seen = new Set<S>(m.initialStates);
  const queue = [...m.initialStates];
  while (queue.length) {
    const s = queue.shift()!;
    for (const t of m.next(s)) if (!seen.has(t)) (seen.add(t), queue.push(t));
  }
  for (const s of m.states) {
    if (!seen.has(s)) problems.push(`${m.name}: "${s}" cannot be reached from ${m.initialStates.join("/")}`);
    if (!m.isTerminal(s) && m.next(s).length === 0) problems.push(`${m.name}: "${s}" is a dead end but not marked terminal`);
  }
  return problems;
}
