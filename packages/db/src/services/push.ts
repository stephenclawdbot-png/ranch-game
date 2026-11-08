/**
 * Phone / desktop alerts (Web Push with VAPID). They extend the bell for a few events that matter
 * when the player is away, never replace it:
 *
 *   race_soon     your Live race goes off in 10 minutes
 *   race_off      your Live race is going to post
 *   race_moved    your Live race was brought forward (it filled up, or the admin started it early)
 *   race_result   your Live result is ready to watch (never the placing: the text is neutral)
 *   back_in_race  a horse has recovered from injury
 *   foal_due      a mare is ready to foal (the foal is here to meet and name)
 *   gift_foal     the Club's gift foal arrived
 *
 * (INBOX_KINDS entries with `push: true`.) Everything else stays in the bell.
 *
 * Off and invisible unless VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are set.
 *
 * Flow. `notify` writes the inbox item inside the event's transaction and signals the web app,
 * which runs `deliverPushes` after the response (Next `after`), once the item is committed; the
 * lazy notification sweep and the cron run it too, as a catch-up. `deliverPushes` reads recent
 * push-kind items of accounts with a device, claims each one (push_deliveries, primary key: at most
 * one alert per item, whoever runs first), and sends it unless:
 *   - the category is switched off in the bell, or on every device of the player;
 *   - it is quiet hours (22:00-08:00 in the account's timezone), unless it is about a race the
 *     player entered that itself runs in those hours;
 *   - the account already had PUSH_DAILY_CAP alerts today (its local day);
 *   - it repeats an alert just sent (same kind and tag), or another item of the batch (two horses
 *     in one race: one alert); a "goes off in 10 minutes" right after "moved earlier" for the same
 *     race says nothing new, so it is a duplicate too;
 *   - it is stale (the race already went off, the result was already watched) or held back by the
 *     no-spoiler rule (it came out of a race whose result is still unwatched).
 * Alerts carry a tag (one per race / horse event): a later alert with the same tag replaces the
 * earlier one on the device, so a player never gets a stack. A device the push service reports
 * gone (404 / 410) is deleted. Failures are logged and never reach game logic.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, lte, notExists, sql } from "drizzle-orm";
import webpush from "web-push";
import * as gc from "@thoroughbred/game-core";
import { fromStates } from "../machines";
import { accounts, inboxItems, pushDeliveries, pushSubscriptions, races, type PushSubscriptionRow } from "../schema";
import type { Db, Executor } from "../types";
import { localDate } from "./entries";
import { LIVE_SLOT_KEY_LIKE } from "./card";
import { CATEGORY_KEYS, INBOX_KINDS, NOTIFICATION_CATEGORIES, PUSH_KINDS, categoryOf, notificationHref, notificationPrefsOf, safeTitle, type InboxKind, type NotificationCategory } from "./notifications";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Quiet hours, in the account's own timezone: from 22:00 to 08:00. */
export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 8;
/** At most this many alerts per account per local day (the bell still has everything). */
export const PUSH_DAILY_CAP = 6;
/** Only items this recent are pushed (an older note is old news: the bell has it). */
export const PUSH_WINDOW_MS = 30 * MIN;
/** The same alert (kind and tag) again within this long is a duplicate. */
export const PUSH_DUPLICATE_MS = 15 * MIN;
/** A "going to post" alert later than this after the off is pointless. */
export const RACE_OFF_STALE_MS = 5 * MIN;
/** Devices per account (the oldest goes when a new one is added). */
export const MAX_PUSH_DEVICES = 10;
/** A device is dropped after this many failed sends in a row (other than 404/410, which drop it at once). */
export const MAX_PUSH_FAILURES = 10;
/** Items one delivery run looks at. */
const BATCH = 200;

/** The categories that have alerts (in the settings' order). */
export const PUSH_CATEGORIES: readonly NotificationCategory[] = NOTIFICATION_CATEGORIES.map((c) => c.key).filter((k) => PUSH_KINDS.some((kind) => INBOX_KINDS[kind].category === k));

/** The race-day kinds: allowed in quiet hours when the race itself runs then. */
const RACE_KINDS: readonly InboxKind[] = ["race_soon", "race_off", "race_moved", "race_result"];
/** Pre-race kinds: pointless once the race has gone off. */
const BEFORE_OFF_KINDS: readonly InboxKind[] = ["race_soon", "race_moved"];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const B64URL = /^[A-Za-z0-9_-]+$/;
const b64len = (s: string) => (B64URL.test(s) ? Buffer.from(s, "base64url").length : -1);
let warned = "";

