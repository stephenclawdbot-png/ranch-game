"use client";

import { useEffect, useMemo, useState } from "react";
import type { HorseAppearance } from "@thoroughbred/shared";
import { Diorama } from "../diorama/Diorama";
import { paddockScene } from "../diorama/scenes";
import { SilksIcon } from "../Silks";
import { Saddlecloth } from "./Saddlecloth";

export interface ParadeRunner {
  id: string;
  name: string;
  /** Stall number (0 = not drawn yet). */
  gate: number;
  appearance: HorseAppearance;
  stableName: string;
  form?: string | null;
}

/**
 * The race's own runners walking the paddock (coats + silks), with a rotating nameplate. Used
 * before the field locks on the race page and as the race viewer's paddock during the build-up
 * before the off.
 */
export function PaddockParade({ runners }: { runners: readonly ParadeRunner[] }) {
  const ids = runners.map((r) => r.id).join(",");
  const def = useMemo(
    () => paddockScene(runners.slice(0, 6).map((r) => ({ coat: r.appearance.coat, appearance: r.appearance }))),
    [ids], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [i, setI] = useState(0);
  useEffect(() => {
    if (runners.length < 2) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % runners.length), 3200);
    return () => window.clearInterval(t);
  }, [runners.length]);
  const e = runners[i % Math.max(1, runners.length)];
  return (
    <>
      <Diorama scene="paddock" sceneDef={def} aspect={null} label="The runners parading in the paddock" style={{ position: "absolute", inset: 0 }} />
      {e && (
        <p key={e.id} className="paddock-plate" aria-live="off" data-testid="paddock-plate">
          {e.gate > 0 && <Saddlecloth gate={e.gate} className="!h-6 !w-6 !text-[0.85rem]" />}
          <SilksIcon silks={e.appearance.silks} className="h-6 w-6" />
          <span className="min-w-0 text-left">
            <span className="paddock-name">{e.name}</span>
            <span className="paddock-meta">
              {e.stableName}
              {e.form ? ` · form ${e.form}` : ""}
            </span>
          </span>
        </p>
      )}
    </>
  );
}
