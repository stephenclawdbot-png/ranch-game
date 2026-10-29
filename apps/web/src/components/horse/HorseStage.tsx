"use client";

/**
 * Champion profile stage (design system v3, docs/redesign/REDESIGN.md §4.2): the horse is the
 * hero. The barn diorama full-bleed with a warm key light, the genetic 3/4 portrait at 2x / 3x,
 * a strip of the stable's horses to switch subject, and the nameplate: registry line, serif
 * name, identity, readiness tiles and the one primary action.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { HorseDetailView } from "@/lib/types";
import { SEX_LABEL, STYLE_LABEL, SURFACE_LABEL, coatLabel, formatDistance, ordinal } from "@/lib/format";
import { usePlayerState } from "@/lib/player";
import { Diorama } from "../diorama/Diorama";
import { HorsePortrait } from "../HorsePortrait";
import { Silks } from "../Silks";

function identity(view: HorseDetailView): string {
  const h = view.horse;
  const age = h.age > 0 ? `${h.age}-year-old` : "Young";
  return `${age} ${coatLabel(h.appearance).toLowerCase()} ${SEX_LABEL[h.sex].toLowerCase()}`;
}

/** Last three finishing positions, newest first ("2-1-4"), or null before the first run. */
function formLine(view: HorseDetailView): string | null {
  const runs = [...view.runs].sort((a, b) => b.postTimeMs - a.postTimeMs).slice(0, 3);
  return runs.length ? runs.map((r) => (r.position <= 9 ? String(r.position) : "0")).join("-") : null;
}

export function HorseStage({ view, actions, status }: { view: HorseDetailView; actions: ReactNode; status: ReactNode }) {
  const state = usePlayerState();
  const horse = view.horse;
  // The owner's roster (stable order) to switch subject; other stables' horses stand alone.
  const roster = view.mine && state ? state.horses : [];
  const idx = roster.findIndex((r) => r.id === horse.id);
  const prev = idx > 0 ? roster[idx - 1] : roster.length > 1 ? roster[roster.length - 1] : null;
  const next = idx >= 0 && idx < roster.length - 1 ? roster[idx + 1] : roster.length > 1 ? roster[0] : null;
  const st = view.status;
  const form = formLine(view);
  const last = [...view.runs].sort((a, b) => b.postTimeMs - a.postTimeMs)[0];

  return (
    <section className="champ bleed" aria-labelledby="horse-h">
      <div className="champ-stage">
        <Diorama scene="barn" aspect={null} priority style={{ position: "absolute", inset: 0 }} />
        <div className="champ-light" aria-hidden />
        {roster.length > 1 && (
          <nav className="champ-roster" aria-label="Your horses">
            {roster.map((r) => (
              <Link key={r.id} href={`/horse/${r.id}`} aria-current={r.id === horse.id ? "page" : undefined} title={r.horse.name} scroll={false}>
                <HorsePortrait appearance={r.horse.appearance} scale="thumb" />
                <span className="sr-only">{r.horse.name}</span>
              </Link>
            ))}
          </nav>
        )}
        {prev && (
          <Link href={`/horse/${prev.id}`} className="champ-arrow champ-prev" aria-label={`Previous horse: ${prev.horse.name}`} scroll={false}>
            ‹
          </Link>
        )}
        {next && (
          <Link href={`/horse/${next.id}`} className="champ-arrow champ-next" aria-label={`Next horse: ${next.horse.name}`} scroll={false}>
            ›
          </Link>
        )}
        <div className="champ-hero" key={horse.id}>
          <span className="md:hidden">
            <HorsePortrait appearance={horse.appearance} scale={2} title={`${horse.name}, ${coatLabel(horse.appearance)}`} />
          </span>
          <span className="hidden md:block">
            <HorsePortrait appearance={horse.appearance} scale={3} />
          </span>
        </div>
        <Link href={view.mine ? "/stable" : "/races"} className="champ-back">
          ‹ {view.mine ? "Stable" : "Racing"}
        </Link>
      </div>

      <div className="champ-plate">
        <p className="eyebrow flex flex-wrap items-center gap-2">
          <Silks silks={horse.appearance.silks} cap={false} className="h-[18px] w-6" />
          <span data-testid="reg-no" title="Registration number">
            {view.regNo}
          </span>
          <span aria-hidden>·</span>
          <span>{view.stableName}</span>
          {view.mine && <span className="tag tag-you !h-5 !text-[0.625rem]">Yours</span>}
        </p>
        <h1 id="horse-h" className="champ-name" data-testid="horse-name">
          {horse.name}
        </h1>
        <p className="champ-id">
          {identity(view)}
          {view.genetics ? ` · ${view.genetics.breed.filter((b) => b.share >= 10).map((b) => `${b.label} ${b.share}%`).join(" · ")}` : ""}
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="At a glance">
          <li className="chip">{STYLE_LABEL[horse.style]}</li>
          <li className="chip">
            Best {formatDistance(horse.preferredDistanceM)} · {SURFACE_LABEL[horse.preferredSurface].toLowerCase()}
          </li>
          {view.trainer && <li className="chip">Trainer {view.trainer}</li>}
        </ul>

        {st && (
          <ul className="champ-ready" aria-label="Readiness">
            <li className="champ-tile">
              <span className={`score ${st.condition === "tired" ? "text-warn" : "text-positive"}`}>{Math.round(st.freshness / 10)}</span>
              <span className="champ-tile-label">{st.condition === "tired" ? "Tired" : st.condition === "fresh" ? "Fresh" : "Ready"}</span>
            </li>
            <li className="champ-tile">
              <span className="score">
                {st.starts}
                <span className="text-sage">/{st.maxStarts}</span>
              </span>
              <span className="champ-tile-label">Starts</span>
            </li>
            <li className="champ-tile">
              <span className="score">{st.rating}</span>
              <span className="champ-tile-label">Rating</span>
            </li>
            <li className="champ-tile">
              <span className="score">{form ?? "–"}</span>
              <span className="champ-tile-label">Form</span>
            </li>
          </ul>
        )}
        {status}
        <div className="mt-4 grid gap-2">{actions}</div>
        {last && (
          <Link href={`/race/${last.raceId}?at=finish`} className="champ-last">
            <span className="eyebrow !text-sage">Last time out</span>
            <span className="t-serif block text-[1.125rem] leading-6 text-cream">
              {ordinal(last.position)} · {last.raceName}
            </span>
            <span className="link">▶ Watch the finish</span>
          </Link>
        )}
      </div>
    </section>
  );
}
