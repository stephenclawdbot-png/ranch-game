"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { SilkPattern, Silks as SilksT } from "@thoroughbred/shared";
import { HorsePortrait } from "@/components/HorsePortrait";
import { Silks } from "@/components/Silks";
import { ArrowIcon, Crest } from "@/components/icons";
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
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-cream-dim">{label}</legend>
      <div className="grid grid-cols-8 gap-2">
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
              className={`aspect-square rounded-full ring-offset-2 ring-offset-turf-850 transition-transform hover:scale-110 ${
                selected ? "ring-2 ring-brass-bright" : "ring-1 ring-black/40"
              }`}
              style={{ background: c.hex }}
            />
          );
        })}
      </div>
    </fieldset>
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
  }

  if (stage === "welcome" && state) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <Silks silks={state.player.silks} className="mx-auto h-20 w-20 drop-shadow-lg" />
          <p className="eyebrow mt-4">Registered with the club</p>
          <h1 className="display mt-2 text-3xl font-semibold sm:text-4xl">{state.player.stableName}</h1>
          <p className="mx-auto mt-3 max-w-lg text-cream-dim">
            Six horses have arrived at your barn, and {formatCredits(STARTING_CREDITS)} credits are in the stable account. Each one has a
            trip, a surface and a way of running that suits them.
          </p>
        </div>
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Your starter horses">
          {(horses ?? Array.from({ length: 6 }, () => null)).map((h, i) => (
            <li key={h?.id ?? i} className="panel overflow-hidden p-3" style={{ animation: `fade-up 500ms ${i * 90}ms both` }}>
              {h ? (
                <>
                  <div className="aspect-square rounded-xl bg-turf-950/60">
                    <HorsePortrait appearance={h.appearance} className="h-full w-full" />
                  </div>
                  <p className="display mt-2 truncate text-base font-semibold">{h.name}</p>
                  <p className="truncate text-xs text-sage">
                    {STYLE_LABEL[h.style]} · {formatDistance(h.preferredDistanceM)} · {SURFACE_LABEL[h.preferredSurface]}
                  </p>
                </>
              ) : (
                <div className="aspect-square animate-pulse rounded-xl bg-cream/5" />
              )}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex justify-center">
          <Link href="/stable" className="btn btn-brass">
            Walk into the stable <ArrowIcon className="h-4 w-4" />
          </Link>
        </div>
        <style>{`@keyframes fade-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 md:mb-8">
        <p className="eyebrow">{editing ? "Stable registration" : "Membership application"}</p>
        <h1 className="display mt-1 text-3xl font-semibold sm:text-4xl">{editing ? "Your colours" : "Found your stable"}</h1>
        <p className="mt-2 max-w-xl text-cream-dim">
          {editing
            ? "Update your stable name or racing colours. Your horses and record stay as they are."
            : "Every great yard starts with a name and a set of colours. Choose yours; the club sends six horses to get you started."}
        </p>
      </header>

      <form onSubmit={submit} className="grid gap-6 md:grid-cols-[1fr_20rem] md:items-start">
        <div className="panel order-2 grid gap-7 p-5 sm:p-7 md:order-1">
          <div>
            <label htmlFor="stable-name" className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-cream-dim">
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
                className="display h-12 min-w-0 flex-1 rounded-xl border border-cream/15 bg-turf-950/70 px-4 text-lg text-cream placeholder:text-sage/60 focus:border-brass/60 focus:outline-none"
                placeholder="e.g. Larkrise Lodge"
                aria-invalid={!valid}
                aria-describedby="name-hint"
              />
              <button type="button" className="btn btn-ghost !px-4" onClick={() => setName(suggestName())} aria-label="Suggest a name">
                Suggest
              </button>
            </div>
            <p id="name-hint" className={`mt-1.5 text-xs ${valid ? "text-sage" : "text-claret"}`}>
              2–32 characters: letters, numbers, spaces and &rsquo; &amp; . -
            </p>
          </div>

          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-cream-dim">Pattern</legend>
            <div className="grid grid-cols-4 gap-2">
              {SILK_PATTERNS.map((p) => {
                const selected = silks.pattern === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSilks((s) => ({ ...s, pattern: p.id as SilkPattern }))}
                    className={`flex flex-col items-center gap-1 rounded-xl border px-1 pb-2 pt-2.5 text-xs transition-colors ${
                      selected ? "border-brass/70 bg-brass/10 text-cream" : "border-cream/10 bg-turf-950/40 text-cream-dim hover:border-cream/25"
                    }`}
                  >
                    <Silks silks={{ ...silks, pattern: p.id }} cap={false} className="h-10 w-10" />
                    {p.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-6 lg:grid-cols-2">
            <Swatches label="Body colour" value={silks.primary} onChange={(hex) => setSilks((s) => ({ ...s, primary: hex }))} />
            <Swatches label="Pattern colour" value={silks.secondary} onChange={(hex) => setSilks((s) => ({ ...s, secondary: hex }))} />
          </div>
          <Swatches label="Cap" value={silks.cap} onChange={(hex) => setSilks((s) => ({ ...s, cap: hex }))} />

          <div className="flex flex-wrap items-center gap-3 border-t border-cream/10 pt-6">
            <button type="submit" className="btn btn-brass" disabled={!valid || state === undefined}>
              {editing ? "Save colours" : "Register & receive horses"}
            </button>
            {editing && (
              <button
                type="button"
                className="btn btn-ghost"
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
          <div className="panel overflow-hidden">
            <div className="relative flex items-center justify-center bg-[radial-gradient(circle_at_50%_40%,rgba(201,162,74,0.18),transparent_65%)] px-6 pb-4 pt-7">
              <Silks silks={silks} className="h-32 w-32 drop-shadow-[0_12px_18px_rgba(0,0,0,0.55)] md:h-44 md:w-44" title="Your racing silks" />
            </div>
            <div className="border-t border-brass/15 px-5 py-4 text-center">
              <p className="eyebrow !text-[0.6rem]">Registered colours</p>
              <p className="display mt-1 truncate text-xl font-semibold" data-testid="preview-name">
                {name.trim() || "Your stable"}
              </p>
              <div className="mt-3 flex items-center justify-center gap-2 text-xs text-sage">
                <Crest className="h-4 w-4" /> Thoroughbred Racing Club
              </div>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}
