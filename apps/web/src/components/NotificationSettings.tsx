"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { refreshPlayer } from "@/lib/player";
import { CATEGORY_ICON } from "@/lib/notifications";
import type { NotificationCategoryKey, NotificationPrefsView } from "@/lib/types";
import { PixelIcon } from "./icons";

/**
 * Profile → Notifications: one switch per category (all on by default). A category switched off
 * leaves the bell and its unread count; the full inbox still lists everything, marked muted.
 */
export function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPrefsView | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<NotificationCategoryKey | null>(null);
  const [status, setStatus] = useState("");

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
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
