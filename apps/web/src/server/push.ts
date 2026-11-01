/**
 * Phone / desktop alerts for the web app (packages/db services/push.ts has the rules).
 *
 * Delivery runs after the response: every new push-kind inbox item signals `schedulePush`
 * (onPushableNote), which hands `kickPush` to Next's `after()`, so the request never waits and the
 * item is committed by the time the sender reads it. Outside a request (scripts) it runs a moment
 * later on a timer. The lazy notification sweep and the cron call `kickPush` as a catch-up.
 * Concurrent kicks on one instance share one run (and run once more if asked meanwhile); across
 * instances the delivery claim keeps each alert to one send. Errors are logged, never thrown.
 *
 * Off and invisible unless VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are set.
 */
import { after } from "next/server";
import { deliverPushes, onPushableNote, pushConfigFromEnv, type Db } from "@thoroughbred/db";

let running: Promise<void> | null = null;
let again = false;
let getDb: (() => Promise<Db>) | null = null;

/** Wires the sender to the app's database (server/db.ts calls this once). */
export function initPush(db: () => Promise<Db>): void {
  getDb = db;
  onPushableNote(() => schedulePush());
}

/** Is push configured (the keys are set)? */
export function pushEnabled(): boolean {
  return pushConfigFromEnv() !== null;
}

/** The public half of the VAPID key pair (what browsers subscribe with), or null when push is off. */
export function pushPublicKey(): string | null {
  return pushConfigFromEnv()?.publicKey ?? null;
}

/** Sends whatever alerts are due now. Never rejects. */
export function kickPush(): Promise<void> {
  if (!getDb || !pushEnabled()) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  const dbOf = getDb;
  running = (async () => {
    try {
      do {
        again = false;
        const report = await deliverPushes(await dbOf(), new Date());
        if (report.considered) console.info("[push]", JSON.stringify(report));
      } while (again);
    } catch (err) {
      console.error("[push] delivery failed", err);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Runs kickPush after the current response (or shortly, outside a request). */
export function schedulePush(): void {
  if (!pushEnabled()) return;
  try {
    after(kickPush);
  } catch {
    setTimeout(() => void kickPush(), 1000);
  }
}
