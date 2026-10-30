/**
 * Outputs of a run in tools/season-harness/out/<tag>/:
 *   metrics.json  the daily series, totals, cohort outcomes, checks (the source of truth);
 *   summary.md    key numbers and flags in plain English;
 *   report.html   self-contained: one inline-SVG chart per key series (light and dark),
 *                 tables, and with HARNESS_COMPARE=<tag> the other run's series dashed on the
 *                 same charts plus a table of deltas.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COHORTS, type Cohort, type HarnessConfig } from "./config";
import type { DaySample } from "./metrics";
import type { RunResult } from "./run";
import { pct, round1, sum } from "./stats";

export const OUT_DIR = fileURLToPath(new URL("../out/", import.meta.url));

export function readRun(tag: string): RunResult {
  const file = `${OUT_DIR}${tag}/metrics.json`;
  if (!existsSync(file)) throw new Error(`no run "${tag}" (expected ${file})`);
  return JSON.parse(readFileSync(file, "utf8")) as RunResult;
}

/** Writes metrics.json (unless re-rendering), summary.md and report.html. Returns the folder. */
export async function writeOutputs(cfg: HarnessConfig, result: RunResult | null): Promise<string> {
  const dir = `${OUT_DIR}${cfg.tag}/`;
  mkdirSync(dir, { recursive: true });
  const run = result ?? readRun(cfg.tag);
  if (result) writeFileSync(`${dir}metrics.json`, JSON.stringify(result, null, 1));
  const base = cfg.compareTo ? readRun(cfg.compareTo) : null;
  writeFileSync(`${dir}summary.md`, summaryMd(run, base));
  writeFileSync(`${dir}report.html`, reportHtml(run, base));
  return dir;
}

// ---------------------------------------------------------------------------
// Key numbers (summary, tiles and the delta table share them)
// ---------------------------------------------------------------------------

export interface KeyNumber {
  key: string;
  label: string;
  value: number;
  unit?: string;
}

const top = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1]);
const fmt = (n: number, unit = "") => `${Number.isInteger(n) ? n.toLocaleString("en-GB") : n.toLocaleString("en-GB", { maximumFractionDigits: 1 })}${unit}`;

function lastDay(r: RunResult): DaySample | undefined {
  return r.days.at(-1);
}

export function keyNumbers(r: RunResult): KeyNumber[] {
  const t = r.totals;
  const created = sum(Object.values(t.created));
  const destroyed = sum(Object.values(t.destroyed));
  const d = lastDay(r);
  const born = (k: string) => t.born[k] ?? 0;
  const earned = created - (t.created.starter_grant ?? 0);
  const pot = t.potential;
  const potN = pot.below + pot.between + pot.above;
  const out: KeyNumber[] = [
    { key: "liveRaces", label: "Live races run", value: t.liveRaces },
    { key: "liveWithPlayers", label: "Live races with a player runner", value: pct(t.liveRacesWithPlayers, t.liveRaces), unit: "%" },
    { key: "avgField", label: "Average Live field", value: t.avgField, unit: " runners" },
    { key: "playerShare", label: "Player share of Live runners", value: t.playerShare, unit: "%" },
    { key: "storyRaces", label: "Story races", value: t.storyRaces },
    { key: "cupRuns", label: "Daily Cup runs", value: t.cupRuns },
    { key: "created", label: "Credits created", value: created },
    { key: "destroyed", label: "Credits destroyed", value: destroyed },
    { key: "sinkRatio", label: "Destroyed per 100 created (starter grants excluded)", value: earned ? round1((100 * destroyed) / earned) : 0 },
    { key: "playerTotal", label: "Credits held by players (end)", value: d?.credits.playerTotal ?? 0 },
    { key: "bredFoals", label: "Foals bred", value: born("bred") },
    { key: "packFoals", label: "Pack foals", value: born("pack") },
    { key: "giftFoals", label: "Gift foals", value: born("gift") },
    { key: "retired", label: "Horses retired from racing", value: sum(Object.values(t.retired)) },
    { key: "legacy", label: "Moved to the Legacy Farm", value: t.legacy },
    { key: "died", label: "Died (fatal race injury)", value: t.died },
    { key: "aboveParents", label: "Foals above both parents' potential", value: pct(pot.above, potN), unit: "%" },
    { key: "belowParents", label: "Foals below both parents' potential", value: pct(pot.below, potN), unit: "%" },
    { key: "listings", label: "Market listings", value: t.listings },
    { key: "sales", label: "Market sales", value: t.sales },
    { key: "fqRunners", label: "Feature Qualifier player runners", value: t.fqPlayerRunners },
    { key: "fqQualifiers", label: "Feature Qualifier top-3 finishes", value: t.fqQualifiers },
    { key: "wfRunners", label: "Weekend Feature player runners", value: t.wfPlayerRunners },
    { key: "injuries", label: "Live race injuries", value: sum(Object.values(t.injuries)) },
    { key: "trainingInjuries", label: "Training injuries", value: t.trainingInjuries },
    { key: "leaseOffers", label: "Lease offers", value: t.leasing?.offers ?? 0 },
    { key: "leases", label: "Leases taken", value: t.leasing?.leases ?? 0 },
    { key: "leaseRaces", label: "Races run on lease", value: t.leasing?.racesOnLease ?? 0 },
    { key: "leaseSharesOwners", label: "Lease shares paid to owners", value: t.leasing?.sharesToOwners ?? 0 },
    { key: "leaseSharesLessees", label: "Lease shares paid to lessees", value: t.leasing?.sharesToLessees ?? 0 },
    { key: "leaseInjuryReturns", label: "Leases ended by injury", value: t.leasing?.ended.injured ?? 0 },
    { key: "leaseReciprocal", label: "Reciprocal lease flags", value: t.leasing?.reciprocalFlags ?? 0 },
  ];
  for (const c of COHORTS) {
    if (!r.meta.cohorts[c]) continue;
    out.push({ key: `medianBalance.${c}`, label: `Median balance, ${c}`, value: d?.balances[c].median ?? 0 });
    out.push({ key: `medianOr.${c}`, label: `Median OR (racing), ${c}`, value: d?.ratings[c].median ?? 0 });
    out.push({ key: `wonLive.${c}`, label: `Stables with a Live win, ${c}`, value: r.outcomes[c].wonLive, unit: "%" });
    out.push({ key: `qualified.${c}`, label: `Stables that qualified for a Weekend Feature, ${c}`, value: r.outcomes[c].qualified, unit: "%" });
  }
  out.push({ key: "farmerToMain", label: "Credits passed alt → main (farmers)", value: sum(r.farmers.groups.map((g) => g.studFeesToMain + g.marketToMain)) });
  out.push({ key: "runtimeMin", label: "Runtime", value: round1(r.meta.runtimeMs / 60_000), unit: " min" });
  return out;
}

