"use client";
/**
 * Breeding barn (game-design §7, §4a): mares in foal with their 24 h countdown and the
 * foaling reveal; plan a cover (your mare × your stallion or a stud) with the exact preview
 * before you pay; and the stud book (stand your stallion, browse studs).
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { ActionBar } from "@/components/ui/ActionBar";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { HowItWorks, SceneBand } from "@/components/ui/Page";
import { HorseNameInput, useHorseNameCheck } from "@/components/ui/HorseNameInput";
import { PixelIcon } from "@/components/icons";
import { useNow } from "@/lib/clock";
import { formatCountdown, formatCredits, shortHash } from "@/lib/format";
import type { BreedingHorse, BreedingView, EcoHorse, PregnancyCard, PreviewView, StudView } from "@/lib/economyTypes";
import { api } from "@/lib/player";
import { BreedingPreviewPanel } from "./BreedingPreviewPanel";
import { FoalReveal } from "./FoalReveal";
import { Credits, HorseLine, Skeleton, newKey, refreshPurse, useEcoView } from "./kit";

type Tab = "barn" | "studs";

export function BreedingBarn() {
  const { data, setData, error, reload } = useEcoView<BreedingView>("/api/breeding");
  const [tab, setTab] = useState<Tab>("barn");
  useEffect(() => {
    const fromHash = () => {
      if (window.location.hash === "#studs") setTab("studs");
      else if (window.location.hash === "#barn") setTab("barn");
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  const v = data;
  return (
    <div className="grid gap-5">
      <SceneBand scene="barn" alt="The breeding barn" eyebrow={`Season ${v.season} · ${formatCredits(v.credits)} credits`} title="Breeding" />
      <HowItWorks className="-mt-2">
        <p>
          Each mare can be covered once a season, and every horse has {v.lifetime} breedings for life. Horses breed from {v.minStarts} starts, or once retired from racing.
        </p>
        <p>The foal&rsquo;s genes are sealed at the cover and revealed when it is born, 24 hours later. It goes to your nursery.</p>
      </HowItWorks>
      <div className="tabs baize-scope -mx-[var(--gutter)] !px-[var(--gutter)]" role="tablist" aria-label="Breeding">
        <button type="button" role="tab" aria-selected={tab === "barn"} onClick={() => setTab("barn")} data-testid="tab-barn">
          Barn
        </button>
        <button type="button" role="tab" aria-selected={tab === "studs"} onClick={() => setTab("studs")} data-testid="tab-studs">
          Stud book
        </button>
      </div>
      {tab === "barn" ? <Barn v={v} onView={setData} reload={reload} /> : <StudBook v={v} onView={setData} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barn: pregnancies + plan a cover
// ---------------------------------------------------------------------------

function Barn({ v, onView, reload }: { v: BreedingView; onView: (v: BreedingView) => void; reload: () => Promise<void> }) {
  return (
    <>
      {v.pregnancies.length > 0 && (
        <section aria-labelledby="foal-h">
          <SectionHeader id="foal-h" title="In foal" />
          <ul className="grid gap-3">
            {v.pregnancies.map((p) => (
              <PregnancyRow key={p.id} p={p} skewMs={v.serverNowMs - Date.now()} onChanged={reload} />
            ))}
          </ul>
        </section>
      )}
      <PlanCover v={v} onView={onView} />
    </>
  );
}

const SEEN_KEY = "thoroughbred:foals-seen";
function seenFoals(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function markSeen(id: string) {
  try {
    const s = seenFoals();
    s.add(id);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-50)));
  } catch {
    /* only a convenience */
  }
}

