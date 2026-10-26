import Link from "next/link";
import type { ReactNode } from "react";

/** Section head (Design System v2 `h2`: Nunito 800) with an optional quiet link on the right. */
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
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 id={id} className="t-h2">
        {title}
      </h2>
      {href ? (
        <Link href={href} className="link shrink-0">
          {linkLabel} ›
        </Link>
      ) : (
        aside
      )}
    </div>
  );
}
