/**
 * Client helpers for notifications: the badge text, grouping by the player's local day, the
 * category icons. Pure (tested in notifications.test.ts).
 */
import type { IconName } from "@/components/icons";
import type { NotificationCategoryKey, NotificationView } from "./types";

/** The server stops counting at 10: the badge shows "9+". */
export function badgeText(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 9 ? "9+" : String(unread);
}

/** Screen-reader wording for the bell. */
export function bellLabel(unread: number): string {
  if (unread <= 0) return "Notifications: nothing unread";
  return `Notifications: ${unread > 9 ? "more than 9" : unread} unread`;
}

export const CATEGORY_ICON: Record<NotificationCategoryKey, IconName> = {
  races: "flag",
  health: "horseshoe",
  training: "stopwatch",
  market: "coin",
  breeding: "star",
  jockeys: "saddle-cloth",
  betting: "dice",
  club: "trophy",
};

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** "Today", "Yesterday", or "Mon 2 Nov" in the viewer's own time zone. */
export function dayLabel(atMs: number, nowMs: number, locale?: string): string {
  const at = new Date(atMs);
  const now = new Date(nowMs);
  if (dayKey(at) === dayKey(now)) return "Today";
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(at) === dayKey(y)) return "Yesterday";
  return at.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", ...(at.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

/** Items (newest first) grouped by local day, in order. */
export function groupByDay<T extends Pick<NotificationView, "createdAtMs">>(items: readonly T[], nowMs: number, locale?: string): { label: string; items: T[] }[] {
  const out: { label: string; items: T[] }[] = [];
  for (const it of items) {
    const label = dayLabel(it.createdAtMs, nowMs, locale);
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(it);
    else out.push({ label, items: [it] });
  }
  return out;
}

/** The time of day, local ("14:05"). */
export function timeOfDay(atMs: number, locale?: string): string {
  return new Date(atMs).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}
