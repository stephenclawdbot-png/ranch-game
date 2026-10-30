/**
 * Accounts, stables, stall capacity, identity links and play days.
 */
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { commitSeed, hashToken, newDeviceToken, newSeed, sha256Hex, utcDay } from "../crypto";
import { DomainError } from "../errors";
import { accountDevices, accountLinks, accountPlayDays, accounts, fraudEvents, horses, pregnancies, stables, type StableRow } from "../schema";
import {RULES, stageFor, type GameHooks, type HorseSpec } from "../rules";
import { defaultHooks } from "../hooks";
import { seasonNumberAt } from "../rules";
import type { Db, Executor } from "../types";
import { ensureDailyEntries, isValidTimezone } from "./entries";
import { grantCreditsTx, spendCreditsTx } from "./ledger";
import { audit, runTx } from "./tx";
import { claimChosenName, claimSystemName } from "./naming";

export interface CreateAccountInput {
  stableName: string;
  silks: unknown;
  displayName?: string;
  /** Defaults to RULES.startingCredits. */
  startingCredits?: number;
  /** Defaults to RULES.starterHorses (bound, Club-bred, racing age). */
  starterHorses?: number;
  /** IANA timezone from the device (falls back to UTC if missing or unknown). */
  timezone?: string;
  now?: Date;
}

export interface CreatedAccount {
  accountId: string;
  stableId: string;
  /** Raw device token for the httpOnly cookie. Shown once; only its hash is stored. */
  token: string;
  horseIds: string[];
}

/** Anonymous device account + starter stable, credits and horses, atomically. */
export async function createAccount(db: Db, input: CreateAccountInput, hooks: GameHooks = defaultHooks): Promise<CreatedAccount> {
  const name = input.stableName.trim();
  if (name.length < 1 || name.length > 40) throw new DomainError("INVALID_INPUT", "stable name must be 1-40 characters");
  const token = newDeviceToken();
  const now = input.now ?? new Date();
  return runTx(db, async (tx) => {
    const [account] = await tx
      .insert(accounts)
      .values({
        tokenHash: hashToken(token),
        displayName: input.displayName ?? null,
        timezone: input.timezone && isValidTimezone(input.timezone) ? input.timezone : "UTC",
        createdAt: now,
        lastSeenAt: now,
      })
      .returning({ id: accounts.id });
    const [stable] = await tx
      .insert(stables)
      .values({ accountId: account!.id, name, silks: input.silks, stallSlots: RULES.defaultStallSlots })
      .returning({ id: stables.id });
    const credits = input.startingCredits ?? RULES.startingCredits;
    if (credits > 0) {
      await grantCreditsTx(tx, { accountId: account!.id, amount: credits, idempotencyKey: `starter-grant:${account!.id}`, kind: "starter_grant" });
    }
    // Day one's Live entry allowance.
    await ensureDailyEntries(tx, (await lockStable(tx, stable!.id))!, now);
    const seed = newSeed();
    const horseIds: string[] = [];
    const count = Math.min(input.starterHorses ?? RULES.starterHorses, RULES.defaultStallSlots);
    for (let i = 0; i < count; i++) {
      const spec = hooks.starterHorse({ seed, index: i, season: seasonNumberAt(now) });
      horseIds.push(await insertHorse(tx, { stableId: stable!.id, spec, origin: "starter", bound: true, now }));
    }
    await audit(tx, {
      actor: account!.id,
      action: "account.create",
      entityType: "account",
      entityId: account!.id,
      data: { stableId: stable!.id, horseIds, starterSeedCommitment: commitSeed(seed) },
    });
    return { accountId: account!.id, stableId: stable!.id, token, horseIds };
  });
}

/**
 * Resolves the cookie token to its account + stable: the founding browser's token, or any
 * linked device's (account_devices). Null if unknown. `last_seen_at` is refreshed at most
 * once per hour, so the hot path stays two cheap indexed lookups and usually no writes.
 */
const SEEN_THROTTLE_MS = 60 * 60_000;

export async function authenticate(db: Db, token: string): Promise<{ accountId: string; stable: StableRow } | null> {
  if (!token) return null;
  const hash = hashToken(token);
  const rows = await db
    .select({ accountId: accounts.id, stable: stables, lastSeenAt: accounts.lastSeenAt })
    .from(accounts)
    .innerJoin(stables, eq(stables.accountId, accounts.id))
    .where(eq(accounts.tokenHash, hash));
  let row = rows[0];
  let device: { id: string; lastSeenAt: Date; accountId: string } | null = null;
  if (!row) {
    const devices = await db.select({ id: accountDevices.id, lastSeenAt: accountDevices.lastSeenAt, accountId: accountDevices.accountId }).from(accountDevices).where(eq(accountDevices.tokenHash, hash));
    device = devices[0] ?? null;
    if (!device) return null;
    row = (
      await db
        .select({ accountId: accounts.id, stable: stables, lastSeenAt: accounts.lastSeenAt })
        .from(accounts)
        .innerJoin(stables, eq(stables.accountId, accounts.id))
        .where(eq(accounts.id, device.accountId))
    )[0];
    if (!row) return null;
  }
  const now = new Date();
  if (now.getTime() - row.lastSeenAt.getTime() >= SEEN_THROTTLE_MS) {
    await db.update(accounts).set({ lastSeenAt: now }).where(eq(accounts.id, row.accountId));
  }
  if (device && now.getTime() - device.lastSeenAt.getTime() >= SEEN_THROTTLE_MS) {
    await db.update(accountDevices).set({ lastSeenAt: now }).where(eq(accountDevices.id, device.id));
  }
  return row;
}

