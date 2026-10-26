"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Silks as SilksT } from "@thoroughbred/shared";
import { PlayerGate } from "@/components/PlayerGate";
import { WalletLink, useWalletStatus } from "@/components/chain/WalletLink";
import { WalletSignIn } from "@/components/chain/WalletSignIn";
import { disconnectWallet } from "@/components/chain/useWallet";
import { shortAddress } from "@/lib/chain/format";
import { FeedbackButton } from "@/components/playtest/FeedbackButton";
import { PageHeader } from "@/components/ui/Page";
import { PixelIcon } from "@/components/icons";
import { Countdown, Digits } from "@/components/Countdown";
import { NAME_RE, NameField, SilksEditor, SilksStand } from "@/components/onboarding/SilksEditor";
import { ActionBar } from "@/components/ui/ActionBar";
import { StorageNote } from "@/components/ui/StorageNote";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { api, signOut, updateProfile, type PlayerState } from "@/lib/player";
import { saveSettings, useSettings, type MotionPref, type TextSize } from "@/lib/settings";

const TEXT_SIZES: { v: TextSize; label: string }[] = [
  { v: "90", label: "Small" },
  { v: "100", label: "Default" },
  { v: "115", label: "Large" },
  { v: "130", label: "Larger" },
];
const MOTION: { v: MotionPref; label: string }[] = [
  { v: "system", label: "Device setting" },
  { v: "reduce", label: "Calm" },
  { v: "full", label: "Full" },
];

