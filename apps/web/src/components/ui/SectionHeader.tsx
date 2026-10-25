import Link from "next/link";
import type { ReactNode } from "react";

/** Section title (display-m, 24 px) with an optional quiet link on the right. */
export function SectionHeader({
  id,
  title,
  href,
  linkLabel,
  aside,
}: {
  id?: string;
  title: ReactNode;
  href?: string;
  linkLabel?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3">
      <h2 id={id} className="t-display-m">
        {title}
      </h2>
      {href ? (
        <Link
          href={href}
          className="inline-flex min-h-11 items-center text-sm font-bold text-cream-dim underline decoration-2 underline-offset-4 hover:text-cream"
        >
          {linkLabel}
        </Link>
      ) : (
        aside
      )}
    </div>
  );
}
