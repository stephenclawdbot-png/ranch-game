"use client";

import Link from "next/link";
import type { HorseRecord, LegMarking } from "@thoroughbred/shared";
import type { HorseView } from "@/server/repository";
import { COAT_LABEL, SEX_LABEL, STYLE_BLURB, STYLE_LABEL, SURFACE_LABEL, formatCredits, formatDistance, furlongs, ordinal } from "@/lib/format";
import { horseRecord, usePlayerState } from "@/lib/player";
import { HorsePortrait } from "../HorsePortrait";
import { StatTile } from "../PaddockStable";
import { SilksIcon } from "../Silks";
import { Stall } from "../Stall";
import { StatBars } from "../StatBars";
import { StatRadar } from "../StatRadar";
import { ArrowIcon, PixelIcon } from "../icons";
import { useTilt } from "../pixel/useTilt";

const FACE_LABEL = { none: "No face markings", star: "Star", snip: "Snip", stripe: "Stripe", blaze: "Blaze", bald: "Bald face" } as const;
const LEG_LABEL: Record<LegMarking, string> = { none: "", coronet: "coronet", sock: "sock", stocking: "stocking" };
const LEG_NAMES = ["near fore", "off fore", "near hind", "off hind"];

function legsText(legs: readonly LegMarking[]): string {
  const marked = legs.map((l, i) => (l === "none" ? null : `${LEG_LABEL[l]} (${LEG_NAMES[i]})`)).filter(Boolean);
  return marked.length ? marked.join(", ") : "No leg markings";
}

function SectionTitle({ id, icon, children }: { id: string; icon: Parameters<typeof PixelIcon>[0]["name"]; children: React.ReactNode }) {
  return (
    <h2 id={id} className="display flex items-center gap-2 text-xl">
      <PixelIcon name={icon} className="h-5 w-5" />
      {children}
    </h2>
  );
}