function PregnancyRow({ p, skewMs, onChanged }: { p: PregnancyCard; skewMs: number; onChanged: () => Promise<void> }) {
  const now = useNow(1000);
  const [name, setName] = useState("");
  const nameCheck = useHorseNameCheck(name, { allowBlank: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reveal, setReveal] = useState<EcoHorse | null>(null);
  const remaining = now === null ? null : p.dueAtMs - (now + skewMs);
  const due = remaining !== null && remaining <= 0;
  const progress = now === null ? 0 : Math.min(1, Math.max(0, (now + skewMs - p.conceivedAtMs) / (p.dueAtMs - p.conceivedAtMs)));

  // A foal that arrived while you were away (overnight maintenance) still gets its reveal once.
  useEffect(() => {
    if (p.status === "foaled" && p.foal && !seenFoals().has(p.foal.id)) setReveal(p.foal);
  }, [p]);

  async function foal() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ foal: EcoHorse }>("/api/breeding/foal", { body: { pregnancyId: p.id, ...(name.trim() ? { name: name.trim() } : {}) } });
      setReveal(r.foal);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="surface grid gap-3 p-3" data-testid="pregnancy">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="t-title">
          {p.damName} <span className="text-cream-dim">×</span> {p.sireName}
        </p>
        <span className="chip" title={`Inheritance seed sealed at covering: ${p.seedCommitment}`}>
          🔒 Sealed {shortHash(p.seedCommitment, 8)}
        </span>
      </div>
      {p.status === "carrying" ? (
        <>
          <div className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="label">{due ? "Ready to foal" : "Foal due in"}</span>
              {!due && (
                <span className="score text-[1.875rem] text-cream" suppressHydrationWarning data-testid="due-countdown">
                  {remaining === null ? "–:––:––" : formatCountdown(remaining)}
                </span>
              )}
            </div>
            <span className="block h-3 bg-[#050b08] p-[2px]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Pregnancy">
              <span className="block h-full bg-brass" style={{ width: `${progress * 100}%` }} />
            </span>
            {p.coiPermille >= 62 && <p className="caption text-negative">Inbred pairing (COI {(p.coiPermille / 10).toFixed(1)}%).</p>}
          </div>
          {due && (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <HorseNameInput
                id={`foal-name-${p.id}`}
                label="Name the foal (optional)"
                showLabel
                value={name}
                onChange={setName}
                check={nameCheck}
                placeholder="Leave blank for a Club name"
                testId="foal-name"
              />
              <button type="button" className="btn btn-brass" onClick={foal} disabled={busy || (nameCheck !== null && !nameCheck.ok)} data-testid="foal-now">
                {busy ? "Foaling…" : "Welcome the foal"}
              </button>
            </div>
          )}
        </>
      ) : p.foal ? (
        <div className="grid gap-2">
          <HorseLine h={p.foal} meta={<>Born {new Date(p.dueAtMs).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · in the nursery</>} />
          <p className="caption">
            Seed revealed {p.seed ? shortHash(p.seed, 8) : "–"}: its fingerprint matches the seal, so the foal's genes were fixed at covering.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/nursery" className="btn btn-sm">
              Go to the nursery
            </Link>
            {p.foal.starts === 0 && <RenameFoal foal={p.foal} onDone={onChanged} />}
          </div>
        </div>
      ) : null}
      {error ? <ErrorNote error={error} /> : null}
      {reveal && (
        <FoalReveal
          foal={reveal}
          eyebrow={`${p.damName} has foaled`}
          note={<p className="t-meta">Sire {p.sireName} · Dam {p.damName}</p>}
          onClose={() => {
            markSeen(reveal.id);
            setReveal(null);
            void onChanged();
          }}
        >
          <Link href="/nursery" className="btn btn-brass btn-block" onClick={() => markSeen(reveal.id)}>
            See the foal in the nursery
          </Link>
          <button
            type="button"
            className="btn btn-block"
            onClick={() => {
              markSeen(reveal.id);
              setReveal(null);
              void onChanged();
            }}
          >
            Back to the barn
          </button>
        </FoalReveal>
      )}
    </li>
  );
}

