/** Friendly, honest note: the demo keeps the stable in this browser only. */
export function StorageNote({ className }: { className?: string }) {
  return (
    <p className={`flex items-start gap-2 text-sm text-cream-dim ${className ?? ""}`} data-testid="storage-note">
      <span aria-hidden className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center bg-surface-2 text-xs font-extrabold text-cream">
        i
      </span>
      <span>
        Your stable is saved in <strong className="text-cream">this browser</strong> on this device. Clearing your browsing data or switching device
        starts a new stable, so keep this browser for now. Accounts that follow you everywhere are on the way.
      </span>
    </p>
  );
}
