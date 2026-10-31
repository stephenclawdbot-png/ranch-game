"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PlayerGate } from "@/components/PlayerGate";
import { EmptyState, PageHeader } from "@/components/ui/Page";
import { PixelIcon } from "@/components/icons";
import { CATEGORY_ICON, groupByDay, timeOfDay } from "@/lib/notifications";
import { refreshPlayer, type PlayerState } from "@/lib/player";
import type { NotificationCategoryKey, NotificationView, NotificationsView } from "@/lib/types";

const FILTERS: { key: NotificationCategoryKey | null; label: string }[] = [
  { key: null, label: "All" },
  { key: "races", label: "Races" },
  { key: "health", label: "Health" },
  { key: "training", label: "Training" },
  { key: "market", label: "Market" },
  { key: "breeding", label: "Breeding" },
  { key: "jockeys", label: "Jockeys" },
  { key: "betting", label: "Betting" },
  { key: "club", label: "Club" },
];

/**
 * The full inbox: every notification, newest first, a page at a time. Categories switched off in
 * Profile still appear here (marked "muted"): the switches only quiet the bell, nothing is lost.
 */
function Inbox({ state }: { state: PlayerState }) {
  const [category, setCategory] = useState<NotificationCategoryKey | null>(null);
  const [items, setItems] = useState<NotificationView[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (cat: NotificationCategoryKey | null, before: number | null) => {
    setBusy(true);
    setFailed(false);
    try {
      const q = new URLSearchParams({ all: "1", ...(cat ? { category: cat } : {}), ...(before ? { before: String(before) } : {}) });
      const r = await fetch(`/api/notifications?${q}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const v = (await r.json()) as NotificationsView;
      setItems((cur) => (before && cur ? [...cur, ...v.items] : v.items));
      setNext(v.nextBefore);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    setItems(null);
    void load(category, null);
  }, [category, load]);

  const markAll = async () => {
    setItems((cur) => cur?.map((i) => ({ ...i, unread: false })) ?? cur);
    await fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
    void refreshPlayer().catch(() => undefined);
  };

  const opened = (it: NotificationView) => {
    if (!it.unread) return;
    void fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [it.id] }), keepalive: true }).catch(() => undefined);
  };

  const nowMs = Date.now();
  return (
    <div className="mx-auto grid max-w-3xl content-start gap-4" data-testid="notifications-page">
      <PageHeader
        back={{ href: "/me", label: "Profile" }}
        eyebrow={state.stableName}
        title="Notifications"
        meta={
          <>
            Everything the bell has told you, newest first. Kinds you switched off still show here, marked muted.{" "}
            <Link href="/me#notifications" className="link font-bold">
              Choose what the bell shows
            </Link>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="segmented max-w-full overflow-x-auto" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.label} type="button" aria-pressed={category === f.key} onClick={() => setCategory(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm btn-outline ml-auto" onClick={markAll} disabled={!items?.some((i) => i.unread)}>
          Mark all read
        </button>
      </div>

      {items && items.length > 0 ? (
        <div className="grid gap-3">
          {groupByDay(items, nowMs).map((g) => (
            <section key={g.label} aria-label={g.label} className="surface">
              <h2 className="bell-day">{g.label}</h2>
              <ul>
                {g.items.map((it) => (
                  <li key={it.id}>
                    <Link href={it.href} className="bell-item" data-unread={it.unread ? "1" : "0"} onClick={() => opened(it)} data-testid="inbox-item">
                      <PixelIcon name={CATEGORY_ICON[it.category]} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block leading-snug">
                          {it.unread && <span className="sr-only">Unread: </span>}
                          {it.title}
                        </span>
                        <span className="t-meta block">
                          {timeOfDay(it.createdAtMs)}
                          {it.muted ? " · muted" : ""}
                        </span>
                      </span>
                      {it.unread && <span className="bell-dot" aria-hidden />}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {next && (
            <button type="button" className="btn btn-outline justify-self-center" disabled={busy} onClick={() => void load(category, next)}>
              {busy ? "Loading…" : "Show older"}
            </button>
          )}
        </div>
      ) : items ? (
        <EmptyState icon="bell" title="Nothing here yet" text="Race results, injuries, sales, training and more will show up here as they happen." />
      ) : failed ? (
        <EmptyState icon="cross" title="Couldn't load your notifications" text="Check your connection and try again." />
      ) : (
        <div className="min-h-40" aria-busy />
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return <PlayerGate>{(s) => <Inbox state={s} />}</PlayerGate>;
}
