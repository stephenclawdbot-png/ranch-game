/**
 * Credit notes (owner, 2026-11-01: "players should be able to audit their own credits"): every
 * movement of Stable Credits on a player's ledger account becomes a note in the bell, with the
 * amount, the reason in plain words and the balance after it, linking to Stable → Finances with
 * that category highlighted.
 *
 * How (one place instead of every spending path): the notes are written from the ledger itself,
 * right after the fact, on the player's own reads (the bell's count and list). Idempotent: each
 * note's dedupe key is the first ledger transaction id it covers, and it records every transaction
 * id it covers, so a retry or two reads at once never double a note and a movement is never
 * noted twice.
 *
 * Batching: transactions posted within BATCH_MS of each other (one action: an entry with its
 * extras and jockey, a race's purse with a jockey bonus, three daily goals at once) make one note.
 *
 * No spoilers: a prize from a race whose broadcast isn't over waits (and so do the notes after it,
 * to keep the order); once public, a race the player hasn't watched says "prize from the 10:15
 * Bellmont Handicap (watch the finish)" and gains its place only after the result is watched
 * (notifications.ts safeTitle).
 *
 * Credits are game currency only (never cashed out); practice T-USDG is a separate ledger currency
 * and never noted here.
 */
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { horses, inboxItems, ledgerAccounts, ledgerPostings, ledgerTransactions, raceEntries, raceResults, races } from "../schema";
import type { Executor } from "../types";
import { kindCategory, type FinanceCategory } from "./finances";
import { timezoneOf } from "./entries";
import { resultPublicAt } from "./news";
import { notify } from "./notifications";

export const CREDIT_NOTE_KIND = "credits";
/** Transactions this close together are one action (one note). */
export const CREDIT_BATCH_MS = 2_000;
/** A first look covers this far back (older movements stay on the Finances page only). */
export const CREDIT_FIRST_LOOK_MS = 24 * 3_600_000;
/** Re-read this far behind the last note, for a transaction that committed late. */
const RESCAN_MS = 30 * 60_000;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const nf = new Intl.NumberFormat("en-GB");
export const formatCreditAmount = (n: number) => `${n >= 0 ? "+" : "−"}${nf.format(Math.abs(n))} credits`;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/** One ledger transaction as the player sees it: its kind, their amount and what it was about. */
export interface CreditMove {
  transactionId: string;
  kind: string;
  amount: number;
  at: number;
  memo: string | null;
  horseName: string | null;
  /** A prize: the race and, when known, the horse's place in it. */
  race?: { id: string; label: string; place: number | null; watched: boolean } | null;
}

/** Plain words for one movement (no amount). `safe`: never a place (a race still to watch). */
export function creditReason(m: CreditMove, safe = false): string {
  const h = m.horseName;
  const forH = h ? ` for ${h}` : "";
  const inc = m.amount > 0;
  switch (m.kind) {
    case "purse":
      if (!m.race) return "prize money";
      if (safe || m.race.place === null) return `prize from the ${m.race.label}${safe ? " (watch the finish)" : ""}`;
      return `${h ?? "Your horse"} ${ordinal(m.race.place)} in the ${m.race.label}`;
    case "training":
      return `${m.memo ?? "Training"}${forH}`;
    case "vet":
      return `Vet treatment${forH}`;
    case "pedigree_scan":
      return `Pedigree Scan${forH}`;
    case "insurance_premium":
      return `Insurance${forH}`;
    case "insurance_payout":
      return `Insurance payout${forH}`;
    case "entry_fee":
      return `Entry fee${forH}`;
    case "entry_fee_refund":
      return `Entry fee refunded${forH}`;
    case "race_extras":
      return `Race-day extras${forH}`;
    case "race_extras_refund":
      return `Race-day extras refunded${forH}`;
    case "jockey_fee":
      return `Jockey fee${forH}`;
    case "jockey_fee_refund":
      return `Jockey fee refunded${forH}`;
    case "jockey_signing":
      return "Jockey signing fee";
    case "jockey_offer_escrow":
      return "Jockey offer held";
    case "jockey_offer_refund":
      return "Jockey offer returned";
    case "jockey_wage":
      return m.memo ? `Jockey wage: ${m.memo}` : "Jockey wage";
    case "jockey_development_bonus":
      return "Jockey development bonus";
    case "upkeep":
      return "Weekly upkeep";
    case "daily_goal":
      return "Daily goal";
    case "stable_step":
      return "First-week step";
    case "daily_cup":
      return "Daily Cup run";
    case "story_reward":
      return "Story race reward";
    case "referral_reward":
      return "Invite reward";
    case "rival_invite":
      return "Rival invite reward";
    case "starter_grant":
      return "Starting credits";
    case "adjustment":
      return m.memo === "released to the Club" ? `${h ?? "A horse"} released to the Club` : (m.memo ?? "Adjustment");
    case "market_sale":
    case "club_sale":
      return inc ? `${h ?? "A horse"} sold` : `Bought ${h ?? "a horse"}`;
    case "claim_sale":
      return inc ? `${h ?? "A horse"} claimed by another stable` : `Claimed ${h ?? "a horse"}`;
    case "claim_escrow":
      return "Claim lodged";
    case "claim_refund":
      return "Claim refunded";
    case "breeding_fee":
      return inc ? `Stud fee earned${forH}` : "Stud fee";
    case "breeding_fee_hold":
      return "Stud fee held";
    case "breeding_fee_release":
      return "Stud fee returned";
    case "lease_fee":
      return inc ? "Lease fee received" : "Lease fee";
    case "lease_share":
      return "Share of a leased horse's prize money";
    case "pack":
      return "Paddock Pack";
    case "facility":
      return m.memo ? `Facility: ${m.memo}` : "Facility upgrade";
    case "stall_slot":
      return "A new stall";
    case "entry_refill":
      return "Entry refill";
    case "race_sponsorship":
      return "Race sponsorship";
    case "race_sponsorship_refund":
      return "Race sponsorship refunded";
    case "tote_stake":
      return "Tote stake";
    case "tote_settlement":
      return "Tote return";
    case "tote_refund":
      return "Tote stake refunded";
    default:
      return m.memo ?? m.kind.replace(/_/g, " ");
  }
}

