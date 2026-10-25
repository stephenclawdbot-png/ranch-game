import type { ReactNode } from "react";

/**
 * Pixel stall backdrop for portraits: plank wall, a beam, straw floor — CSS-only pixel art
 * in layers so the portrait can float in front with parallax.
 */
export function Stall({ children, className, tone = "wood" }: { children?: ReactNode; className?: string; tone?: "wood" | "green" }) {
  const wall =
    tone === "wood"
      ? "repeating-linear-gradient(90deg, #6b3f22 0 20px, #5e371d 20px 22px, #734628 22px 42px, #3d2414 42px 44px)"
      : "repeating-linear-gradient(90deg, #1f4d35 0 20px, #1a4330 20px 22px, #24563b 22px 42px, #0f2a1d 42px 44px)";
  return (
    <div className={`relative overflow-hidden ${className ?? ""}`} style={{ background: wall }}>
      {/* light shaft, dithered */}
      <div
        aria-hidden
        className="parallax absolute inset-0 opacity-60"
        style={{
          ["--depth" as string]: 4,
          background: "repeating-linear-gradient(115deg, transparent 0 40%, rgba(242,200,106,.16) 40% 52%, transparent 52% 100%)",
        }}
      />
      {/* beam */}
      <div aria-hidden className="absolute inset-x-0 top-[18%] h-[10px]" style={{ background: "linear-gradient(#8a5a32 0 2px, #4a2c18 2px 8px, #2a170c 8px)" }} />
      {/* straw floor */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[16%]"
        style={{
          background:
            "repeating-linear-gradient(90deg, #e8c46a 0 3px, #d2a64e 3px 7px, #b98a3a 7px 9px, #e0b85c 9px 13px), linear-gradient(#f0cf7a, #d2a64e)",
          boxShadow: "inset 0 3px 0 #f6dc8f, 0 -3px 0 rgba(0,0,0,.35)",
        }}
      />
      {/* vignette in hard steps */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: "radial-gradient(closest-side, transparent 0 70%, rgba(0,0,0,.18) 70% 85%, rgba(0,0,0,.32) 85%)" }}
      />
      {children}
    </div>
  );
}
