/**
 * Notifications: the one path every inbox item is written through (`notify`), the categories a
 * player can switch off, and the reads behind the top-bar bell (unread count, recent list, mark
 * read) and the full inbox page.
 *
 * Built on inbox_items (idempotent per account and dedupe key): an event is written once, by the
 * server path where it happens, inside that path's transaction.
 *
 * Read state. `read_at` keeps the meanings it already had (a race result watched: the reveal is
 * staged until then; a moment's horse-page highlight dismissed). The bell has its own `seen_at`
 * (opened from the bell, or "mark all read"). An item is unread in the bell while neither is set,
 * for UNREAD_WINDOW_MS after it arrived (an old note never nags).
 *
 * No spoilers (the live-race rule):
 *   - an unread item about a race (race_id set, a kind marked `spoiler`) shows a neutral title until
 *     its result has been watched;
 *   - an item that came out of a race but isn't about it (data.raceId: a moment, an injury, a
 *     horse back from that injury) is left out entirely while the owner still has that race's
 *     result unwatched, exactly like listMoments.
 *
 * Push (browser / phone) is not built. Its seam is `notify`: every new item passes through it, so a
 * delivery queue can be fed from there (after the transaction commits) without touching callers.
 */
import { and, desc, eq, gt, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { inboxItems, notificationPrefs, races } from "../schema";
import type { gc } from "../gameCore";
import type { Executor } from "../types";

// ---------------------------------------------------------------------------
// Categories and kinds
// ---------------------------------------------------------------------------

export const NOTIFICATION_CATEGORIES = [
  { key: "races", label: "Races & results", detail: "Results, your Live race about to go off and going off, entry reminders for your targets, new races that suit your horses, match races." },
  { key: "health", label: "Horse health & care", detail: "Injuries, a horse back in the race, retirements and memorials." },
  { key: "training", label: "Training", detail: "A new training week for the horses you train, and what training reveals." },
  { key: "market", label: "Market & sales", detail: "Sales, listings that expired, claims and leases." },
  { key: "breeding", label: "Breeding & stud", detail: "Stud bookings and fees, Pedigree Scans, breeders retiring." },
  { key: "jockeys", label: "Jockeys", detail: "Offers, signings and contract news." },
  { key: "betting", label: "Betting", detail: "Tote news, when there is any." },
  { key: "club", label: "Club & news", detail: "League recaps, sponsorships, weekly upkeep, unlocks and the first-week guide." },
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]["key"];
export const CATEGORY_KEYS: readonly NotificationCategory[] = NOTIFICATION_CATEGORIES.map((c) => c.key);

interface KindMeta {
  category: NotificationCategory;
  /** About a race's outcome: neutral title while the result is unwatched (needs race_id). */
  spoiler?: boolean;
  /** Where the bell links when the item carries no href, race or horse. */
  href?: string;
}

/**
 * Every inbox kind and its category. `notify` only accepts these keys, so a new kind without a
 * category does not compile (and notifications.test.ts scans the services for writes that bypass
 * `notify`).
 */
export const INBOX_KINDS = {
  // Races & results
  race_result: { category: "races", spoiler: true },
  match_note: { category: "races", href: "/quick" },
  plan_reminder: { category: "races" },
  race_suits: { category: "races", href: "/races" },
  race_soon: { category: "races" },
  race_off: { category: "races" },
  race_moved: { category: "races" },
  // Horse health & care
  injury: { category: "health" },
  back_in_race: { category: "health" },
  // Training
  training_ready: { category: "training", href: "/stable" },
  // Market & sales
  claim_won: { category: "market", spoiler: true },
  claim_lost: { category: "market", spoiler: true },
  claim_refunded: { category: "market", spoiler: true },
  claim_void: { category: "market", spoiler: true },
  horse_claimed: { category: "market", spoiler: true },
  usdg_sale: { category: "market", href: "/market" },
  listing_expired: { category: "market", href: "/market" },
  lease_start: { category: "market" },
  lease_end: { category: "market" },
  // Breeding & stud
  usdg_stud: { category: "breeding", href: "/breeding" },
  retired: { category: "breeding" },
  // Jockeys
  jockey: { category: "jockeys", href: "/jockeys" },
  // Club & news
  week_recap: { category: "club", href: "/league" },
  race_sponsor: { category: "club", spoiler: true, href: "/races" },
  upkeep: { category: "club", href: "/stable/finances" },
  gift_foal: { category: "club", href: "/nursery" },
  // Moments: the category comes from the moment's own kind (MOMENT_CATEGORY)
  moment: { category: "club" },
} as const satisfies Record<string, KindMeta>;

export type InboxKind = keyof typeof INBOX_KINDS;

/** Kinds that only the bell and the full inbox show (the Estate's race list, listInbox, leaves them out). */
export const BELL_ONLY_KINDS = ["injury", "back_in_race", "training_ready", "race_suits", "race_soon", "race_off", "race_moved", "listing_expired"] as const satisfies readonly InboxKind[];

/** Moments (moments.ts, guide.ts) by their game-core kind. A Record: a new moment kind must be placed. */
export const MOMENT_CATEGORY: Record<gc.MomentKind, NotificationCategory> = {
  quirk: "races",
  first_win: "races",
  first_feature: "races",
  improver: "training",
  exact: "training",
  scan: "breeding",
  retired: "health",
  legacy: "health",
  memorial: "health",
  unlock: "club",
  stable_steps: "club",
};

export const isInboxKind = (k: string): k is InboxKind => Object.prototype.hasOwnProperty.call(INBOX_KINDS, k);

/** The category of a stored item (an unknown kind, e.g. from an older build, counts as Club & news). */
export function categoryOf(kind: string, data?: unknown): NotificationCategory {
  if (kind === "moment") {
    const m = (data as { moment?: string } | null | undefined)?.moment;
    return (m && (MOMENT_CATEGORY as Record<string, NotificationCategory>)[m]) || "club";
  }
  return isInboxKind(kind) ? INBOX_KINDS[kind].category : "club";
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** SQL for categoryOf over inbox_items (built from the constant tables above, never from input). */
function categorySql(): SQL {
  const momentCase = Object.entries(MOMENT_CATEGORY)
    .map(([k, c]) => `when ${quote(k)} then ${quote(c)}`)
    .join(" ");
  const byCat = new Map<string, string[]>();
  for (const [k, m] of Object.entries(INBOX_KINDS)) if (k !== "moment") byCat.set(m.category, [...(byCat.get(m.category) ?? []), k]);
  const kindCase = [...byCat].map(([c, ks]) => `when "inbox_items"."kind" in (${ks.map(quote).join(", ")}) then ${quote(c)}`).join(" ");
  return sql.raw(`(case when "inbox_items"."kind" = 'moment' then (case "inbox_items"."data"->>'moment' ${momentCase} else 'club' end) ${kindCase} else 'club' end)`);
}

// ---------------------------------------------------------------------------
// Writing: notify()
// ---------------------------------------------------------------------------

export interface NotifyInput {
  accountId: string;
  kind: InboxKind;
  /** Unique per account: the same event is never written twice. */
  dedupeKey: string;
  title: string;
  data?: unknown;
  /** The race the item is about (marked read when that result is watched). */
  raceId?: string | null;
  horseId?: string | null;
  now: Date;
  /** Already seen (the player made it happen, e.g. a training injury shown on screen). */
  seen?: boolean;
}

/**
 * Writes one notification (an inbox item), at most once per (account, dedupe key). Returns the new
 * item's id, or null when it already existed. Call it inside the transaction of the event.
 *
 * The push seam: browser/phone delivery, when it comes, starts here (enqueue the returned id for a
 * sender that runs after commit and checks the player's category switches).
 */
export async function notify(ex: Executor, n: NotifyInput): Promise<string | null> {
  const rows = await ex
    .insert(inboxItems)
    .values({
      accountId: n.accountId,
      kind: n.kind,
      dedupeKey: n.dedupeKey,
      title: n.title,
      data: n.data ?? null,
      raceId: n.raceId ?? null,
      horseId: n.horseId ?? null,
      createdAt: n.now,
      ...(n.seen ? { seenAt: n.now } : {}),
    })
    .onConflictDoNothing()
    .returning({ id: inboxItems.id });
  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/** The categories this account switched off (none by default). */
export async function notificationPrefsOf(ex: Executor, accountId: string): Promise<NotificationCategory[]> {
  const [row] = await ex.select({ disabled: notificationPrefs.disabled }).from(notificationPrefs).where(eq(notificationPrefs.accountId, accountId));
  return cleanCategories(row?.disabled ?? []);
}

function cleanCategories(xs: readonly unknown[]): NotificationCategory[] {
  return CATEGORY_KEYS.filter((k) => xs.includes(k));
}

/** Saves the categories switched off (unknown keys are dropped). Returns what was stored. */
export async function setNotificationPrefs(ex: Executor, input: { accountId: string; disabled: readonly string[]; now: Date }): Promise<NotificationCategory[]> {
  const disabled = cleanCategories(input.disabled);
  await ex
    .insert(notificationPrefs)
    .values({ accountId: input.accountId, disabled, updatedAt: input.now })
    .onConflictDoUpdate({ target: notificationPrefs.accountId, set: { disabled, updatedAt: input.now } });
  return disabled;
}

// ---------------------------------------------------------------------------
// Reading: the bell and the full inbox
// ---------------------------------------------------------------------------

/** An item counts as unread in the bell for this long after it arrived. */
export const UNREAD_WINDOW_MS = 14 * 86_400_000;
/** The bell's unread count stops counting here (the badge shows "9+"). */
export const UNREAD_COUNT_CAP = 10;

/** Items that came out of a race (data.raceId) stay out while that result is still unwatched. */
const notHeldForResult = sql`not exists (
  select 1 from inbox_items r
  where r.account_id = "inbox_items"."account_id" and r.kind <> 'moment' and r.read_at is null
    and r.race_id is not null and r.race_id::text = "inbox_items"."data"->>'raceId'
)`;

function enabledOnly(disabled: readonly NotificationCategory[]): SQL | undefined {
  return disabled.length ? sql`${categorySql()} not in (${sql.join(disabled.map((c) => sql`${c}`), sql`, `)})` : undefined;
}

const unreadSql = (now: Date) => and(isNull(inboxItems.seenAt), isNull(inboxItems.readAt), gt(inboxItems.createdAt, new Date(now.getTime() - UNREAD_WINDOW_MS)));

/** Unread items for the bell (switched-off categories don't count), capped at UNREAD_COUNT_CAP. */
export async function unreadNotificationCount(ex: Executor, input: { accountId: string; now: Date; disabled?: readonly NotificationCategory[] }): Promise<number> {
  const disabled = input.disabled ?? (await notificationPrefsOf(ex, input.accountId));
  const capped = ex
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(and(eq(inboxItems.accountId, input.accountId), unreadSql(input.now), enabledOnly(disabled), notHeldForResult))
    .limit(UNREAD_COUNT_CAP)
    .as("capped");
  const [row] = await ex.select({ n: sql<number>`count(*)::int` }).from(capped);
  return Number(row?.n ?? 0);
}

export interface NotificationItem {
  id: string;
  kind: string;
  category: NotificationCategory;
  /** Spoiler-safe: a neutral line while the race it's about is unwatched. */
  title: string;
  href: string;
  raceId: string | null;
  horseId: string | null;
  createdAt: Date;
  unread: boolean;
  /** Its category is switched off (the full inbox still lists it). */
  muted: boolean;
}

type ItemRow = typeof inboxItems.$inferSelect & { raceName: string | null };

/** Where an item links: its own href, its race, its horse, or its kind's page. */
export function notificationHref(row: Pick<ItemRow, "kind" | "data" | "raceId" | "horseId">): string {
  const href = (row.data as { href?: unknown } | null)?.href;
  if (typeof href === "string" && href.startsWith("/") && !href.startsWith("//")) return href;
  if (row.raceId) return `/race/${row.raceId}`;
  const meta: KindMeta | undefined = isInboxKind(row.kind) ? INBOX_KINDS[row.kind] : undefined;
  if (row.horseId && !meta?.href) return `/horse/${row.horseId}`;
  return meta?.href ?? (row.horseId ? `/horse/${row.horseId}` : "/");
}

/** The title the player may see now (no spoilers before the result is watched). */
export function safeTitle(row: Pick<ItemRow, "kind" | "title" | "raceId" | "readAt" | "raceName">): string {
  const meta: KindMeta | undefined = isInboxKind(row.kind) ? INBOX_KINDS[row.kind] : undefined;
  if (meta?.spoiler && row.raceId && !row.readAt) {
    const race = row.raceName ? `the ${row.raceName}` : "a race";
    return row.kind === "race_result" ? `Your result is in from ${race}: watch it` : `News from ${race}: watch the race first`;
  }
  return row.title;
}

function toItem(row: ItemRow, now: Date, disabled: readonly NotificationCategory[]): NotificationItem {
  const category = categoryOf(row.kind, row.data);
  return {
    id: row.id,
    kind: row.kind,
    category,
    title: safeTitle(row),
    href: notificationHref(row),
    raceId: row.raceId,
    horseId: row.horseId,
    createdAt: row.createdAt,
    unread: !row.seenAt && !row.readAt && row.createdAt.getTime() > now.getTime() - UNREAD_WINDOW_MS,
    muted: disabled.includes(category),
  };
}

/**
 * Notifications, newest first. The bell (`all` false) leaves switched-off categories out; the full
 * inbox (`all` true) lists everything, muted ones flagged. `before` pages back (an item's createdAt).
 */
export async function listNotifications(
  ex: Executor,
  input: { accountId: string; now: Date; limit?: number; all?: boolean; before?: Date; category?: NotificationCategory; disabled?: readonly NotificationCategory[] },
): Promise<NotificationItem[]> {
  const disabled = input.disabled ?? (await notificationPrefsOf(ex, input.accountId));
  const rows = await ex
    .select({ item: inboxItems, raceName: races.name })
    .from(inboxItems)
    .leftJoin(races, eq(races.id, inboxItems.raceId))
    .where(
      and(
        eq(inboxItems.accountId, input.accountId),
        input.all ? undefined : enabledOnly(disabled),
        input.category ? sql`${categorySql()} = ${input.category}` : undefined,
        input.before ? lt(inboxItems.createdAt, input.before) : undefined,
        notHeldForResult,
      ),
    )
    .orderBy(desc(inboxItems.createdAt), desc(inboxItems.id))
    .limit(Math.max(1, Math.min(input.limit ?? 30, 100)));
  return rows.map((r) => toItem({ ...r.item, raceName: r.raceName }, input.now, disabled));
}

/**
 * Marks items seen in the bell: the given ids, or (no ids) every unread item the player can see now.
 * Never touches read_at, and never an item still held back for an unwatched result. Returns how many changed.
 */
export async function markNotificationsSeen(ex: Executor, input: { accountId: string; now: Date; ids?: readonly string[] }): Promise<number> {
  if (input.ids && input.ids.length === 0) return 0;
  const rows = await ex
    .update(inboxItems)
    .set({ seenAt: input.now })
    .where(
      and(
        eq(inboxItems.accountId, input.accountId),
        isNull(inboxItems.seenAt),
        input.ids ? inArray(inboxItems.id, [...input.ids]) : unreadSql(input.now),
        notHeldForResult,
      ),
    )
    .returning({ id: inboxItems.id });
  return rows.length;
}
