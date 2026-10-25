import { ordinal } from "@/lib/format";

const MEDAL: Record<number, { bg: string; fg: string; edge: string }> = {
  1: { bg: "#f2c86a", fg: "#2a1a05", edge: "#9a6b22" },
  2: { bg: "#d5dde0", fg: "#1c2427", edge: "#7d888b" },
  3: { bg: "#d08a4e", fg: "#2a1405", edge: "#7a4a2a" },
};

/** Square pixel position badge (gold/silver/bronze for the podium; the number is always shown). */
export function PositionBadge({ position, size = "md" }: { position: number; size?: "sm" | "md" | "lg" }) {
  const m = MEDAL[position];
  const dim = size === "sm" ? "h-7 w-8 text-sm" : size === "lg" ? "h-12 w-14 text-xl" : "h-9 w-10 text-base";
  return (
    <span
      className={`num flex shrink-0 items-center justify-center ${dim}`}
      style={{ background: m?.bg ?? "#0a1912", color: m?.fg ?? "#cdbf9c", boxShadow: `inset 0 -3px 0 ${m?.edge ?? "#050b08"}, 0 0 0 2px #0b0f0c` }}
    >
      {ordinal(position)}
    </span>
  );
}
