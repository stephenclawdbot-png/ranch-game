/** Honest note about where the stable lives: on the server, linked to this browser by a private cookie. */
export function StorageNote({ className }: { className?: string }) {
  return (
    <p className={`flex items-start gap-2 text-sm text-cream-dim ${className ?? ""}`} data-testid="storage-note">
      <span aria-hidden className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center bg-surface-2 text-xs font-extrabold text-cream">
        i
      </span>
      <span>
        Your stable is kept safe on the Club&rsquo;s servers and linked to <strong className="text-cream">this browser</strong> by a private cookie. Clearing
        cookies or switching device loses the link for now; accounts that follow you everywhere are on the way.
      </span>
    </p>
  );
}