export async function stableOf(ex: Executor, accountId: string): Promise<StableRow> {
  const [s] = await ex.select().from(stables).where(eq(stables.accountId, accountId));
  if (!s) throw new DomainError("NOT_FOUND", "stable not found");
  return s;
}

/** Locks and returns the account's stable (serialises every acquisition for that stable). */
export async function accountIdOfStable(ex: Executor, stableId: string): Promise<string> {
  const [s] = await ex.select({ accountId: stables.accountId }).from(stables).where(eq(stables.id, stableId));
  if (!s) throw new DomainError("NOT_FOUND", "stable not found");
  return s.accountId;
}

export async function lockStableOf(ex: Executor, accountId: string): Promise<StableRow> {
  const [s] = await ex.select().from(stables).where(eq(stables.accountId, accountId)).for("update");
  if (!s) throw new DomainError("NOT_FOUND", "stable not found");
  return s;
}

export async function lockStable(ex: Executor, stableId: string): Promise<StableRow> {
  const [s] = await ex.select().from(stables).where(eq(stables.id, stableId)).for("update");
  if (!s) throw new DomainError("NOT_FOUND", "stable not found");
  return s;
}

export interface Occupancy {
  slots: number;
  /** Horses in the stalls: owned horses at home not on the Legacy Farm, plus horses held on lease (an owned horse away on lease frees its stall). */
  horses: number;
  /** Foals on the way (carrying pregnancies of the stable's mares). */
  pendingFoals: number;
  used: number;
  free: number;
  /** True while a foal sits in the nursery overflow slot (used > slots). */
  overflow: boolean;
}

export async function occupancy(ex: Executor, stable: Pick<StableRow, "id" | "stallSlots">): Promise<Occupancy> {
  const [h] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(horses)
    .where(
      and(
        ne(horses.careerStatus, "pasture"),
        or(and(eq(horses.ownerStableId, stable.id), isNull(horses.lesseeStableId)), eq(horses.lesseeStableId, stable.id)),
      ),
    );
  const [p] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(pregnancies)
    .innerJoin(horses, eq(horses.id, pregnancies.damId))
    .where(and(eq(pregnancies.status, "carrying"), eq(horses.ownerStableId, stable.id)));
  const used = Number(h?.n ?? 0) + Number(p?.n ?? 0);
  return {
    slots: stable.stallSlots,
    horses: Number(h?.n ?? 0),
    pendingFoals: Number(p?.n ?? 0),
    used,
    free: Math.max(0, stable.stallSlots - used),
    overflow: used > stable.stallSlots,
  };
}

/**
 * Throws STABLE_FULL unless the (already locked) stable can take one more horse.
 * `allowOverflow` (covering a mare) lets the pending foal use the nursery overflow slot.
 */
export async function assertStallFree(ex: Executor, stable: StableRow, opts: { allowOverflow?: boolean } = {}): Promise<Occupancy> {
  const occ = await occupancy(ex, stable);
  const limit = stable.stallSlots + (opts.allowOverflow ? RULES.nurseryOverflowSlots : 0);
  if (occ.used + 1 > limit) {
    throw new DomainError("STABLE_FULL", `all ${stable.stallSlots} stalls are taken`, { ...occ });
  }
  return occ;
}

export interface InsertHorseInput {
  stableId: string | null;
  spec: HorseSpec;
  origin: "starter" | "bred" | "pack" | "gift" | "house" | "admin";
  bound?: boolean;
  tradeMinStarts?: number;
  sireId?: string | null;
  damId?: string | null;
  generation?: number;
  birthSeasonNumber?: number | null;
  now: Date;
  /**
   * "chosen": the name came from the player (validated; NAME_TAKEN when in use).
   * "system" (default): a free alternative is picked quietly when the name is taken.
   */
  nameMode?: "chosen" | "system";
}

/** Low-level insert. Callers are responsible for the stall check. */
export async function insertHorse(ex: Executor, input: InsertHorseInput): Promise<string> {
  const careSessions = input.spec.careSessions ?? RULES.careToRacing;
  const name =
    input.nameMode === "chosen"
      ? await claimChosenName(ex, input.spec.name)
      : await claimSystemName(ex, input.spec.name, sha256Hex(`${input.spec.name}|${JSON.stringify(input.spec.genome ?? null)}|${input.stableId ?? "club"}`));
  const [row] = await ex
    .insert(horses)
    .values({
      ownerStableId: input.stableId,
      name: name.slice(0, 32),
      sex: input.spec.sex,
      sireId: input.sireId ?? null,
      damId: input.damId ?? null,
      generation: input.generation ?? 0,
      origin: input.origin,
      birthSeasonNumber: input.birthSeasonNumber ?? null,
      bornAt: input.now,
      genome: input.spec.genome,
      appearance: input.spec.appearance,
      stats: input.spec.stats,
      maturityType: input.spec.maturityType ?? "normal",
      rating: input.spec.rating ?? 0,
      careSessions,
      stage: stageFor(careSessions, 0),
      bound: input.bound ?? false,
      tradeMinStarts: input.tradeMinStarts ?? 0,
    })
    .returning({ id: horses.id });
  return row!.id;
}