/**
 * The VAPID keys from the environment, or null (push off and invisible). The public key is an
 * uncompressed P-256 point (65 bytes) and the private key 32 bytes, both base64url (what
 * `web-push generate-vapid-keys` prints); the subject is a mailto: or https: contact.
 */
export function pushConfigFromEnv(env: Record<string, string | undefined> = process.env): PushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.VAPID_SUBJECT?.trim() ?? "";
  if (!publicKey || !privateKey || !subject) return null;
  if (b64len(publicKey) !== 65 || b64len(privateKey) !== 32 || !/^(mailto:|https:\/\/)/.test(subject)) {
    const sig = `${publicKey.length}:${privateKey.length}:${subject.slice(0, 8)}`;
    if (warned !== sig) {
      warned = sig;
      console.warn("[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT are set but not valid: phone alerts stay off");
    }
    return null;
  }
  return { publicKey, privateKey, subject };
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/** Push services a device may point at (the browsers' own). Anything else is refused: the server posts to this URL. */
const PUSH_HOST_SUFFIXES = [".googleapis.com", ".mozilla.com", ".mozaws.net", ".push.apple.com", ".notify.windows.com"];

/**
 * True for an https endpoint on a known browser push service, or an origin listed in `extraOrigins`
 * (PUSH_EXTRA_ORIGINS, comma-separated: local tests against a mock push service only).
 */
export function isAllowedPushEndpoint(endpoint: string, extraOrigins: string | undefined = process.env.PUSH_EXTRA_ORIGINS): boolean {
  if (typeof endpoint !== "string" || endpoint.length > 1024) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  const extra = (extraOrigins ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.includes(url.origin)) return true;
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s));
}

export interface PushDeviceInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** True when the keys look like a browser's (p256dh: a 65-byte P-256 point, auth: 16 bytes). */
export function isValidPushKeys(k: { p256dh: string; auth: string }): boolean {
  return b64len(k.p256dh.replace(/=+$/, "")) === 65 && b64len(k.auth.replace(/=+$/, "")) === 16;
}

export interface PushDeviceView {
  /** The categories this device gets alerts for. */
  categories: NotificationCategory[];
}

const cleanPushCategories = (xs: readonly unknown[]): NotificationCategory[] => PUSH_CATEGORIES.filter((k) => xs.includes(k));
const deviceView = (row: Pick<PushSubscriptionRow, "categories">): PushDeviceView => ({ categories: cleanPushCategories(row.categories ?? []) });

/**
 * Saves a device that said yes (or refreshes its keys). A device already on this account keeps its
 * categories; a new one (or one moving over from another account on the same browser) starts with
 * every alert category on. At most MAX_PUSH_DEVICES per account: the least recently updated goes.
 */
export async function savePushDevice(db: Db, input: PushDeviceInput & { accountId: string; userAgent?: string | null; now: Date }): Promise<PushDeviceView> {
  const p256dh = input.p256dh.replace(/=+$/, "");
  const auth = input.auth.replace(/=+$/, "");
  const [existing] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, input.endpoint));
  const categories = existing && existing.accountId === input.accountId ? cleanPushCategories(existing.categories) : [...PUSH_CATEGORIES];
  const userAgent = input.userAgent ? input.userAgent.slice(0, 300) : null;
  const [row] = await db
    .insert(pushSubscriptions)
    .values({ accountId: input.accountId, endpoint: input.endpoint, p256dh, auth, categories, userAgent, createdAt: input.now, updatedAt: input.now })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { accountId: input.accountId, p256dh, auth, categories, userAgent, failures: 0, updatedAt: input.now } })
    .returning();
  const all = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.accountId, input.accountId)).orderBy(sql`${pushSubscriptions.updatedAt} desc`, sql`${pushSubscriptions.id} desc`);
  const extra = all.slice(MAX_PUSH_DEVICES).map((r) => r.id);
  if (extra.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, extra));
  return deviceView(row!);
}

/** This account's device with that endpoint, or null. */
export async function pushDeviceOf(ex: Executor, accountId: string, endpoint: string): Promise<PushDeviceView | null> {
  const [row] = await ex.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.accountId, accountId)));
  return row ? deviceView(row) : null;
}

