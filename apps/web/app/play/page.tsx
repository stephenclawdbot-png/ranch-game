"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { SilkPattern, Silks as SilksT } from "@thoroughbred/shared";
import { HorsePortrait } from "@/components/HorsePortrait";
import { Silks } from "@/components/Silks";
import { Stall } from "@/components/Stall";
import { ArrowIcon, Crest, PixelIcon } from "@/components/icons";
import { SceneBackdrop } from "@/components/pixel/SceneBackdrop";
import { GallopSprite } from "@/components/pixel/GallopSprite";
import { useTilt } from "@/components/pixel/useTilt";
import { STYLE_LABEL, formatDistance, SURFACE_LABEL, formatCredits } from "@/lib/format";
import { STARTING_CREDITS, createPlayer, newPlayerId, resetPlayer, updateProfile, usePlayerState } from "@/lib/player";
import { SILK_COLORS, SILK_PATTERNS } from "@/lib/silks";
import { usePlayerHorses } from "@/lib/useStable";

const NAME_A = ["Harbourlight", "Ashdown", "Blackthorn", "Kingsfold", "Larkrise", "Moorcroft", "Nettlebed", "Oakwood", "Ravensmoor", "Stonebridge", "Whitecross", "Wildmere", "Foxcote", "Glenmorrow"];
const NAME_B = ["Stables", "Racing", "Lodge", "Stud", "House", "Farm", "Yard"];
const NAME_RE = /^[\p{L}\p{N} '&.\-]{2,32}$/u;

function suggestName(): string {
  const a = NAME_A[Math.floor(Math.random() * NAME_A.length)]!;
  const b = NAME_B[Math.floor(Math.random() * NAME_B.length)]!;
  return `${a} ${b}`;
}

const DEFAULT_SILKS: SilksT = { pattern: "hoops", primary: "#0f5a3a", secondary: "#e2b33c", cap: "#e2b33c" };

function Swatches({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="label mb-1.5 !text-cream-dim">{label}</legend>
      <div className="grid grid-cols-8 gap-1.5">
        {SILK_COLORS.map((c) => {
          const selected = c.hex.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={c.hex}
              type="button"
              title={c.name}
              aria-label={`${label}: ${c.name}`}
              aria-pressed={selected}
              onClick={() => onChange(c.hex)}
              className={`aspect-square transition-transform hover:-translate-y-0.5 ${selected ? "-translate-y-0.5" : ""}`}
              style={{
                background: c.hex,
                boxShadow: selected
                  ? "inset 0 -3px 0 rgba(0,0,0,.28), inset 0 2px 0 rgba(255,255,255,.3), 0 0 0 2px #0b0f0c, 0 0 0 5px #f2c86a, 0 0 0 7px #0b0f0c"
                  : "inset 0 -3px 0 rgba(0,0,0,.28), inset 0 2px 0 rgba(255,255,255,.3), 0 0 0 2px #0b0f0c",
              }}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h2 className="mb-2 flex items-center gap-2">
        <span className="num flex h-6 w-6 items-center justify-center bg-brass text-sm text-[#241505]">{n}</span>
        <span className="display text-lg">{title}</span>
      </h2>
      {children}
    </section>
  );
}

/** The silks on a tack-room stand: big live preview with tilt + parallax. */
function SilksPreview({ silks, name }: { silks: SilksT; name: string }) {
  const tilt = useTilt<HTMLDivElement>(6);
  return (
    <div ref={tilt} className="tilt px-panel overflow-hidden !p-0">
      <div className="relative h-36 md:h-72">
        <SceneBackdrop variant="barn" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/3 bg-[#2a170c]/30" />
        {/* stand */}
        <div className="parallax absolute bottom-[10%] left-1/2 h-[12%] w-[34%] -translate-x-1/2" style={{ ["--depth" as string]: 6 }}>
          <div className="mx-auto h-full w-[8%] min-w-[6px] bg-[#3d2414]" />
        </div>
        <div className="parallax absolute inset-x-0 bottom-[18%] top-[6%] flex justify-center" style={{ ["--depth" as string]: 14 }}>
          <Silks silks={silks} className="h-full w-auto animate-bob drop-shadow-[6px_6px_0_rgba(0,0,0,0.45)]" title="Your racing silks" />
        </div>
        <div className="sheen sheen-play" key={`${silks.pattern}${silks.primary}${silks.secondary}${silks.cap}`} aria-hidden />
      </div>
      <div className="px-plate m-2 text-center md:m-3">
        <p className="font-[family-name:var(--font-pixel)] text-[9px] uppercase tracking-wider text-[#7a5a2e]">Registered colours</p>
        <p className="display truncate text-xl !text-[#1d140a] [text-shadow:none]" data-testid="preview-name">
          {name.trim() || "Your stable"}
        </p>
        <div className="mt-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-[#5c4a2e]">
          <Crest className="h-4 w-4" /> Thoroughbred Racing Club
        </div>
      </div>
    </div>
  );
}

export default function PlayPage() {
  const router = useRouter();
  const state = usePlayerState();
  const [name, setName] = useState("");
  const [silks, setSilks] = useState<SilksT>(DEFAULT_SILKS);
  const [stage, setStage] = useState<"form" | "welcome">("form");
  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    if (state === undefined || initialised) return;
    if (state) {
      setName(state.player.stableName);
      setSilks(state.player.silks);
    } else {
      setName(suggestName());
    }
    setInitialised(true);
  }, [state, initialised]);

  const editing = Boolean(state) && stage === "form";
  const valid = NAME_RE.test(name.trim());
  const { horses } = usePlayerHorses(stage === "welcome" ? state?.player.playerId : undefined, state?.player.silks);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    if (state) {
      updateProfile({ stableName: name.trim(), silks });
      router.push("/stable");
      return;
    }
    createPlayer({ playerId: newPlayerId(), stableName: name.trim(), silks });
    setStage("welcome");
    window.scrollTo({ top: 0 });
  }

  if (stage === "welcome" && state) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="px-panel relative overflow-hidden !p-0">
          <div className="relative h-56 sm:h-64">
            <SceneBackdrop variant="stable" />
            {horses?.[0] && (
              <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[30%]">
                <div className="gallop-across absolute bottom-0 left-0">
                  <GallopSprite appearance={horses[0].appearance} scale={2} />
                </div>
              </div>
            )}
            <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,transparent_0_40%,rgba(8,21,14,.55)_40%_70%,rgba(8,21,14,.85)_70%)]" />
            <div className="absolute inset-0 flex flex-col items-center justify-end p-4 text-center">
              <Silks silks={state.player.silks} className="h-20 w-20 animate-bob drop-shadow-[4px_4px_0_rgba(0,0,0,0.5)]" />
              <p className="eyebrow mt-2 bg-[#08150e]/80 px-1.5 py-0.5 !text-brass-bright">Registered with the club</p>
              <h1 className="display mt-1 text-[2rem] sm:text-5xl">{state.player.stableName}</h1>
            </div>
          </div>
          <p className="mx-auto max-w-xl px-4 py-3 text-center text-cream-dim">
            Six horses have arrived at your barn, and{" "}
            <span className="num inline-flex items-center gap-1 text-brass-bright">
              <PixelIcon name="coin" className="h-4 w-4" />
              {formatCredits(STARTING_CREDITS)}
            </span>{" "}
            credits are in the stable account. Each one has a trip, a surface and a way of running that suits them.
          </p>
        </div>
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Your starter horses">
          {(horses ?? Array.from({ length: 6 }, () => null)).map((h, i) => (
            <li key={h?.id ?? i} className="px-panel overflow-hidden !p-0" style={h ? { animation: `reveal-card 640ms steps(10) ${i * 160}ms both` } : undefined}>
              {h ? (
                <>
                  <Stall className="aspect-square">
                    <div className="absolute inset-x-0 bottom-[6%] top-[8%] flex justify-center">
                      <HorsePortrait appearance={h.appearance} className="h-full w-auto" />
                    </div>
                    <span className="chip chip-cream absolute left-1.5 top-1.5 text-[0.65rem]">{STYLE_LABEL[h.style]}</span>
                  </Stall>
                  <div className="p-2">
                    <p className="display truncate text-base">{h.name}</p>
                    <p className="truncate text-xs text-sage">
                      {formatDistance(h.preferredDistanceM)} · {SURFACE_LABEL[h.preferredSurface]}
                    </p>
                  </div>
                </>
              ) : (
                <div className="aspect-square animate-pulse bg-[#163a28]" />
              )}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex justify-center">
          <Link href="/stable" className="btn btn-brass btn-lg">
            <PixelIcon name="stable" className="h-5 w-5" /> Walk into the stable <ArrowIcon className="h-3 w-3" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-4 flex items-center gap-3 md:mb-6">
        <Crest className="h-12 w-12 shrink-0 md:h-14 md:w-14" />
        <div className="min-w-0">
          <p className="eyebrow">{editing ? "Stable registration" : "Membership application"}</p>
          <h1 className="display mt-0.5 text-[1.9rem] sm:text-[2.6rem]">{editing ? "Your colours" : "Found your stable"}</h1>
          <p className="mt-1 max-w-xl text-sm text-cream-dim">
            {editing
              ? "Update your stable name or racing colours. Your horses and record stay as they are."
              : "Every great yard starts with a name and a set of colours. Choose yours; the club sends six horses to get you started."}
          </p>
        </div>
      </header>

      <form onSubmit={submit} className="grid gap-4 md:grid-cols-[1fr_20rem] md:items-start md:gap-6">
        <div className="px-panel order-2 grid gap-6 p-3 sm:p-5 md:order-1">
          <Step n={1} title="Name your yard">
            <label htmlFor="stable-name" className="label mb-1.5 block !text-cream-dim">
              Stable name
            </label>
            <div className="flex gap-2">
              <input
                id="stable-name"
                name="stableName"
                value={name}
                maxLength={32}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                className="px-inset display h-12 min-w-0 flex-1 px-2 text-xl text-cream placeholder:text-sage/60 focus:outline-none focus-visible:outline-3 focus-visible:outline-brass-bright"
                placeholder="e.g. Larkrise Lodge"
                aria-invalid={!valid}
                aria-describedby="name-hint"
              />
              <button type="button" className="btn shrink-0 !px-3" onClick={() => setName(suggestName())} aria-label="Suggest a name">
                <PixelIcon name="dice" className="h-5 w-5" />
                <span className="hidden sm:inline">Suggest</span>
              </button>
            </div>
            <p id="name-hint" className={`mt-1.5 text-xs ${valid ? "text-sage" : "font-semibold text-claret"}`}>
              2–32 characters: letters, numbers, spaces and &rsquo; &amp; . -
            </p>
          </Step>

          <Step n={2} title="Pick a pattern">
            <fieldset className="min-w-0">
              <legend className="sr-only">Pattern</legend>
              <div className="grid grid-cols-4 gap-1.5">
                {SILK_PATTERNS.map((p) => {
                  const selected = silks.pattern === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSilks((s) => ({ ...s, pattern: p.id as SilkPattern }))}
                      className={`px-panel-quiet flex flex-col items-center gap-1 px-1 pb-1 pt-1.5 text-xs font-bold transition-transform ${
                        selected ? "px-select -translate-y-0.5 text-cream" : "text-cream-dim hover:-translate-y-0.5"
                      }`}
                    >
                      <Silks silks={{ ...silks, pattern: p.id }} cap={false} className="h-10 w-10 sm:h-12 sm:w-12" />
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </Step>

          <Step n={3} title="Choose your colours">
            <div className="grid gap-5 lg:grid-cols-2">
              <Swatches label="Body colour" value={silks.primary} onChange={(hex) => setSilks((s) => ({ ...s, primary: hex }))} />
              <Swatches label="Pattern colour" value={silks.secondary} onChange={(hex) => setSilks((s) => ({ ...s, secondary: hex }))} />
              <Swatches label="Cap" value={silks.cap} onChange={(hex) => setSilks((s) => ({ ...s, cap: hex }))} />
            </div>
          </Step>

          <div className="flex flex-wrap items-center gap-3 border-t-2 border-dashed border-[#1f4d35] pt-4">
            <button type="submit" className="btn btn-brass btn-lg" disabled={!valid || state === undefined}>
              <PixelIcon name={editing ? "check" : "horseshoe"} className="h-5 w-5" />
              {editing ? "Save colours" : "Register & receive horses"}
            </button>
            {editing && (
              <button
                type="button"
                className="btn btn-oxblood"
                onClick={() => {
                  if (window.confirm("Start over with a new stable? Your current horses, credits and history on this device will be cleared.")) {
                    resetPlayer();
                    setInitialised(false);
                  }
                }}
              >
                Start over
              </button>
            )}
          </div>
        </div>

        <aside className="order-1 md:sticky md:top-24 md:order-2" aria-label="Preview">
          <SilksPreview silks={silks} name={name} />
        </aside>
      </form>
    </div>
  );
}