/** Facility upgrade: +n stalls (max 24), paid in credits (burned). Idempotent by key. */
export async function upgradeStalls(
  db: Db,
  input: { accountId: string; addSlots: number; cost: number; idempotencyKey: string },
): Promise<{ stallSlots: number }> {
  return runTx(db, async (tx) => {
    const stable = await lockStableOf(tx, input.accountId);
    const target = stable.stallSlots + input.addSlots;
    if (input.addSlots < 1 || target > RULES.maxStallSlots) throw new DomainError("INVALID_INPUT", `stalls are capped at ${RULES.maxStallSlots}`);
    const res = await spendCreditsTx(tx, { accountId: input.accountId, amount: input.cost, idempotencyKey: input.idempotencyKey, kind: "stall_slot" });
    if (res.duplicate) return { stallSlots: stable.stallSlots };
    await tx.update(stables).set({ stallSlots: target }).where(eq(stables.id, stable.id));
    await audit(tx, { actor: input.accountId, action: "stable.upgrade_stalls", entityType: "stable", entityId: stable.id, data: { from: stable.stallSlots, to: target } });
    return { stallSlots: target };
  });
}

// ---------------------------------------------------------------------------
// Identity links / verification / play days
// ---------------------------------------------------------------------------

export type LinkKind = "device" | "fingerprint" | "ip_hash" | "wallet" | "email";

/**
 * Records an identity signal (hashed here; pass the raw value or a pre-hash). Returns the
 * other accounts sharing it; a new link is logged as a fraud event for review.
 */
export async function recordAccountSignal(db: Db, input: { accountId: string; kind: LinkKind; value: string }): Promise<string[]> {
  const valueHash = sha256Hex(`${input.kind}:${input.value.trim().toLowerCase()}`);
  return runTx(db, async (tx) => {
    await tx
      .insert(accountLinks)
      .values({ accountId: input.accountId, kind: input.kind, valueHash })
      .onConflictDoUpdate({ target: [accountLinks.accountId, accountLinks.kind, accountLinks.valueHash], set: { lastSeenAt: new Date() } });
    const others = await tx
      .selectDistinct({ id: accountLinks.accountId })
      .from(accountLinks)
      .where(and(eq(accountLinks.kind, input.kind), eq(accountLinks.valueHash, valueHash), ne(accountLinks.accountId, input.accountId)));
    for (const o of others) {
      // One review event per new link: repeated signals for the same pair don't pile up.
      const [already] = await tx
        .select({ id: fraudEvents.id })
        .from(fraudEvents)
        .where(
          and(
            eq(fraudEvents.accountId, input.accountId),
            eq(fraudEvents.relatedAccountId, o.id),
            eq(fraudEvents.kind, "account_link"),
            sql`${fraudEvents.data}->>'signal' = ${input.kind}`,
          ),
        );
      if (!already) {
        await tx.insert(fraudEvents).values({ accountId: input.accountId, relatedAccountId: o.id, kind: "account_link", data: { signal: input.kind } });
      }
    }
    return others.map((o) => o.id);
  });
}

/** True when the two accounts share any identity signal. */
export async function areLinked(ex: Executor, a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const rows = await ex.execute(sql`
    select 1 from account_links x join account_links y
      on x.kind = y.kind and x.value_hash = y.value_hash
     where x.account_id = ${a} and y.account_id = ${b} limit 1`);
  const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
  return list.length > 0;
}

export async function verifyEmail(db: Db, input: { accountId: string; email: string; now?: Date }): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError("INVALID_INPUT", "invalid email");
  await runTx(db, async (tx) => {
    await tx.update(accounts).set({ email, emailVerifiedAt: input.now ?? new Date() }).where(eq(accounts.id, input.accountId));
    await audit(tx, { actor: input.accountId, action: "account.verify_email", entityType: "account", entityId: input.accountId });
  });
  await recordAccountSignal(db, { accountId: input.accountId, kind: "email", value: email });
}

/** Marks today as a play day (idempotent). Returns the total number of play days. */
export async function recordPlayDay(ex: Executor, accountId: string, now: Date): Promise<number> {
  await ex.insert(accountPlayDays).values({ accountId, day: utcDay(now) }).onConflictDoNothing();
  const [r] = await ex.select({ n: sql<number>`count(*)::int` }).from(accountPlayDays).where(eq(accountPlayDays.accountId, accountId));
  return Number(r?.n ?? 0);
}

export async function accountsByIds(ex: Executor, ids: string[]) {
  return ids.length ? ex.select().from(accounts).where(inArray(accounts.id, ids)) : [];
}