/** Switches alert categories on or off for one device (categories left out keep their setting). Null when it isn't this account's device. */
export async function setPushDeviceCategories(
  ex: Executor,
  input: { accountId: string; endpoint: string; enabled: Partial<Record<NotificationCategory, boolean>>; now: Date },
): Promise<PushDeviceView | null> {
  const [row] = await ex.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, input.endpoint), eq(pushSubscriptions.accountId, input.accountId)));
  if (!row) return null;
  const current = cleanPushCategories(row.categories);
  const categories = PUSH_CATEGORIES.filter((k) => (input.enabled[k] === undefined ? current.includes(k) : input.enabled[k]));
  await ex.update(pushSubscriptions).set({ categories, updatedAt: input.now }).where(eq(pushSubscriptions.id, row.id));
  return { categories };
}

/** Forgets a device (the player turned alerts off on it). Returns whether it existed. */
export async function removePushDevice(ex: Executor, input: { accountId: string; endpoint: string }): Promise<boolean> {
  const rows = await ex
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, input.endpoint), eq(pushSubscriptions.accountId, input.accountId)))
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------

export interface PushMessage {
  title: string;
  body: string;
  /** The page a tap opens (same-origin path). */
  url: string;
  /** Alerts with the same tag replace each other on the device. */
  tag: string;
  kind: string;
}

export interface PushItem {
  id: string;
  kind: string;
  title: string;
  data: unknown;
  raceId: string | null;
  horseId: string | null;
  readAt: Date | null;
  createdAt: Date;
  raceName: string | null;
}

/** The tag an alert shows under: one per race (soon, off and result replace each other), one per horse event. */
export function pushTag(item: Pick<PushItem, "kind" | "raceId" | "horseId" | "data">): string {
  if (item.raceId) return `race-${item.raceId}`;
  const preg = (item.data as { pregnancyId?: unknown } | null)?.pregnancyId;
  if (item.kind === "foal_due" && typeof preg === "string") return `foal-${preg}`;
  if (item.horseId) return `${item.kind}-${item.horseId}`;
  return item.kind;
}

/**
 * The alert for an inbox item. Never more than the bell would show before the result is watched:
 * a result says only that it is ready to watch (never the placing, a win or an injury).
 */
export function pushMessageFor(item: PushItem): PushMessage {
  const base = { url: notificationHref(item), tag: pushTag(item), kind: item.kind };
  const meta = INBOX_KINDS[item.kind as InboxKind] as { spoiler?: boolean } | undefined;
  if (item.kind === "race_result" || meta?.spoiler) {
    const race = item.raceName ? `the ${item.raceName}` : "your race";
    return { ...base, title: "Your result is ready", body: `Watch ${race} to see how it went.` };
  }
  const neutral = safeTitle({ ...item, readAt: null });
  switch (item.kind) {
    case "race_soon":
      return { ...base, title: "Your Live race is coming up", body: neutral };
    case "race_off":
      return { ...base, title: "Going to post", body: neutral };
    case "race_moved":
      return { ...base, title: "Your Live race moved earlier", body: neutral };
    case "back_in_race":
      return { ...base, title: "Back in the race", body: neutral };
    case "foal_due":
      return { ...base, title: "Your foal is here", body: neutral };
    case "gift_foal": {
      const name = neutral.split(": ").slice(1).join(": ").trim();
      return { ...base, title: "A gift foal from the Club", body: name ? `${name} is waiting for you in the nursery.` : "Your gift foal is waiting for you in the nursery." };
    }
    default:
      return { ...base, title: "Post Time", body: neutral };
  }
}

// ---------------------------------------------------------------------------
// Quiet hours and the daily cap
// ---------------------------------------------------------------------------

/** The hour (0-23) at `at` in IANA timezone `tz` (UTC if the zone is unknown). */
export function localHour(tz: string, at: Date): number {
  try {
    const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(at);
    return Number(h) % 24;
  } catch {
    return at.getUTCHours();
  }
}

/** True from QUIET_FROM_HOUR to QUIET_UNTIL_HOUR, local. */
export function isQuietHour(tz: string, at: Date): boolean {
  const h = localHour(tz, at);
  return h >= QUIET_FROM_HOUR || h < QUIET_UNTIL_HOUR;
}