/** Things worth a second look, found from the numbers (plain English). */
export function flags(r: RunResult): string[] {
  const out: string[] = [];
  const t = r.totals;
  const created = sum(Object.values(t.created));
  const destroyed = sum(Object.values(t.destroyed));
  if (!r.checks.ok) out.push(`CHECKS FAILED: ledger ${JSON.stringify(r.checks.ledger.unbalancedTransactions.length)} unbalanced, conservation drift ${r.checks.conservation.drift}, ${r.checks.unexpectedErrors} unexpected exceptions.`);
  const earned = created - (t.created.starter_grant ?? 0);
  if (earned > 0 && destroyed / earned < 0.5) {
    out.push(`Credit inflation: sinks removed only ${round1((100 * destroyed) / earned)} of every 100 credits earned in play (starter grants aside); players hold ${fmt(created - destroyed)} credits at the end.`);
  }
  const purse = t.created.purse ?? 0;
  if (earned > 0 && purse / earned > 0.5) out.push(`Purses are ${pct(purse, earned)}% of the credits earned in play.`);
  if (t.liveRaces && pct(t.liveRacesWithPlayers, t.liveRaces) < 50) out.push(`Mostly empty of players: only ${pct(t.liveRacesWithPlayers, t.liveRaces)}% of Live races had a player runner (player share of runners ${t.playerShare}%).`);
  if (t.fqQualifiers === 0) out.push(`Nobody qualified through a Feature Qualifier (${t.fqPlayerRunners} player runners in qualifiers).`);
  if (t.wfPlayerRunners === 0) out.push("No player horse ran in a Weekend Feature.");
  if (t.sales === 0) out.push(`No market sales (${t.listings} listings): seller requirements and Club-bred locks may keep the market empty this early.`);
  if (t.died > 0) out.push(`${t.died} horse(s) died from fatal race injuries.`);
  const farm = sum(r.farmers.groups.map((g) => g.studFeesToMain + g.marketToMain));
  if (farm > 0) out.push(`Farmer alts passed ${fmt(farm)} credits to their mains (stud fees ${fmt(sum(r.farmers.groups.map((g) => g.studFeesToMain)))}, market ${fmt(sum(r.farmers.groups.map((g) => g.marketToMain)))}).`);
  const bestOr = Math.max(0, ...r.days.flatMap((d) => COHORTS.filter((c) => r.meta.cohorts[c]).map((c) => d.ratings[c].max)));
  if (bestOr < 85) out.push(`No racing horse reached OR 85, the Listed band (best ${bestOr}): Qualifiers are open to every rating, but Listed and Group races are not.`);
  const wfDays = r.days.filter((d) => d.features.wfRaces > 0).length;
  if (wfDays && t.wfPlayerRunners === 0 && (t.fqQualifiers > 0 || r.days.some((d) => d.features.ratedHundred > 0))) {
    out.push(`Weekend Features ran on ${wfDays} day(s) with no player runner although ${t.fqQualifiers} qualifier top-3 finish(es) and up to ${Math.max(...r.days.map((d) => d.features.ratedHundred))} horse(s) rated 100+ existed: check the Classics licence (Story chapter 4) and whether qualified horses were still racing (40-start careers).`);
  }
  const retiredByStarts = t.retired.max_starts ?? 0;
  if (retiredByStarts > 0) out.push(`${retiredByStarts} horses completed their 40-start careers within the run.`);
  return out;
}

// ---------------------------------------------------------------------------
// summary.md
// ---------------------------------------------------------------------------

