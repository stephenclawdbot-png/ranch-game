import Link from "next/link";

export type HorseTab = "overview" | "care" | "training" | "career" | "log";

const TABS: { key: HorseTab; label: string; path: string }[] = [
  { key: "overview", label: "Overview", path: "" },
  { key: "care", label: "Care", path: "/care" },
  { key: "training", label: "Training", path: "/training" },
  { key: "career", label: "Career", path: "/career" },
  { key: "log", label: "Log", path: "/log" },
];

/** The owner's tabs on a horse: one level below the horse, never deeper. */
export function HorseTabs({ id, active }: { id: string; active: HorseTab }) {
  return (
    <nav aria-label="Horse sections" className="baize-scope -mx-[var(--gutter)] border-b-2 border-baize-700 md:mx-0">
      <div className="tabs !px-[var(--gutter)] md:!px-0">
        {TABS.map((t) => (
          <Link key={t.key} href={`/horse/${id}${t.path}`} aria-current={t.key === active ? "true" : undefined} data-testid={`tab-${t.key}`} scroll={false}>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