function safeLocalDate(tz: string, at: Date): string {
  try {
    return localDate(tz, at);
  } catch {
    return localDate("UTC", at);
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface PushRequest {
  endpoint: string;
  headers: Record<string, string>;
  body: Buffer | null;
}

/** Posts one encrypted message to a push service; resolves with the HTTP status. */
export type PushTransport = (req: PushRequest) => Promise<{ status: number }>;

export const fetchTransport: PushTransport = async (req) => {
  const res = await fetch(req.endpoint, {
    method: "POST",
    headers: req.headers,
    body: req.body ? new Uint8Array(req.body) : null,
    signal: AbortSignal.timeout(10_000),
  });
  // Drain the body so the connection can be reused.
  await res.arrayBuffer().catch(() => undefined);
  return { status: res.status };
};

/** How long the push service may hold an alert for an offline device. */
function ttlSeconds(item: { kind: string }, postTime: Date | null, now: Date): number {
  if ((item.kind === "race_soon" || item.kind === "race_moved") && postTime) return Math.max(60, Math.floor((postTime.getTime() - now.getTime()) / 1000));
  if (item.kind === "race_off") return Math.floor(RACE_OFF_STALE_MS / 1000);
  if (item.kind === "race_result") return 6 * 3600;
  return 24 * 3600;
}

/** The encrypted request for one device (RFC 8291 aes128gcm, VAPID RFC 8292). */
export function buildPushRequest(config: PushConfig, device: Pick<PushSubscriptionRow, "endpoint" | "p256dh" | "auth">, msg: PushMessage, opts: { ttl: number; urgent?: boolean }): PushRequest {
  const d = webpush.generateRequestDetails({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, JSON.stringify(msg), {
    vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
    TTL: opts.ttl,
    urgency: opts.urgent ? "high" : "normal",
    // The push service keeps only the newest undelivered message per topic (<= 32 url-safe chars).
    topic: createHash("sha256").update(msg.tag).digest("base64url").slice(0, 32),
    contentEncoding: "aes128gcm",
  });
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.headers)) if (v !== undefined && v !== null) headers[k] = String(v);
  return { endpoint: d.endpoint, headers, body: d.body };
}

/** A push delivery's outcome: game-core pushDeliveryMachine (docs/state-machines.md), every state but "pending". */
export type PushStatus = gc.PushOutcome;

export interface PushRunReport {
  considered: number;
  sent: number;
  skipped: Partial<Record<PushStatus, number>>;
  devicesRemoved: number;
}

interface Candidate extends PushItem {
  accountId: string;
  timezone: string;
  postTime: Date | null;
  slotKey: string | null;
}

/**
 * Sends the alerts that are due (see the file comment). Idempotent and safe to run concurrently:
 * each item is claimed once. Returns what happened; never throws for a single device's failure.
 */
export async function deliverPushes(db: Db, now: Date, opts: { config?: PushConfig | null; transport?: PushTransport } = {}): Promise<PushRunReport> {
  const report: PushRunReport = { considered: 0, sent: 0, skipped: {}, devicesRemoved: 0 };
  const config = opts.config === undefined ? pushConfigFromEnv() : opts.config;
  if (!config) return report;
  const transport = opts.transport ?? fetchTransport;

  const rows = await db
    .select({
      id: inboxItems.id,
      accountId: inboxItems.accountId,
      kind: inboxItems.kind,
      title: inboxItems.title,
      data: inboxItems.data,
      raceId: inboxItems.raceId,
      horseId: inboxItems.horseId,
      readAt: inboxItems.readAt,
      createdAt: inboxItems.createdAt,
      raceName: races.name,
      postTime: races.postTime,
      slotKey: races.slotKey,
      timezone: accounts.timezone,
    })
    .from(inboxItems)
    .innerJoin(accounts, eq(accounts.id, inboxItems.accountId))
    .leftJoin(races, eq(races.id, inboxItems.raceId))
    .where(
      and(
        inArray(inboxItems.accountId, db.selectDistinct({ a: pushSubscriptions.accountId }).from(pushSubscriptions)),
        inArray(inboxItems.kind, [...PUSH_KINDS]),
        gt(inboxItems.createdAt, new Date(now.getTime() - PUSH_WINDOW_MS)),
        lte(inboxItems.createdAt, now),
        isNull(inboxItems.seenAt),
        notExists(db.select({ x: sql`1` }).from(pushDeliveries).where(eq(pushDeliveries.inboxItemId, inboxItems.id))),
      ),
    )
    .orderBy(asc(inboxItems.createdAt), asc(inboxItems.id))
    .limit(BATCH);
  if (!rows.length) return report;

  // Claim: whoever inserts the delivery row sends it.
  const claimed = await db
    .insert(pushDeliveries)
    .values(rows.map((r) => ({ inboxItemId: r.id, accountId: r.accountId, kind: r.kind, tag: pushTag(r), status: "pending" as const, createdAt: now })))
    .onConflictDoNothing()
    .returning({ id: pushDeliveries.inboxItemId });
  const mine = new Set(claimed.map((c) => c.id));
  const byAccount = new Map<string, Candidate[]>();
  for (const r of rows) if (mine.has(r.id)) byAccount.set(r.accountId, [...(byAccount.get(r.accountId) ?? []), { ...r, timezone: r.timezone ?? "UTC" }]);

  const statuses = new Map<string, PushStatus>();
  for (const [accountId, items] of byAccount) {
    try {
      await deliverForAccount(db, config, transport, accountId, items, now, statuses, report);
    } catch (err) {
      console.error("[push] delivery failed for an account", err);
      for (const it of items) if (!statuses.has(it.id)) statuses.set(it.id, "failed");
    }
  }
  report.considered = statuses.size;
  const byStatus = new Map<PushStatus, string[]>();
  for (const [id, s] of statuses) byStatus.set(s, [...(byStatus.get(s) ?? []), id]);
  for (const [s, ids] of byStatus) {
    // Only rows this run claimed (inserted "pending" above) get their outcome, once.
    await db.update(pushDeliveries).set({ status: s }).where(and(inArray(pushDeliveries.inboxItemId, ids), inArray(pushDeliveries.status, fromStates(gc.pushDeliveryMachine, s))));
    if (s === "sent") report.sent += ids.length;
    else report.skipped[s] = ids.length;
  }
  return report;
}

async function deliverForAccount(
  db: Db,
  config: PushConfig,
  transport: PushTransport,
  accountId: string,
  items: Candidate[],
  now: Date,
  statuses: Map<string, PushStatus>,
  report: PushRunReport,
): Promise<void> {
  const tz = items[0]!.timezone;
  const disabled = await notificationPrefsOf(db, accountId);
  let devices = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.accountId, accountId)).orderBy(asc(pushSubscriptions.createdAt));
  const recent = await db
    .select({ kind: pushDeliveries.kind, tag: pushDeliveries.tag, createdAt: pushDeliveries.createdAt })
    .from(pushDeliveries)
    .where(and(eq(pushDeliveries.accountId, accountId), eq(pushDeliveries.status, "sent"), gt(pushDeliveries.createdAt, new Date(now.getTime() - 26 * HOUR))));
  const today = safeLocalDate(tz, now);
  let sentToday = recent.filter((r) => safeLocalDate(tz, r.createdAt) === today).length;
  const sentKeys = new Set(recent.filter((r) => r.createdAt.getTime() > now.getTime() - PUSH_DUPLICATE_MS).map((r) => `${r.kind}|${r.tag}`));
  // "Moved earlier" already said when it goes off: a "goes off in 10 minutes" for that race adds nothing.
  for (const k of [...sentKeys]) if (k.startsWith("race_moved|")) sentKeys.add(`race_soon|${k.slice("race_moved|".length)}`);

  // Items that came out of a race (data.raceId) while that result is unwatched stay quiet (the bell holds them too).
  const heldRaces = new Set<string>();
  const fromRaces = [...new Set(items.map((i) => (i.data as { raceId?: unknown } | null)?.raceId).filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))];
  if (fromRaces.length) {
    const unwatched = await db
      .select({ raceId: inboxItems.raceId })
      .from(inboxItems)
      .where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.kind, "race_result"), isNull(inboxItems.readAt), inArray(inboxItems.raceId, fromRaces)));
    for (const u of unwatched) if (u.raceId) heldRaces.add(u.raceId);
  }

  // Within the batch, the newest item per (kind, tag) speaks for the rest.
  const latest = new Map<string, Candidate>();
  for (const it of items) latest.set(`${it.kind}|${pushTag(it)}`, it);

  for (const it of items) {
    const kind = it.kind as InboxKind;
    const key = `${kind}|${pushTag(it)}`;
    const category = categoryOf(kind, it.data);
    const isLiveRace = !!it.slotKey && likeLive(it.slotKey);
    const raceId = (it.data as { raceId?: unknown } | null)?.raceId;
    let status: PushStatus | null = null;
    if (latest.get(key) !== it) status = "duplicate";
    else if (RACE_KINDS.includes(kind) && it.raceId && !isLiveRace) status = "stale"; // Story / quick races: the player is there
    else if (BEFORE_OFF_KINDS.includes(kind) && it.postTime && now >= it.postTime) status = "stale";
    else if (kind === "race_off" && it.postTime && now.getTime() > it.postTime.getTime() + RACE_OFF_STALE_MS) status = "stale";
    else if (kind === "race_result" && it.readAt) status = "stale"; // already watched
    else if (disabled.includes(category)) status = "off";
    else if (typeof raceId === "string" && heldRaces.has(raceId)) status = "held";
    else if (sentKeys.has(key)) status = "duplicate";
    if (status) {
      statuses.set(it.id, status);
      continue;
    }
    const targets = devices.filter((d) => cleanPushCategories(d.categories).includes(category));
    if (!targets.length) status = "device_off";
    else if (isQuietHour(tz, now) && !(RACE_KINDS.includes(kind) && it.postTime && isQuietHour(tz, it.postTime))) status = "quiet";
    else if (sentToday >= PUSH_DAILY_CAP) status = "cap";
    if (status) {
      statuses.set(it.id, status);
      continue;
    }

    const msg = pushMessageFor(it);
    const ttl = ttlSeconds(it, it.postTime, now);
    let ok = false;
    for (const d of targets) {
      const outcome = await sendToDevice(db, config, transport, d, msg, { ttl, urgent: kind === "race_soon" || kind === "race_off" || kind === "race_moved" }, now);
      if (outcome === "ok") ok = true;
      if (outcome === "removed") {
        report.devicesRemoved++;
        devices = devices.filter((x) => x.id !== d.id);
      }
    }
    statuses.set(it.id, ok ? "sent" : "failed");
    if (ok) {
      sentToday++;
      sentKeys.add(key);
      if (kind === "race_moved") sentKeys.add(`race_soon|${pushTag(it)}`);
    }
  }
}

