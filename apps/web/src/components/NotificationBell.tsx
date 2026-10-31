"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePlayerState } from "@/lib/player";
import { CATEGORY_ICON, badgeText, bellLabel, groupByDay, timeOfDay } from "@/lib/notifications";
import type { NotificationView, NotificationsView } from "@/lib/types";
import { PixelIcon } from "./icons";

/** How often the open tab asks for the unread count (GET /api/notifications/count, cached 15 s privately). */
export const BELL_POLL_MS = 60_000;

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The top-bar bell: unread count (the player state carries it; a light count endpoint polls while
 * the tab is visible), and a panel of recent notifications grouped by day: a full-width sheet on
 * phones, a dropdown on desktop. Escape or the close button closes it and focus returns to the
 * bell; Tab stays inside the panel while it's open.
 */
export function NotificationBell() {
  const state = usePlayerState();
  const [unread, setUnread] = useState<number>(state?.unreadNotifications ?? 0);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationsView | null>(null);
  const [error, setError] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const prev = useRef(unread);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const headingId = useId();

  // The player state (GET /api/me, on load, focus and after actions) carries the count.
  useEffect(() => {
    if (typeof state?.unreadNotifications === "number") setUnread(state.unreadNotifications);
  }, [state?.unreadNotifications]);

  // Announce only a rise (a new notification), politely.
  useEffect(() => {
    if (unread > prev.current) setAnnounce(bellLabel(unread));
    prev.current = unread;
  }, [unread]);

  // Light poll while the tab is visible.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/notifications/count");
        if (!r.ok || stopped) return;
        const { unread: n } = (await r.json()) as { unread: number };
        if (!stopped) setUnread(n);
      } catch {
        /* offline: keep the last count */
      }
    };
    const t = setInterval(tick, BELL_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  const load = useCallback(async () => {
    setError(false);
    try {
      const r = await fetch("/api/notifications", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const v = (await r.json()) as NotificationsView;
      setData(v);
      setUnread(v.unread);
    } catch {
      setError(true);
    }
  }, []);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    // focus the panel's first control once it's on screen
    const f = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const els = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!els.length) return;
      const first = els[0]!;
      const last = els[els.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!panel.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || button.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      cancelAnimationFrame(f);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, load, close]);

  const markAll = async () => {
    setData((d) => (d ? { ...d, unread: 0, items: d.items.map((i) => ({ ...i, unread: false })) } : d));
    setUnread(0);
    try {
      const r = await fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (r.ok) setUnread(((await r.json()) as { unread: number }).unread);
    } catch {
      /* the next poll corrects it */
    }
  };

  const openItem = (item: NotificationView) => {
    if (item.unread) {
      setUnread((n) => Math.max(0, n - 1));
      void fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [item.id] }), keepalive: true }).catch(() => undefined);
    }
    close(false);
  };

  const badge = badgeText(unread);
  const nowMs = Date.now();

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        className={`pill relative !px-0.5 ${open ? "pill-on" : ""}`}
        aria-label={bellLabel(unread)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => {
          if (open) return close();
          const r = button.current?.getBoundingClientRect();
          // the desktop dropdown hangs under the bell (the phone sheet ignores this)
          if (r) setAnchor({ top: Math.round(r.bottom + 10), right: Math.max(8, Math.round(window.innerWidth - r.right - 8)) });
          setOpen(true);
        }}
        data-testid="nav-bell"
      >
        <PixelIcon name="bell" size={32} />
        {badge && (
          <span className="bell-badge" data-testid="bell-badge" aria-hidden>
            {badge}
          </span>
        )}
      </button>
      <span className="sr-only" aria-live="polite" role="status">
        {announce}
      </span>
      {/* On document.body: above the sticky top bar and the tab bar (their own stacking contexts). */}
      {open &&
        createPortal(
          <>
            <div className="bell-backdrop md:hidden" aria-hidden onClick={() => close(false)} />
            <div
              ref={panel}
              id={panelId}
              role="dialog"
              aria-modal="true"
              aria-labelledby={headingId}
              className="surface bell-panel"
              style={anchor ? ({ "--bell-top": `${anchor.top}px`, "--bell-right": `${anchor.right}px` } as React.CSSProperties) : undefined}
              data-testid="bell-panel"
            >
              <div className="flex items-center gap-2 px-4 pb-2 pt-3">
                <h2 id={headingId} className="t-h2 flex-1">
                  Notifications
                </h2>
                <button type="button" className="btn btn-sm btn-outline" onClick={markAll} disabled={!data?.items.some((i) => i.unread)} data-testid="bell-mark-all">
                  Mark all read
                </button>
                <button type="button" className="btn btn-sm btn-outline !px-2" aria-label="Close notifications" onClick={() => close()}>
                  <PixelIcon name="cross" className="h-4 w-4" />
                </button>
              </div>
              <div className="bell-list" data-testid="bell-list">
                {error ? (
                  <p className="t-meta px-4 py-6">
                    Couldn&apos;t load your notifications.{" "}
                    <button type="button" className="link" onClick={() => void load()}>
                      Try again
                    </button>
                  </p>
                ) : !data ? (
                  <p className="t-meta px-4 py-6">Loading…</p>
                ) : data.items.length === 0 ? (
                  <p className="t-meta px-4 py-6">Nothing yet. Race results, injuries, sales and more will show up here.</p>
                ) : (
                  groupByDay(data.items, nowMs).map((g) => (
                    <section key={g.label} aria-label={g.label}>
                      <h3 className="bell-day">{g.label}</h3>
                      <ul>
                        {g.items.map((it) => (
                          <li key={it.id}>
                            <Link href={it.href} className="bell-item" data-unread={it.unread ? "1" : "0"} onClick={() => openItem(it)} data-testid="bell-item">
                              <PixelIcon name={CATEGORY_ICON[it.category]} size={32} />
                              <span className="min-w-0 flex-1">
                                <span className="block leading-snug">
                                  {it.unread && <span className="sr-only">Unread: </span>}
                                  {it.title}
                                </span>
                                <span className="t-meta block">{timeOfDay(it.createdAtMs)}</span>
                              </span>
                              {it.unread && <span className="bell-dot" aria-hidden />}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <Link href="/me/notifications" className="link font-extrabold" onClick={() => close(false)} data-testid="bell-all">
                  All notifications
                </Link>
                <Link href="/me#notifications" className="link" onClick={() => close(false)}>
                  Settings
                </Link>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