/** Kinds that read as a count when several come at once ("from 2 daily goals"). */
const COUNTED: Record<string, [string, string]> = {
  daily_goal: ["daily goal", "daily goals"],
  stable_step: ["first-week step", "first-week steps"],
};

/**
 * `safe`: the title for the bell while a race in it is still to watch (a prize from a race not yet
 * watched names no place; a watched race's prize still does).
 *
 * One note's title from one action's movements: "+400 credits: Velvet Falcon 2nd in the 10:15
 * Bellmont Handicap · balance 3,465", "+50 credits from 2 daily goals · balance 3,515".
 */
export function creditNoteTitle(moves: readonly CreditMove[], balance: number, safe = false): string {
  const net = moves.reduce((s, m) => s + m.amount, 0);
  const kinds = [...new Set(moves.map((m) => m.kind))];
  const tail = ` · balance ${nf.format(balance)}`;
  if (kinds.length === 1 && moves.length > 1 && COUNTED[kinds[0]!]) {
    const [one, many] = COUNTED[kinds[0]!]!;
    return `${formatCreditAmount(net)} from ${moves.length} ${moves.length === 1 ? one : many}${tail}`;
  }
  // One horse's action (an entry with its extras and jockey): name the horse once, at the end.
  const horse = moves[0]!.horseName;
  const shared = moves.length > 1 && !!horse && moves.every((m) => m.horseName === horse && m.kind !== "purse");
  const reasons: string[] = [];
  for (const m of [...moves].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))) {
    const r = creditReason(shared ? { ...m, horseName: null } : m, safe && !!m.race && !m.race.watched);
    // Later reasons run on in lower case, except a horse's name ("…, Willow Ember 1st in …").
    const named = !shared && !!m.horseName && r.startsWith(m.horseName);
    const lower = reasons.length && !named ? `${r.charAt(0).toLowerCase()}${r.slice(1)}` : r;
    if (!reasons.some((x) => x.toLowerCase() === lower.toLowerCase())) reasons.push(lower);
  }
  const words = reasons.length <= 3 ? reasons.join(", ").replace(/, ([^,]*)$/, " and $1") : `${reasons.slice(0, 2).join(", ")} and ${reasons.length - 2} more`;
  return `${formatCreditAmount(net)}: ${words.charAt(0).toUpperCase()}${words.slice(1)}${shared ? ` for ${horse}` : ""}${tail}`;
}

/** The Finances category a note highlights (the biggest movement's). */
export function noteCategory(moves: readonly CreditMove[]): FinanceCategory {
  const big = [...moves].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0]!;
  const c = kindCategory(big.kind);
  return big.amount > 0 ? c.income : c.spend;
}

/** Groups movements (oldest first) into actions: each starts a window of CREDIT_BATCH_MS. */
export function batchMoves<T extends { at: number }>(moves: readonly T[]): T[][] {
  const out: T[][] = [];
  for (const m of moves) {
    const last = out[out.length - 1];
    if (last && m.at - last[0]!.at <= CREDIT_BATCH_MS) last.push(m);
    else out.push([m]);
  }
  return out;
}

/** The race's label in the player's own clock: "10:15 Bellmont Handicap". */
function raceLabel(name: string, postTime: Date, tz: string): string {
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(postTime);
  return `${time} ${name}`;
}