const likeLive = (slotKey: string) => {
  // LIVE_SLOT_KEY_LIKE is "live%:%": starts with "live" and has a ":" after it.
  const prefix = LIVE_SLOT_KEY_LIKE.split("%")[0]!;
  return slotKey.startsWith(prefix) && slotKey.indexOf(":", prefix.length) >= 0;
};

async function sendToDevice(
  db: Db,
  config: PushConfig,
  transport: PushTransport,
  device: PushSubscriptionRow,
  msg: PushMessage,
  opts: { ttl: number; urgent: boolean },
  now: Date,
): Promise<"ok" | "failed" | "removed"> {
  let status = 0;
  try {
    status = (await transport(buildPushRequest(config, device, msg, opts))).status;
  } catch (err) {
    console.error("[push] send failed", hostOf(device.endpoint), err instanceof Error ? err.message : err);
  }
  if (status >= 200 && status < 300) {
    await db.update(pushSubscriptions).set({ lastSentAt: now, failures: 0 }).where(eq(pushSubscriptions.id, device.id));
    return "ok";
  }
  if (status === 404 || status === 410) {
    // The browser unsubscribed or the subscription expired: forget the device.
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, device.id));
    return "removed";
  }
  if (status) console.error("[push] push service refused", hostOf(device.endpoint), status);
  const failures = device.failures + 1;
  if (failures >= MAX_PUSH_FAILURES) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, device.id));
    return "removed";
  }
  await db.update(pushSubscriptions).set({ failures }).where(eq(pushSubscriptions.id, device.id));
  device.failures = failures;
  return "failed";
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "?";
  }
}

/** For settings: the categories that have alerts, with their labels. */
export function pushCategoryList(): { key: NotificationCategory; label: string }[] {
  return NOTIFICATION_CATEGORIES.filter((c) => PUSH_CATEGORIES.includes(c.key)).map((c) => ({ key: c.key, label: c.label }));
}

export const isPushCategory = (x: unknown): x is NotificationCategory => typeof x === "string" && (CATEGORY_KEYS as readonly string[]).includes(x) && PUSH_CATEGORIES.includes(x as NotificationCategory);
