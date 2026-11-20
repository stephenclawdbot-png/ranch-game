/**
 * Query meter (diagnostics, off by default): counts every statement the driver sends and the
 * time it took, so a request's database cost can be measured ("how many queries does the home
 * page run?"). Enabled only when `DB_QUERY_LOG` is set:
 *
 *   DB_QUERY_LOG=/tmp/queries.log   one line per statement: <epoch ms>\t<duration ms>\t<sql, first 160 chars>
 *   DB_QUERY_LOG=1                  counters only (queryMeterTotals())
 *
 * The meter wraps the driver client (PGlite or the Neon pool) in place; without the env
 * variable nothing is wrapped. Parameters are never logged.
 */
export interface QueryTotals {
  queries: number;
  ms: number;
}

const KEY = Symbol.for("thoroughbred.db.queryMeter");
type GlobalWithMeter = typeof globalThis & { [KEY]?: QueryTotals };

function totals(): QueryTotals {
  const g = globalThis as GlobalWithMeter;
  return (g[KEY] ??= { queries: 0, ms: 0 });
}

/** Statements and database time counted so far in this process (zeros when the meter is off). */
export function queryMeterTotals(): QueryTotals {
  return { ...totals() };
}

export function queryMeterTarget(): string | null {
  const v = typeof process !== "undefined" ? process.env.DB_QUERY_LOG?.trim() : undefined;
  return v ? v : null;
}

function sqlOf(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg && typeof arg === "object" && typeof (arg as { text?: unknown }).text === "string") return (arg as { text: string }).text;
  return "?";
}

const WRAPPED = Symbol("thoroughbred.db.metered");
type Loose = Record<string | symbol, unknown>;
type Fn = (...args: unknown[]) => unknown;

/**
 * Wraps `client.query` (and the clients handed out by `transaction` / `connect`) so every
 * statement is counted. Mutates and returns the same object.
 */
export function meterClient<T extends object>(client: T, target: string): T {
  const c = client as unknown as Loose;
  if (c[WRAPPED]) return client;
  c[WRAPPED] = true;
  const file = target === "1" ? null : target;
  const fs = file ? process.getBuiltinModule("node:fs") : null;
  const record = (sql: string, started: number) => {
    const ms = performance.now() - started;
    const t = totals();
    t.queries++;
    t.ms += ms;
    if (fs && file) {
      try {
        fs.appendFileSync(file, `${Date.now()}\t${ms.toFixed(2)}\t${sql.replace(/\s+/g, " ").slice(0, 160)}\n`);
      } catch {
        // diagnostics never break a query
      }
    }
  };
  const wrapQuery = (obj: Loose) => {
    const original = obj.query;
    if (typeof original !== "function") return;
    obj.query = (...args: unknown[]) => {
      const started = performance.now();
      const out = (original as Fn).apply(obj, args);
      if (out && typeof (out as Promise<unknown>).then === "function") {
        return (out as Promise<unknown>).finally(() => record(sqlOf(args[0]), started));
      }
      record(sqlOf(args[0]), started);
      return out;
    };
  };
  const wrapOnce = (obj: Loose) => {
    if (!obj || typeof obj !== "object" || obj[WRAPPED]) return;
    obj[WRAPPED] = true;
    wrapQuery(obj);
  };
  wrapQuery(c);
  // PGlite: transaction(cb) hands the callback a transaction object with its own query().
  const transaction = c.transaction;
  if (typeof transaction === "function") {
    c.transaction = (cb: (tx: Loose) => unknown, ...rest: unknown[]) =>
      (transaction as Fn).call(
        c,
        (tx: Loose) => {
          wrapOnce(tx);
          return cb(tx);
        },
        ...rest,
      );
  }
  // Neon pool: connect() hands out a client for a transaction.
  const connect = c.connect;
  if (typeof connect === "function") {
    c.connect = async (...args: unknown[]) => {
      const inner = (await (connect as Fn).apply(c, args)) as Loose;
      wrapOnce(inner);
      return inner;
    };
  }
  return client;
}
