"use client";
/**
 * Breeding barn (game-design §7, §4a): mares in foal with their 24 h countdown and the
 * foaling reveal; plan a cover (your mare × your stallion or a stud) with the preview before you
 * pay (possible looks and an outlook in words: still a chance); the stallion finder (every
 * available stallion for a mare with that same outlook and one possible look); and the stud
 * book (stand your stallion, browse studs).
 *
 * USDG stud fees (docs/usdg-market.md): a stallion registered for the USDG market may stand for a
 * USDG fee instead of credits. Covering a mare with him is booked here ("Pay N USDG to <owner>"),
 * paid from the wallet with the USDG pay widget (simulated on the mock chain), and the covering
 * happens once the payment is verified.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usdgFromDecimal } from "@thoroughbred/game-core";
import { UsdgPay } from "@/components/chain/UsdgPay";
import { formatUsdgDollars, formatUsdgToken, type UsdgOrderJson } from "@/lib/chain/usdg";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { ActionBar } from "@/components/ui/ActionBar";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { HowItWorks, SceneBand } from "@/components/ui/Page";
import { HorseNameInput, useHorseNameCheck } from "@/components/ui/HorseNameInput";
import { PixelIcon } from "@/components/icons";
import { useNow } from "@/lib/clock";
import { formatCountdown, formatCredits, shortHash } from "@/lib/format";
import type { BreedingHorse, BreedingView, EcoHorse, PregnancyCard, PreviewView, StudFinderRow, StudFinderView, StudView } from "@/lib/economyTypes";
import { api } from "@/lib/player";
import { BreedingPreviewPanel, OUTLOOK_TONE, nickColor } from "./BreedingPreviewPanel";
import { LazyPortrait } from "./PossibleLooks";
import { FoalReveal } from "./FoalReveal";
import { Credits, HorseLine, Skeleton, newKey, refreshPurse, useEcoView } from "./kit";

type Tab = "barn" | "finder" | "studs";

export function BreedingBarn() {
  const { data, setData, error, reload } = useEcoView<BreedingView>("/api/breeding");
  const [tab, setTab] = useState<Tab>("barn");
  useEffect(() => {
    const fromHash = () => {
      if (window.location.hash === "#studs") setTab("studs");
      else if (window.location.hash === "#finder") setTab("finder");
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
        <button type="button" role="tab" aria-selected={tab === "finder"} onClick={() => setTab("finder")} data-testid="tab-finder">
          Stallion finder
        </button>
        <button type="button" role="tab" aria-selected={tab === "studs"} onClick={() => setTab("studs")} data-testid="tab-studs">
          Stud book
        </button>
      </div>
      {tab === "barn" ? <Barn v={v} onView={setData} reload={reload} /> : tab === "finder" ? <StallionFinder v={v} /> : <StudBook v={v} onView={setData} />}
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
      <PlanCover v={v} onView={onView} reload={reload} />
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
  ) : h.block === "stud_resting" ? (
    <span className="text-sm font-bold text-brass-bright" data-testid="stud-resting">
      <span aria-hidden>◷ </span>
      {h.reason}
    </span>
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

/** "$40.00 USDG" for a stud fee in the pick list and the stud book. */
function UsdgFee({ micro }: { micro: number }) {
  return (
    <span className="num text-cream" title={formatUsdgToken(micro)} data-testid="usdg-stud-fee">
      {formatUsdgDollars(micro)} USDG
    </span>
  );
}

