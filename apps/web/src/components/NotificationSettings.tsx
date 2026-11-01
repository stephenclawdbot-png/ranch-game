"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { refreshPlayer } from "@/lib/player";
import { CATEGORY_ICON } from "@/lib/notifications";
import { pushConfig, pushSupport, setDeviceCategory, thisDevice, turnOffPush, turnOnPush, type PushDevice, type PushServerConfig, type PushSupport } from "@/lib/push";
import type { NotificationCategoryKey, NotificationPrefsView } from "@/lib/types";
import { PixelIcon } from "./icons";

/**
 * Profile → Notifications: one switch per category (all on by default). A category switched off
 * leaves the bell and its unread count; the full inbox still lists everything, marked muted.
 *
 * Phone alerts (when the server has them on): a quiet "Turn on phone alerts" link, then a "Push to
 * this device" switch under each category that has alerts. Invisible when push is off.
 */
export function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPrefsView | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<NotificationCategoryKey | null>(null);
  const [status, setStatus] = useState("");
  const push = usePushDevice(setStatus);

  useEffect(() => {
    let live = true;
    fetch("/api/notifications/prefs", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<NotificationPrefsView>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setPrefs(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const toggle = async (key: NotificationCategoryKey, enabled: boolean, label: string) => {
    setBusy(key);
    setPrefs((p) => (p ? { categories: p.categories.map((c) => (c.key === key ? { ...c, enabled } : c)) } : p));
    try {
      const r = await fetch("/api/notifications/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: { [key]: enabled } }) });
      if (!r.ok) throw new Error(String(r.status));
      setPrefs((await r.json()) as NotificationPrefsView);
      setStatus(`${label} ${enabled ? "on" : "off"}`);
      void refreshPlayer().catch(() => undefined); // the bell's count follows
    } catch {
      setPrefs((p) => (p ? { categories: p.categories.map((c) => (c.key === key ? { ...c, enabled: !enabled } : c)) } : p));
      setStatus("Couldn't save. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="notifications" className="surface grid scroll-mt-24 gap-3 p-4" aria-labelledby="notifications-h" data-testid="notification-settings">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="notifications-h" className="t-h2">
          Notifications
        </h2>
        <Link href="/me/notifications" className="link font-bold" data-testid="notifications-all-link">
          All notifications ›
        </Link>
      </div>
      <p className="t-meta">
        Choose what the bell in the top bar tells you about. Switching a kind off hides it from the bell and its count; the full list still keeps everything, so nothing is lost.
      </p>
      {failed ? (
        <p className="t-meta">Couldn&apos;t load your settings. Reload the page to try again.</p>
      ) : !prefs ? (
        <div className="min-h-40" aria-busy />
      ) : (
        <ul className="grid gap-1">
          {prefs.categories.map((c) => (
            <li key={c.key} className="flex items-center gap-3 py-1.5">
              <PixelIcon name={CATEGORY_ICON[c.key]} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold" id={`nc-${c.key}`}>
                  {c.label}
                </span>
                <span className="t-meta block" id={`nc-${c.key}-d`}>
                  {c.detail}
                </span>
                {push.device && push.categories.includes(c.key) && (
                  <span className="mt-1.5 flex items-center gap-2">
                    <span className="t-meta font-bold" id={`np-${c.key}`}>
                      Push to this device
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={c.enabled && push.device.categories.includes(c.key)}
                      aria-labelledby={`np-${c.key} nc-${c.key}`}
                      disabled={!c.enabled || push.busy === c.key}
                      title={c.enabled ? undefined : "Switched off in the bell too"}
                      className="notif-switch"
                      onClick={() => void push.toggle(c.key, !push.device!.categories.includes(c.key), c.label)}
                      data-testid={`push-switch-${c.key}`}
                    >
                      <span aria-hidden>{c.enabled && push.device.categories.includes(c.key) ? "On" : "Off"}</span>
                    </button>
                  </span>
                )}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={c.enabled}
                aria-labelledby={`nc-${c.key}`}
                aria-describedby={`nc-${c.key}-d`}
                disabled={busy === c.key}
                className="notif-switch"
                onClick={() => void toggle(c.key, !c.enabled, c.label)}
                data-testid={`notif-switch-${c.key}`}
              >
                <span aria-hidden>{c.enabled ? "On" : "Off"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {prefs && <PushFooter push={push} />}
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}

interface PushState {
  cfg: PushServerConfig | null;
  support: PushSupport | null;
  device: PushDevice | null;
  categories: NotificationCategoryKey[];
  busy: NotificationCategoryKey | "on" | "off" | null;
  note: string;
  toggle: (key: NotificationCategoryKey, on: boolean, label: string) => Promise<void>;
  turnOn: () => Promise<void>;
  turnOff: () => Promise<void>;
}

/** This device's phone alerts: the server's config, what the browser allows, and the saved device. */
function usePushDevice(announce: (s: string) => void): PushState {
  const [cfg, setCfg] = useState<PushServerConfig | null>(null);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [device, setDevice] = useState<PushDevice | null>(null);
  const [busy, setBusy] = useState<PushState["busy"]>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      const c = await pushConfig();
      if (!live || !c.enabled) return;
      setCfg(c);
      setSupport(pushSupport());
      const d = await thisDevice().catch(() => null);
      if (live) setDevice(d);
    })();
    return () => {
      live = false;
    };
  }, []);

  return {
    cfg,
    support,
    device,
    categories: (cfg?.categories ?? []).map((c) => c.key),
    busy,
    note,
    toggle: async (key, on, label) => {
      setBusy(key);
      setDevice((d) => (d ? { categories: on ? [...d.categories, key] : d.categories.filter((k) => k !== key) } : d));
      try {
        const d = await setDeviceCategory(key, on);
        setDevice(d);
        announce(`${label} alerts on this device ${on ? "on" : "off"}`);
      } catch {
        setDevice((d) => (d ? { categories: on ? d.categories.filter((k) => k !== key) : [...d.categories, key] } : d));
        announce("Couldn't save. Try again.");
      } finally {
        setBusy(null);
      }
    },
    turnOn: async () => {
      setBusy("on");
      setNote("");
      const r = await turnOnPush();
      setBusy(null);
      setSupport(pushSupport());
      if (r.ok) {
        setDevice(r.device);
        announce("Phone alerts on for this device");
      } else if (r.reason === "dismissed") setNote("Your browser didn't turn them on. Try again when you're ready.");
      else if (r.reason === "failed") setNote("That didn't work on this browser. The bell will still have everything.");
    },
    turnOff: async () => {
      setBusy("off");
      await turnOffPush().catch(() => undefined);
      setBusy(null);
      setDevice(null);
      announce("Phone alerts off for this device");
    },
  };
}

function PushFooter({ push }: { push: PushState }) {
  if (!push.cfg?.enabled || !push.support || push.support === "unsupported") return null;
  return (
    <div className="grid gap-1 border-t border-cream/10 pt-3" data-testid="push-settings">
      {push.device ? (
        <>
          <p className="t-meta">
            <b className="text-cream">Phone alerts are on for this device.</b> They stay quiet from 22:00 to 08:00 your time (unless a race you entered runs then), and there are 6 a day at most. The bell still has everything.
          </p>
          <button type="button" className="link justify-self-start" disabled={push.busy === "off"} onClick={() => void push.turnOff()} data-testid="push-off">
            Turn off phone alerts on this device
          </button>
        </>
      ) : push.support === "ios-install" ? (
        <p className="t-meta" data-testid="push-ios">
          <b className="text-cream">Phone alerts on iPhone and iPad</b> need Post Time on your Home Screen: tap Share, then Add to Home Screen, open Post Time from there and turn them on here.
        </p>
      ) : push.support === "denied" ? (
        <p className="t-meta" data-testid="push-denied">
          Phone alerts are blocked for Post Time in this browser&apos;s settings. Allow notifications for this site there to turn them on.
        </p>
      ) : (
        <>
          <button type="button" className="link justify-self-start" disabled={push.busy === "on"} onClick={() => void push.turnOn()} data-testid="push-on">
            {push.busy === "on" ? "Turning on…" : "Turn on phone alerts"}
          </button>
          <p className="t-meta">A ping on this device when your race goes to post, your result is ready to watch, a foal arrives or a horse is back from injury. Never at night, a few a day at most.</p>
          {push.note && (
            <p className="t-meta" role="status">
              {push.note}
            </p>
          )}
        </>
      )}
    </div>
  );
}
