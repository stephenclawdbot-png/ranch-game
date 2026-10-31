import Link from "next/link";
import type { RaceCard } from "@/lib/types";
import { SEX_LABEL, STYLE_SHORT, coatLabel, formatCredits, formatDistance } from "@/lib/format";
import { formatWeight } from "@thoroughbred/game-core";
import { SilksIcon } from "../Silks";
import { StableBadge } from "../StableBadge";
import { GradeBadge } from "../StatBars";
import { ClaimButton } from "./ClaimButton";
import { Saddlecloth } from "./Saddlecloth";

const stables = (n: number) => `${n} ${n === 1 ? "stable" : "stables"}`;
const claimsLabel = (n: number) => (n === 0 ? "no claims" : `${n} ${n === 1 ? "claim" : "claims"}`);
const CLAIM_STATUS: Record<string, string> = {
  lodged: "lodged",
  drawn: "won the draw: the horse is yours after the race",
  lost: "lost the draw (refunded)",
  claimed: "claimed",
  void: "void (refunded)",
  refunded: "refunded",
};

/**
 * The racecard (REDESIGN §4.3): the declared field as printed matter. Cloth number and silks,
 * the horse (age, colour, sex), its connections, form figures and official rating, the plan,
 * best trip and three key grades. Your runner is marked. Race-day equipment and a booked
 * jockey print under the connections ("Soft shoes · Top jockey"). Form and rating come from the
 * stud book (settled races before this one), never from this race. Every runner shows its
 * stable; the Club's horses (house runners that fill the gates at the close) are marked Club.
 * A claiming race prints each runner's claim price and how many claims it has (never who), the
 * rules in one line and, while entries are open, a Claim button on other stables' runners.
 */