/**
 * Writes the credit notes this account is due (idempotent; safe to call on every read). Returns
 * how many notes were written.
 */
export async function syncCreditNotes(ex: Executor, input: { accountId: string; now: Date }): Promise<number> {
  const { accountId, now } = input;
  const nowMs = now.getTime();
  const [acct] = await ex
    .select({ id: ledgerAccounts.id, balance: ledgerAccounts.balance })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.ownerAccountId, accountId), eq(ledgerAccounts.kind, "player"), eq(ledgerAccounts.currency, "CR")));
  if (!acct) return 0;

  const [last] = await ex
    .select({ at: sql<string | null>`max((${inboxItems.data}->>'atMs')::bigint)` })
    .from(inboxItems)
    .where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.kind, CREDIT_NOTE_KIND)));
  const lastMs = last?.at ? Number(last.at) : null;
  const from = new Date(lastMs !== null ? lastMs - RESCAN_MS : nowMs - CREDIT_FIRST_LOOK_MS);

  const rows = await ex
    .select({ transactionId: ledgerTransactions.id, kind: ledgerTransactions.kind, key: ledgerTransactions.idempotencyKey, memo: ledgerTransactions.memo, meta: ledgerTransactions.meta, at: ledgerTransactions.createdAt, amount: sql<number>`sum(${ledgerPostings.amount})::bigint` })
    .from(ledgerPostings)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerPostings.transactionId))
    .where(and(eq(ledgerPostings.ledgerAccountId, acct.id), gte(ledgerTransactions.createdAt, from)))
    .groupBy(ledgerTransactions.id)
    .orderBy(asc(ledgerTransactions.createdAt), asc(ledgerTransactions.id));
  if (!rows.length) return 0;

  // Transactions already in a note (the rescan window overlaps the last notes).
  const noted = new Set<string>();
  const notes = await ex
    .select({ data: inboxItems.data })
    .from(inboxItems)
    .where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.kind, CREDIT_NOTE_KIND), gte(inboxItems.createdAt, new Date(from.getTime() - RESCAN_MS))));
  for (const n of notes) for (const id of ((n.data as { tx?: string[] } | null)?.tx ?? [])) noted.add(id);

  // Balance after each transaction: the balance now, less everything after it (all within the window).
  const fresh = rows.map((r) => ({ ...r, amount: Number(r.amount), atMs: r.at.getTime() })).filter((r) => r.amount !== 0);
  const afterById = new Map<string, number>();
  let running = acct.balance;
  for (let i = fresh.length - 1; i >= 0; i--) {
    afterById.set(fresh[i]!.transactionId, running);
    running -= fresh[i]!.amount;
  }
  const todo = fresh.filter((r) => !noted.has(r.transactionId));
  if (!todo.length) return 0;

  // Names: horses and races named by id in the keys and meta.
  const ids = new Set<string>();
  for (const r of todo) {
    for (const m of `${r.key} ${JSON.stringify(r.meta ?? {})}`.match(UUID) ?? []) ids.add(m.toLowerCase());
  }
  const horseNames = ids.size ? new Map((await ex.select({ id: horses.id, name: horses.name }).from(horses).where(inArray(horses.id, [...ids]))).map((h) => [h.id, h.name])) : new Map<string, string>();
  const purseRaceIds = todo.filter((r) => r.kind === "purse").map((r) => String((r.meta as { raceId?: string } | null)?.raceId ?? r.key.replace(/^purse:/, "")));
  const raceRows = purseRaceIds.length
    ? await ex.select({ id: races.id, name: races.name, postTime: races.postTime, settledAt: races.settledAt, result: raceResults.result }).from(races).leftJoin(raceResults, eq(raceResults.raceId, races.id)).where(inArray(races.id, purseRaceIds))
    : [];
  const raceById = new Map(raceRows.map((r) => [r.id, r]));
  // The stable's placed, paid runner in each purse race (the horse and place a prize is for).
  const placed = purseRaceIds.length
    ? await ex
        .select({ raceId: raceEntries.raceId, horseId: raceEntries.horseId, position: raceEntries.finishPosition, prize: raceEntries.prize, name: horses.name })
        .from(raceEntries)
        .innerJoin(horses, eq(horses.id, raceEntries.horseId))
        .where(and(inArray(raceEntries.raceId, purseRaceIds), sql`${raceEntries.stableId} in (select id from stables where account_id = ${accountId})`, sql`${raceEntries.prize} > 0`))
    : [];
  const watchedRows = purseRaceIds.length
    ? await ex
        .select({ raceId: inboxItems.raceId, readAt: inboxItems.readAt })
        .from(inboxItems)
        .where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.kind, "race_result"), inArray(inboxItems.raceId, purseRaceIds)))
    : [];
  const unwatched = new Set(watchedRows.filter((w) => !w.readAt).map((w) => w.raceId!));
  const tz = purseRaceIds.length ? await timezoneOf(ex, accountId) : "UTC";

  const moves = todo.map((r) => {
    const horseId = [...(`${r.key} ${JSON.stringify(r.meta ?? {})}`.match(UUID) ?? [])].map((x) => x.toLowerCase()).find((x) => horseNames.has(x)) ?? null;
    let race: CreditMove["race"] = null;
    let horseName = horseId ? horseNames.get(horseId)! : null;
    let publicMs = 0;
    if (r.kind === "purse") {
      const raceId = String((r.meta as { raceId?: string } | null)?.raceId ?? r.key.replace(/^purse:/, ""));
      const rr = raceById.get(raceId);
      const mine = placed.filter((p) => p.raceId === raceId).sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
      if (rr) {
        publicMs = resultPublicAt(rr, rr.result, rr.settledAt).getTime();
        race = { id: raceId, label: raceLabel(rr.name, rr.postTime, tz), place: mine.length === 1 ? (mine[0]!.position ?? null) : null, watched: !unwatched.has(raceId) };
        if (mine.length === 1) horseName = mine[0]!.name;
      }
    }
    return { transactionId: r.transactionId, kind: r.kind, amount: r.amount, at: r.atMs, memo: r.memo, horseName, race, publicMs, balanceAfter: afterById.get(r.transactionId)! };
  });

  let written = 0;
  for (const group of batchMoves(moves)) {
    // A prize whose broadcast isn't over waits, and so does everything after it (order kept).
    if (group.some((m) => m.publicMs > nowMs)) break;
    const net = group.reduce((s, m) => s + m.amount, 0);
    if (net === 0) continue; // a hold and its release in one action: nothing moved
    const balance = group[group.length - 1]!.balanceAfter;
    // The race the note waits on: one still to watch, if any (its place stays out until then).
    const race = group.find((m) => m.race && !m.race.watched)?.race ?? group.find((m) => m.race)?.race ?? null;
    const category = noteCategory(group);
    const id = await notify(ex, {
      accountId,
      kind: "credits",
      dedupeKey: `credits:${group[0]!.transactionId}`,
      // With the place; while the race is still to watch the bell shows `unwatchedTitle` (safeTitle).
      title: creditNoteTitle(group, balance),
      data: {
        href: `/stable/finances?highlight=${category}#cat-${category}`,
        atMs: group[group.length - 1]!.at,
        amount: net,
        balance,
        category,
        tx: group.map((m) => m.transactionId),
        ...(race && !race.watched ? { unwatchedTitle: creditNoteTitle(group, balance, true) } : {}),
      },
      raceId: race && !race.watched ? race.id : null,
      now: new Date(group[group.length - 1]!.at),
    });
    if (id) written++;
  }
  return written;
}

