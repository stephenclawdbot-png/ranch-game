"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Silks as SilksT } from "@thoroughbred/shared";
import { HorsePortrait } from "@/components/HorsePortrait";
import { Stall } from "@/components/Stall";
import { enterQuickRace } from "@/components/entry/EntryForm";
import { useEntry } from "@/components/entry/EntryProvider";
import { PixelIcon } from "@/components/icons";
import { NAME_RE, NameField, SilksEditor, SilksStand, suggestName } from "@/components/onboarding/SilksEditor";
import { ActionBar } from "@/components/ui/ActionBar";
import { StorageNote } from "@/components/ui/StorageNote";
import { horseSummary, pronoun, recommendIndex } from "@/lib/aptitude";
import { STYLE_LABEL, SURFACE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import { STARTING_CREDITS, createPlayer, newPlayerId, usePlayerState } from "@/lib/player";
import { randomSilks } from "@/lib/silks";
import { usePlayerHorses } from "@/lib/useStable";

/**
 * Onboarding in one tap: the name and silks are pre-rolled (dice to reroll, colours optional),
 * then six horses arrive with the best one flagged "Ready to race" and a single "Race now".
 */
export default function PlayPage() {
  const router = useRouter();
  const state = usePlayerState();
  const [name, setName] = useState("");
  const [silks, setSilks] = useState<SilksT | null>(null);
  const [stage, setStage] = useState<"form" | "welcome">("form");
  const decided = useRef(false);

  useEffect(() => {
    if (state === undefined || decided.current) return;
    decided.current = true;
    // An existing stable edits its colours under Profile; this page is for founding one.
    if (state) router.replace("/me");
    else {
      setName(suggestName());
      setSilks(randomSilks());
    }
  }, [state, router]);

  if (stage === "welcome" && state) return <Welcome />;
  if (state !== null || !silks) return <div className="min-h-[60vh]" aria-busy />;

  const valid = NAME_RE.test(name.trim());
  function register() {
    if (!valid || !silks) return;
    createPlayer({ playerId: newPlayerId(), stableName: name.trim(), silks });
    setStage("welcome");
    window.scrollTo({ top: 0 });
  }

  return (
    <form
      className="mx-auto grid max-w-4xl gap-5 md:grid-cols-[1fr_18rem] md:gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        register();
      }}
    >
      <div className="grid content-start gap-5">
        <header>
          <h1 className="t-display-xl">Found your stable</h1>
          <p className="mt-1 text-lg text-cream-dim">We&rsquo;ve picked a name and colours. Keep them or roll again, then meet your six horses.</p>
        </header>
        <div className="md:hidden">
          <SilksStand silks={silks} name={name} />
        </div>
        <NameField name={name} onChange={setName} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => setSilks(randomSilks())}>
            <PixelIcon name="dice" className="h-5 w-5" /> New colours
          </button>
        </div>
        <details className="surface group p-3 [&[open]>summary_.chev]:rotate-90">
          <summary className="flex min-h-11 items-center justify-between gap-2 font-extrabold">
            Customise colours
            <span className="chev text-cream-dim" aria-hidden>
              ▸
            </span>
          </summary>
          <div className="mt-3">
            <SilksEditor silks={silks} onChange={setSilks} />
          </div>
        </details>
        <ActionBar>
          <button type="submit" className="btn btn-brass btn-lg" disabled={!valid}>
            <PixelIcon name="horseshoe" size={32} className="-my-2" /> Register &amp; get my horses
          </button>
        </ActionBar>
        <p className="text-sm text-sage">Free. No email, no wallet. Your stable is kept in this browser.</p>
      </div>
      <aside className="hidden md:block" aria-label="Preview">
        <div className="sticky top-24">
          <SilksStand silks={silks} name={name} />
        </div>
      </aside>
    </form>
  );
}

/** The reveal: six stall doors open in sequence; the best horse is flagged and one tap from the gates. */
function Welcome() {
  const state = usePlayerState();
  const entry = useEntry();
  const { horses } = usePlayerHorses(state?.player.playerId, state?.player.silks);
  const rec = useMemo(() => (horses ? recommendIndex(horses) : 0), [horses]);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state) return null;
  const star = horses?.[rec];

  // First race in one tap: the natural plan is preselected (explained below); "Change the plan" opens the sheet.
  async function raceNow() {
    if (!state || !star) return;
    setBusy(true);
    setError(null);
    try {
      router.push(`/race/${await enterQuickRace(state, star, rec, star.style)}`);
    } catch (e) {
      setError(`Couldn't enter the race (${(e as Error).message}). Please try again.`);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <header>
        <p className="eyebrow">Registered with the club · {formatCredits(STARTING_CREDITS)} credits in the account</p>
        <h1 className="t-display-xl">{state.player.stableName}</h1>
        <p className="mt-1 text-lg text-cream-dim">
          Six horses have arrived.{" "}
          {star && (
            <>
              <strong className="text-cream">{star.name}</strong> is fit and ready to race. {horseSummary(star)}
            </>
          )}
        </p>
      </header>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3" aria-label="Your starter horses">
        {(horses ? [rec, ...horses.map((_, i) => i).filter((i) => i !== rec)].map((i) => ({ h: horses[i]!, i })) : Array.from({ length: 6 }, (_, i) => ({ h: null, i }))).map(({ h, i }, order) => {
          const isStar = h !== null && i === rec;
          return (
            <li
              key={h?.id ?? i}
              className={`${isStar ? "surface is-selected" : "surface"} overflow-hidden !p-0`}
              style={h ? { animation: `stall-open 360ms steps(6) ${order * 140}ms both` } : undefined}
            >
              {h ? (
                <Link href={`/horse/${h.id}`} className="block">
                  <Stall className="flex h-[7.5rem] items-end justify-center">
                    <HorsePortrait appearance={h.appearance} scale={1} className="relative" />
                    {isStar && <span className="chip chip-brass absolute left-1 top-1 text-xs">Ready to race</span>}
                  </Stall>
                  <div className="p-2">
                    <p className="font-extrabold leading-tight">{h.name}</p>
                    <p className="text-sm text-cream-dim">
                      {STYLE_LABEL[h.style]} · {formatDistance(h.preferredDistanceM)} · {SURFACE_LABEL[h.preferredSurface]}
                    </p>
                  </div>
                </Link>
              ) : (
                <div className="h-[11rem] bg-surface-2 opacity-60" />
              )}
            </li>
          );
        })}
      </ul>

      {star && (
        <div className="flex flex-wrap items-center gap-3">
          <ActionBar>
            <button type="button" className="btn btn-brass btn-lg" onClick={raceNow} disabled={busy} data-testid="race-now">
              <PixelIcon name="flag" size={32} className="-my-2" /> {busy ? "Going to the gates…" : `Race ${star.name} now`}
            </button>
          </ActionBar>
          <button type="button" className="btn" onClick={() => entry.open(rec)}>
            Change the plan
          </button>
          <Link href="/stable" className="btn-ghost inline-flex min-h-11 items-center font-bold">
            Walk into the stable
          </Link>
        </div>
      )}
      {error && (
        <p className="font-bold text-negative" role="alert">
          {error}
        </p>
      )}
      <p className="text-sm text-cream-dim">
        {star ? `${star.name} runs as a ${STYLE_LABEL[star.style].toLowerCase()}: ${pronoun(star.sex).he} ${star.style === "front" ? "tries to lead all the way" : star.style === "closer" ? "saves energy and comes late" : "sits behind the leaders, then pounces"}. That plan is set for you. The gates open ten seconds after you tap.` : ""}
      </p>
      <StorageNote />
    </div>
  );
}
