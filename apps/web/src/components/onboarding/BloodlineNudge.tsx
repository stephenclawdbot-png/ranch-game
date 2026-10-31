"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, refreshPlayer } from "@/lib/player";
import { ErrorNote } from "../ui/ErrorNote";
import { MentorLine } from "./Mentor";
import { sendOnboarding, useOnboarding } from "./guide";

/**
 * The day-3 bloodline nudge (owner-approved, 2026-11-01): from the stable's third day Wilf
 * suggests starting a bloodline. Retire one of the starters to the broodmares (a retired mare can
 * breed straight away) and pick a stallion, straight in the stallion finder. Shown once: "Not now"
 * puts it away for good, and the server never sends it to a stable that has already bred.
 */
export function BloodlineNudge() {
  const o = useOnboarding();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const b = o?.bloodline;
  if (!b) return null;
  const finder = `/breeding?mare=${encodeURIComponent(b.horseId)}#finder`;

  async function retire() {
    if (!b) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/horses/${b.horseId}/career`, { body: { action: "retire" } });
      await sendOnboarding({ action: "coach", id: "bloodline" }).catch(() => undefined);
      await refreshPlayer().catch(() => undefined);
      router.push(finder);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <section className="frame-hero grid gap-3 p-4" aria-label="Start a bloodline" data-testid="bloodline-nudge">
      <MentorLine compact>
        {b.retired ? (
          <p>
            A few days in the yard now, and you&rsquo;ve a broodmare doing nothing. <b>{b.name}</b> can be covered today: pick her a stallion and there&rsquo;s a foal on the way of your own
            breeding. That&rsquo;s how a stable becomes a name.
          </p>
        ) : (
          <p>
            A few days in the yard now: time to think about a bloodline. Retire <b>{b.name}</b> to the broodmares: a retired mare can be covered straight away. Pick her a stallion and you&rsquo;ll
            have a foal of your own breeding. That&rsquo;s how a stable becomes a name.
          </p>
        )}
      </MentorLine>
      {confirming ? (
        <div className="surface-2 grid gap-2 p-3" role="group" aria-label={`Retire ${b.name}?`}>
          <p className="font-bold">Retire {b.name} from racing? It&rsquo;s for good: she won&rsquo;t race again, but she can breed from today.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-brass" onClick={retire} disabled={busy} data-testid="bloodline-retire-confirm">
              {busy ? "Retiring…" : `Retire ${b.name} and pick a stallion`}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Keep her racing
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {b.retired ? (
            <Link href={finder} className="btn btn-brass" data-testid="bloodline-finder">
              Pick a stallion for {b.name}
            </Link>
          ) : (
            <>
              <button type="button" className="btn btn-brass" onClick={() => setConfirming(true)} data-testid="bloodline-retire">
                Retire {b.name} to the broodmares
              </button>
              <Link href={finder} className="btn" data-testid="bloodline-finder">
                Look at stallions first
              </Link>
            </>
          )}
          <button type="button" className="btn btn-ghost ml-auto" onClick={() => void sendOnboarding({ action: "coach", id: "bloodline" }).catch(() => undefined)} data-testid="bloodline-dismiss">
            Not now
          </button>
        </div>
      )}
      {error !== null && <ErrorNote error={error} />}
    </section>
  );
}
