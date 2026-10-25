import type { ReactNode } from "react";

/** Pixel stall backdrop for portraits: plank wall, a beam and a straw floor (CSS-only, static). */
export function Stall({ children, className, tone = "wood" }: { children?: ReactNode; className?: string; tone?: "wood" | "green" }) {
  const wall =
    tone === "wood"
      ? "repeating-linear-gradient(90deg, #5e371d 0 20px, #563219 20px 22px, #643b20 22px 42px, #3d2414 42px 44px)"
      : "repeating-linear-gradient(90deg, #1f4d35 0 20px, #1a4330 20px 22px, #24563b 22px 42px, #0f2a1d 42px 44px)";
  return (
    <div className={`relative overflow-hidden ${className ?? ""}`} style={{ background: wall }}>
      <div
        aria-hidden
        className="absolute inset-x-0 top-[14%] h-[10px]"
        style={{ background: "linear-gradient(#7a4f2c 0 2px, #4a2c18 2px 8px, #2a170c 8px)" }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[14%]"
        style={{
          background: "repeating-linear-gradient(90deg, #d8b45e 0 3px, #c49a46 3px 7px, #a97f36 7px 9px, #d0aa54 9px 13px)",
          boxShadow: "inset 0 2px 0 #e6c878",
        }}
      />
      {children}
    </div>
  );
}
