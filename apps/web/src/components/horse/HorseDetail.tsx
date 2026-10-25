"use client";

import Link from "next/link";
import type { HorseRecord, LegMarking } from "@thoroughbred/shared";
import type { HorseView } from "@/server/repository";
import { COAT_LABEL, SEX_LABEL, STYLE_BLURB, STYLE_LABEL, SURFACE_LABEL, formatCredits, formatDistance, furlongs, ordinal } from "@/lib/format";
import { horseRecord, usePlayerState } from "@/lib/player";
import { HorsePortrait } from "../HorsePortrait";
import { SilksIcon } from "../Silks";
import { StatBars } from "../StatBars";
import { StatRadar } from "../StatRadar";
import { ArrowIcon } from "../icons";

const FACE_LABEL = { none: "No face markings", star: "Star", snip: "Snip", stripe: "Stripe", blaze: "Blaze", bald: "Bald face" } as const;
const LEG_LABEL: Record<LegMarking, string> = { none: "", coronet: "coronet", sock: "sock", stocking: "stocking" };
const LEG_NAMES = ["near fore", "off fore", "near hind", "off hind"];

function legsText(legs: readonly LegMarking[]): string {
  const marked = legs.map((l, i) => (l === "none" ? null : `${LEG_LABEL[l]} (${LEG_NAMES[i]})`)).filter(Boolean);
  return marked.length ? marked.join(", ") : "No leg markings";
}

