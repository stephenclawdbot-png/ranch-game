import Link from "next/link";
import { formatRaceTime, type RaceReplay } from "@thoroughbred/shared";
import type { RaceCard } from "@/server/races";
import { formatCredits } from "@/lib/format";
import { SilksIcon } from "../Silks";
import { PixelIcon } from "../icons";
import { PositionBadge } from "../horse/HorseDetail";
import { Saddlecloth } from "./Saddlecloth";

/** The official result as a pixel leaderboard board. */
export function ResultsTable({ replay, card, highlightHorseId }: { replay: RaceReplay; card: RaceCard; highlightHorseId?: string }) {
  const byId = new Map(card.field.map((e) => [e.horse.id, e]));
  const { result } = replay;
  return (
    <section aria-labelledby="results-h">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <h2 id="results-h" className="display flex items-center gap-2 text-2xl">
          <PixelIcon name="trophy" className="h-6 w-6" /> Result
        </h2>
        <p className="label flex items-center gap-2">
          Winning time <span className="led text-xl normal-case leading-none text-brass-bright">{formatRaceTime(result.winningTimeUs)}</span>
          {result.photoFinish && <span className="chip chip-brass !py-0">Photo finish</span>}
        </p>
      </div>
      <div className="px-screen overflow-hidden !p-0">
        <div className="flex items-center justify-between bg-[#14110a] px-3 py-1.5" aria-hidden>
          <span className="led text-lg tracking-[0.2em] text-brass-bright">OFFICIAL RESULT</span>
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 bg-live" style={{ animation: `blink 1.2s steps(1) ${i * 400}ms infinite` }} />
            ))}
          </span>
        </div>
        <table className="w-full text-left text-sm" data-testid="results-table">
          <thead className="bg-[#0b0f0c]">
            <tr className="label">
              <th scope="col" className="w-14 py-1.5 pl-3 font-normal">Pos</th>
              <th scope="col" className="py-1.5 pl-1 font-normal">Horse</th>
              <th scope="col" className="hidden py-1.5 pr-5 font-normal sm:table-cell">Time</th>
              <th scope="col" className="hidden py-1.5 font-normal sm:table-cell">Btn</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-normal">Prize</th>
            </tr>
          </thead>
          <tbody>
            {result.finishOrder.map((f, i) => {
              const e = byId.get(f.horseId);
              const me = f.horseId === highlightHorseId;
              return (
                <tr
                  key={f.horseId}
                  className={`border-t-2 border-[#1a201c] ${me ? "bg-[#d9a441]/15 shadow-[inset_4px_0_0_#f2c86a]" : i % 2 ? "bg-[#0e1310]" : ""}`}
                  style={{ animation: `fade-up 360ms steps(5) ${Math.min(i, 12) * 60}ms both` }}
                  data-testid="result-row"
                >
                  <td className="py-2 pl-3">
                    <PositionBadge position={f.position} size="sm" />
                  </td>
                  <td className="w-full max-w-0 py-2 pl-1">
                    <div className="flex min-w-0 items-center gap-2">
                      {e && (
                        <span className="hidden sm:inline-flex">
                          <Saddlecloth gate={e.gate} />
                        </span>
                      )}
                      {e && <SilksIcon silks={e.horse.appearance.silks} className="h-7 w-7 sm:h-9 sm:w-9" />}
                      <div className="min-w-0">
                        <Link href={`/horse/${f.horseId}`} className="display block truncate text-[1.02rem] text-cream hover:text-brass-bright">
                          <span data-testid={f.position === 1 ? "winner-name" : undefined}>{e?.horse.name ?? f.horseId}</span>
                          {me && <span className="chip chip-brass ml-2 hidden !py-0 align-middle text-[0.6rem] sm:inline-flex">YOURS</span>}
                        </Link>
                        <p className="truncate text-xs text-sage">
                          {e?.stableName}
                          <span className="tabular sm:hidden">
                            {" "}
                            · {formatRaceTime(f.finishTimeUs)}
                            {f.position > 1 && ` · ${f.marginLabel}`}
                          </span>
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="led hidden whitespace-nowrap py-2 pr-5 text-xl leading-none text-cream-dim sm:table-cell">{formatRaceTime(f.finishTimeUs)}</td>
                  <td className="led hidden whitespace-nowrap py-2 pr-2 text-lg leading-none text-cream-dim sm:table-cell">{f.position === 1 ? "—" : f.marginLabel}</td>
                  <td className={`num py-2 pr-3 text-right ${f.prize > 0 ? "text-brass-bright" : "text-sage"}`}>{f.prize > 0 ? formatCredits(f.prize) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
