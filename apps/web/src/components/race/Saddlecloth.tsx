/** Saddlecloth number tile in the conventional US/UK cloth colours by gate. */
const CLOTH: [string, string][] = [
  ["#c8242f", "#ffffff"],
  ["#f4efe3", "#0b0f0c"],
  ["#2346a8", "#ffffff"],
  ["#f2d24a", "#0b0f0c"],
  ["#1f8a4c", "#ffffff"],
  ["#1a1a1a", "#f2d24a"],
  ["#e8742a", "#0b0f0c"],
  ["#e47aa5", "#0b0f0c"],
  ["#3fb8b0", "#0b0f0c"],
  ["#5b2f8f", "#ffffff"],
  ["#a9b0b8", "#c8242f"],
  ["#9ccc3a", "#0b0f0c"],
];

export function Saddlecloth({ gate, className }: { gate: number; className?: string }) {
  const [bg, fg] = CLOTH[(gate - 1) % CLOTH.length]!;
  return (
    <span
      className={`num inline-flex h-7 w-7 shrink-0 items-center justify-center text-[0.95rem] leading-none ${className ?? ""}`}
      style={{ background: bg, color: fg, boxShadow: "inset 0 -3px 0 rgba(0,0,0,.25), 0 0 0 2px #0b0f0c" }}
      aria-label={`Gate ${gate}`}
    >
      {gate}
    </span>
  );
}