function summaryMd(r: RunResult, base: RunResult | null): string {
  const m = r.meta;
  const t = r.totals;
  const L: string[] = [];
  L.push(`# Season harness: ${m.tag}`, "");
  L.push(
    `${m.days} simulated days from ${m.start.slice(0, 10)} (season ${m.season}), ${m.stables} stables ` +
      `(${COHORTS.map((c) => `${m.cohorts[c]} ${c}`).join(", ")}; ${m.detectedFarmerGroups} farmer group(s) detectable). ` +
      `Card slot ${m.slotMs / 60_000} min, published ${m.cardHorizonMs / 3_600_000} h ahead; engine ${m.engineVersion}; seed "${m.seed}". ` +
      `Runtime ${round1(m.runtimeMs / 60_000)} min.`,
    "",
  );
  L.push(`Checks: ${r.checks.ok ? "all passed" : "FAILED"} (ledger balanced: ${r.checks.ledger.totalPostings === 0 && !r.checks.ledger.unbalancedTransactions.length}, credits conserved: ${r.checks.conservation.ok}, unexpected exceptions: ${r.checks.unexpectedErrors}).`, "");
  const fl = flags(r);
  if (fl.length) {
    L.push("## Worth a look", "");
    for (const f of fl) L.push(`- ${f}`);
    L.push("");
  }
  L.push("## Key numbers", "");
  const keys = keyNumbers(r);
  const baseKeys = base ? new Map(keyNumbers(base).map((k) => [k.key, k])) : null;
  L.push(baseKeys ? `| | ${m.tag} | ${base!.meta.tag} | Δ |` : `| | ${m.tag} |`, baseKeys ? "|---|---:|---:|---:|" : "|---|---:|");
  for (const k of keys) {
    const b = baseKeys?.get(k.key);
    L.push(baseKeys ? `| ${k.label} | ${fmt(k.value, k.unit)} | ${b ? fmt(b.value, b.unit) : "–"} | ${b ? delta(k.value, b.value) : "–"} |` : `| ${k.label} | ${fmt(k.value, k.unit)} |`);
  }
  L.push("", "## Credits", "");
  L.push("Created by source: " + top(t.created).map(([k, v]) => `${k} ${fmt(v)}`).join(", ") + ".");
  L.push("", "Destroyed by sink: " + (top(t.destroyed).map(([k, v]) => `${k} ${fmt(v)}`).join(", ") || "none") + ".");
  L.push("", "Moved between players: " + (top(t.transfers).map(([k, v]) => `${k} ${fmt(v)}`).join(", ") || "none") + ".");
  const d = lastDay(r);
  if (d) {
    L.push("", "Balances at the end (median / p90 / max):");
    for (const c of COHORTS) if (m.cohorts[c]) L.push(`- ${c}: ${fmt(d.balances[c].median)} / ${fmt(d.balances[c].p90)} / ${fmt(d.balances[c].max)}`);
  }
  L.push("", "## Cohorts (share of stables that did it at least once)", "");
  L.push("| | stables | Live win | ran a Qualifier | qualified | ran Weekend Feature | bred | sold | licence 3+ | promoted | above start credits | Live starts | visits |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const c of COHORTS) {
    const o = r.outcomes[c];
    if (!o.stables) continue;
    L.push(`| ${c} | ${o.stables} | ${o.wonLive}% | ${o.ranFeatureQualifier}% | ${o.qualified}% | ${o.ranWeekendFeature}% | ${o.bredFoal}% | ${o.soldHorse}% | ${o.licence3}% | ${o.promoted}% | ${o.endedAboveStart}% | ${o.avgLiveStarts} | ${o.avgVisits} |`);
  }
  if (r.farmers.groups.length) {
    L.push("", "## Farmers (alt accounts feeding a main)", "");
    for (const g of r.farmers.groups) {
      L.push(`- Group ${g.group} (${g.detected ? "shares a wallet: detectable" : "separate devices: undetected"}): main has a stallion at stud: ${g.mainStallion ? "yes" : "no"}, alt mares covered by him ${g.altMaresCovered}, stud fees to main ${fmt(g.studFeesToMain)}, market to main ${fmt(g.marketToMain)}, horses to main ${g.horsesToMain}, refused buys ${g.blockedTrades}; main ends on ${fmt(g.mainBalance)}, alts on ${g.altBalances.map((b) => fmt(b)).join(", ")}.`);
    }
    L.push(`- Fraud events: ${top(r.farmers.fraudEvents).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`);
  }
  if (r.errors.length) {
    L.push("", "## Unexpected exceptions (first 10)", "");
    for (const e of r.errors.slice(0, 10)) L.push(`- ${new Date(e.atMs).toISOString()} ${e.agent} ${e.action}: ${e.message}`);
  }
  L.push("", "Daily series, totals and the refused-action counts are in metrics.json; charts in report.html.", "");
  return L.join("\n");
}

function delta(v: number, b: number): string {
  const d = round1(v - b);
  const p = b !== 0 ? ` (${d >= 0 ? "+" : ""}${round1((100 * (v - b)) / Math.abs(b))}%)` : "";
  return `${d >= 0 ? "+" : ""}${fmt(d)}${p}`;
}

