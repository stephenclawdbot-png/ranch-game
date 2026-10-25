"use client";
/** Presentational HUD pieces. All state comes from RaceViewer; nothing here touches Pixi. */
import { formatRaceTime, type RaceEvent, type RaceReplay } from "@thoroughbred/shared";
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
  replay: RaceReplay;
  raceTime: number;
  toGoM: number;
  standings: StandingRow[];
  maxStandings: number;
  commentary: RaceEvent | null;
  highlightHorseId?: string;
}

export function TopHud({ replay, raceTime, toGoM, standings, maxStandings, commentary, highlightHorseId }: TopHudProps) {
  const { race, result } = replay;
  const winnerHome = raceTime >= result.winningTimeUs / 1e6;
  const clock = winnerHome ? formatRaceTime(result.winningTimeUs) : formatRaceTime(Math.max(0, raceTime) * 1e6);
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
  { id: "leader", label: "Leader", short: "Lead", title: "Follow leader" },
  { id: "mine", label: "My horse", short: "Mine", title: "Follow my horse" },
  { id: "wide", label: "Wide", short: "Wide", title: "Wide shot" },
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
  const nextRate = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(p.rate as (typeof PLAYBACK_RATES)[number]) + 1) % PLAYBACK_RATES.length]!;
  const cams = CAMERAS.filter((c) => c.id !== "mine" || p.hasHighlight);
  const nextCam = cams[(cams.findIndex((c) => c.id === p.camera) + 1) % cams.length]!;
  const t = Math.max(0, Math.min(p.time, p.duration));
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
          max={p.duration}
          step={0.05}
          value={t}
          aria-label="Race position"
          onPointerDown={p.onScrubStart}
          onPointerUp={p.onScrubEnd}
          onPointerCancel={p.onScrubEnd}
          onChange={(e) => p.onSeek(Number(e.currentTarget.value))}
        />
        <span className="rv-elapsed">
          {clockLabel(t)} / {clockLabel(p.duration)}
        </span>
      </div>
      {p.narrow ? (
        <button type="button" className="rv-btn" onClick={() => p.onRate(nextRate)} aria-label={`Speed ${p.rate}x`} title="Playback speed">
          {p.rate}×
        </button>
      ) : (
        <div className="rv-seg" role="group" aria-label="Playback speed">
          {PLAYBACK_RATES.map((r) => (
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
