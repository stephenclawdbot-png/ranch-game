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
import { MentorWelcome } from "@/components/onboarding/Mentor";
import { ActionBar } from "@/components/ui/ActionBar";
import { StorageNote } from "@/components/ui/StorageNote";
import { WalletSignIn } from "@/components/chain/WalletSignIn";
import { pronoun } from "@/lib/aptitude";
import { STYLE_LABEL, SURFACE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { deviceId } from "@/lib/deviceId";
import { api, createStable, legacyProfile, recommendHorse, refreshPlayer, usePlayerState } from "@/lib/player";
import type { StableHorse } from "@/lib/types";
import { HorseNameInput, useHorseNameCheck } from "@/components/ui/HorseNameInput";
import { randomSilks } from "@/lib/silks";

/**
 * Onboarding in one tap: the name and silks are pre-rolled (dice to reroll, colours optional),
 * then the starter horses arrive with the best one flagged "Ready to race" and a single "Race now".
 */
export function PlayClient({ playtest }: { playtest: boolean }) {
  const router = useRouter();
  const state = usePlayerState();
  const [name, setName] = useState("");
  const [silks, setSilks] = useState<SilksT | null>(null);
  const [stage, setStage] = useState<"form" | "mentor" | "welcome">("form");
  const [imported, setImported] = useState(false);
  /** "Sign in with your wallet" panel under the founding form (an existing stable's wallet). */
  const [walletOpen, setWalletOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const decided = useRef(false);
  /** Closed playtest: the checked invite code (null until accepted). */
  const [invite, setInvite] = useState<string | null>(null);
  /** Outside the playtest, a referral link (?invite=CODE) still records who invited you. */
  const [referral, setReferral] = useState<string | null>(null);
  /** "Bring a rival" link (?invite=CODE&rival=1): who challenged you, and the welcome you both get. */
  const [rival, setRival] = useState<{ stableName: string; credits: number } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const code = q.get("invite");
    if (code && /^[A-Za-z0-9-]{4,40}$/.test(code)) {
      setReferral(code);
      if (q.get("rival") === "1") {
        fetch(`/api/rivals/invite?code=${encodeURIComponent(code)}`, { cache: "no-store" })
          .then((r) => (r.ok ? (r.json() as Promise<{ stableName: string; credits: number }>) : null))
          .then(setRival)
          .catch(() => undefined);
      }
    }
  }, []);

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

  // A new stable meets the head lad first (three short screens, skippable), then its horses.
  if (stage === "mentor" && state)
    return (
      <MentorWelcome
        onDone={() => {
          setStage("welcome");
          window.scrollTo({ top: 0 });
        }}
      />
    );
  if (stage === "welcome" && state) return <Welcome />;
  if ((state !== null && stage === "form" && !busy) || !silks) return <div className="min-h-[60vh]" aria-busy />;
  if (playtest && invite === null) return <InviteGate onAccepted={setInvite} />;

  const valid = NAME_RE.test(name.trim());
  async function register() {
    if (!valid || !silks || busy) return;
    setBusy(true);
    setError(null);
    try {
      const code = invite ?? referral;
      await createStable({ stableName: name.trim(), silks, ...(code ? { inviteCode: code } : {}), ...(rival && referral ? { rival: true, deviceId: deviceId() } : {}) });
      setStage("mentor");
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
        <header className="grid gap-2">
          {rival && (
            <p className="surface flex flex-wrap items-center gap-2 p-3 text-sm font-bold" data-testid="rival-banner">
              <span className="tag tag-live">Rival</span>
              <span className="min-w-0 flex-1">
                {rival.stableName} challenged you. Found your stable and you&apos;re rivals from day one: you both get {rival.credits} credits.
              </span>
            </p>
          )}
          <h1 className="t-page">Found your stable</h1>
          <p className="t-meta">
            {imported
              ? "We found your stable from the demo on this browser: its name and colours come with you. Horses and credits start fresh."
              : "We’ve picked a name and colours. Keep them or roll again, then meet your horses."}
          </p>
        </header>
        <div className="md:hidden">
          <SilksStand silks={silks} name={name} />
        </div>
        <div className="surface grid gap-4 p-4">
          <NameField name={name} onChange={setName} />
          <button type="button" className="btn btn-outline w-fit" onClick={() => setSilks(randomSilks())}>
            <PixelIcon name="dice" className="h-5 w-5" /> New colours
          </button>
        </div>
        <details className="surface group p-4 [&[open]>summary_.chev]:rotate-90">
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
        <p className="caption">
          {invite ? `Invite ${invite} accepted. ` : ""}Free. No email, no wallet. Your stable is linked to this browser.
        </p>
        <p className="caption">
          Already have a stable?{" "}
          <button
            type="button"
            className="link"
            data-testid="play-link-wallet"
            onClick={() => setWalletOpen((o) => !o)}
          >
            Sign in with your wallet
          </button>{" "}
          · or{" "}
          <Link href="/link" className="link" data-testid="play-link-device">
            link this device with a code
          </Link>
        </p>
        {walletOpen && (
          <div className="surface-2 p-3">
            <WalletSignIn create={{ stableName: name.trim(), silks, inviteCode: invite ?? referral }} />
          </div>
        )}
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
    <div className="mx-auto grid max-w-4xl gap-6">
      <header className="grid gap-1">
        <p className="eyebrow">
          <span className="whitespace-nowrap">Registered at Kestrel Downs ·</span>{" "}
          <span className="whitespace-nowrap">{formatCredits(state.credits)} credits ·</span>{" "}
          <span className="whitespace-nowrap">{state.entries.balance} Live entries</span>
        </p>
        <h1 className="t-page">{state.stableName}</h1>
        <p className="t-meta">
          {horses.length} horses have arrived. {h ? `${h.name} is fit and ready to race.` : ""} You can rename any of them before their first race.
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-3" aria-label="Your starter horses">
        {ordered.map((s, order) => (
          <StarterCard key={s.id} s={s} star={s.id === star?.id} order={order} />
        ))}
      </ul>

      {h && star && (
        <div className="frame-hero grid gap-3 p-4 sm:p-5">
          <p className="tag tag-ready w-fit">★ Your first race</p>
          <p className="t-hero">{h.name} runs as a {STYLE_LABEL[h.style].toLowerCase()}</p>
          <p className="t-meta">
            {pronoun(h.sex).he[0]!.toUpperCase() + pronoun(h.sex).he.slice(1)}{" "}
            {h.style === "front" ? "tries to lead all the way" : h.style === "closer" ? "saves energy and comes late" : "sits behind the leaders, then pounces"}. A free Story race against the Club; the gates
            open ten seconds after you tap.
          </p>
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-4">
            <ActionBar>
              <button type="button" className="btn btn-brass btn-lg" onClick={raceNow} disabled={busy} data-testid="race-now">
                <PixelIcon name="flag" size={32} className="-my-2" /> {busy ? "Going to the gates…" : `Race ${h.name} now`}
              </button>
            </ActionBar>
            <button type="button" className="btn btn-outline" onClick={() => entry.open(star.id)}>
              Change the plan
            </button>
            <Link href="/stable" className="btn btn-ghost">
              Walk into the stable
            </Link>
          </div>
        </div>
      )}
      {error !== null && <ErrorNote error={error} />}
      <StorageNote />
    </div>
  );
}

/** One starter in its stall: the door opens, the portrait at 1x, the name (rename before the first race). */
function StarterCard({ s, star, order }: { s: StableHorse; star: boolean; order: number }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.horse.name);
  const check = useHorseNameCheck(name, { horseId: s.id, current: s.horse.name });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/horses/${s.id}/rename`, { body: { name } });
      await refreshPlayer();
      setEditing(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className={`surface overflow-hidden ${star ? "is-selected" : ""}`} style={{ animation: `stall-open 360ms steps(6) ${order * 140}ms both` }} data-testid="starter">
      <Stall className="flex h-[148px] items-end justify-center">
        <HorsePortrait appearance={s.horse.appearance} scale={1} className="relative" />
        {star && <span className="tag tag-you absolute left-2 top-2">Ready to race</span>}
      </Stall>
      <div className="grid gap-1 p-3">
        {editing ? (
          <form className="grid gap-2" onSubmit={save}>
            <HorseNameInput id={`starter-${s.id}`} label={`Rename ${s.horse.name}`} value={name} onChange={setName} check={check} testId="starter-name-input" />
            <div className="flex gap-2">
              <button type="submit" className="btn btn-sm" disabled={busy || !name.trim() || (check !== null && !check.ok)} data-testid="starter-name-save">
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
            {error !== null && <ErrorNote error={error} />}
          </form>
        ) : (
          <>
            <Link href={`/horse/${s.id}`} className="t-title hover:underline">
              {s.horse.name}
            </Link>
            <p className="t-meta">
              {STYLE_LABEL[s.horse.style]} · {formatDistance(s.horse.preferredDistanceM)} · {SURFACE_LABEL[s.horse.preferredSurface]}
            </p>
            <p className="caption flex items-center justify-between gap-2">
              <span>{s.regNo}</span>
              <button type="button" className="link !text-[0.8125rem]" onClick={() => setEditing(true)} data-testid="starter-rename">
                Rename
              </button>
            </p>
          </>
        )}
      </div>
    </li>
  );
}

const INVITE_PROBLEM: Record<string, string> = {
  MISSING: "Enter the invite code from your invitation.",
  INVALID: "We don't recognise that code. Check it and try again (it looks like TB-XXXX-XXXX).",
  USED: "That code has already been used. Each invite works for one tester; ask us for another.",
  FULL: "The playtest is full right now. Thanks for your interest: we'll open more places soon.",
};

/** Closed playtest: invite only. The code is checked here and used when the stable is founded. */
function InviteGate({ onAccepted }: { onAccepted: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const autoTried = useRef(false);

  async function check(raw: string) {
    const c = raw.trim().toUpperCase();
    if (!c || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/invite?code=${encodeURIComponent(c)}`, { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; problem?: string };
      if (data.ok) onAccepted(c);
      else setProblem(INVITE_PROBLEM[data.problem ?? "INVALID"] ?? INVITE_PROBLEM.INVALID!);
    } catch {
      setProblem("Couldn't reach the track. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    const fromLink = new URLSearchParams(window.location.search).get("invite");
    if (fromLink) {
      setCode(fromLink);
      void check(fromLink);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <form
      className="mx-auto grid max-w-xl gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void check(code);
      }}
      data-testid="invite-gate"
    >
      <header>
        <p className="eyebrow">Closed playtest</p>
        <h1 className="t-display-xl">Invite only, for now</h1>
        <p className="mt-1 text-lg text-cream-dim">
          Post Time is in a small closed playtest. If you have an invite, enter your code to found your stable. Your feedback shapes the game.
        </p>
      </header>
      <label className="grid gap-1">
        <span className="font-extrabold">Invite code</span>
        <input
          className="field min-h-11 uppercase tracking-wider"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="TB-XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? "invite-problem" : undefined}
          data-testid="invite-code"
        />
      </label>
      {problem && (
        <p id="invite-problem" role="alert" className="font-bold text-negative" data-testid="invite-problem">
          {problem}
        </p>
      )}
      <ActionBar>
        <button type="submit" className="btn btn-brass btn-lg" disabled={!code.trim() || busy} data-testid="invite-continue">
          {busy ? "Checking…" : "Continue"}
        </button>
      </ActionBar>
      <p className="text-sm text-cream-dim">
        No invite yet? You can still{" "}
        <Link href="/races" className="font-bold underline decoration-2 underline-offset-4 hover:text-cream">
          watch the live races
        </Link>
        .
      </p>
    </form>
  );
}

