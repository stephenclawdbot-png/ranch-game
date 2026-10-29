"use client";

/**
 * The Ranch: the stable's own horses turned out in the paddocks (REDESIGN §4.4, owner ask "a
 * ranch view of all your horses"). Every horse grazes or stands in its real coat (the keyed
 * untacked strips recoloured from its genes), youngstock smaller; tap one for its card.
 *
 * The herd is laid out across the part of the pasture the box actually shows (phones see a
 * narrow crop), in two rows; horses that don't fit stay "in the barn" and are counted. Name
 * tags are HTML pinned to the sprites through the same camera framing the engine uses (the
 * scene keeps pointer parallax low so they stay put).
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StableHorse } from "@/lib/types";
import { SEX_LABEL, coatLabel } from "@/lib/format";
import { conditionLabel, riskText } from "../entry/EntryForm";
import { Diorama } from "../diorama/Diorama";
import { computeFrame } from "../diorama/frame";
import { PASTURE_ROWS, SCENES, looseHorse, pastureScene, type AnimItem } from "../diorama/scenes";
import { DIORAMA_ATLAS } from "../diorama/atlas.generated";
import { HorsePortrait } from "../HorsePortrait";
import { PixelIcon } from "../icons";

const BASE = SCENES.pasture;
const ANIMS = DIORAMA_ATLAS.anims as Record<string, { fw: number; fh: number; frames: number }>;
const YOUNG = new Set(["foal", "weanling", "yearling"]);

/** Deterministic per-horse variety (pose, facing, frame phase). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

interface Placed {
  s: StableHorse;
  item: AnimItem;
  row: "far" | "near";
}

/**
 * One column per horse across the visible art range [l, r], rows alternating near / far, so no
 * two horses share a spot (near horses two columns apart never touch). Youngstock are smaller.
 */
export function layoutHerd(horses: StableHorse[], l: number, r: number): { placed: Placed[]; inBarn: number } {
  const span = Math.max(0, r - l - 24);
  const shown = horses.slice(0, Math.max(1, Math.min(horses.length, Math.floor(span / 64))));
  const slot = span / Math.max(1, shown.length);
  const placed: Placed[] = shown.map((s, i) => {
    const h = hash(s.id);
    const row: "far" | "near" = shown.length > 1 && i % 2 === 1 ? "far" : "near";
    const size = row === "near" && !YOUNG.has(s.stage) ? 2 : 3;
    const kind = h % 3 === 1 ? "idle" : "graze";
    const strip = ANIMS[`horse-loose-${kind}-s${size}`]!;
    const jitter = ((h >>> 8) % 100) / 100 - 0.5;
    const cx = l + 12 + slot * (i + 0.5) + jitter * slot * 0.2;
    const appearance = s.horse.appearance;
    return {
      s,
      row,
      item: looseHorse(kind, size, Math.round(cx - strip.fw / 2), PASTURE_ROWS[row] + ((h >>> 4) % 5), {
        flip: ((h >>> 12) & 1) === 1,
        phase: (h >>> 16) % strip.frames,
        look: { coat: appearance.coat, appearance },
      }),
    };
  });
  // far row first: the engine draws it behind, and its tags/hit areas sit under the near row's
  placed.sort((a, b) => (a.row === b.row ? 0 : a.row === "far" ? -1 : 1));
  return { placed, inBarn: horses.length - shown.length };
}

interface View {
  vx: number;
  vy: number;
  u: number;
  viewW: number;
}

