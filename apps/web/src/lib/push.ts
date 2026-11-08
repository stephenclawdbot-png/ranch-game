/**
 * Phone / desktop alerts, browser side: is this device able to get them, turn them on (ask the
 * permission, register /sw.js, subscribe with the server's key, save it) or off, and the one-time
 * ask after the first Live entry. Everything is invisible when the server has push off.
 *
 * iPhone and iPad: Safari delivers web alerts only to Post Time added to the Home Screen and opened
 * from there; in a Safari tab there is no PushManager, so the UI explains Add to Home Screen.
 */
import { api } from "./player";
import { withTimeout } from "./fetchTimed";
import type { NotificationCategoryKey } from "./types";

export interface PushServerConfig {
  enabled: boolean;
  publicKey?: string;
  categories?: { key: NotificationCategoryKey; label: string }[];
}

export interface PushDevice {
  categories: NotificationCategoryKey[];
}

/** "ready": can turn alerts on here. "ios-install": iPhone/iPad in a browser tab (needs Add to Home Screen). "denied": blocked in browser settings. "unsupported": no Web Push here. */
export type PushSupport = "ready" | "ios-install" | "denied" | "unsupported";

const SW_URL = "/sw.js";
const ASKED_KEY = "pt-push-asked";
/** Each step after the permission prompt (register, ready, subscribe) gives up after this. */
const PUSH_STEP_TIMEOUT_MS = 20_000;

let configPromise: Promise<PushServerConfig> | null = null;

/** The server's push settings (cached for the page's life; `{ enabled: false }` on any failure). */
export function pushConfig(): Promise<PushServerConfig> {
  configPromise ??= fetch("/api/push", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<PushServerConfig>) : { enabled: false }))
    .catch(() => ({ enabled: false }));
  return configPromise;
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIos() && !isStandalone()) return "ios-install";
  if (!capable) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "ready";
}

/** This browser's current push subscription (null when none, or no service worker yet). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** This device as the server knows it for this account (null: alerts are off here). */
export async function thisDevice(): Promise<PushDevice | null> {
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return null;
  // Subscribed in this browser but not for this account (another sign-in, or forgotten): null, so
  // the player turns it on with a tap rather than silently.
  const r = await api<{ device: PushDevice | null }>("/api/push/device", { method: "PATCH", body: { endpoint: sub.endpoint } });
  return r.device;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i]);

async function saveSubscription(sub: PushSubscription): Promise<PushDevice> {
  const r = await api<{ device: PushDevice }>("/api/push/device", { body: { subscription: sub.toJSON() } });
  return r.device;
}

export type TurnOnResult = { ok: true; device: PushDevice } | { ok: false; reason: "denied" | "dismissed" | "unsupported" | "off" | "failed" };

/** Asks the browser's permission (only ever from a tap), subscribes and saves the device. */
export async function turnOnPush(): Promise<TurnOnResult> {
  const cfg = await pushConfig();
  if (!cfg.enabled || !cfg.publicKey) return { ok: false, reason: "off" };
  if (pushSupport() !== "ready") return { ok: false, reason: pushSupport() === "denied" ? "denied" : "unsupported" };
  try {
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: permission === "denied" ? "denied" : "dismissed" };
    // After the player's answer every step has a time limit: a service worker that never gets
    // ready, or a browser whose push service never answers, ends as "failed" instead of a
    // "Turning on…" that never finishes.
    const reg = await withTimeout(navigator.serviceWorker.register(SW_URL, { scope: "/" }), PUSH_STEP_TIMEOUT_MS);
    await withTimeout(navigator.serviceWorker.ready, PUSH_STEP_TIMEOUT_MS);
    const key = keyBytes(cfg.publicKey);
    let sub = await withTimeout(reg.pushManager.getSubscription(), PUSH_STEP_TIMEOUT_MS);
    if (sub && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe().catch(() => undefined);
      sub = null;
    }
    sub ??= await withTimeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), PUSH_STEP_TIMEOUT_MS);
    return { ok: true, device: await saveSubscription(sub) };
  } catch (err) {
    console.warn("[push] couldn't turn alerts on", err);
    return { ok: false, reason: "failed" };
  }
}

/** Turns alerts off on this device (the browser forgets the subscription, the server too). */
export async function turnOffPush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api("/api/push/device", { method: "DELETE", body: { endpoint: sub.endpoint } }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

export async function setDeviceCategory(key: NotificationCategoryKey, on: boolean): Promise<PushDevice | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const r = await api<{ device: PushDevice | null }>("/api/push/device", { method: "PATCH", body: { endpoint: sub.endpoint, enabled: { [key]: on } } });
  return r.device;
}

/** The one-time ask after the first Live entry: asked already on this device? */
export function askedBefore(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return true; // no storage: don't risk asking again and again
  }
}

export function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    /* private mode */
  }
}
