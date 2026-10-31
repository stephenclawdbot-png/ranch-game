/**
 * Notifications for the web app (packages/db notifications.ts): the top-bar bell, the full inbox
 * (/me/notifications) and the category switches on Profile. Reads only, plus "seen" marks and
 * the switches; notifications themselves are written by the server paths where things happen.
 */
import {
  CATEGORY_KEYS,
  NOTIFICATION_CATEGORIES,
  listNotifications,
  markNotificationsSeen,
  notificationPrefsOf,
  setNotificationPrefs,
  sweepNotifications,
  unreadNotificationCount,
  type Db,
  type NotificationCategory,
  type NotificationItem,
} from "@thoroughbred/db";
import type { NotificationPrefsView, NotificationView, NotificationsView } from "@/lib/types";
import type { Session } from "./session";

/** Items in the bell's panel. */
export const BELL_LIMIT = 30;
/** Items per page of the full inbox. */
export const INBOX_PAGE = 40;

function view(n: NotificationItem): NotificationView {
  return { id: n.id, kind: n.kind, category: n.category, title: n.title, href: n.href, createdAtMs: n.createdAt.getTime(), unread: n.unread, muted: n.muted };
}

export const isCategory = (x: unknown): x is NotificationCategory => typeof x === "string" && (CATEGORY_KEYS as readonly string[]).includes(x);

/** The unread count for the bell badge (cheap: one capped read plus the switches). */
export async function unreadCount(db: Db, session: Session, now: Date): Promise<number> {
  return unreadNotificationCount(db, { accountId: session.accountId, now });
}

/** The bell (`all` false: switched-off categories left out) or a page of the full inbox (`all` true). */
export async function notificationsView(db: Db, session: Session, now: Date, opts: { all?: boolean; before?: number | null; category?: NotificationCategory | null } = {}): Promise<NotificationsView> {
  const disabled = await notificationPrefsOf(db, session.accountId);
  const limit = opts.all ? INBOX_PAGE : BELL_LIMIT;
  const items = await listNotifications(db, {
    accountId: session.accountId,
    now,
    limit,
    all: !!opts.all,
    disabled,
    ...(opts.before ? { before: new Date(opts.before) } : {}),
    ...(opts.category ? { category: opts.category } : {}),
  });
  const unread = await unreadNotificationCount(db, { accountId: session.accountId, now, disabled });
  return { unread, items: items.map(view), nextBefore: opts.all && items.length === limit ? items[items.length - 1]!.createdAt.getTime() : null };
}

/** Marks items seen (ids), or everything unread (no ids). Returns the new unread count. */
export async function markSeen(db: Db, session: Session, now: Date, ids?: string[]): Promise<number> {
  await markNotificationsSeen(db, { accountId: session.accountId, now, ...(ids ? { ids } : {}) });
  return unreadNotificationCount(db, { accountId: session.accountId, now });
}

export async function prefsView(db: Db, session: Session): Promise<NotificationPrefsView> {
  const disabled = await notificationPrefsOf(db, session.accountId);
  return { categories: NOTIFICATION_CATEGORIES.map((c) => ({ key: c.key, label: c.label, detail: c.detail, enabled: !disabled.includes(c.key) })) };
}

export async function savePrefs(db: Db, session: Session, enabled: Partial<Record<NotificationCategory, boolean>>, now: Date): Promise<NotificationPrefsView> {
  const current = await notificationPrefsOf(db, session.accountId);
  const disabled = CATEGORY_KEYS.filter((k) => (enabled[k] === undefined ? current.includes(k) : !enabled[k]));
  await setNotificationPrefs(db, { accountId: session.accountId, disabled, now });
  return prefsView(db, session);
}

// ---------------------------------------------------------------------------
// The time-driven notes (back in the race, the new training week): lazily on reads
// ---------------------------------------------------------------------------

/** At most once a minute per server instance (the daily cron is the backstop). */
export const SWEEP_EVERY_MS = 60_000;
const G = globalThis as typeof globalThis & { __tbNoteSweep?: { at: number } };
const sweepState = (G.__tbNoteSweep ??= { at: 0 });

export async function maybeSweepNotifications(db: Db, now: Date): Promise<void> {
  if (now.getTime() - sweepState.at < SWEEP_EVERY_MS && now.getTime() >= sweepState.at) return;
  sweepState.at = now.getTime();
  try {
    await sweepNotifications(db, now);
  } catch (err) {
    console.error("[notifications] sweep failed", err);
  }
}
