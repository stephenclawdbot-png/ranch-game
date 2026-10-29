/**
 * The Trophy Room (REDESIGN §4.8): the stable's own honours on display. Cups for Live wins
 * (gold: finals, features, graded; silver: listed; bronze: other Live races; Daily Cup feats
 * show as plaques),
 * rosettes for Story wins and places, brass plaques for achievements (the ones still to win
 * stand dimmed with what earns them), medals for titles and Hall of Fame inductions, and the
 * stable's best horses framed on the wall. Every trophy opens the race at the finish.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { TrophyRoomView, TrophyTier, TrophyView } from "@/lib/competitionTypes";
import { formatCredits } from "@/lib/format";
import { DIORAMA_ATLAS } from "../diorama/atlas.generated";
import { HorsePortrait } from "../HorsePortrait";
import { Silks } from "../Silks";

const RECTS = DIORAMA_ATLAS.props.trophies as unknown as readonly (readonly [number, number, number, number])[];
const SHEET = DIORAMA_ATLAS.files.trophies;
type Piece = TrophyTier | "plaque" | "medal";
const IDX: Record<Piece, number> = { gold: 0, silver: 1, bronze: 2, first: 3, second: 4, third: 5, plaque: 6, medal: 7 };
const TIER_TEXT: Record<TrophyTier, string> = { gold: "Gold cup", silver: "Silver cup", bronze: "Bronze cup", first: "Winner's rosette", second: "Second", third: "Third" };
const ROSETTE_CAP = 36;

function Sprite({ piece, dim = false }: { piece: Piece; dim?: boolean }) {
  const [x, y, w, h] = RECTS[IDX[piece]]!;
  return (
    <span
      className={`trophy-sprite ${dim ? "is-dim" : ""}`}
      aria-hidden
      style={{ width: w, height: h, backgroundPosition: `${-x}px ${-y}px`, backgroundSize: `${SHEET.w}px ${SHEET.h}px` }}
    />
  );
}

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

function Prize({ t }: { t: TrophyView }) {
  return (
    <li>
      <Link href={`/race/${t.raceId}?at=finish`} className="trophy" data-testid={`trophy-${t.tier}`}>
        <Sprite piece={t.tier} />
        <span className="trophy-card">
          <span className="trophy-card-tier">{TIER_TEXT[t.tier]}</span>
          <span className="trophy-card-race">{t.raceName}</span>
          <span className="trophy-card-meta">
            {t.horseName} · {when(t.atMs)}
            {t.prize > 0 ? ` · ${formatCredits(t.prize)} cr` : ""}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Shelf({ title, note, children, empty }: { title: string; note?: string; children: ReactNode; empty?: ReactNode }) {
  return (
    <section className="shelf" aria-label={title}>
      <div className="shelf-head">
        <h2 className="t-h2">{title}</h2>
        {note && <p className="t-meta">{note}</p>}
      </div>
      <div className="shelf-board">{empty ?? <ul className="shelf-row">{children}</ul>}</div>
    </section>
  );
}

export function TrophyRoom({ view }: { view: TrophyRoomView }) {
  const shownRosettes = view.rosettes.slice(0, ROSETTE_CAP);
  const earned = view.achievements.filter((a) => a.earned).length;
  return (
    <div>
      <section className="troom bleed" aria-label="Your Trophy Room" data-testid="trophy-room">
        <div className="troom-stage">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/art/diorama/trophy-room.png" alt="" className="troom-img" draggable={false} />
          <div className="troom-greet">
            <p className="eyebrow inline-flex items-center gap-2">
              <Silks silks={view.silks} cap={false} className="h-[22px] w-7" /> {view.stableName}
            </p>
            <h1 className="troom-title">Trophy Room</h1>
          </div>
          <dl className="troom-stats">
            <div>
              <dt>Wins</dt>
              <dd data-testid="trophy-wins">{view.totals.wins}</dd>
            </div>
            <div>
              <dt>Cups</dt>
              <dd>{view.totals.cups}</dd>
            </div>
            <div>
              <dt>Placed</dt>
              <dd>{view.totals.places}</dd>
            </div>
            <div>
              <dt>Prize money</dt>
              <dd>{formatCredits(view.totals.earnings)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="mt-6 grid gap-8">
        <Shelf
          title="Cups"
          note="Live race wins: gold for finals, features and graded races; silver for listed races; bronze for the rest. Daily Cup feats hang with the plaques."
          empty={
            view.cups.length ? undefined : (
              <div className="shelf-empty">
                <span className="flex items-end gap-4">
                  <Sprite piece="gold" dim />
                  <Sprite piece="silver" dim />
                  <Sprite piece="bronze" dim />
                </span>
                <p>
                  No cups yet. Win a Live race for the first one.{" "}
                  <Link href="/races" className="link">
                    Today&rsquo;s card
                  </Link>
                </p>
              </div>
            )
          }
        >
          {view.cups.map((t) => (
            <Prize key={`${t.raceId}:${t.horseId}`} t={t} />
          ))}
        </Shelf>

        <Shelf
          title="Rosettes"
          note={view.rosettes.length > ROSETTE_CAP ? `The latest ${ROSETTE_CAP} of ${view.rosettes.length}: Story wins and places.` : "Story wins, seconds and thirds."}
          empty={
            view.rosettes.length ? undefined : (
              <div className="shelf-empty">
                <span className="flex items-end gap-4">
                  <Sprite piece="first" dim />
                  <Sprite piece="second" dim />
                  <Sprite piece="third" dim />
                </span>
                <p>Every first, second and third earns a rosette here.</p>
              </div>
            )
          }
        >
          {shownRosettes.map((t) => (
            <Prize key={`${t.raceId}:${t.horseId}`} t={t} />
          ))}
        </Shelf>

        {view.stars.length > 0 && (
          <section aria-labelledby="stars-h">
            <h2 id="stars-h" className="t-h2 mb-3">
              Pride of the stable
            </h2>
            <ul className="stars">
              {view.stars.map((h) => (
                <li key={h.horseId}>
                  <Link href={`/horse/${h.horseId}`} className="star-frame">
                    <span className="star-canvas">
                      <HorsePortrait appearance={h.appearance} scale={1} />
                    </span>
                    <span className="star-name">{h.name}</span>
                    <span className="star-meta">
                      {h.wins} {h.wins === 1 ? "win" : "wins"} from {h.starts} · {formatCredits(h.earnings)} cr{h.status === "stud" ? " · at stud" : h.status === "retired" ? " · retired" : h.status === "deceased" ? " · in memoriam" : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Shelf title="Plaques" note={`${earned} of ${view.achievements.length} achievements. The dimmed ones say what earns them.`}>
          {view.achievements.map((a) => (
            <li key={a.id}>
              <span className={`plaque-piece ${a.earned ? "" : "is-locked"}`} tabIndex={0} data-testid={a.earned ? "plaque-earned" : "plaque-locked"}>
                <Sprite piece="plaque" dim={!a.earned} />
                <span className="trophy-card">
                  <span className="trophy-card-tier">{a.earned ? `Earned ${when(a.earnedAtMs)}` : "Still to win"}</span>
                  <span className="trophy-card-race">{a.title}</span>
                  <span className="trophy-card-meta">{a.description}</span>
                </span>
              </span>
            </li>
          ))}
        </Shelf>

        {view.honours.length > 0 && (
          <Shelf title="Honours">
            {view.honours.map((h) => (
              <li key={h.key}>
                <span className="plaque-piece" tabIndex={0}>
                  <Sprite piece="medal" />
                  <span className="trophy-card">
                    <span className="trophy-card-tier">{h.detail}</span>
                    <span className="trophy-card-race">{h.title}</span>
                    <span className="trophy-card-meta">{when(h.atMs)}</span>
                  </span>
                </span>
              </li>
            ))}
          </Shelf>
        )}

        <p className="t-meta">
          The Club&rsquo;s permanent honours live in the{" "}
          <Link href="/hall" className="link">
            Hall of Fame
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
