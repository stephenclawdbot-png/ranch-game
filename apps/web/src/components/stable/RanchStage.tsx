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
import type { DioramaEngine } from "../diorama/engine";
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
  row: "far" | "mid" | "near";
}

/**
 * HD-2.5D herd across the visible art range [l, r]: the lead horse (first in the list) close to
 * the camera at full HD size, then a sharp mid row and a soft far row, one column each. Mid and
 * far horses roam a short beat of their column (walk, graze, turn, walk back); youngstock are
 * drawn smaller. Deterministic per horse.
 */
export function layoutHerd(horses: StableHorse[], l: number, r: number): { placed: Placed[]; inBarn: number } {
  const span = Math.max(0, r - l - 24);
  const placed: Placed[] = [];
  const look = (s: StableHorse) => ({ coat: s.horse.appearance.coat, appearance: s.horse.appearance });
  const [lead, ...rest] = horses;
  if (lead) {
    const h = hash(lead.id);
    const size = YOUNG.has(lead.stage) ? 2 : span >= 560 ? 1 : 2;
    const kind = h % 2 ? "graze" : "idle";
    const strip = ANIMS[size === 1 ? `horse-loose-${kind}` : `horse-loose-${kind}-s${size}`]!;
    const cx = l + 12 + span * (span >= 560 ? 0.62 : 0.5);
    placed.push({
      s: lead,
      row: "near",
      item: looseHorse(kind, size, Math.round(cx - strip.fw / 2), PASTURE_ROWS.near, { id: lead.id, flip: ((h >>> 12) & 1) === 1, phase: (h >>> 16) % strip.frames, look: look(lead) }),
    });
  }
  // one column per horse across the pasture; the lead horse keeps its own column, the rest
  // alternate mid / far so neighbours stand at different depths
  const shown = rest.slice(0, Math.max(0, Math.floor(span / 90) - 1));
  const cols = shown.length + (lead ? 1 : 0);
  const slot = span / Math.max(1, cols);
  const leadCol = lead ? Math.min(cols - 1, Math.max(0, Math.round((span >= 560 ? 0.62 : 0.5) * cols - 0.5))) : -1;
  if (lead) {
    const p = placed[0]!;
    const cx = l + 12 + slot * (leadCol + 0.5);
    p.item = { ...p.item, x: Math.round(cx - p.item.fw / 2) };
  }
  const free = Array.from({ length: cols }, (_, i) => i).filter((i) => i !== leadCol);
  shown.forEach((s, i) => {
    const row: "far" | "mid" = i % 2 === 0 ? "mid" : "far";
    const h = hash(s.id);
    const size = YOUNG.has(s.stage) || row === "far" ? 3 : 2;
    const restKind = h % 3 === 1 ? "idle" : "graze";
    const walk = ANIMS[`horse-loose-walk-s${size}`]!;
    const restStrip = ANIMS[`horse-loose-${restKind}-s${size}`]!;
    const flip = ((h >>> 12) & 1) === 1;
    const range = Math.round(Math.min(slot * 0.45, size === 2 ? 70 : 50));
    const cx = l + 12 + slot * (free[i]! + 0.5);
    // start so the beat stays centred in the column whichever way the horse faces
    const x = Math.round(cx - walk.fw / 2 + (flip ? range / 2 : -range / 2));
    placed.push({
      s,
      row,
      item: looseHorse("walk", size, x, PASTURE_ROWS[row] + ((h >>> 4) % 4), {
        id: s.id,
        flip,
        phase: (h >>> 16) % walk.frames,
        look: look(s),
        roam: {
          range,
          speed: size === 2 ? 10 : 7,
          pause: 6 + ((h >>> 20) % 6),
          offset: (h >>> 8) % 40,
          rest: { src: `diorama/horse-loose-${restKind}-s${size}.png`, fw: restStrip.fw, fh: restStrip.fh, frames: restStrip.frames, fps: 5 },
        },
      }),
    });
  });
  // back to front, so nearer horses' tags and tap areas sit on top
  const order = { far: 0, mid: 1, near: 2 } as const;
  placed.sort((a, b) => order[a.row] - order[b.row]);
  return { placed, inBarn: horses.length - placed.length };
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
      pastureScene({
        far: herd.placed.filter((p) => p.row === "far").map((p) => p.item),
        mid: herd.placed.filter((p) => p.row === "mid").map((p) => p.item),
        near: herd.placed.filter((p) => p.row === "near").map((p) => p.item),
      }),
    [herd],
  );
  // Name tags ride on the horses: each frame, read where the engine drew them.
  const engine = useRef<DioramaEngine | null>(null);
  const tags = useRef(new Map<string, HTMLLIElement>());
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const e = engine.current;
      const el = box.current;
      if (!e || !el) return;
      const W = el.clientWidth;
      const H = el.clientHeight;
      for (const [id, a] of e.anchors()) {
        const li = tags.current.get(id);
        if (!li) continue;
        li.style.transform = `translate(${Math.round(a.x * W)}px, ${Math.round(a.y * H)}px)`;
        li.style.width = `${Math.round(a.w * W)}px`;
        li.style.height = `${Math.round(a.h * H)}px`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const sel = horses.find((h) => h.id === picked) ?? null;

  return (
    <section className="ranch bleed" aria-label="Your horses in the paddocks" data-testid="ranch">
      <div ref={box} className="ranch-stage">
        <Diorama
          scene="pasture"
          sceneDef={def}
          aspect={null}
          priority
          label="Your horses grazing in the paddocks"
          style={{ position: "absolute", inset: 0 }}
          onEngine={(e) => (engine.current = e)}
        />
        <div className="ranch-greet">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="ranch-title">{title}</h1>
        </div>
        {view && (
          <ul className="ranch-tags" aria-label="Horses in the paddocks">
            {herd.placed.map(({ s, item, row }) => {
              // until the engine reports where it drew the horse: its authored spot
              const left = (item.x - view.vx) * view.u;
              const top = (item.y - item.fh - view.vy) * view.u;
              return (
                <li
                  key={s.id}
                  ref={(li) => {
                    if (li) tags.current.set(s.id, li);
                    else tags.current.delete(s.id);
                  }}
                  style={{ left: 0, top: 0, transform: `translate(${Math.round(left)}px, ${Math.round(top)}px)`, width: item.fw * view.u, height: item.fh * view.u }}
                >
                  <button
                    type="button"
                    className="ranch-hit"
                    aria-pressed={picked === s.id}
                    aria-label={`${s.horse.name}: open card`}
                    data-testid="ranch-horse"
                    onClick={() => setPicked((p) => (p === s.id ? null : s.id))}
                  >
                    <span className={`ranch-tag ranch-tag-${row === "far" ? "far" : "near"} ${s.lockedRaceId ? "is-entered" : s.block || s.condition === "tired" ? "is-resting" : ""}`}>{s.horse.name}</span>
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
