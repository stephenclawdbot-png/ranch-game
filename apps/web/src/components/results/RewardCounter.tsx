"use client";

import { useEffect, useState } from "react";
import { formatCredits, ordinal } from "@/lib/format";
import { prefersCalm } from "@/lib/settings";
import { PixelIcon } from "../icons";

/** Credits roll up (400–900 ms, proportional to the prize) with a coin hop; instant when calm. */
export function useCountUp(target: number, run: boolean): number {
  const [value, setValue] = useState(run && !prefersCalm() ? 0 : target);
  useEffect(() => {
    if (!run || prefersCalm() || target <= 0) {
      setValue(target);
      return;
    }
    const dur = Math.min(900, 400 + target / 20);
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      setValue(Math.round(target * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return value;
}

export function RewardCounter({
  horseName,
  position,
  fieldSize,
  prize,
  fresh,
}: {
  horseName: string;
  position: number;
  fieldSize: number;
  prize: number;
  fresh: boolean;
}) {
  const shown = useCountUp(prize, fresh);
  const done = shown === prize;
  return (
    <section className="surface flex items-center gap-4 p-3 sm:p-4" aria-labelledby="reward-h" data-testid="settlement">
      <span className={done && prize > 0 ? "coin-hop" : ""}>
        <PixelIcon name={position === 1 ? "trophy" : position <= 3 ? "rosette" : "coin"} size={64} />
      </span>
      <div className="min-w-0">
        <h2 id="reward-h" className="font-extrabold">
          {horseName} finished {ordinal(position)} of {fieldSize}
        </h2>
        {prize > 0 ? (
          <>
            <p className="score text-[2.5rem] text-positive" aria-hidden>
              +{formatCredits(shown)}
            </p>
            <p className="text-sm text-cream-dim">
              <span className="sr-only">Plus {formatCredits(prize)} credits, </span>
              {fresh ? "credits added to your stable." : "credits were paid to your stable."}
            </p>
          </>
        ) : (
          <p className="text-cream-dim">Out of the prize money this time. Every run is in the form book.</p>
        )}
      </div>
    </section>
  );
}