export function RanchStage({ horses, eyebrow, title, onRace }: { horses: StableHorse[]; eyebrow: ReactNode; title: ReactNode; onRace: (horseId: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const dpr = window.devicePixelRatio || 1;
      const f = computeFrame(BASE, r.width, r.height, dpr);
      setView((v) => {
        const next = { vx: f.vx, vy: f.vy, u: f.s / dpr, viewW: f.viewW };
        return v && v.vx === next.vx && v.vy === next.vy && v.u === next.u && v.viewW === next.viewW ? v : next;
      });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Rebuild the herd only when the visible range changes (rebuilding restarts the engine).
  const l = view ? Math.max(0, view.vx) : 0;
  const rr = view ? Math.min(BASE.width, view.vx + view.viewW) : BASE.width;
  const ids = horses.map((h) => `${h.id}:${h.stage}:${JSON.stringify(h.horse.appearance.colour ?? h.horse.appearance.coat)}`).join("|");
  const herd = useMemo(() => (view ? layoutHerd(horses, l, rr) : { placed: [], inBarn: 0 }), [view ? `${l}-${rr}` : "", ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const def = useMemo(
    () =>
      pastureScene(
        herd.placed.filter((p) => p.row === "far").map((p) => p.item),
        herd.placed.filter((p) => p.row === "near").map((p) => p.item),
      ),
    [herd],
  );
  const sel = horses.find((h) => h.id === picked) ?? null;

  return (
    <section className="ranch bleed" aria-label="Your horses in the paddocks" data-testid="ranch">
      <div ref={box} className="ranch-stage">
        <Diorama scene="pasture" sceneDef={def} aspect={null} priority label="Your horses grazing in the paddocks" style={{ position: "absolute", inset: 0 }} />
        <div className="ranch-greet">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="ranch-title">{title}</h1>
        </div>
        {view && (
          <ul className="ranch-tags" aria-label="Horses in the paddocks">
            {herd.placed.map(({ s, item, row }) => {
              const left = (item.x - view.vx) * view.u;
              const top = (item.y - item.fh - view.vy) * view.u;
              return (
                <li key={s.id} style={{ left, top, width: item.fw * view.u, height: item.fh * view.u }}>
                  <button
                    type="button"
                    className="ranch-hit"
                    aria-pressed={picked === s.id}
                    aria-label={`${s.horse.name}: open card`}
                    data-testid="ranch-horse"
                    onClick={() => setPicked((p) => (p === s.id ? null : s.id))}
                  >
                    <span className={`ranch-tag ranch-tag-${row} ${s.lockedRaceId ? "is-entered" : s.block || s.condition === "tired" ? "is-resting" : ""}`}>{s.horse.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {herd.inBarn > 0 && (
          <p className="ranch-barn" data-testid="ranch-in-barn">
            +{herd.inBarn} in the barn
          </p>
        )}
        {!sel && horses.length > 0 && <p className="ranch-hint">Tap a horse</p>}
        {sel && <RanchCard s={sel} onClose={() => setPicked(null)} onRace={() => onRace(sel.id)} />}
      </div>
    </section>
  );
}

function RanchCard({ s, onClose, onRace }: { s: StableHorse; onClose: () => void; onRace: () => void }) {
  const h = s.horse;
  const cond = conditionLabel(s);
  const young = s.block === "Not yet of racing age";
  return (
    <div className="ranch-card surface" role="dialog" aria-label={h.name} data-testid="ranch-card">
      <button type="button" className="ranch-close" onClick={onClose} aria-label="Close">
        <PixelIcon name="cross" size={12} />
      </button>
      <div className="flex items-center gap-3">
        <span className="well grid shrink-0 place-items-center overflow-hidden">
          <HorsePortrait appearance={h.appearance} scale={1} title={`${h.name}, ${coatLabel(h.appearance)}`} />
        </span>
        <div className="min-w-0">
          <p className="eyebrow">{s.regNo}</p>
          <p className="ranch-name truncate">{h.name}</p>
          <p className="t-meta">
            {h.age > 0 ? `${h.age}yo` : "Young"} {coatLabel(h.appearance).toLowerCase()} {SEX_LABEL[h.sex].toLowerCase()}
          </p>
        </div>
      </div>
      <dl className="ranch-facts">
        <div>
          <dt>Rating</dt>
          <dd className="score">{s.rating}</dd>
        </div>
        <div>
          <dt>Condition</dt>
          <dd className={cond.tone}>{s.lockedRaceId ? "Entered" : cond.text}</dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>{riskText(s.risk)}</dd>
        </div>
      </dl>
      {s.geneticsLine && <p className="caption mt-2">{s.geneticsLine}</p>}
      <div className="mt-3 flex gap-2">
        {young ? (
          <Link href={`/horse/${s.id}/care`} className="btn btn-sm flex-1">
            Care
          </Link>
        ) : s.block ? null : (
          <button type="button" className="btn btn-sm btn-brass flex-1" onClick={onRace}>
            <PixelIcon name="flag" size={16} /> Race
          </button>
        )}
        <Link href={`/horse/${s.id}`} className="btn btn-sm btn-outline flex-1">
          Profile
        </Link>
      </div>
    </div>
  );
}
