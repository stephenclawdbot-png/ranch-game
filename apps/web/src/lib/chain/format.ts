/** Display helpers for ETH amounts and their USD equivalent (always labelled "≈"). */
export function formatEth(wei: bigint | string, digits = 5): string {
  const w = typeof wei === "string" ? BigInt(wei) : wei;
  const neg = w < 0n;
  const abs = neg ? -w : w;
  const whole = abs / 10n ** 18n;
  const frac = (abs % 10n ** 18n).toString().padStart(18, "0").slice(0, digits).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""} ETH`;
}

export function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "≈ $12.34" from wei at a micro-dollar ETH price. */
export function approxUsd(wei: bigint | string, ethUsdMicros: number | null | undefined): string {
  if (!ethUsdMicros) return "≈ $–";
  const w = typeof wei === "string" ? BigInt(wei) : wei;
  return `≈ ${formatUsdCents(Number((w * BigInt(ethUsdMicros)) / 10n ** 22n))}`;
}

export function shortAddress(a: string | null | undefined): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}