function Profile({ state }: { state: PlayerState }) {
  const [name, setName] = useState(state.stableName);
  const [silks, setSilks] = useState<SilksT>(state.silks);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const settings = useSettings();
  const wallet = useWalletStatus();
  const dirty = name.trim() !== state.stableName || JSON.stringify(silks) !== JSON.stringify(state.silks);
  const valid = NAME_RE.test(name.trim());

  useEffect(() => {
    if (dirty) setSaved(false);
  }, [dirty]);

  return (
    <div className="mx-auto grid max-w-4xl gap-8">
      <PageHeader eyebrow={state.stableName} title="Profile" meta="Your stable's name and colours, and how the game looks on this device." />

      <section className="grid gap-5 md:grid-cols-[1fr_16rem]" aria-labelledby="colours-h">
        <div className="surface grid content-start gap-5 p-4">
          <h2 id="colours-h" className="t-h2">
            Name &amp; colours
          </h2>
          <NameField name={name} onChange={setName} />
          <SilksEditor silks={silks} onChange={setSilks} />
          {dirty ? (
            <ActionBar>
              <button
                type="button"
                className="btn btn-brass btn-lg"
                disabled={!valid || busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await updateProfile({ stableName: name.trim(), silks });
                    setSaved(true);
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <PixelIcon name="check" className="h-5 w-5" /> {busy ? "Saving…" : "Save colours"}
              </button>
            </ActionBar>
          ) : (
            <p className="t-meta">{saved ? "✓ Saved." : "Change the name or colours to save them."}</p>
          )}
          {error !== null && <ErrorNote error={error} />}
          <p className="sr-only" role="status">
            {saved && !dirty ? "Saved" : ""}
          </p>
        </div>
        <div className="order-first md:order-none">
          <SilksStand silks={silks} name={name} caption="Registered colours" />
        </div>
      </section>

      <section className="surface grid gap-5 p-4" aria-labelledby="access-h">
        <h2 id="access-h" className="t-h2">
          Display &amp; motion
        </h2>
        <div>
          <p className="mb-1 font-extrabold" id="text-size-l">
            Text size
          </p>
          <div className="segmented" role="group" aria-labelledby="text-size-l">
            {TEXT_SIZES.map((t) => (
              <button key={t.v} type="button" aria-pressed={settings.text === t.v} onClick={() => saveSettings({ text: t.v })}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="font-extrabold" id="motion-l">
            Motion
          </p>
          <p className="t-meta mb-1">Calm turns off celebrations and count-ups. Device setting follows your system.</p>
          <div className="segmented" role="group" aria-labelledby="motion-l">
            {MOTION.map((m) => (
              <button key={m.v} type="button" aria-pressed={settings.motion === m.v} onClick={() => saveSettings({ motion: m.v })}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="surface grid gap-3 p-4" aria-labelledby="save-h">
        <h2 id="save-h" className="t-h2">
          Where your stable lives
        </h2>
        <StorageNote />
        <StartOver />
      </section>

      <LinkDeviceCard />

      <section className="surface grid gap-2 p-4" aria-labelledby="fb-h">
        <h2 id="fb-h" className="t-h2">
          Feedback
        </h2>
        <p className="t-meta">Found a bug, or have an idea? It goes straight to the team, with the page you were on.</p>
        <FeedbackButton variant="button" />
      </section>

      <details className="surface group p-4" open={!!wallet.status?.address || state.tester} data-testid="me-wallet">
        <summary className="flex min-h-11 items-center justify-between gap-2">
          <span className="t-h2">Beta &amp; wallet</span>
          <span aria-hidden className="chev group-open:rotate-90">
            ›
          </span>
        </summary>
        <div className="mt-3 grid gap-4">
          {state.tester && (
            <Link href="/beta" className="surface-2 flex items-center gap-3 p-3" data-testid="me-beta-link">
              <PixelIcon name="rosette" size={32} />
              <span className="min-w-0 flex-1">
                <span className="t-title block">Playtester: your beta</span>
                <span className="t-meta block">Progress, tester bonuses and your tester item.</span>
              </span>
              <span aria-hidden className="chev">
                ›
              </span>
            </Link>
          )}
          <p className="t-meta">Optional, for the closed beta. The game never needs a wallet.</p>
          {wallet.status?.loginAddress ? (
            <p className="t-meta" data-testid="me-login-wallet">
              Sign-in wallet: <span className="font-mono text-cream">{shortAddress(wallet.status.loginAddress)}</span>. Use this wallet to sign in on other
              devices.
            </p>
          ) : (
            <div className="grid gap-2" data-testid="me-login-wallet">
              <p className="t-meta">Link a wallet to sign in on other devices (free signature).</p>
              <WalletSignIn label="Link a wallet for sign-in" onLinked={() => void wallet.reload()} />
            </div>
          )}
          <WalletLink />
          <p className="flex flex-wrap gap-4">
            <Link href="/pool" className="link" data-testid="me-pool-link">
              Prize Pool
            </Link>
            <Link href="/invite" className="link" data-testid="me-invite-link">
              Invite friends
            </Link>
          </p>
        </div>
      </details>
    </div>
  );
}

interface DeviceEntry {
  id: string;
  label: string;
  createdAtMs: number;
  lastSeenAtMs: number;
  current: boolean;
}

/** "Play on another device": a one-time code for the other device, plus the linked-device list. */
function LinkDeviceCard() {
  const [code, setCode] = useState<{ code: string; expiresAtMs: number } | null>(null);
  const [devices, setDevices] = useState<{ devices: DeviceEntry[]; original: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const loadDevices = useCallback(async () => {
    try {
      const res = await fetch("/api/account/devices", { cache: "no-store" });
      if (res.ok) setDevices((await res.json()) as { devices: DeviceEntry[]; original: boolean });
    } catch {
      /* the list is a convenience; the card still works without it */
    }
  }, []);
  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  async function getCode() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setCode(await api<{ code: string; expiresAtMs: number }>("/api/account/link-code"));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/account/devices/${id}`, { method: "DELETE" });
      await loadDevices();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const when = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <section className="surface grid gap-3 p-4" aria-labelledby="link-device-h" data-testid="link-device">
      <h2 id="link-device-h" className="t-h2">
        Play on another device
      </h2>
      <p className="t-meta">Moving phones or switching browsers? Take the stable with you: get a code here and type it in on the other device.</p>
      {code ? (
        <div className="surface-2 grid gap-2 p-3">
          <p className="label">Your link code</p>
          <Digits text={code.code} className="text-3xl sm:text-4xl" />
          <p className="t-meta" data-testid="link-code-expiry">
            Valid for <Countdown targetMs={code.expiresAtMs} animate doneLabel="expired" /> · one use only
          </p>
          <p className="t-meta">On the other device open Post Time at /link and enter this code.</p>
        </div>
      ) : (
        <p className="t-meta">The code works for ten minutes and can be used once. Getting a new code cancels the old one.</p>
      )}
      <ActionBar>
        <button type="button" className="btn btn-brass" disabled={busy} onClick={() => void getCode()} data-testid="get-link-code">
          <PixelIcon name="horseshoe" className="h-5 w-5" /> {busy ? "Making a code…" : code ? "New code" : "Get a link code"}
        </button>
      </ActionBar>
      {error !== null && <ErrorNote error={error} />}

      {devices && (devices.original || devices.devices.length > 0) && (
        <div className="grid gap-2" data-testid="device-list">
          <p className="font-extrabold">Devices playing this stable</p>
          <ul className="grid gap-2">
            {devices.original && (
              <li className="surface-2 flex items-center justify-between gap-2 p-3">
                <span className="min-w-0">
                  <span className="t-title block">Where it was founded</span>
                  <span className="t-meta block">This browser&rsquo;s original sign-in</span>
                </span>
                <span className="tag tag-you shrink-0">This device</span>
              </li>
            )}
            {devices.devices.map((d) => (
              <li key={d.id} className="surface-2 flex items-center justify-between gap-2 p-3" data-testid="linked-device">
                <span className="min-w-0">
                  <span className="t-title block truncate">{d.label}</span>
                  <span className="t-meta block">
                    Linked {when(d.createdAtMs)} · last seen {when(d.lastSeenAtMs)}
                  </span>
                </span>
                {d.current ? (
                  <span className="tag tag-you shrink-0">This device</span>
                ) : (
                  <button type="button" className="btn btn-ghost btn-danger-text btn-sm shrink-0" disabled={busy} onClick={() => void remove(d.id)} data-testid="remove-device">
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {devices.original && devices.devices.length === 0 && <p className="t-meta">No other devices yet.</p>}
        </div>
      )}
    </section>
  );
}

/** "Start over": a quiet text button with a typed confirm (destructive actions never shout). */
function StartOver() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  if (!open)
    return (
      <button type="button" className="btn btn-ghost btn-danger-text w-fit !px-0" onClick={() => setOpen(true)} data-testid="start-over">
        Start over with a new stable…
      </button>
    );
  return (
    <div className="surface-2 grid gap-2 p-3" role="alertdialog" aria-label="Start over">
      <p className="font-extrabold">This browser forgets your current stable for good.</p>
      <p className="t-meta">There is no way back to it yet. Type START OVER to confirm.</p>
      <input className="field max-w-xs" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type START OVER" data-testid="start-over-input" />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-oxblood"
          disabled={typed.trim().toUpperCase() !== "START OVER"}
          onClick={() => {
            disconnectWallet(); // drops a WalletConnect session too, so the QR sheet starts clean
            void signOut().then(() => window.location.assign("/play"));
          }}
          data-testid="start-over-confirm"
        >
          Start over
        </button>
        <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
          Keep my stable
        </button>
      </div>
    </div>
  );
}

export default function MePage() {
  return <PlayerGate>{(state) => <Profile state={state} />}</PlayerGate>;
}
