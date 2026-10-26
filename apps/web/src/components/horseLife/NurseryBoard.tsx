"use client";

import Link from "next/link";
import { useState } from "react";
import type { NurseryFoal, NurseryView } from "@/lib/horseLife";
import { SEX_LABEL, formatCredits } from "@/lib/format";
import { HorsePortrait } from "../HorsePortrait";
import { PixelIcon } from "../icons";
import { ActionBar } from "../ui/ActionBar";
import { ErrorNote } from "../ui/ErrorNote";
import { HorseNameInput, useHorseNameCheck } from "../ui/HorseNameInput";
import { EmptyState, SceneBand } from "../ui/Page";
import { GrowthTrack, RangeList, useAction } from "./common";

function FoalCard({ f, view, action }: { f: NurseryFoal; view: NurseryView; action: ReturnType<typeof useAction> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(f.name);
  const check = useHorseNameCheck(name, { horseId: f.id, current: f.name });
  const base = `/api/horses/${f.id}`;
  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (await action.run(`rename:${f.id}`, `${base}/rename`, { body: { name } })) setEditing(false);
  }
  return (
    <li className="surface grid gap-3 p-3" data-testid="foal-card" data-horse-id={f.id}>
      <div className="flex items-center gap-3">
        <Link href={`/horse/${f.id}/care`} className="well grid place-items-center" aria-label={`${f.name}: care`}>
          <HorsePortrait appearance={f.horse.appearance} scale="thumb" />
        </Link>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form className="flex flex-wrap items-start gap-2" onSubmit={rename}>
              <HorseNameInput id={`name-${f.id}`} value={name} onChange={setName} check={check} testId="foal-name-input" className="min-w-0 max-w-[16rem] flex-1" />
              <button type="submit" className="btn btn-sm" disabled={action.busy !== null || !name.trim() || (check !== null && !check.ok)} data-testid="foal-name-save">
                Save
              </button>
            </form>
          ) : (
            <p className="flex items-center gap-2">
              <Link href={`/horse/${f.id}/care`} className="t-title break-words hover:underline">
                {f.name}
              </Link>
              <button type="button" className="btn-ghost min-h-11 text-sm font-bold" onClick={() => setEditing(true)} aria-label={`Name ${f.name}`} data-testid="foal-name">
                <PixelIcon name="pencil" className="h-4 w-4" />
              </button>
            </p>
          )}
          <p className="t-meta">{SEX_LABEL[f.horse.sex]}</p>
        </div>
        {f.care.caredToday ? (
          <span className="chip text-positive">✓ Cared today</span>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => action.run(`care:${f.id}`, `${base}/care`, { body: {} })} disabled={action.busy !== null} data-testid="foal-care">
            {action.busy === `care:${f.id}` ? "Caring…" : "Care"}
          </button>
        )}
      </div>
      {f.care.growth && <GrowthTrack growth={f.care.growth} compact />}
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-extrabold">Potential (revealed so far)</summary>
        <div className="grid gap-2 pt-1">
          <RangeList ranges={f.ranges} />
          <p className="caption">Ranges narrow at each stage and with every start{f.scanned ? "; scanned." : "."}</p>
          {!f.scanned && (
            <button
              type="button"
              className="btn btn-sm w-fit"
              onClick={() => action.run(`scan:${f.id}`, `${base}/scan`)}
              disabled={action.busy !== null || view.credits < view.scanCost}
              data-testid="foal-scan"
            >
              Pedigree Scan · {formatCredits(view.scanCost)} cr
            </button>
          )}
        </div>
      </details>
    </li>
  );
}

/** The nursery: foals grow only with care (5 / 7 / 7 sessions), then graduate to racing. */
export function NurseryBoard({ view }: { view: NurseryView }) {
  const action = useAction();
  const firstUncared = view.foals.find((f) => !f.care.caredToday);
  const { stalls } = view;
  return (
    <div className="grid gap-6">
      <SceneBand
        scene="barn"
        alt="The foaling barn"
        eyebrow={
          <span data-testid="nursery-stalls">
            {stalls.used} of {stalls.slots} stalls · {stalls.overflow ? "overflow slot in use" : `${stalls.overflowSlots} overflow slot free`}
          </span>
        }
        title="Nursery"
      />

      {view.graduates.length > 0 && (
        <section aria-labelledby="grad-h" className="grid gap-2">
          <h2 id="grad-h" className="t-h2">
            Ready to race
          </h2>
          <ul className="grid gap-2">
            {view.graduates.map((g) => (
              <li key={g.id} className="surface flex flex-wrap items-center gap-3 p-3" data-testid="graduate-card">
                <span className="well grid place-items-center">
                  <HorsePortrait appearance={g.horse.appearance} scale="thumb" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="t-title">{g.name}</p>
                  <p className="text-sm text-positive">✓ Grown up: 19 care sessions done.</p>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => action.run(`grad:${g.id}`, `/api/horses/${g.id}/graduate`)} disabled={action.busy !== null} data-testid="graduate">
                  Welcome to the yard
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="foals-h" className="grid gap-2">
        <h2 id="foals-h" className="t-h2">
          Foals
        </h2>
        {view.foals.length === 0 ? (
          <EmptyState
            icon="star"
            testId="nursery-empty"
            title="No foals right now"
            text="Foals arrive from Paddock Packs and your own mares, and grow with one care session a day."
            action={
              <div className="flex flex-wrap gap-2">
                <Link href="/packs" className="btn btn-sm" data-testid="nursery-to-packs">
                  Open a Paddock Pack
                </Link>
                <Link href="/breeding" className="btn btn-outline btn-sm">
                  Breeding barn
                </Link>
              </div>
            }
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {view.foals.map((f) => (
              <FoalCard key={f.id} f={f} view={view} action={action} />
            ))}
          </ul>
        )}
        <p className="caption">Missed days just pause growth. Nothing is lost while you&rsquo;re away.</p>
      </section>

      {action.error != null && action.busy === null && <ErrorNote error={action.error} />}

      {view.stableHand && view.uncared > 0 ? (
        <ActionBar>
          <button type="button" className="btn btn-brass btn-lg" onClick={() => action.run("all", "/api/nursery/care-all")} disabled={action.busy !== null} data-testid="care-all">
            <PixelIcon name="horseshoe" size={32} className="-my-2" /> {action.busy === "all" ? "Caring…" : `Care for all (${view.uncared})`}
          </button>
        </ActionBar>
      ) : firstUncared ? (
        <ActionBar>
          <button
            type="button"
            className="btn btn-brass btn-lg"
            onClick={() => action.run(`care:${firstUncared.id}`, `/api/horses/${firstUncared.id}/care`, { body: {} })}
            disabled={action.busy !== null}
            data-testid="care-next"
          >
            <PixelIcon name="horseshoe" size={32} className="-my-2" /> Care for {firstUncared.name}
          </button>
        </ActionBar>
      ) : null}

      {!view.stableHand && (
        <p className="text-sm text-cream-dim">
          Tip: a{" "}
          <Link href="/facilities" className="font-bold underline decoration-2 underline-offset-4">
            stable hand
          </Link>{" "}
          cares for every horse in one tap.
        </p>
      )}
    </div>
  );
}