// ---------------------------------------------------------------------------
// report.html
// ---------------------------------------------------------------------------

/** Categorical slots (reference palette, validated order), light and dark steps. */
const SLOTS: readonly [string, string][] = [
  ["#2a78d6", "#3987e5"],
  ["#eb6834", "#d95926"],
  ["#1baf7a", "#199e70"],
  ["#eda100", "#c98500"],
  ["#e87ba4", "#d55181"],
  ["#008300", "#008300"],
  ["#6250d6", "#9085e9"],
  ["#e34948", "#e66767"],
];
const COHORT_SLOT: Record<Cohort, number> = { casual: 0, grinder: 1, breeder: 2, farmer: 3 };

interface Series {
  name: string;
  slot: number;
  values: number[];
}

interface ChartSpec {
  id: string;
  title: string;
  note: string;
  unit: string;
  series: (r: RunResult) => Series[];
}

const daysOf = <T>(r: RunResult, f: (d: DaySample) => T) => r.days.map(f);

/** Top `n` kinds over the run (others folded into "other"), as daily series. */
function kindSeries(r: RunResult, pick: (d: DaySample) => Record<string, number>, totals: Record<string, number>, n = 5, order?: string[]): Series[] {
  const kinds = order ?? top(totals).slice(0, n).map(([k]) => k);
  const series = kinds.map((k, i) => ({ name: k, slot: i, values: daysOf(r, (d) => pick(d)[k] ?? 0) }));
  const other = daysOf(r, (d) => sum(Object.entries(pick(d)).filter(([k]) => !kinds.includes(k)).map(([, v]) => v)));
  if (other.some((v) => v !== 0)) series.push({ name: "other", slot: kinds.length, values: other });
  return series;
}

function cohortSeries(r: RunResult, f: (d: DaySample, c: Cohort) => number): Series[] {
  return COHORTS.filter((c) => r.meta.cohorts[c]).map((c) => ({ name: c, slot: COHORT_SLOT[c], values: daysOf(r, (d) => f(d, c)) }));
}

const STAGES = ["foal", "weanling", "yearling", "juvenile", "prime", "veteran", "retired", "legacy"];

