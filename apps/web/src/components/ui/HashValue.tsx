"use client";

import { useState } from "react";

/**
 * A sealed hash or revealed seed: shortened (first 10 … last 6) in monospace instead of a
 * break-all block, with a Copy button that puts the full value on the clipboard (the full
 * value is also the tooltip).
 */
export function HashValue({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const short = value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the full value is still in the tooltip */
    }
  }
  return (
    <span className={`inline-flex max-w-full items-center gap-1 ${className ?? ""}`} title={value}>
      <code className="whitespace-nowrap font-mono text-xs">{short}</code>
      <button type="button" className="btn btn-ghost !min-h-8 px-2 text-xs" onClick={copy} aria-label="Copy the full hash">
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </span>
  );
}