export function HorseDetail({ view }: { view: HorseView }) {
  const state = usePlayerState();
  const tilt = useTilt<HTMLDivElement>(4);
  const isMine = view.kind === "player" && state?.player.playerId === view.horse.ownerId;
  const index = isMine ? Number(view.horse.id.split("-").pop()) : -1;
  const horse = isMine && state ? { ...view.horse, appearance: { ...view.horse.appearance, silks: state.player.silks } } : view.horse;
  const record: HorseRecord = isMine ? horseRecord(state, index) : horse.record;
  const stableName = isMine ? state!.player.stableName : view.stableName ?? "Private owner";
  const history = isMine ? (state?.progress.history ?? []).filter((h) => h.horseIndex === index) : [];
  const strike = record.starts > 0 ? Math.round((record.wins / record.starts) * 100) : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <nav className="label flex items-center gap-1.5" aria-label="Breadcrumb">
        <Link href={isMine ? "/stable" : "/races"} className="hover:text-cream">
          {isMine ? "Your stable" : "Races"}
        </Link>
        <span>›</span>
        <span className="truncate text-cream-dim">{horse.name}</span>
      </nav>

      <section className="px-panel grid overflow-hidden !p-0 md:grid-cols-[minmax(0,25rem)_1fr]">
        <div ref={tilt} className="tilt relative">
          <Stall className="aspect-square md:aspect-auto md:h-full md:min-h-[24rem]">
            <div className="parallax absolute inset-x-0 bottom-[7%] top-[8%] flex justify-center" style={{ ["--depth" as string]: 14 }}>
              <HorsePortrait appearance={horse.appearance} className="h-full w-auto drop-shadow-[6px_6px_0_rgba(0,0,0,0.35)]" title={`${horse.name}, ${COAT_LABEL[horse.appearance.coat]}`} />
            </div>
            <div className="parallax absolute left-3 top-3" style={{ ["--depth" as string]: 20 }}>
              <span className="chip chip-cream">{STYLE_LABEL[horse.style]}</span>
            </div>
          </Stall>
        </div>
        <div className="flex flex-col gap-4 p-4 sm:p-6">
          <div>
            <div className="flex items-center gap-2">
              <SilksIcon silks={horse.appearance.silks} className="h-8 w-8" />
              <p className="eyebrow">{stableName}</p>
            </div>
            <h1 className="display mt-2 text-[2.2rem] sm:text-5xl" data-testid="horse-name">
              {horse.name}
            </h1>
            <p className="mt-1 text-cream-dim">
              {horse.age}-year-old {COAT_LABEL[horse.appearance.coat].toLowerCase()} {SEX_LABEL[horse.sex].toLowerCase()}
              {view.trainer && <span className="text-sage"> · trained by {view.trainer}</span>}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-1.5">
            <StatTile icon="star" label="Style" value={STYLE_LABEL[horse.style]} />
            <StatTile icon="flag" label="Best trip" value={formatDistance(horse.preferredDistanceM)} />
            <StatTile icon="horseshoe" label="Surface" value={SURFACE_LABEL[horse.preferredSurface]} />
          </dl>
          <p className="text-sm leading-relaxed text-cream-dim">
            {STYLE_BLURB[horse.style]} Happiest over {furlongs(horse.preferredDistanceM)} on {SURFACE_LABEL[horse.preferredSurface].toLowerCase()}.
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-3">
            {isMine ? (
              <Link href={`/races?horse=${index}#quick`} className="btn btn-brass btn-lg" data-testid="enter-a-race">
                <PixelIcon name="flag" className="h-5 w-5" /> Enter a race <ArrowIcon className="h-3 w-3" />
              </Link>
            ) : view.kind === "rival" ? (
              <p className="text-sm text-sage">A house horse. Meet it on the club card.</p>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="px-panel p-4 sm:p-5" aria-labelledby="ability-h">
          <SectionTitle id="ability-h" icon="star">
            Ability
          </SectionTitle>
          <div className="mt-3 grid items-start gap-5 sm:grid-cols-[13rem_1fr]">
            <StatRadar stats={horse.stats} />
            <StatBars stats={horse.stats} />
          </div>
        </section>

        <div className="grid gap-5">
          <section className="px-panel p-4 sm:p-5" aria-labelledby="record-h">
            <SectionTitle id="record-h" icon="trophy">
              Race record
            </SectionTitle>
            <dl className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
              {(
                [
                  ["Starts", record.starts, "flag"],
                  ["Wins", record.wins, "trophy"],
                  ["2nds", record.places, "rosette"],
                  ["3rds", record.shows, "star"],
                  ["Earned", formatCredits(record.earnings), "coin"],
                ] as const
              ).map(([k, v, icon]) => (
                <StatTile key={k} icon={icon} label={k} value={String(v)} />
              ))}
            </dl>
            <p className="label mt-2">{strike === null ? "Yet to race." : `Strike rate ${strike}%`}</p>
          </section>

          <section className="px-panel p-4 sm:p-5" aria-labelledby="pedigree-h">
            <SectionTitle id="pedigree-h" icon="horseshoe">
              Pedigree &amp; markings
            </SectionTitle>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {[
                ["Sire", horse.sireId ?? "Foundation stock"],
                ["Dam", horse.damId ?? "Foundation stock"],
              ].map(([k, v]) => (
                <div key={k} className="px-plate px-2 py-1">
                  <p className="font-[family-name:var(--font-pixel)] text-[10px] uppercase tracking-wider text-[#7a5a2e]">{k}</p>
                  <p className="display truncate text-base !text-[#1d140a] [text-shadow:none]">{v}</p>
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
          <h2 id="history-h" className="display mb-2 flex items-center gap-2 text-2xl">
            <PixelIcon name="stopwatch" className="h-6 w-6" /> Race history
          </h2>
          {history.length === 0 ? (
            <div className="px-panel-quiet p-4 text-sm text-cream-dim">
              No runs yet.{" "}
              <Link href={`/races?horse=${index}#quick`} className="font-semibold text-brass-bright underline underline-offset-4">
                Send {horse.name} to the gates
              </Link>
              .
            </div>
          ) : (
            <ul className="px-panel divide-y-2 divide-dashed divide-[#1f4d35] !p-0" data-testid="history">
              {history.map((h) => (
                <li key={h.raceId}>
                  <Link href={`/race/${h.raceId}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-[#163a28]">
                    <PositionBadge position={h.position} />
                    <div className="min-w-0 flex-1">
                      <p className="display truncate text-[1.05rem]">{h.raceName}</p>
                      <p className="text-xs text-sage">
                        {formatDistance(h.distanceM)} · {SURFACE_LABEL[h.surface]} · {h.fieldSize} ran ·{" "}
                        {new Date(h.postTimeMs).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                    <span className={`num text-base ${h.prize > 0 ? "text-brass-bright" : "text-sage"}`}>{h.prize > 0 ? `+${formatCredits(h.prize)}` : "–"}</span>
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

const MEDAL: Record<number, { bg: string; fg: string; edge: string }> = {
  1: { bg: "#f2c86a", fg: "#2a1a05", edge: "#9a6b22" },
  2: { bg: "#d5dde0", fg: "#1c2427", edge: "#7d888b" },
  3: { bg: "#d08a4e", fg: "#2a1405", edge: "#7a4a2a" },
};

/** Square pixel position badge (gold/silver/bronze for the podium). */
export function PositionBadge({ position, size = "md" }: { position: number; size?: "sm" | "md" }) {
  const m = MEDAL[position];
  const dim = size === "sm" ? "h-7 w-7 text-sm" : "h-9 w-9 text-base";
  return (
    <span
      className={`num flex shrink-0 items-center justify-center ${dim}`}
      style={{
        background: m?.bg ?? "#0a1912",
        color: m?.fg ?? "#cdbf9c",
        boxShadow: `inset 0 -3px 0 ${m?.edge ?? "#050b08"}, 0 0 0 2px #0b0f0c`,
      }}
    >
      {ordinal(position)}
    </span>
  );
}