export function HorseDetail({ view }: { view: HorseView }) {
  const state = usePlayerState();
  const isMine = view.kind === "player" && state?.player.playerId === view.horse.ownerId;
  const index = isMine ? Number(view.horse.id.split("-").pop()) : -1;
  const horse = isMine && state ? { ...view.horse, appearance: { ...view.horse.appearance, silks: state.player.silks } } : view.horse;
  const record: HorseRecord = isMine ? horseRecord(state, index) : horse.record;
  const stableName = isMine ? state!.player.stableName : view.stableName ?? "Private owner";
  const history = isMine ? (state?.progress.history ?? []).filter((h) => h.horseIndex === index) : [];
  const strike = record.starts > 0 ? Math.round((record.wins / record.starts) * 100) : null;

  return (
    <div className="grid gap-6">
      <nav className="text-xs text-sage" aria-label="Breadcrumb">
        <Link href={isMine ? "/stable" : "/races"} className="hover:text-cream">
          {isMine ? "Your stable" : "Races"}
        </Link>{" "}
        / <span className="text-cream-dim">{horse.name}</span>
      </nav>

      <section className="panel grid overflow-hidden md:grid-cols-[minmax(0,26rem)_1fr]">
        <div className="relative aspect-square bg-gradient-to-br from-turf-700 via-turf-850 to-ink md:aspect-auto md:min-h-[24rem]">
          <HorsePortrait appearance={horse.appearance} className="absolute inset-0 h-full w-full" title={`${horse.name}, ${COAT_LABEL[horse.appearance.coat]}`} />
        </div>
        <div className="flex flex-col gap-5 p-5 sm:p-7">
          <div>
            <div className="flex items-center gap-2">
              <SilksIcon silks={horse.appearance.silks} className="h-7 w-7" />
              <p className="eyebrow">{stableName}</p>
            </div>
            <h1 className="display mt-2 text-4xl font-semibold leading-tight sm:text-5xl" data-testid="horse-name">
              {horse.name}
            </h1>
            <p className="mt-1 text-cream-dim">
              {horse.age}-year-old {COAT_LABEL[horse.appearance.coat].toLowerCase()} {SEX_LABEL[horse.sex].toLowerCase()}
              {view.trainer && <span className="text-sage"> · trained by {view.trainer}</span>}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Style", STYLE_LABEL[horse.style]],
              ["Best trip", `${formatDistance(horse.preferredDistanceM)}`],
              ["Surface", SURFACE_LABEL[horse.preferredSurface]],
            ].map(([k, v]) => (
              <div key={k} className="panel-quiet px-3 py-2.5">
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-sage">{k}</p>
                <p className="mt-0.5 truncate font-semibold">{v}</p>
              </div>
            ))}
          </div>
          <p className="text-sm leading-relaxed text-cream-dim">
            {STYLE_BLURB[horse.style]} Happiest over {furlongs(horse.preferredDistanceM)} on {SURFACE_LABEL[horse.preferredSurface].toLowerCase()}.
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-3">
            {isMine ? (
              <Link href={`/races?horse=${index}#quick`} className="btn btn-brass" data-testid="enter-a-race">
                Enter a race <ArrowIcon className="h-4 w-4" />
              </Link>
            ) : view.kind === "rival" ? (
              <p className="text-sm text-sage">A house horse. Meet it on the club card.</p>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-5 sm:p-6" aria-labelledby="ability-h">
          <h2 id="ability-h" className="display text-xl font-semibold">
            Ability
          </h2>
          <div className="mt-4 grid items-center gap-6 sm:grid-cols-[1fr_1fr]">
            <StatRadar stats={horse.stats} className="mx-auto w-full max-w-xs" />
            <StatBars stats={horse.stats} />
          </div>
        </section>

        <div className="grid gap-6">
          <section className="panel p-5 sm:p-6" aria-labelledby="record-h">
            <h2 id="record-h" className="display text-xl font-semibold">
              Race record
            </h2>
            <dl className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {[
                ["Starts", record.starts],
                ["Wins", record.wins],
                ["2nds", record.places],
                ["3rds", record.shows],
                ["Earned", formatCredits(record.earnings)],
              ].map(([k, v]) => (
                <div key={k as string} className="panel-quiet px-3 py-2.5">
                  <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-sage">{k}</dt>
                  <dd className="display tabular text-xl font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-sage">{strike === null ? "Yet to race." : `Strike rate ${strike}%.`}</p>
          </section>

          <section className="panel p-5 sm:p-6" aria-labelledby="pedigree-h">
            <h2 id="pedigree-h" className="display text-xl font-semibold">
              Pedigree &amp; markings
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                ["Sire", horse.sireId ?? "Foundation stock"],
                ["Dam", horse.damId ?? "Foundation stock"],
              ].map(([k, v]) => (
                <div key={k} className="panel-quiet px-3 py-2.5">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-sage">{k}</p>
                  <p className="display mt-0.5 italic text-cream-dim">{v}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-cream-dim">
              Generation {horse.generation}. {FACE_LABEL[horse.appearance.face]}; {legsText(horse.appearance.legs)}.
            </p>
          </section>
        </div>
      </div>

      {isMine && (
        <section aria-labelledby="history-h">
          <h2 id="history-h" className="display mb-3 text-2xl font-semibold">
            Race history
          </h2>
          {history.length === 0 ? (
            <div className="panel-quiet p-5 text-sm text-cream-dim">
              No runs yet.{" "}
              <Link href={`/races?horse=${index}#quick`} className="text-brass-bright underline underline-offset-4">
                Send {horse.name} to the gates
              </Link>
              .
            </div>
          ) : (
            <ul className="panel divide-y divide-cream/5 p-1.5" data-testid="history">
              {history.map((h) => (
                <li key={h.raceId}>
                  <Link href={`/race/${h.raceId}`} className="flex items-center gap-4 rounded-xl px-3 py-3 hover:bg-cream/[0.03]">
                    <span
                      className={`display flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                        h.position === 1 ? "bg-gradient-to-b from-brass-bright to-brass text-ink" : "border border-cream/15 text-cream-dim"
                      }`}
                    >
                      {ordinal(h.position)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{h.raceName}</p>
                      <p className="text-xs text-sage">
                        {formatDistance(h.distanceM)} · {SURFACE_LABEL[h.surface]} · {h.fieldSize} ran · {new Date(h.postTimeMs).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                    <span className={`tabular text-sm ${h.prize > 0 ? "font-semibold text-brass-bright" : "text-sage"}`}>
                      {h.prize > 0 ? `+${formatCredits(h.prize)}` : "–"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