/**
 * Credits moved since `from` (the away summary's line): the net and the count of a few kinds
 * worth naming (prizes, refunds). From the ledger itself, so nothing is invented.
 */
export async function creditsSince(ex: Executor, input: { accountId: string; from: Date; now: Date; /** Races still to watch: their prizes stay out (a prize would tell a place). */ hideRaceIds?: ReadonlySet<string> }): Promise<{ net: number; prizes: number; refunds: number; moves: number }> {
  const rows = await ex
    .select({ kind: ledgerTransactions.kind, raceId: sql<string | null>`${ledgerTransactions.meta}->>'raceId'`, key: ledgerTransactions.idempotencyKey, amount: sql<number>`sum(${ledgerPostings.amount})::bigint` })
    .from(ledgerPostings)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerPostings.transactionId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerPostings.ledgerAccountId))
    .where(and(eq(ledgerAccounts.ownerAccountId, input.accountId), eq(ledgerAccounts.kind, "player"), eq(ledgerAccounts.currency, "CR"), sql`${ledgerTransactions.createdAt} > ${input.from}`, sql`${ledgerTransactions.createdAt} <= ${input.now}`))
    .groupBy(ledgerTransactions.id);
  const hidden = input.hideRaceIds ?? new Set<string>();
  const raceOf = (r: (typeof rows)[number]) => r.raceId ?? (r.key.match(UUID)?.[0]?.toLowerCase() ?? null);
  const moves = rows
    .filter((r) => !((r.kind === "purse" || r.kind === "lease_share" || r.kind === "jockey_development_bonus" || r.kind === "tote_settlement") && hidden.has(raceOf(r) ?? "")))
    .map((r) => ({ kind: r.kind, amount: Number(r.amount) }))
    .filter((r) => r.amount !== 0);
  return {
    net: moves.reduce((s, m) => s + m.amount, 0),
    prizes: moves.filter((m) => m.kind === "purse" || m.kind === "lease_share").length,
    refunds: moves.filter((m) => m.kind.endsWith("_refund")).length,
    moves: moves.length,
  };
}