function PlanCover({ v, onView, reload }: { v: BreedingView; onView: (v: BreedingView) => void; reload: () => Promise<void> }) {
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
  const [usdgOrder, setUsdgOrder] = useState<UsdgOrderJson | null>(null);

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
    setUsdgOrder(null);
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
  const usdgFee = preview?.usdgStudFee ?? null;

  /** Books the USDG covering: the server holds the slot and the mare and returns the signed StudOrder. */
  async function bookUsdg() {
    if (!preview) return;
    setBusy(true);
    setCoverError(null);
    try {
      setUsdgOrder(await api<UsdgOrderJson>("/api/usdg/stud", { body: { sireId: preview.sireId, damId: preview.damId } }));
      refreshPurse();
    } catch (e) {
      setCoverError(e);
    } finally {
      setBusy(false);
    }
  }

  function usdgCovered() {
    if (!preview) return;
    setCovered(`${preview.damName} is in foal to ${preview.sireName}. The foal arrives in 24 hours.`);
    setUsdgOrder(null);
    setTick((t) => t + 1);
    refreshPurse();
    void reload();
  }

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
                        {h.stableName} · fee {h.studFeeUsdg !== null ? <UsdgFee micro={h.studFeeUsdg} /> : <span className="num text-cream">{formatCredits(h.studFee)}</span>}
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
                {usdgFee !== null ? (
                  <div className="grid gap-2" data-testid="cover-usdg-panel">
                    <p className="text-sm">
                      {preview.sireName} stands at stud for <span className="font-bold text-cream">{formatUsdgDollars(usdgFee)}</span> ({formatUsdgToken(usdgFee)}), paid from your wallet
                      straight to {preview.stallionOwner ?? "his owner"}
                      {preview.usdgFee !== null ? ` (${formatUsdgDollars(preview.usdgFee)} of it is the Club's market fee)` : ""}. You also pay the {formatCredits(total)} credits base fee, held when
                      you book and burned at the covering (returned if the booking lapses). Your mare is held for you while you pay
                      {v.usdg ? ` (${v.usdg.quoteMinutes} minutes)` : ""}; the covering happens once the payment is confirmed.
                    </p>
                    {!v.usdg ? (
                      <p className="t-meta font-bold" data-testid="cover-usdg-off">
                        USDG payments are coming soon: this stallion can&rsquo;t be booked yet.
                      </p>
                    ) : usdgOrder ? (
                      <UsdgPay order={usdgOrder} onDone={usdgCovered} label={`Stud fee for ${preview.sireName}`} />
                    ) : ready ? (
                      <ActionBar>
                        <button type="button" className="btn btn-brass btn-lg" onClick={() => void bookUsdg()} disabled={busy} data-testid="cover-usdg">
                          {busy ? "Booking…" : `Pay ${formatUsdgDollars(usdgFee)} USDG to ${preview.stallionOwner ?? "his owner"}`}
                        </button>
                      </ActionBar>
                    ) : !preview.block && !canAfford ? (
                      <p className="t-meta font-bold">The base fee is {formatCredits(total)} credits: a few more races and it&rsquo;s yours.</p>
                    ) : null}
                  </div>
                ) : confirming ? (
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
// Stallion finder: every available stallion ranked for one mare
// ---------------------------------------------------------------------------

/** The finder's sorts: the best outlook (default, ties by fee) or the fee, cheapest first. */
const FINDER_SORTS: readonly { key: "outlook" | "fee"; label: string; hint: string }[] = [
  { key: "outlook", label: "Best outlook", hint: "Best foal outlook for this mare first (ties by fee)" },
  { key: "fee", label: "Fee: low to high", hint: "Total credits the mare's owner pays (base fee + stud fee), cheapest first" },
];

function StallionFinder({ v }: { v: BreedingView }) {
  const [mareId, setMareId] = useState<string | null>(null);
  const [sort, setSort] = useState<"outlook" | "fee">("outlook");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<StudFinderView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!mareId && v.mares.length) setMareId(v.mares[0]!.id);
  }, [v.mares, mareId]);
  useEffect(() => {
    if (!mareId) return;
    let live = true;
    setLoading(true);
    setError(null);
    api<StudFinderView>(`/api/breeding/finder?mareId=${mareId}&sort=${sort}&page=${page}`, { method: "GET" })
      .then((r) => {
        if (!live) return;
        setData(r);
        setPage(r.page); // the server clamps out-of-range pages
      })
      .catch((e) => live && setError(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [mareId, sort, page]);
  useEffect(() => setPage(0), [mareId, sort]);

  if (v.mares.length === 0)
    return (
      <section aria-labelledby="finder-h">
        <SectionHeader id="finder-h" title="Stallion finder" />
        <p className="surface p-3 text-cream-dim">No mares in your stable yet: fillies from your packs grow into broodmares.</p>
      </section>
    );
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section aria-labelledby="finder-h" className="grid gap-4">
      <SectionHeader id="finder-h" title="Stallion finder" />
      <p className="t-meta">
        Every stallion available to <span className="text-cream">{data?.mareName ?? "your mare"}</span> — your own, the Club&rsquo;s house studs and other stables&rsquo; advertised studs —
        with the foal outlook in words and one look a foal could have. It&rsquo;s still a chance: the real foal is a surprise. Stallions that can&rsquo;t cover her (her close kin, or a stallion at
        his cover limit, listed or away on lease) are left out. The list is worked out once a day per mare.
      </p>
      <div>
        <h3 className="label mb-2">Your mare</h3>
        <PickList items={v.mares} selected={mareId} onPick={setMareId} name="Mare" testid="finder-mare" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="label">Stallions for her</h3>
        <div className="segmented" role="group" aria-label="Sort stallions">
          {FINDER_SORTS.map((s) => (
            <button key={s.key} type="button" aria-pressed={sort === s.key} title={s.hint} onClick={() => setSort(s.key)} data-testid={`finder-sort-${s.key}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {error ? <ErrorNote error={error} /> : null}
      {loading && !data ? <Skeleton rows={4} /> : null}
      {data && (data.total > 0 || data.excluded > 0) && (
        <>
          <ul className="grid gap-2" data-testid="finder-list">
            {data.rows.map((r, i) => (
              <FinderRow key={r.id} r={r} top={sort === "outlook" && data.page === 0 && i === 0} />
            ))}
          </ul>
          {data.rows.length === 0 && <p className="surface p-3 text-cream-dim">No stallion can cover this mare today.</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="t-meta" data-testid="finder-summary">
              {data.total} available{data.excluded > 0 ? ` · ${data.excluded} ruled out` : ""} · list of {data.day}
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-sm" disabled={data.page <= 0} onClick={() => setPage(data.page - 1)} data-testid="finder-prev">
                ← Earlier
              </button>
              <span className="btn btn-sm pointer-events-none">
                {data.page + 1} / {pages}
              </span>
              <button type="button" className="btn btn-sm" disabled={data.page >= pages - 1} onClick={() => setPage(data.page + 1)} data-testid="finder-next">
                Later →
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function FinderRow({ r, top }: { r: StudFinderRow; top: boolean }) {
  const tone = OUTLOOK_TONE[r.outlook.tone];
  return (
    <li className={`surface grid grid-cols-[auto_minmax(0,1fr)] gap-3 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center ${top ? "picked" : ""}`} data-testid="finder-row" data-usdg-only={r.usdgOnly}>
      <span className="well grid place-items-center self-start p-1">
        <LazyPortrait look={r.look} scale="thumb" label={`A foal could look like this: ${r.look.caption}`} />
      </span>
      <span className="grid min-w-0 gap-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="t-title">{r.name}</span>
          <span className="caption">
            {r.own ? "Yours" : r.club ? "The Club" : r.stableName}
            {r.usdgOnly ? " · USDG only" : ""}
          </span>
          {top && !r.resting && <span className="chip text-brass-bright">Best outlook</span>}
          {r.resting && (
            <span className="chip text-brass-bright" data-testid="finder-resting">
              ◷ {r.resting}
            </span>
          )}
        </span>
        <span className="font-extrabold leading-snug" style={{ color: tone.color }} data-testid="finder-outlook">
          <span aria-hidden>{tone.mark} </span>
          {r.outlook.phrase}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="chip font-bold" style={{ color: nickColor(r.nick) }}>
            {r.nick}
          </span>
          <span className="caption">Could look like: {r.look.caption}</span>
        </span>
        {r.warnings.map((w) => (
          <span key={w} className="text-sm text-negative">
            <span aria-hidden>⚠ </span>
            {w}
          </span>
        ))}
      </span>
      <span className="col-span-2 flex items-baseline justify-between gap-2 sm:col-span-1 sm:grid sm:justify-items-end sm:gap-0.5" data-testid="finder-fee">
        <span className="label">{r.usdgOnly ? "Stud fee" : "You pay"}</span>
        {r.usdgOnly ? (
          <span className="text-right">
            <UsdgFee micro={r.studFeeUsdg ?? 0} />
            <span className="block caption">paid on-chain, listed after the credits studs</span>
          </span>
        ) : (
          <Credits value={r.feeCredits ?? 0} className="text-cream" />
        )}
      </span>
    </li>
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
              <StudForm key={s.id} s={s} baseFee={v.baseFee} usdg={v.usdg} onView={onView} />
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
                  aside={s.studFeeUsdg !== null ? <UsdgFee micro={s.studFeeUsdg} /> : <Credits value={s.studFee} className="text-cream" />}
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

function StudForm({ s, baseFee, usdg, onView }: { s: BreedingHorse; baseFee: number; usdg: BreedingView["usdg"]; onView: (v: BreedingView) => void }) {
  const max = s.studFeeMax ?? 100_000;
  const [fee, setFee] = useState(String(Math.min(s.studFee ?? 800, max)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const canUsdg = !!s.usdgRegistered && !!usdg;
  const [currency, setCurrency] = useState<"credits" | "usdg">(s.studFeeUsdg ? "usdg" : "credits");
  const [usdText, setUsdText] = useState(s.studFeeUsdg ? String(s.studFeeUsdg / 1_000_000) : "10");
  const n = Number(fee);
  const valid = fee.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= max;
  const usdMicro = usdgFromDecimal(usdText);
  const usdValid = !!usdg && usdMicro !== null && usdMicro >= usdg.studFeeMin && usdMicro <= usdg.studFeeMax;
  const atStud = s.studFee !== null || !!s.studFeeUsdg;
  async function saveUsdg(next: number) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const r = await api<{ view: BreedingView }>("/api/usdg/stud-fee", { body: { horseId: s.id, fee: next } });
      onView(r.view);
      setSaved(`Standing at stud for ${formatUsdgDollars(next)} USDG.`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
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
            {s.starts} starts · {s.used}/{s.lifetime} breedings used ·{" "}
            {s.studFeeUsdg ? `at stud for ${formatUsdgDollars(s.studFeeUsdg)} USDG` : s.studFee === null ? "not at stud" : `at stud for ${formatCredits(s.studFee)}`}
          </>
        }
      />
      <div className="pl-1">{eligibilityChip(s)}</div>
      {canUsdg && (
        <div className="segmented w-fit" role="group" aria-label="Stud fee currency">
          <button type="button" aria-pressed={currency === "credits"} onClick={() => setCurrency("credits")} data-testid="stud-currency-credits">
            Credits
          </button>
          <button type="button" aria-pressed={currency === "usdg"} onClick={() => setCurrency("usdg")} data-testid="stud-currency-usdg">
            USDG
          </button>
        </div>
      )}
      {canUsdg && currency === "usdg" ? (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1">
              <span className="label">
                Stud fee (USDG, {formatUsdgDollars(usdg!.studFeeMin)} to {formatUsdgDollars(usdg!.studFeeMax)})
              </span>
              <input className="field w-36" inputMode="decimal" value={usdText} onChange={(e) => setUsdText(e.target.value.replace(/[^0-9.]/g, ""))} data-testid="stud-fee-usdg-input" />
            </label>
            <button type="button" className="btn" onClick={() => usdMicro !== null && void saveUsdg(usdMicro)} disabled={busy || !usdValid} data-testid="stud-save-usdg">
              {s.studFeeUsdg ? "Update USDG fee" : "Stand for USDG"}
            </button>
            {atStud && (
              <button type="button" className="btn btn-ghost" onClick={() => save(null)} disabled={busy}>
                Withdraw
              </button>
            )}
          </div>
          {usdValid && (
            <p className="caption">
              Per cover the mare&apos;s owner pays {formatUsdgDollars(usdMicro!)} from their wallet: {formatUsdgDollars(usdMicro! - Math.floor((usdMicro! * usdg!.feeBps) / 10_000))} straight to your
              linked wallet, {formatUsdgDollars(Math.floor((usdMicro! * usdg!.feeBps) / 10_000))} to the Club (market fee). They also pay the {formatCredits(baseFee)} credits base fee. A USDG fee
              replaces any credits fee.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1">
              <span className="label">Stud fee (credits, up to {formatCredits(max)})</span>
              <input className="field w-36" inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^0-9]/g, ""))} data-testid="stud-fee" />
            </label>
            <button type="button" className="btn" onClick={() => save(n)} disabled={busy || !valid} data-testid="stud-save">
              {s.studFee === null ? "Stand at stud" : "Update fee"}
            </button>
            {atStud && (
              <button type="button" className="btn btn-ghost" onClick={() => save(null)} disabled={busy}>
                Withdraw
              </button>
            )}
          </div>
          {valid && n > 0 && (
            <p className="caption">
              Per cover you receive {formatCredits(n - Math.floor(n / 10))}; {formatCredits(Math.floor(n / 10))} is burned. The mare&apos;s owner also pays the {formatCredits(baseFee)} base fee.
              {s.studFeeUsdg ? " Saving a credits fee replaces his USDG fee." : ""}
            </p>
          )}
        </>
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
