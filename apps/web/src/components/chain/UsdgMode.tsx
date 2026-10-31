"use client";
/**
 * How USDG is shown to players. In practice mode (USDG_MODE=practice, the closed beta) it is test
 * money, "T-USDG": every amount reads "12.50 T-USDG" (never a dollar sign), every sentence says
 * T-USDG, a badge says it has no value, and there is no network or faucet prompt anywhere. The
 * root layout reads the server env and provides the mode; the server stays the authority (it
 * refuses every real-money path in practice mode whatever the page shows).
 */
import { createContext, useContext, useMemo } from "react";
import { formatPracticeUsdg, formatUsdgDollars, formatUsdgToken, practiceUsdgText } from "@thoroughbred/game-core";
import { shortAddress } from "@/lib/chain/format";

const PracticeContext = createContext(false);

export function UsdgModeProvider({ practice, children }: { practice: boolean; children: React.ReactNode }) {
  return <PracticeContext.Provider value={practice}>{children}</PracticeContext.Provider>;
}

export interface UsdgDisplay {
  practice: boolean;
  /** "USDG" or "T-USDG". */
  name: string;
  /** The main amount: "$12.50", or "12.50 T-USDG" in practice mode. */
  dollars(micro: number): string;
  /** "$40.00 USDG" / "40.00 T-USDG". */
  full(micro: number): string;
  /** The exact token amount: "12.5 USDG" / "12.5 T-USDG". */
  token(micro: number): string;
  /** A sentence in the right wording (USDG -> T-USDG, $x -> x T-USDG in practice mode). */
  t(s: string): string;
}

const practiceDollars = (m: number) => `${formatUsdgDollars(m).replace(/^\$/, "")} T-USDG`;

export function usdgDisplay(practice: boolean): UsdgDisplay {
  return practice
    ? { practice, name: "T-USDG", dollars: practiceDollars, full: practiceDollars, token: formatPracticeUsdg, t: practiceUsdgText }
    : { practice, name: "USDG", dollars: formatUsdgDollars, full: (m) => `${formatUsdgDollars(m)} USDG`, token: formatUsdgToken, t: (s) => s };
}

export function useUsdg(): UsdgDisplay {
  const practice = useContext(PracticeContext);
  return useMemo(() => usdgDisplay(practice), [practice]);
}

/** The words every T-USDG surface carries. */
export const PRACTICE_BADGE = "T-USDG · test money, no real value";
export const PRACTICE_EXPLAINER =
  "During the beta, USDG is test money (T-USDG): you sign in with your wallet, nothing is charged and nothing can be withdrawn. Balances may be reset when the beta ends.";

export function PracticeBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`tag tag-you w-fit normal-case ${className}`} data-testid="tusdg-badge">
      {PRACTICE_BADGE}
    </span>
  );
}

/** "My T-USDG: 87.50 T-USDG" with the badge (practice mode only). */
export function PracticeBalance({ micro, className = "" }: { micro: number | null; className?: string }) {
  if (micro === null) return null;
  return (
    <span className={`flex flex-wrap items-center gap-2 ${className}`} data-testid="tusdg-balance">
      <span className="label">Your T-USDG</span>
      <span className="score text-[1.5rem] leading-none">{usdgDisplay(true).dollars(micro)}</span>
      <PracticeBadge />
    </span>
  );
}

/** The signed-in wallet, shortened, as a chip. */
export function WalletChip({ address }: { address: string | null }) {
  if (!address) return null;
  return (
    <span className="tag w-fit normal-case" title={address} data-testid="wallet-chip">
      <span aria-hidden="true">●</span> Wallet {shortAddress(address)}
    </span>
  );
}

/** "$12.50 (12.5 USDG)" or, in practice mode, "12.50 T-USDG". `suffix` goes inside the brackets. */
export function UsdgMoney({ micro, suffix, testId }: { micro: number; suffix?: string; testId?: string }) {
  const u = useUsdg();
  return (
    <span className="num text-cream" data-testid={testId}>
      {u.dollars(micro)}
      {u.practice ? (suffix ? ` (${suffix})` : "") : ` (${u.token(micro)}${suffix ? `, ${suffix}` : ""})`}
    </span>
  );
}

/** "USDG" or "T-USDG" (or a sentence rewritten for practice mode). */
export function UsdgText({ children }: { children: string }) {
  return <>{useUsdg().t(children)}</>;
}

/** One sentence for live money, another for practice mode. */
export function PracticeAware({ live, practice }: { live: string; practice: string }) {
  return <>{useUsdg().practice ? practice : live}</>;
}