export function FieldList({ card, highlightHorseId, open = true }: { card: RaceCard; highlightHorseId?: string; open?: boolean }) {
  // Handicap weights print once the field is locked (Live handicaps).
  const weighted = card.field.some((e) => !!e.weightLb);
  return (
    <details className="racecard print group" open={open} aria-labelledby="field-h">
      <summary className="racecard-head">
        <span className="min-w-0">
          <span className="racecard-eyebrow">Racecard · {formatDistance(card.config.distanceM)}</span>
          <h2 id="field-h" className="racecard-title">
            The field
          </h2>
          {card.course && (
            <span className="caption block" data-testid="course-character">
              {card.course.name}: {card.course.character}
            </span>
          )}
        </span>
        <span className="text-sm font-bold text-cream-dim">
          <span data-testid="field-stables">
            {card.fieldLocked
              ? `${card.field.length} runners · ${stables(card.field.filter((e) => e.isPlayer).length)}`
              : `${stables(card.field.filter((e) => e.isPlayer).length)} entered · the Club fills the field to ${card.targetRunners}`}
          </span>{" "}
          {card.claiming && (
            <span className="tag" data-testid="claiming-tag">
              Claiming
            </span>
          )}{" "}
          <span aria-hidden className="inline-block group-open:rotate-90">
            ▸
          </span>
        </span>
      </summary>
      {card.claiming && (
        <p className="caption px-3 py-2" data-testid="claiming-rules">
          {card.claiming.rules}
          {card.claiming.myClaim && (
            <>
              {" "}
              <strong data-testid="my-claim">
                Your claim ({formatCredits(card.claiming.myClaim.price)} cr on {card.field.find((e) => e.horse.id === card.claiming!.myClaim!.horseId)?.horse.name ?? "a runner"}): {CLAIM_STATUS[card.claiming.myClaim.status]}.
              </strong>
            </>
          )}
        </p>
      )}
      <table className="racecard-table" data-testid="field-table">
        <thead>
          <tr>
            <th scope="col" className="w-12 pl-3">
              No.
            </th>
            <th scope="col">Horse</th>
            <th scope="col" className="text-right" title="Last three finishes, oldest first (0 = outside the first nine)">
              Form
            </th>
            <th scope="col" className="text-right" title="Official rating">
              OR
            </th>
            {weighted && (
              <th scope="col" className="text-right" title="Handicap weight: the top-rated horse carries the most, 1 lb less for every point of rating below it">
                Wgt
              </th>
            )}
            <th scope="col" className="hidden sm:table-cell">
              Plan
            </th>
            <th scope="col" className="hidden md:table-cell">
              Best trip
            </th>
            <th scope="col" className="pr-3 text-right" title="Speed · Stamina · Burst grades">
              <span className="hidden sm:inline">Spd · Sta · Brs</span>
              <span className="sm:hidden">Grades</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {card.field.length === 0 && (
            <tr>
              <td colSpan={weighted ? 8 : 7} className="px-3 py-3 text-cream-dim">
                No entries yet. Empty gates are filled by the Club&rsquo;s horses when entries close.
              </td>
            </tr>
          )}
          {card.field.map((e) => {
            const me = e.horse.id === highlightHorseId;
            const s = e.horse.stats;
            const h = e.horse;
            return (
              <tr key={h.id} className={me ? "is-mine" : undefined} data-testid={me ? "my-runner" : undefined}>
                <td className="pl-3">{e.gate > 0 ? <Saddlecloth gate={e.gate} /> : <span className="text-cream-dim">–</span>}</td>
                <td className="w-full max-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    {e.stablePhotoUrl ? (
                      <StableBadge silks={h.appearance.silks} photoUrl={e.stablePhotoUrl} className="h-9 w-9 shrink-0" alt={e.stableName} />
                    ) : (
                      <SilksIcon silks={h.appearance.silks} className="h-9 w-9 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <Link href={`/horse/${h.id}`} className="racecard-name">
                        {h.name}
                        {me && <span className="you-tag ml-2 align-middle">You</span>}
                      </Link>
                      {/* the connections first, on their own line, so a narrow card never cuts them off */}
                      <p className="racecard-meta !text-[#2c2116]">
                        {e.isPlayer ? (
                          <span data-testid="runner-stable">{e.stableName}</span>
                        ) : (
                          <>
                            <span className="tag !h-[16px] !px-1 align-[1px] !text-[0.625rem] !leading-[16px]" data-testid="club-runner" title="A Club horse: it fills an empty gate">
                              Club
                            </span>{" "}
                            {e.stableName}
                          </>
                        )}
                      </p>
                      {e.jockey && (
                        <p className="racecard-meta" data-testid="runner-jockey">
                          <span className="sr-only">Jockey: </span>
                          {e.jockey.id ? (
                            <Link href={`/jockeys/${e.jockey.id}`} className="underline decoration-dotted underline-offset-2">
                              {e.jockey.cardName}
                            </Link>
                          ) : (
                            e.jockey.cardName
                          )}
                        </p>
                      )}
                      <p className="racecard-meta">
                        {h.age > 0 ? `${h.age}yo ` : ""}
                        {coatLabel(h.appearance).toLowerCase()} {SEX_LABEL[h.sex].toLowerCase()}
                        <span className="sm:hidden"> · {STYLE_SHORT[e.tactic]}</span>
                      </p>
                      {e.claim && (
                        <p className="racecard-gear" data-testid="runner-claim">
                          Claim {formatCredits(e.claim.price)} cr · {claimsLabel(e.claim.claims)}
                          {card.status === "open" && !card.fieldLocked && !e.mine && e.isPlayer && !card.claiming?.myClaim && (
                            <>
                              {" "}
                              <ClaimButton raceId={card.id} horseId={h.id} horseName={h.name} price={e.claim.price} />
                            </>
                          )}
                        </p>
                      )}
                      {e.gear.length > 0 && (
                        <p className="racecard-gear" data-testid="runner-gear" title="Race-day equipment and jockey">
                          {e.gear.join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="racecard-fig text-right" data-testid="runner-form">
                  {e.form ?? "–"}
                </td>
                <td className="racecard-fig text-right">{e.rating ?? "–"}</td>
                {weighted && (
                  <td className="racecard-fig whitespace-nowrap text-right" data-testid="runner-weight">
                    {e.weightLb ? formatWeight(e.weightLb) : "–"}
                  </td>
                )}
                <td className="hidden whitespace-nowrap font-semibold text-cream-dim sm:table-cell">{STYLE_SHORT[e.tactic]}</td>
                <td className="hidden whitespace-nowrap font-semibold text-cream-dim md:table-cell">{formatDistance(h.preferredDistanceM)}</td>
                <td className="pr-3">
                  <span className="flex justify-end gap-1" aria-label={`Speed ${s.speed}, stamina ${s.stamina}, burst ${s.burst}`}>
                    <GradeBadge value={s.speed} size="sm" />
                    <GradeBadge value={s.stamina} size="sm" />
                    <GradeBadge value={s.burst} size="sm" />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
