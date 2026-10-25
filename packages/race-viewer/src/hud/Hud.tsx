"use client";
import { useEffect, useRef } from "react";
/** Presentational HUD pieces. All state comes from RaceViewer; nothing here touches Pixi. */
import { formatRaceTime, type RaceConfig, type RaceEvent, type RaceReplay } from "@thoroughbred/shared";
import type { StandingRow } from "../timeline";
import type { CameraMode } from "../types";
import { PLAYBACK_RATES } from "../playback";

const SURFACE_LABEL = { turf: "Turf", dirt: "Dirt", synthetic: "Synthetic" } as const;
const GOING_LABEL = { firm: "Firm", good: "Good", soft: "Soft", heavy: "Heavy" } as const;
const WEATHER_LABEL = { clear: "Clear", overcast: "Overcast", rain: "Rain", dusk: "Dusk" } as const;

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/** m:ss for the scrub bar. */
export function clockLabel(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Swatch({ primary, secondary }: { primary: string; secondary: string }) {
  return <span className="rv-swatch" style={{ background: `linear-gradient(135deg, ${primary} 0 55%, ${secondary} 55% 100%)` }} />;
}

export interface TopHudProps {
  race: RaceConfig;
  /** Official winning time once known (replay mode); null while live. */
  winningTimeUs: number | null;
  trackLengthM: number;
  raceTime: number;
  toGoM: number;
  standings: StandingRow[];
  maxStandings: number;
  commentary: RaceEvent | null;
  highlightHorseId?: string;
}

export function TopHud({ race, winningTimeUs, raceTime, toGoM, standings, maxStandings, commentary, highlightHorseId }: TopHudProps) {
  const winnerHome = winningTimeUs !== null && raceTime >= winningTimeUs / 1e6;
  const clock = winnerHome ? formatRaceTime(winningTimeUs) : formatRaceTime(Math.max(0, raceTime) * 1e6);
  let rows = standings.slice(0, maxStandings);
  const me = standings.find((s) => s.horseId === highlightHorseId);
  if (me && !rows.includes(me)) rows = [...rows.slice(0, Math.max(1, maxStandings - 1)), me];
  return (
    <div className="rv-hud">
      <div className="rv-row">
        <div className="rv-title">
          <div className="rv-name">{race.name}</div>
          <div className="rv-chips">
            <span className="rv-chip">{race.distanceM.toLocaleString("en-US")}m</span>
            <span className={`rv-chip rv-chip-${race.surface}`}>
              {SURFACE_LABEL[race.surface]} · {GOING_LABEL[race.going]}
            </span>
            {race.weather !== "clear" && <span className="rv-chip">{WEATHER_LABEL[race.weather]}</span>}
          </div>
        </div>
        <div className="rv-clock" aria-live="off">
          <div className="rv-time">{clock}</div>
          <div className="rv-togo">{raceTime < 0 ? "At the start" : toGoM > 0.5 ? `${Math.ceil(toGoM)}m to go` : winnerHome ? "Winning time" : "Finish"}</div>
        </div>
      </div>
      {raceTime >= 0 && (
        <div className="rv-standings" aria-label="Live standings">
          {rows.map((s) => (
            <span key={s.horseId} className={`rv-st${s.horseId === highlightHorseId ? " rv-st-me" : ""}`}>
              <Swatch primary={s.primary} secondary={s.secondary} />
              <span className="rv-st-pos">{s.position}</span>
              <span>{s.name}</span>
              {s.gapLabel && <span className="rv-st-gap">{s.gapLabel}</span>}
            </span>
          ))}
        </div>
      )}
      {commentary && <Ticker event={commentary} />}
    </div>
  );
}

export function Ticker({ event }: { event: RaceEvent }) {
  return (
    <div key={`${event.tick}-${event.type}`} className="rv-ticker" aria-live="polite">
      {event.text}
    </div>
  );
}

export interface ControlsProps {
  narrow: boolean;
  playing: boolean;
  rate: number;
  time: number;
  duration: number;
  camera: CameraMode;
  hasHighlight: boolean;
  showLive: boolean;
  live: boolean;
  /** Live broadcast: no total duration, no fast-forward past the edge. */
  liveMode?: boolean;
  canGoLive: boolean;
  onToggle(): void;
  onRestart(): void;
  onRate(r: number): void;
  onSeek(t: number): void;
  onScrubStart(): void;
  onScrubEnd(): void;
  onCamera(c: CameraMode): void;
  onLive(): void;
}

const CAMERAS: { id: CameraMode; label: string; short: string; title: string }[] = [
  { id: "director", label: "Director", short: "TV", title: "Broadcast director (auto cuts)" },
  { id: "mine", label: "My horse", short: "Mine", title: "Lock on my horse" },
  { id: "leader", label: "Leader", short: "Lead", title: "Lock on the leader" },
  { id: "wide", label: "Wide", short: "Wide", title: "Whole field" },
];

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <rect x="2" y="1.5" width="3.6" height="11" rx="1" fill="currentColor" />
      <rect x="8.4" y="1.5" width="3.6" height="11" rx="1" fill="currentColor" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M3 1.6v10.8a.6.6 0 0 0 .9.5l8.6-5.4a.6.6 0 0 0 0-1L3.9 1.1a.6.6 0 0 0-.9.5z" fill="currentColor" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 2.5a5.5 5.5 0 1 1-5.2 3.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M2 2.2v4.2h4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Controls(p: ControlsProps) {
  const cams = CAMERAS.filter((c) => c.id !== "mine" || p.hasHighlight);
  const nextCam = cams[(cams.findIndex((c) => c.id === p.camera) + 1) % cams.length]!;
  const t = Math.max(0, Math.min(p.time, p.duration));
  // Live: speeds only to catch up after a rewind (never shown at the live edge).
  const rates = p.liveMode ? (p.live ? [] : PLAYBACK_RATES.filter((r) => r >= 1)) : [...PLAYBACK_RATES];
  return (
    <div className="rv-controls" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="rv-btn" onClick={p.onToggle} aria-label={p.playing ? "Pause" : "Play"} title={p.playing ? "Pause (space)" : "Play (space)"}>
        <PlayIcon playing={p.playing} />
      </button>
      <button type="button" className="rv-btn" onClick={p.onRestart} aria-label="Restart" title="Restart">
        <RestartIcon />
      </button>
      <div className="rv-scrub">
        <input
          className="rv-range"
          type="range"
          min={0}
          max={Math.max(0.01, p.duration)}
          step={0.05}
          value={t}
          aria-label="Race position"
          onPointerDown={p.onScrubStart}
          onPointerUp={p.onScrubEnd}
          onPointerCancel={p.onScrubEnd}
          onChange={(e) => p.onSeek(Number(e.currentTarget.value))}
        />
        <span className="rv-elapsed">{p.liveMode ? clockLabel(t) : `${clockLabel(t)} / ${clockLabel(p.duration)}`}</span>
      </div>
      {rates.length === 0 ? null : p.narrow ? (
        <button type="button" className="rv-btn" onClick={() => p.onRate(rates[(rates.indexOf(p.rate as never) + 1) % rates.length] ?? 1)} aria-label={`Speed ${p.rate}x`} title="Playback speed">
          {p.rate}×
        </button>
      ) : (
        <div className="rv-seg" role="group" aria-label="Playback speed">
          {rates.map((r) => (
            <button type="button" key={r} className="rv-btn" aria-pressed={p.rate === r} onClick={() => p.onRate(r)}>
              {r}×
            </button>
          ))}
        </div>
      )}
      {p.narrow ? (
        <button type="button" className="rv-btn" onClick={() => p.onCamera(nextCam.id)} title={`Camera: ${CAMERAS.find((c) => c.id === p.camera)?.title}`} aria-label="Camera mode">
          <CamIcon />
          {CAMERAS.find((c) => c.id === p.camera)?.short}
        </button>
      ) : (
        <div className="rv-seg" role="group" aria-label="Camera">
          {cams.map((c) => (
            <button type="button" key={c.id} className="rv-btn" aria-pressed={p.camera === c.id} onClick={() => p.onCamera(c.id)} title={c.title}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {p.showLive && (
        <button type="button" className="rv-btn rv-live" aria-pressed={p.live} disabled={!p.live && !p.canGoLive} onClick={p.onLive} title="Jump to live">
          <span className="rv-live-dot" />
          Live
        </button>
      )}
    </div>
  );
}

function CamIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <rect x="1" y="4" width="10" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 7l4-2.2v6.4L11 9z" fill="currentColor" />
    </svg>
  );
}

export function Countdown({ seconds, live }: { seconds: number; live: boolean }) {
  return (
    <div className="rv-center rv-center-top">
      <div className="rv-count">
        <div className="rv-count-k">{live && seconds > 1 ? "Horses loading · off in" : "Under starter's orders"}</div>
        {live && seconds > 1 ? <div className="rv-count-v">{clockLabel(Math.ceil(seconds))}</div> : <div className="rv-count-v">Ready…</div>}
      </div>
    </div>
  );
}

export function PhotoStamp() {
  return (
    <div className="rv-center">
      <div className="rv-photo">PHOTO</div>
    </div>
  );
}

export interface ResultsCardProps {
  replay: RaceReplay;
  highlightHorseId?: string;
  onClose(): void;
  onReplay(): void;
}

export function ResultsCard({ replay, highlightHorseId, onClose, onReplay }: ResultsCardProps) {
  const byId = new Map(replay.horses.map((h) => [h.horseId, h]));
  const winner = byId.get(replay.result.finishOrder[0]?.horseId ?? "");
  return (
    <div className="rv-modal" onClick={onClose}>
      <div className="rv-card" role="dialog" aria-label="Race result" onClick={(e) => e.stopPropagation()}>
        <div className="rv-card-h">
          <div>
            <div className="rv-card-k">{replay.result.photoFinish ? "Photo finish · Result" : "Official result"}</div>
            <div className="rv-card-t">{winner ? `${winner.name} wins` : replay.race.name}</div>
            <div className="rv-card-s">
              {replay.race.name} · {replay.race.distanceM}m · {formatRaceTime(replay.result.winningTimeUs)}
            </div>
          </div>
          <button type="button" className="rv-btn" onClick={onClose} aria-label="Close results">
            ✕
          </button>
        </div>
        <table className="rv-res">
          <tbody>
            {replay.result.finishOrder.map((f) => {
              const h = byId.get(f.horseId);
              const cls = [f.horseId === highlightHorseId ? "rv-me" : "", f.position === 1 ? "rv-win" : ""].join(" ").trim();
              return (
                <tr key={f.horseId} className={cls || undefined}>
                  <td>{ordinal(f.position)}</td>
                  <td style={{ width: 18 }}>{h && <Swatch primary={h.appearance.silks.primary} secondary={h.appearance.silks.secondary} />}</td>
                  <td className="rv-res-name">{h?.name ?? f.horseId}</td>
                  <td className="rv-res-time">{formatRaceTime(f.finishTimeUs)}</td>
                  <td>{f.position === 1 ? "" : f.marginLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="rv-card-f">
          <button type="button" className="rv-btn" onClick={onReplay}>
            <RestartIcon /> Watch again
          </button>
          <button type="button" className="rv-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export interface MinimapDot {
  id: string;
  /** 0..1 along the race. */
  p: number;
  /** 0..1 across the track (0 = rail). */
  lane: number;
  primary: string;
  secondary: string;
  me: boolean;
  leader: boolean;
}

/**
 * Race minimap: a compact progress strip with every runner as a silks dot at its
 * distance (lane = slight vertical offset), furlong ticks, the finish post, the
 * leader and my horse marked. Drawn on a canvas, crisp at any DPR.
 */
export function Minimap({ dots, furlongs }: { dots: MinimapDot[]; furlongs: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const u = Math.max(1, Math.round(dpr));
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    const padL = 8 * u;
    const padR = 14 * u;
    const x = (p: number) => Math.round(padL + Math.min(1, Math.max(0, p)) * (w - padL - padR));
    const top = Math.round(h * 0.28);
    const bot = Math.round(h * 0.86);
    // Track band + rails.
    ctx.fillStyle = "rgba(31,77,53,0.92)";
    ctx.fillRect(x(0), top, x(1) - x(0), bot - top);
    ctx.fillStyle = "#f3e7c9";
    ctx.fillRect(x(0), top, x(1) - x(0), u);
    ctx.fillRect(x(0), bot - u, x(1) - x(0), u);
    // Furlong ticks.
    ctx.fillStyle = "rgba(243,231,201,0.55)";
    for (const f of furlongs) ctx.fillRect(x(f), top, u, Math.round((bot - top) * 0.35));
    // Finish post: red/white pole + flag.
    const fx = x(1);
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = k % 2 ? "#d71920" : "#ffffff";
      ctx.fillRect(fx, Math.round(top - 3 * u + ((bot - top + 3 * u) * k) / 6), 2 * u, Math.ceil((bot - top + 3 * u) / 6));
    }
    ctx.fillStyle = "#d71920";
    ctx.fillRect(fx + 2 * u, top - 3 * u, 5 * u, 3 * u);
    // Runners: back to front, mine last (on top).
    const r = Math.max(3 * u, Math.round(h * 0.13));
    const order = [...dots].sort((a, b) => Number(a.me) - Number(b.me) || a.p - b.p);
    for (const d of order) {
      const cx = x(d.p);
      const cy = Math.round(top + (bot - top) * (0.22 + 0.56 * d.lane));
      ctx.fillStyle = "#0b0f0c";
      ctx.fillRect(cx - r - u, cy - r - u, 2 * r + 2 * u, 2 * r + 2 * u);
      ctx.fillStyle = d.primary;
      ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      ctx.fillStyle = d.secondary;
      ctx.fillRect(cx - r, cy, 2 * r, r);
      if (d.me) {
        ctx.strokeStyle = "#f2c86a";
        ctx.lineWidth = 2 * u;
        ctx.strokeRect(cx - r - 2.5 * u, cy - r - 2.5 * u, 2 * r + 5 * u, 2 * r + 5 * u);
        ctx.fillStyle = "#f2c86a";
        ctx.beginPath();
        ctx.moveTo(cx - 3 * u, top - 6 * u);
        ctx.lineTo(cx + 3 * u, top - 6 * u);
        ctx.lineTo(cx, top - 2 * u);
        ctx.fill();
      }
      if (d.leader) {
        ctx.fillStyle = "#f3e7c9";
        ctx.fillRect(cx + r + 2 * u, cy - u, 3 * u, 2 * u);
      }
    }
  });
  return <canvas ref={ref} className="rv-minimap" aria-label="Race positions" />;
}