function charts(main: RunResult): ChartSpec[] {
  // Kind lists are fixed from the main run so both runs share colours in compare mode.
  const createdKinds = top(main.totals.created).slice(0, 5).map(([k]) => k);
  const destroyedKinds = top(main.totals.destroyed).slice(0, 5).map(([k]) => k);
  return [
    { id: "flow", title: "Credits created and destroyed per day", note: "All sources (mint) against all sinks (burn, Club treasury).", unit: "credits", series: (r) => [
      { name: "created", slot: 0, values: daysOf(r, (d) => d.credits.createdTotal) },
      { name: "destroyed", slot: 1, values: daysOf(r, (d) => d.credits.destroyedTotal) },
    ] },
    { id: "sources", title: "Credits created by source", note: "Ledger transaction kinds posting from the mint.", unit: "credits", series: (r) => kindSeries(r, (d) => d.credits.created, main.totals.created, 5, createdKinds) },
    { id: "sinks", title: "Credits destroyed by sink", note: "Ledger transaction kinds posting to the burn or the Club treasury.", unit: "credits", series: (r) => kindSeries(r, (d) => d.credits.destroyed, main.totals.destroyed, 5, destroyedKinds) },
    { id: "held", title: "Credits held by all players", note: "End-of-day sum of player balances.", unit: "credits", series: (r) => [{ name: "players", slot: 0, values: daysOf(r, (d) => d.credits.playerTotal) }] },
    { id: "median", title: "Median credit balance by cohort", note: "End of day.", unit: "credits", series: (r) => cohortSeries(r, (d, c) => d.balances[c].median) },
    { id: "p90", title: "90th-percentile credit balance by cohort", note: "End of day; max is in metrics.json.", unit: "credits", series: (r) => cohortSeries(r, (d, c) => d.balances[c].p90) },
    { id: "races", title: "Live races per day", note: "Settled card races (sister courses included), and those with at least one player runner.", unit: "races", series: (r) => [
      { name: "all", slot: 0, values: daysOf(r, (d) => d.races.live) },
      { name: "with players", slot: 1, values: daysOf(r, (d) => d.races.liveWithPlayers) },
    ] },
    { id: "field", title: "Runners per Live race", note: "Average field (house runners fill the gates) and average player runners.", unit: "runners", series: (r) => [
      { name: "field", slot: 0, values: daysOf(r, (d) => d.races.avgField) },
      { name: "player runners", slot: 1, values: daysOf(r, (d) => d.races.avgPlayerRunners) },
    ] },
    { id: "share", title: "Player share of Live runners", note: "Player horses / all runners.", unit: "%", series: (r) => [{ name: "player share", slot: 0, values: daysOf(r, (d) => d.races.playerShare) }] },
    { id: "entries", title: "Live stable entries used per stable", note: "Entry cost of the day's Live runs, per stable in the cohort.", unit: "entries", series: (r) => cohortSeries(r, (d, c) => d.entriesPerStable[c]) },
    { id: "league", title: "League points per stable (week to date)", note: "weekScore over settled Live runs; resets each Monday.", unit: "points", series: (r) => cohortSeries(r, (d, c) => d.league.pointsPerStable[c]) },
    { id: "population", title: "Player horses by stage", note: "Racing horses by career stage, plus retired (stud / broodmare) and the Legacy Farm.", unit: "horses", series: (r) => STAGES.map((s, i) => ({ name: s, slot: i, values: daysOf(r, (d) => d.horses.byStage[s] ?? 0) })) },
    { id: "lifecycle", title: "Horses born, retired, to the Legacy Farm and died", note: "Per day (born = bred, pack and gift foals).", unit: "horses", series: (r) => [
      { name: "born", slot: 0, values: daysOf(r, (d) => (d.horses.born.bred ?? 0) + (d.horses.born.pack ?? 0) + (d.horses.born.gift ?? 0)) },
      { name: "retired", slot: 1, values: daysOf(r, (d) => sum(Object.values(d.horses.retired))) },
      { name: "legacy", slot: 2, values: daysOf(r, (d) => d.horses.legacy) },
      { name: "died", slot: 7, values: daysOf(r, (d) => d.horses.died) },
    ] },
    { id: "injuries", title: "Injuries per day", note: "Live race injuries by severity, plus training injuries.", unit: "injuries", series: (r) => [
      { name: "minor", slot: 0, values: daysOf(r, (d) => d.injuries.live.minor ?? 0) },
      { name: "moderate", slot: 1, values: daysOf(r, (d) => d.injuries.live.moderate ?? 0) },
      { name: "career ending", slot: 2, values: daysOf(r, (d) => d.injuries.live.career_ending ?? 0) },
      { name: "fatal", slot: 7, values: daysOf(r, (d) => d.injuries.live.fatal ?? 0) },
      { name: "training", slot: 4, values: daysOf(r, (d) => d.injuries.training) },
    ] },
    { id: "features", title: "Feature Qualifiers and the Weekend Feature", note: "Player runners per day, and qualifier top-3 finishes (a Weekend Feature place).", unit: "runners", series: (r) => [
      { name: "qualifier runners", slot: 0, values: daysOf(r, (d) => d.features.fqPlayerRunners) },
      { name: "qualified", slot: 1, values: daysOf(r, (d) => d.features.fqQualifiers) },
      { name: "Weekend Feature runners", slot: 2, values: daysOf(r, (d) => d.features.wfPlayerRunners) },
    ] },
    { id: "breeding", title: "Breeding", note: "Covers and foals per day.", unit: "per day", series: (r) => [
      { name: "covers", slot: 0, values: daysOf(r, (d) => d.breeding.covers) },
      { name: "foals", slot: 1, values: daysOf(r, (d) => d.breeding.foals) },
    ] },
    { id: "market", title: "Market", note: "Listings and sales per day.", unit: "per day", series: (r) => [
      { name: "listed", slot: 0, values: daysOf(r, (d) => d.market.listed) },
      { name: "sold", slot: 1, values: daysOf(r, (d) => d.market.sold) },
      { name: "expired", slot: 2, values: daysOf(r, (d) => d.market.expired) },
    ] },
    { id: "or", title: "Median official rating by cohort", note: "Racing-age horses still in training.", unit: "OR", series: (r) => cohortSeries(r, (d, c) => d.ratings[c].median) },
    { id: "ormax", title: "Best official rating by cohort", note: "OR 85 opens Feature Qualifiers; 100 is a Weekend Feature place by right.", unit: "OR", series: (r) => cohortSeries(r, (d, c) => d.ratings[c].max) },
    { id: "licence", title: "Average Story licence by cohort", note: "Licences gate Live classes (3 = Listed and Group, 4 = Features).", unit: "level", series: (r) => cohortSeries(r, (d, c) => d.licence[c]) },
  ];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function niceStep(range: number): number {
  const raw = range / 4;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

const tick = (v: number) => (Math.abs(v) >= 10_000 ? `${round1(v / 1000)}k` : fmt(round1(v)));

/** One line chart: inline SVG (one y axis), legend, hover data for the crosshair script. */
function lineChart(spec: ChartSpec, main: RunResult, base: RunResult | null): string {
  const runs: { run: RunResult; dashed: boolean }[] = [{ run: main, dashed: false }, ...(base ? [{ run: base, dashed: true }] : [])];
  const all = runs.flatMap(({ run, dashed }) => spec.series(run).map((s) => ({ ...s, dashed, label: base ? `${s.name} (${run.meta.tag})` : s.name })));
  const n = Math.max(1, ...all.map((s) => s.values.length));
  const W = 640;
  const H = 240;
  const pad = { l: 52, r: 12, t: 12, b: 28 };
  const maxV = Math.max(0, ...all.flatMap((s) => s.values));
  const minV = Math.min(0, ...all.flatMap((s) => s.values));
  const step = niceStep(maxV - minV || 1);
  const yMax = Math.ceil(maxV / step) * step || step;
  const yMin = Math.floor(minV / step) * step;
  const x = (i: number) => pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (n - 1));
  const y = (v: number) => pad.t + ((yMax - v) * (H - pad.t - pad.b)) / (yMax - yMin || 1);
  const grid: string[] = [];
  for (let v = yMin; v <= yMax + step / 2; v += step) {
    grid.push(`<line class="grid${v === 0 ? " zero" : ""}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${tick(v)}</text>`);
  }
  const every = Math.max(1, Math.ceil(n / 10));
  for (let i = 0; i < n; i += every) grid.push(`<text class="tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${i + 1}</text>`);
  const lines = all
    .map((s) => {
      const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
      const marker = s.values.length === 1 ? `<circle cx="${x(0)}" cy="${y(s.values[0]!)}" r="4" fill="var(--s${s.slot})"/>` : "";
      return `<polyline points="${pts}" fill="none" stroke="var(--s${s.slot})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dashed ? ' stroke-dasharray="5 4" opacity="0.8"' : ""}/>${marker}`;
    })
    .join("");
  const swatch = (stroke: string, dashed: boolean) =>
    `<svg width="22" height="10" aria-hidden="true"><line x1="1" x2="21" y1="5" y2="5" stroke="${stroke}" stroke-width="2.5"${dashed ? ' stroke-dasharray="5 4"' : ""}/></svg>`;
  // Colour names the series; in compare mode the line style names the run.
  const legend =
    spec.series(main).map((s) => `<span class="key">${swatch(`var(--s${s.slot})`, false)}${esc(s.name)}</span>`).join("") +
    (base ? `<span class="key runkey">${swatch("var(--ink2)", false)}${esc(main.meta.tag)}</span><span class="key runkey">${swatch("var(--ink2)", true)}${esc(base.meta.tag)}</span>` : "");
  const data = esc(JSON.stringify({ n, x0: x(0), x1: x(n - 1), unit: spec.unit, series: all.map((s) => ({ name: s.label, slot: s.slot, values: s.values })) }));
  return `<figure class="chart" id="c-${spec.id}">
<figcaption><h3>${esc(spec.title)}</h3><p>${esc(spec.note)} <span class="unit">(${esc(spec.unit)}, by day)</span></p></figcaption>
<div class="legend">${legend}</div>
<div class="plot" data-chart="${data}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title)}">${grid.join("")}${lines}<line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/></svg><div class="tip" hidden></div></div>
</figure>`;
}

/** An HTML table; numeric cells (and their column headers) are right-aligned. */
function table(head: string[], rows: (string | number)[][], numeric = true): string {
  const isNum = (c: string | number | undefined) => numeric && (typeof c === "number" || /^[+-]?[\d,.]+(%| runners| min)?( \(.*\))?$/.test(String(c ?? "")));
  const numCol = head.map((_, i) => i > 0 && rows.length > 0 && rows.every((r) => isNum(r[i]) || r[i] === "–"));
  return `<div class="tablewrap"><table><thead><tr>${head.map((h, i) => `<th${numCol[i] ? ' class="n"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => `<td${numCol[i] ? ' class="n"' : ""}>${esc(typeof c === "number" ? fmt(c) : c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

const STYLE = `
:root{color-scheme:light;--bg:#f6f5f2;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--ink3:#7b7a75;--rule:#e2e0da;--grid:#ebe9e4;--good:#008300;--bad:#c62828;
--s0:${SLOTS[0]![0]};--s1:${SLOTS[1]![0]};--s2:${SLOTS[2]![0]};--s3:${SLOTS[3]![0]};--s4:${SLOTS[4]![0]};--s5:${SLOTS[5]![0]};--s6:${SLOTS[6]![0]};--s7:${SLOTS[7]![0]}}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#121211;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--ink3:#97958c;--rule:#33322f;--grid:#2a2927;--good:#5cb85c;--bad:#ef6b6b;
--s0:${SLOTS[0]![1]};--s1:${SLOTS[1]![1]};--s2:${SLOTS[2]![1]};--s3:${SLOTS[3]![1]};--s4:${SLOTS[4]![1]};--s5:${SLOTS[5]![1]};--s6:${SLOTS[6]![1]};--s7:${SLOTS[7]![1]}}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#121211;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--ink3:#97958c;--rule:#33322f;--grid:#2a2927;--good:#5cb85c;--bad:#ef6b6b;
--s0:${SLOTS[0]![1]};--s1:${SLOTS[1]![1]};--s2:${SLOTS[2]![1]};--s3:${SLOTS[3]![1]};--s4:${SLOTS[4]![1]};--s5:${SLOTS[5]![1]};--s6:${SLOTS[6]![1]};--s7:${SLOTS[7]![1]}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:36px 0 12px;border-top:1px solid var(--rule);padding-top:20px}
h3{font-size:15px;margin:0}.meta,figcaption p{color:var(--ink2);margin:0}.unit{color:var(--ink3)}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-top:16px}.tile{background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:10px 12px}
.tile b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.tile span{color:var(--ink2);font-size:13px}.tile i{display:block;font-style:normal;font-size:12px;color:var(--ink3)}
.flags{background:var(--surface);border:1px solid var(--rule);border-left:4px solid var(--s1);border-radius:6px;padding:8px 16px 8px 28px}.ok{color:var(--good)}.fail{color:var(--bad);font-weight:600}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr));gap:16px}.chart{margin:0;background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:12px 12px 4px}
.runkey{color:var(--ink3)}.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:8px 0 2px;font-size:13px;color:var(--ink2)}.key{display:inline-flex;align-items:center;gap:6px}
.plot{position:relative}.plot svg{width:100%;height:auto;display:block}.grid{stroke:var(--grid);stroke-width:1}.grid.zero{stroke:var(--ink3)}.tick{fill:var(--ink3);font-size:11px;font-variant-numeric:tabular-nums}
.cross{stroke:var(--ink3);stroke-width:1}.tip{position:absolute;top:4px;pointer-events:none;background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:6px 8px;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.15);white-space:nowrap}
.tip div{display:flex;align-items:center;gap:6px}.tip i{width:10px;height:3px;display:inline-block;border-radius:2px}.tip b{margin-left:auto;padding-left:10px;font-variant-numeric:tabular-nums}
.tablewrap{overflow-x:auto;background:var(--surface);border:1px solid var(--rule);border-radius:8px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:6px 10px;border-bottom:1px solid var(--rule);text-align:left}th{color:var(--ink2);font-weight:600}.n{text-align:right;font-variant-numeric:tabular-nums}
.up{color:var(--ink)}.dn{color:var(--ink)}code{font-size:12px}
`;

/** Crosshair + tooltip for every chart (no external scripts). */
const SCRIPT = `
document.querySelectorAll('.plot').forEach(function(p){var d=JSON.parse(p.dataset.chart),svg=p.querySelector('svg'),cr=p.querySelector('.cross'),tip=p.querySelector('.tip');
function f(v){return Math.abs(v)>=1000?Math.round(v).toLocaleString('en-GB'):(Math.round(v*10)/10).toLocaleString('en-GB')}
p.addEventListener('pointermove',function(e){var r=svg.getBoundingClientRect(),vb=svg.viewBox.baseVal,sx=(e.clientX-r.left)*vb.width/r.width;
var i=d.n<2?0:Math.round((sx-d.x0)/((d.x1-d.x0)/(d.n-1)));if(i<0||i>=d.n){cr.setAttribute('visibility','hidden');tip.hidden=true;return}
var x=d.n<2?d.x0:d.x0+i*(d.x1-d.x0)/(d.n-1);cr.setAttribute('x1',x);cr.setAttribute('x2',x);cr.setAttribute('visibility','visible');
tip.innerHTML='<strong>Day '+(i+1)+'</strong>'+d.series.map(function(s){var v=s.values[i];return v===undefined?'':'<div><i style="background:var(--s'+s.slot+')"></i>'+s.name.replace(/</g,'&lt;')+'<b>'+f(v)+'</b></div>'}).join('');
tip.hidden=false;var px=x*r.width/vb.width;tip.style.left=(px>r.width/2?Math.max(0,px-tip.offsetWidth-12):px+12)+'px'});
p.addEventListener('pointerleave',function(){cr.setAttribute('visibility','hidden');tip.hidden=true})});
`;

function reportHtml(r: RunResult, base: RunResult | null): string {
  const m = r.meta;
  const keys = keyNumbers(r);
  const bk = base ? new Map(keyNumbers(base).map((k) => [k.key, k])) : null;
  const tileKeys = ["liveRaces", "liveWithPlayers", "avgField", "playerShare", "created", "destroyed", "sinkRatio", "playerTotal", "bredFoals", "sales", "fqQualifiers", "injuries"];
  const tiles = tileKeys
    .map((k) => keys.find((x) => x.key === k)!)
    .map((k) => `<div class="tile"><span>${esc(k.label)}</span><b>${esc(fmt(k.value, k.unit))}</b>${bk?.get(k.key) ? `<i>${esc(base!.meta.tag)}: ${esc(fmt(bk.get(k.key)!.value, k.unit))} (${esc(delta(k.value, bk.get(k.key)!.value))})</i>` : ""}</div>`)
    .join("");
  const fl = flags(r);
  const d = lastDay(r);
  const outcomeRows = COHORTS.filter((c) => r.outcomes[c].stables).map((c) => {
    const o = r.outcomes[c];
    return [c, o.stables, `${o.wonLive}%`, `${o.ranFeatureQualifier}%`, `${o.qualified}%`, `${o.ranWeekendFeature}%`, `${o.bredFoal}%`, `${o.soldHorse}%`, `${o.licence3}%`, `${o.promoted}%`, `${o.endedAboveStart}%`, o.avgLiveStarts, o.avgVisits];
  });
  const kinds = [...new Set([...Object.keys(r.totals.created), ...Object.keys(r.totals.destroyed), ...Object.keys(r.totals.transfers)])].sort();
  const creditRows = kinds.map((k) => [k, r.totals.created[k] ?? 0, r.totals.destroyed[k] ?? 0, r.totals.transfers[k] ?? 0]);
  const refusedRows = COHORTS.flatMap((c) => top(r.activity.refused[c]).slice(0, 8).map(([k, n]) => [c, k, n]));
  const deltaTable = bk
    ? `<h2>Compared with ${esc(base!.meta.tag)}</h2><p class="meta">Dashed lines in every chart are ${esc(base!.meta.tag)} (${base!.meta.days} days, ${base!.meta.stables} stables, slot ${base!.meta.slotMs / 60_000} min, seed "${esc(base!.meta.seed)}").</p>` +
      table(
        ["", m.tag, base!.meta.tag, "Δ"],
        keys.map((k) => {
          const b = bk.get(k.key);
          return [k.label, fmt(k.value, k.unit), b ? fmt(b.value, b.unit) : "–", b ? delta(k.value, b.value) : "–"];
        }),
      )
    : "";
  const farmerRows = r.farmers.groups.map((g) => [`group ${g.group}`, g.detected ? "detectable (shared wallet)" : "undetected", g.mainStallion ? "yes" : "no", g.altMaresCovered, g.studFeesToMain, g.marketToMain, g.horsesToMain, g.blockedTrades, g.mainBalance, g.altBalances.map((b) => fmt(b)).join(" / ")]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Season harness ${esc(m.tag)}</title><style>${STYLE}</style></head><body><main>
<h1>Season harness: ${esc(m.tag)}${base ? ` vs ${esc(base.meta.tag)}` : ""}</h1>
<p class="meta">${m.days} simulated days from ${m.start.slice(0, 10)} (season ${m.season}) · ${m.stables} stables (${COHORTS.map((c) => `${m.cohorts[c]} ${c}`).join(", ")}) · card slot ${m.slotMs / 60_000} min, published ${m.cardHorizonMs / 3_600_000} h ahead · engine ${esc(m.engineVersion)} · seed “${esc(m.seed)}” · runtime ${round1(m.runtimeMs / 60_000)} min</p>
<p class="${r.checks.ok ? "ok" : "fail"}">${r.checks.ok ? "✓ Checks passed" : "✗ Checks failed"}: ledger balanced ${r.checks.ledger.totalPostings === 0 && !r.checks.ledger.unbalancedTransactions.length ? "yes" : "NO"}, credits conserved ${r.checks.conservation.ok ? "yes" : `NO (drift ${r.checks.conservation.drift})`}, unexpected exceptions ${r.checks.unexpectedErrors}.</p>
<div class="tiles">${tiles}</div>
${fl.length ? `<h2>Worth a look</h2><ul class="flags">${fl.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
${deltaTable}
<h2>Daily series</h2><div class="grid2">${charts(r).map((c) => lineChart(c, r, base)).join("\n")}</div>
<h2>Cohorts</h2><p class="meta">Share of each cohort's stables that did it at least once over the run (retention proxies), plus average Live starts and visits per stable.</p>
${table(["cohort", "stables", "Live win", "ran a Qualifier", "qualified", "ran Weekend Feature", "bred", "sold", "licence 3+", "promoted", "above start credits", "Live starts", "visits"], outcomeRows)}
${d ? `<h2>Balances and ratings at the end</h2>${table(["cohort", "median credits", "p90", "max", "median OR", "p90 OR", "best OR", "licence"], COHORTS.filter((c) => r.meta.cohorts[c]).map((c) => [c, d.balances[c].median, d.balances[c].p90, d.balances[c].max, d.ratings[c].median, d.ratings[c].p90, d.ratings[c].max, d.licence[c]]))}` : ""}
<h2>Credits by ledger kind (whole run)</h2>${table(["kind", "created", "destroyed", "between players"], creditRows)}
${farmerRows.length ? `<h2>Farmers</h2><p class="meta">Alt accounts feeding a main: stud fees for covering the alts' mares with the main's stallion (the main sets the fee to what the alt holds) and ceiling-priced market sales. Fraud events: ${esc(top(r.farmers.fraudEvents).map(([k, v]) => `${k} ${v}`).join(", ") || "none")}.</p>${table(["group", "detection", "main stallion", "alt covers", "stud fees to main", "market to main", "horses to main", "refused buys", "main balance", "alt balances"], farmerRows)}` : ""}
${r.notables ? `<h2>Calendar races and top horses</h2><p class="meta">Every player run in a Feature Qualifier, Weekend Feature or Season Final, and the best-rated player horses at the end.</p>
${r.notables.featureRuns.length ? table(["post time", "race", "min OR", "cohort", "stable", "horse", "OR before", "finish"], r.notables.featureRuns.map((x) => [x.date.slice(0, 16).replace("T", " "), x.race, x.minRating ?? "–", x.cohort, x.stable, x.horse, x.ratingBefore, x.position ?? "–"])) : `<p class="meta">No player horse ran in a calendar race.</p>`}
${table(["horse", "cohort", "stable", "origin", "status", "OR", "peak OR", "starts", "wins"], r.notables.topHorses.map((x) => [x.name, x.cohort, x.stable, x.origin, x.careerStatus, x.rating, x.peakOr, x.starts, x.wins]))}` : ""}
<h2>Refused actions</h2><p class="meta">Server refusals (DomainError codes) by cohort: what the simulated players tried that the rules stopped. Top 8 per cohort.</p>${table(["cohort", "action:code", "count"], refusedRows)}
${r.errors.length ? `<h2>Unexpected exceptions</h2>${table(["time", "stable", "action", "message"], r.errors.slice(0, 30).map((e) => [new Date(e.atMs).toISOString(), e.agent, e.action, e.message]), false)}` : ""}
</main><script>${SCRIPT}</script></body></html>
`;
}

export { sum };