function RenameFoal({ foal, onDone }: { foal: EcoHorse; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(foal.horse.name);
  const check = useHorseNameCheck(name, { horseId: foal.id, current: foal.horse.name });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
        <PixelIcon name="pencil" className="h-4 w-4" /> Rename
      </button>
    );
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/breeding/foal", { method: "PATCH", body: { horseId: foal.id, name: name.trim() } });
      setOpen(false);
      await onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid w-full gap-2 sm:grid-cols-[1fr_auto]">
      <HorseNameInput id={`rename-${foal.id}`} label="Foal name" value={name} onChange={setName} check={check} />
      <button type="button" className="btn self-start" onClick={save} disabled={busy || !name.trim() || (check !== null && !check.ok)}>
        Save name
      </button>
      {error ? <ErrorNote error={error} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan a cover
// ---------------------------------------------------------------------------

type SireSource = "own" | "stud";

function eligibilityChip(h: { block: string | null; reason: string | null }) {
  return h.block === null ? (
    <span className="text-sm font-extrabold text-positive">✓ Can breed</span>
  ) : (
    <span className="text-sm font-bold text-cream-dim">✗ {h.reason}</span>
  );
}

function PickList<T extends EcoHorse & { block: string | null; reason: string | null }>({
  items,
  selected,
  onPick,
  name,
  extra,
  testid,
}: {
  items: T[];
  selected: string | null;
  onPick: (id: string) => void;
  name: string;
  extra?: (h: T) => React.ReactNode;
  testid: string;
}) {
  return (
    <ul className="grid gap-2" role="radiogroup" aria-label={name}>
      {items.map((h) => {
        const on = h.id === selected;
        return (
          <li key={h.id}>
            <button
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(h.id)}
              className={`surface-2 w-full p-3 text-left ${on ? "picked" : ""}`}
              data-testid={testid}
              data-eligible={h.block === null}
            >
              <HorseLine h={h} link={false} aside={on ? <span className="tag tag-ready">✓ Picked</span> : undefined} />
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 pl-1">
                {eligibilityChip(h)}
                {extra?.(h)}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PlanCover({ v, onView }: { v: BreedingView; onView: (v: BreedingView) => void }) {
  const [damId, setDamId] = useState<string | null>(null);
  const [source, setSource] = useState<SireSource>(v.stallions.length ? "own" : "stud");
  const [sireId, setSireId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [coverError, setCoverError] = useState<unknown>(null);
  const [covered, setCovered] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Default picks: the first eligible mare and sire.
  useEffect(() => {
    if (!damId && v.mares.length) setDamId((v.mares.find((m) => m.block === null) ?? v.mares[0]!).id);
  }, [v.mares, damId]);
  const sires: (BreedingHorse | StudView)[] = source === "own" ? v.stallions : v.studs;
  useEffect(() => {
    if (sireId && sires.some((s) => s.id === sireId)) return;
    setSireId(sires.length ? (sires.find((s) => s.block === null) ?? sires[0]!).id : null);
  }, [source, sires, sireId]);

  useEffect(() => {
    setPreview(null);
    setConfirming(false);
    setKey(newKey());
    if (!damId || !sireId) return;
    let live = true;
    setLoading(true);
    setPreviewError(null);
    api<PreviewView>("/api/breeding/preview", { body: { sireId, damId } })
      .then((p) => live && setPreview(p))
      .catch((e) => live && setPreviewError(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [damId, sireId, tick]);

  const dam = v.mares.find((m) => m.id === damId);
  const sire = sires.find((s) => s.id === sireId);
  const total = preview?.fees.totalPaidByMareOwner ?? 0;
  const canAfford = (preview?.credits ?? v.credits) >= total;
  const ready = !!preview && preview.block === null && canAfford;

  async function confirmCover() {
    if (!preview) return;
    setBusy(true);
    setCoverError(null);
    try {
      const r = await api<{ view: BreedingView }>("/api/breeding", { body: { sireId: preview.sireId, damId: preview.damId, key } });
      setCovered(`${preview.damName} is in foal to ${preview.sireName}. The foal arrives in 24 hours.`);
      onView(r.view);
      setConfirming(false);
      setTick((t) => t + 1);
      refreshPurse();
    } catch (e) {
      setCoverError(e);
    } finally {
      setBusy(false);
    }
  }

  const blockedEverywhere = useMemo(() => v.mares.length > 0 && v.mares.every((m) => m.block !== null), [v.mares]);

  return (
    <section aria-labelledby="plan-h" className="grid gap-4">
      <SectionHeader id="plan-h" title="Plan a cover" />
      {covered && (
        <p className="surface-2 p-3 font-bold text-positive" role="status" data-testid="covered">
          ✓ {covered}
        </p>
      )}
      {v.mares.length === 0 ? (
        <div className="surface grid gap-2 p-4">
          <p className="text-cream-dim">No mares in your stable yet. Fillies grow into broodmares: they breed from {v.minStarts} starts, or once made a broodmare.</p>
          <Link href="/packs" className="btn w-fit">
            Find a foal in a pack
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="grid content-start gap-4">
            <div>
              <h3 className="label mb-2">1 · Your mare</h3>
              {blockedEverywhere && <p className="caption mb-2">None of your mares can be covered right now; you can still preview any pairing.</p>}
              <PickList items={v.mares} selected={damId} onPick={setDamId} name="Mare" testid="pick-mare" />
            </div>
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="label">2 · The stallion</h3>
                <div className="segmented" role="group" aria-label="Stallion source">
                  <button type="button" aria-pressed={source === "own"} onClick={() => setSource("own")}>
                    Yours ({v.stallions.length})
                  </button>
                  <button type="button" aria-pressed={source === "stud"} onClick={() => setSource("stud")} data-testid="source-stud">
                    At stud ({v.studs.length})
                  </button>
                </div>
              </div>
              {sires.length === 0 ? (
                <p className="surface p-3 text-cream-dim">
                  {source === "own" ? "No stallions of your own. Try the stud book." : "No stallions standing at stud yet. Owners list them from the Stud book tab."}
                </p>
              ) : (
                <PickList
                  items={sires}
                  selected={sireId}
                  onPick={setSireId}
                  name="Stallion"
                  testid="pick-sire"
                  extra={(h) =>
                    "stableName" in h ? (
                      <span className="text-sm text-cream-dim">
                        {h.stableName} · fee <span className="num text-cream">{formatCredits(h.studFee)}</span>
                      </span>
                    ) : null
                  }
                />
              )}
            </div>
          </div>

          <div className="grid content-start gap-3">
            <h3 className="label">3 · Preview {dam && sire ? `· ${dam.horse.name} × ${sire.horse.name}` : ""}</h3>
            {loading && !preview && <Skeleton rows={2} />}
            {previewError ? <ErrorNote error={previewError} /> : null}
            {preview && (
              <div className="surface grid gap-4 p-3">
                <div className="surface-2 grid gap-2 p-3" data-testid="cover-eligibility">
                  {preview.block ? (
                    <>
                      <p className="font-bold">
                        <span className="text-negative">✗</span> Not yet: {preview.reason}
                      </p>
                      {dam && dam.starts < v.minStarts && dam.block !== null && (
                        <div className="grid gap-1">
                          <span className="meter" aria-hidden>
                            <span style={{ width: `${Math.min(100, (dam.starts / v.minStarts) * 100)}%` }} />
                          </span>
                          <span className="caption">
                            {dam.horse.name}: {dam.starts} of {v.minStarts} starts. Eligible from start {v.minStarts}, or once retired.
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="font-bold text-positive">✓ Both horses can breed now.</p>
                  )}
                </div>
                <BreedingPreviewPanel v={preview} />
                {coverError ? <ErrorNote error={coverError} /> : null}
                {confirming ? (
                  <div className="paper grid gap-2 p-3" role="alertdialog" aria-labelledby="confirm-cover">
                    <p id="confirm-cover" className="font-extrabold">
                      Cover {preview.damName} with {preview.sireName} for {formatCredits(total)} credits?
                    </p>
                    <p className="text-sm">The foal is due in 24 hours and goes to your nursery. This uses one of each horse&apos;s {v.lifetime} lifetime breedings.</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn btn-brass" onClick={confirmCover} disabled={busy} data-testid="cover-confirm">
                        {busy ? "Covering…" : `Confirm · ${formatCredits(total)}`}
                      </button>
                      <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>
                        Not now
                      </button>
                    </div>
                  </div>
                ) : ready ? (
                  <ActionBar>
                    <button type="button" className="btn btn-brass btn-lg" onClick={() => setConfirming(true)} data-testid="cover">
                      Cover for {formatCredits(total)}
                    </button>
                  </ActionBar>
                ) : !preview.block && !canAfford ? (
                  <p className="t-meta font-bold">This cover costs {formatCredits(total)} credits: a few more races and it&rsquo;s yours.</p>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stud book
// ---------------------------------------------------------------------------

function StudBook({ v, onView }: { v: BreedingView; onView: (v: BreedingView) => void }) {
  return (
    <div className="grid gap-5">
      <section aria-labelledby="mine-h">
        <SectionHeader id="mine-h" title="Your stallions" />
        <p className="t-meta mb-2">
          Stand a stallion at stud and other stables can book him. You set the fee; the Club keeps 10% of it (burned) and you get the rest. Breeding still needs {v.minStarts} starts or
          retirement, and every horse has {v.lifetime} breedings for life.
        </p>
        {v.stallions.length === 0 ? (
          <p className="surface p-3 text-cream-dim">No entire stallions in your stable.</p>
        ) : (
          <ul className="grid gap-2">
            {v.stallions.map((s) => (
              <StudForm key={s.id} s={s} baseFee={v.baseFee} onView={onView} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="studs-h">
        <SectionHeader id="studs-h" title="Standing at stud" />
        {v.studs.length === 0 ? (
          <p className="surface p-3 text-cream-dim">No stallions are standing at stud right now. Check back soon: the Club keeps a few of its own at stud.</p>
        ) : (
          <ul className="surface rows !p-0">
            {v.studs.map((s) => (
              <li key={s.id} className="grid gap-1 p-3" data-testid="stud-row">
                <HorseLine
                  h={s}
                  meta={
                    <>
                      {s.club ? "Club stallion" : s.stableName} · {s.club ? "at stud" : `${s.starts} starts`} · {s.lifetime - s.used} of {s.lifetime} breedings left
                    </>
                  }
                  aside={<Credits value={s.studFee} className="text-cream" />}
                />
                <div className="pl-1">{eligibilityChip(s)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StudForm({ s, baseFee, onView }: { s: BreedingHorse; baseFee: number; onView: (v: BreedingView) => void }) {
  const [fee, setFee] = useState(String(s.studFee ?? 800));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const n = Number(fee);
  const valid = fee.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 100_000;
  async function save(next: number | null) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const r = await api<{ view: BreedingView }>("/api/studs", { body: { horseId: s.id, fee: next } });
      onView(r.view);
      setSaved(next === null ? "Withdrawn from stud." : `Standing at stud for ${formatCredits(next)}.`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="surface grid gap-2 p-3" data-testid="my-stallion">
      <HorseLine
        h={s}
        meta={
          <>
            {s.starts} starts · {s.used}/{s.lifetime} breedings used · {s.studFee === null ? "not at stud" : `at stud for ${formatCredits(s.studFee)}`}
          </>
        }
      />
      <div className="pl-1">{eligibilityChip(s)}</div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="label">Stud fee (credits)</span>
          <input className="field w-36" inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^0-9]/g, ""))} data-testid="stud-fee" />
        </label>
        <button type="button" className="btn" onClick={() => save(n)} disabled={busy || !valid} data-testid="stud-save">
          {s.studFee === null ? "Stand at stud" : "Update fee"}
        </button>
        {s.studFee !== null && (
          <button type="button" className="btn btn-ghost" onClick={() => save(null)} disabled={busy}>
            Withdraw
          </button>
        )}
      </div>
      {valid && n > 0 && (
        <p className="caption">
          Per cover you receive {formatCredits(n - Math.floor(n / 10))}; {formatCredits(Math.floor(n / 10))} is burned. The mare&apos;s owner also pays the {formatCredits(baseFee)} base fee.
        </p>
      )}
      {saved && (
        <p className="text-sm font-bold text-positive" role="status">
          ✓ {saved}
        </p>
      )}
      {error ? <ErrorNote error={error} /> : null}
    </li>
  );
}
