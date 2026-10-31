import Link from "next/link";
import type { NemesisView, RivalView } from "@/lib/socialTypes";
import { LocalTime } from "../competition/LocalTime";
import { Silks } from "../Silks";
import { EmptyState } from "../ui/Page";

/** "1–3" from your side. */
export const scoreLine = (r: { ahead: number; behind: number }) => `${r.ahead}–${r.behind}`;

/**
 * Your rivals (stables your horses keep meeting and finishing within a length of, last 28 days)
 * with the head-to-head behind each one, and your nemesis horse. Built only from races whose
 * result is public.
 */
export function RivalsPanel({ rivals, nemesis, compact = false }: { rivals: RivalView[]; nemesis: NemesisView | null; compact?: boolean }) {
  if (!rivals.length && !nemesis) {
    return (
      <EmptyState
        title="No rivals yet"
        icon="silks-sash"
        testId="rivals-empty"
        text="Finish within a length of the same stable three times in Live races (last 28 days) and they become your rival. Or bring a friend as your rival."
        action={
          <Link href="/rival" className="btn btn-sm" data-testid="bring-rival-link">
            Bring a rival
          </Link>
        }
      />
    );
  }
  return (
    <div className="grid gap-3">
      {rivals.length > 0 && (
        <ul className="surface rows" data-testid="rivals-panel">
          {rivals.map((r) => (
            <li key={r.stableId} className="grid gap-1.5 px-4 py-3" data-testid="rival">
              <div className="flex items-center gap-3">
                {r.silks && <Silks silks={r.silks} cap={false} className="h-[26px] w-8 shrink-0" />}
                <Link href={`/stables/${r.stableId}`} className="t-title min-w-0 flex-1 truncate underline-offset-2 hover:underline">
                  {r.stableName}
                </Link>
                <span className="num whitespace-nowrap text-sm font-bold" title="Head-to-head: meetings where your best runner finished ahead of theirs, and behind">
                  H2H {scoreLine(r)}
                </span>
              </div>
              {r.declared && (
                <p className="text-sm font-bold" data-testid="rival-declared">
                  <span className="tag">{r.declared === "invited" ? `You invited ${r.stableName}` : `${r.stableName} invited you`}</span>
                </p>
              )}
              <p className="t-meta">
                {r.meetings} {r.meetings === 1 ? "meeting" : "meetings"} · {r.close} close {r.close === 1 ? "finish" : "finishes"}
                {r.last && (
                  <>
                    {" "}
                    · last:{" "}
                    <Link href={`/race/${r.last.raceId}`} className="underline decoration-dotted underline-offset-2">
                      {r.last.raceName}
                    </Link>{" "}
                    (<LocalTime ms={r.last.atMs} withDate />, {r.last.ahead ? "you ahead" : "they were ahead"})
                  </>
                )}
              </p>
              {!compact && r.pairs.length > 0 && (
                <ul className="caption grid gap-0.5" aria-label={`Your horses against ${r.stableName}`}>
                  {r.pairs.map((p) => (
                    <li key={`${p.mineId}-${p.theirId}`}>
                      {p.mineName} v {p.theirName}: {scoreLine(p)} in {p.meetings}
                      {p.close > 0 ? `, ${p.close} close` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {rivals.length > 0 && (
        <Link href="/rival" className="link w-fit text-sm" data-testid="bring-rival-link">
          Bring a rival ›
        </Link>
      )}
      {nemesis && (
        <p className="surface flex items-center gap-2 px-4 py-3 text-sm" data-testid="nemesis">
          <span className="tag tag-live">Nemesis</span>
          <span className="min-w-0">
            <Link href={`/horse/${nemesis.horseId}`} className="font-bold underline-offset-2 hover:underline">
              {nemesis.horseName}
            </Link>{" "}
            ({nemesis.stableName}) has beaten your horses in {nemesis.closeBeats} close finishes.
          </span>
        </p>
      )}
    </div>
  );
}
