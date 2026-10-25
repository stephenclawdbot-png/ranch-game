"use client";

import { useEffect, useState } from "react";
import type { Silks as SilksT } from "@thoroughbred/shared";
import { PlayerGate } from "@/components/PlayerGate";
import { PixelIcon } from "@/components/icons";
import { NAME_RE, NameField, SilksEditor, SilksStand } from "@/components/onboarding/SilksEditor";
import { ActionBar } from "@/components/ui/ActionBar";
import { StorageNote } from "@/components/ui/StorageNote";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { signOut, updateProfile, type PlayerState } from "@/lib/player";
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
  const dirty = name.trim() !== state.stableName || JSON.stringify(silks) !== JSON.stringify(state.silks);
  const valid = NAME_RE.test(name.trim());

  useEffect(() => {
    if (dirty) setSaved(false);
  }, [dirty]);

  return (
    <div className="mx-auto grid max-w-4xl gap-8">
      <header>
        <h1 className="t-display-xl">Profile &amp; settings</h1>
        <p className="mt-1 text-lg text-cream-dim">Your stable&rsquo;s name and colours, and how the game looks on this device.</p>
      </header>

      <section className="grid gap-5 md:grid-cols-[1fr_16rem]" aria-labelledby="colours-h">
        <div className="grid content-start gap-5">
          <h2 id="colours-h" className="t-display-m">
            Name &amp; colours
          </h2>
          <NameField name={name} onChange={setName} />
          <SilksEditor silks={silks} onChange={setSilks} />
          <ActionBar>
            <button
              type="button"
              className="btn btn-brass btn-lg"
              disabled={!dirty || !valid || busy}
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
              <PixelIcon name="check" className="h-5 w-5" /> {busy ? "Saving…" : saved && !dirty ? "Saved" : "Save colours"}
            </button>
          </ActionBar>
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
        <h2 id="access-h" className="t-display-m">
          Display &amp; motion
        </h2>
        <div>
          <p className="mb-2 font-extrabold" id="text-size-l">
            Text size
          </p>
          <div className="segmented flex-wrap" role="group" aria-labelledby="text-size-l">
            {TEXT_SIZES.map((t) => (
              <button key={t.v} type="button" aria-pressed={settings.text === t.v} onClick={() => saveSettings({ text: t.v })}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 font-extrabold" id="motion-l">
            Motion
          </p>
          <p className="mb-2 text-sm text-cream-dim">
            Calm turns off celebrations, count-ups and other animation. Device setting follows your system&rsquo;s reduce-motion option.
          </p>
          <div className="segmented flex-wrap" role="group" aria-labelledby="motion-l">
            {MOTION.map((m) => (
              <button key={m.v} type="button" aria-pressed={settings.motion === m.v} onClick={() => saveSettings({ motion: m.v })}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3" aria-labelledby="save-h">
        <h2 id="save-h" className="t-display-m">
          Where your stable lives
        </h2>
        <StorageNote />
        <div>
          <button
            type="button"
            className="btn btn-oxblood"
            onClick={() => {
              if (window.confirm("Start over with a new stable? This browser forgets your current stable for good: there is no way back to it yet.")) {
                void signOut().then(() => window.location.assign("/play"));
              }
            }}
          >
            Start over with a new stable
          </button>
        </div>
      </section>
    </div>
  );
}

export default function MePage() {
  return <PlayerGate>{(state) => <Profile state={state} />}</PlayerGate>;
}
