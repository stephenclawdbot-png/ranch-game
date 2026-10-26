import Link from "next/link";

export type HorseTab = "overview" | "care" | "training" | "career";

const TABS: { key: HorseTab; label: string; path: string }[] = [
  { key: "overview", label: "Overview", path: "" },
  { key: "care", label: "Care", path: "/care" },
  { key: "training", label: "Training", path: "/training" },
  { key: "career", label: "Career", path: "/career" },
];

/** The owner's tabs on a horse: one level below the horse, never deeper. */
export function HorseTabs({ id, active }: { id: string; active: HorseTab }) {
  return (
    <nav aria-label="Horse sections" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="segmented flex w-full min-w-max md:w-fit">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/horse/${id}${t.path}`}
            aria-current={t.key === active ? "true" : undefined}
            className="flex flex-1 items-center justify-center"
            data-testid={`tab-${t.key}`}
            scroll={false}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
