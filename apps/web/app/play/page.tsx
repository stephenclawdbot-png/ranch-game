"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Silks as SilksT } from "@thoroughbred/shared";
import { HorsePortrait } from "@/components/HorsePortrait";
import { Stall } from "@/components/Stall";
import { enterStoryRace } from "@/components/entry/EntryForm";
import { useEntry } from "@/components/entry/EntryProvider";
import { PixelIcon } from "@/components/icons";
import { NAME_RE, NameField, SilksEditor, SilksStand, suggestName } from "@/components/onboarding/SilksEditor";
import { ActionBar } from "@/components/ui/ActionBar";
import { StorageNote } from "@/components/ui/StorageNote";
import { horseSummary, pronoun } from "@/lib/aptitude";
import { STYLE_LABEL, SURFACE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { createStable, legacyProfile, recommendHorse, usePlayerState } from "@/lib/player";
import { randomSilks } from "@/lib/silks";

/**
 * Onboarding in one tap: the name and silks are pre-rolled (dice to reroll, colours optional),
 * then the starter horses arrive with the best one flagged "Ready to race" and a single "Race now".
 */
export default function PlayPage() {
  const router = useRouter();
  const state = usePlayerState();
  const [name, setName] = useState("");
  const [silks, setSilks] = useState<SilksT | null>(null);
  const [stage, setStage] = useState<"form" | "welcome">("form");
  const [imported, setImported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const decided = useRef(false);

  useEffect(() => {
    if (state === undefined || decided.current) return;
    decided.current = true;
    // An existing stable edits its colours under Profile; this page is for founding one.
    if (state) router.replace("/me");
    else {
      // One-time import: a stable from the old in-browser demo keeps its name and colours.
      const legacy = legacyProfile();
      setImported(!!legacy && NAME_RE.test(legacy.stableName.trim()));
      setName(legacy && NAME_RE.test(legacy.stableName.trim()) ? legacy.stableName.trim() : suggestName());
      setSilks(legacy?.silks ?? randomSilks());
    }
  }, [state, router]);

  if (stage === "welcome" && state) return <Welcome />;
  if ((state !== null && stage === "form" && !busy) || !silks) return <div className="min-h-[60vh]" aria-busy />;

  const valid = NAME_RE.test(name.trim());
  async function register() {
    if (!valid || !silks || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createStable({ stableName: name.trim(), silks });
      setStage("welcome");
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
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
          <p className="mt-1 text-lg text-cream-dim">
            {imported
              ? "We found your stable from the demo on this browser: its name and colours come with you. Your horses and credits start fresh on the Club's servers."
              : "We’ve picked a name and colours. Keep them or roll again, then meet your horses."}
          </p>
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
          <button type="submit" className="btn btn-brass btn-lg" disabled={!valid || busy}>
            <PixelIcon name="horseshoe" size={32} className="-my-2" /> {busy ? "Registering…" : "Register & get my horses"}
          </button>
        </ActionBar>
        {error !== null && <ErrorNote error={error} />}
        <p className="text-sm text-sage">Free. No email, no wallet. Your stable is linked to this browser.</p>
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
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const star = useMemo(() => recommendHorse(state), [state]);
  if (!state) return null;
  const horses = state.horses;
  const h = star?.horse;

  // First race in one tap: the natural plan is preselected (explained below); "Change the plan" opens the sheet.
  async function raceNow() {
    if (!star) return;
    setBusy(true);
    setError(null);
    try {
      const { raceId } = await enterStoryRace(star.id, { tactic: star.horse.style, intensity: "normal" });
      router.push(`/race/${raceId}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const ordered = star ? [star, ...horses.filter((x) => x.id !== star.id)] : horses;
  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <header>
        <p className="eyebrow">Registered with the club · {formatCredits(state.credits)} credits · {state.entries.balance} Live entries today</p>
        <h1 className="t-display-xl">{state.stableName}</h1>
        <p className="mt-1 text-lg text-cream-dim">
          {horses.length} horses have arrived.{" "}
          {h && (
            <>
              <strong className="text-cream">{h.name}</strong> is fit and ready to race. {horseSummary(h)}
            </>
          )}
        </p>
      </header>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3" aria-label="Your starter horses">
        {ordered.map((s, order) => {
          const isStar = s.id === star?.id;
          return (
            <li
              key={s.id}
              className={`${isStar ? "surface is-selected" : "surface"} overflow-hidden !p-0`}
              style={{ animation: `stall-open 360ms steps(6) ${order * 140}ms both` }}
            >
              <Link href={`/horse/${s.id}`} className="block">
                <Stall className="flex h-[7.5rem] items-end justify-center">
                  <HorsePortrait appearance={s.horse.appearance} scale={1} className="relative" />
                  {isStar && <span className="chip chip-brass absolute left-1 top-1 text-xs">Ready to race</span>}
                </Stall>
                <div className="p-2">
                  <p className="font-extrabold leading-tight">{s.horse.name}</p>
                  <p className="text-sm text-cream-dim">
                    {STYLE_LABEL[s.horse.style]} · {formatDistance(s.horse.preferredDistanceM)} · {SURFACE_LABEL[s.horse.preferredSurface]}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {h && star && (
        <div className="flex flex-wrap items-center gap-3">
          <ActionBar>
            <button type="button" className="btn btn-brass btn-lg" onClick={raceNow} disabled={busy} data-testid="race-now">
              <PixelIcon name="flag" size={32} className="-my-2" /> {busy ? "Going to the gates…" : `Race ${h.name} now`}
            </button>
          </ActionBar>
          <button type="button" className="btn" onClick={() => entry.open(star.id)}>
            Change the plan
          </button>
          <Link href="/stable" className="btn-ghost inline-flex min-h-11 items-center font-bold">
            Walk into the stable
          </Link>
        </div>
      )}
      {error !== null && <ErrorNote error={error} />}
      <p className="text-sm text-cream-dim">
        {h
          ? `${h.name} runs as a ${STYLE_LABEL[h.style].toLowerCase()}: ${pronoun(h.sex).he} ${h.style === "front" ? "tries to lead all the way" : h.style === "closer" ? "saves energy and comes late" : "sits behind the leaders, then pounces"}. That plan is set for you. Your first race is a free Story race against the Club; the gates open ten seconds after you tap.`
          : ""}
      </p>
      <StorageNote />
    </div>
  );
}
