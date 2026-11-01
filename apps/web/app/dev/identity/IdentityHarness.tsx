"use client";

import { useMemo, useState } from "react";
import * as gc from "@thoroughbred/game-core";
import { FoalReveal } from "@/components/economy/FoalReveal";
import { FirstWinMoment } from "@/components/moments/FirstWinMoment";
import { HorsePortrait } from "@/components/HorsePortrait";
import { GallopSprite } from "@/components/pixel/GallopSprite";
import { PaddockParade } from "@/components/race/PaddockParade";
import { RanchStage } from "@/components/stable/RanchStage";
import { IDENTITY_HORSES, IDENTITY_SILKS, identityAppearance, identityGenome } from "@/dev/identityHorses";
import type { EcoHorse } from "@/lib/economyTypes";
import type { StableHorse } from "@/lib/types";

/**
 * The identity set in every non-race view, side by side (dev): portrait, gallop sprite (still and
 * running), paddock and Ranch. The race views take the same horses at /dev/viewer?coats=identity.
 * `?build=0` draws the painted bodies and hair for comparison. `view` limits the page to one block;
 * view=reveal opens the foal reveal for a real foal bred from two of them (dam=, sire= pick the
 * parents by index, seed= the foal), view=firstwin the first-win owner's moment.
 */
export function IdentityHarness({ view, dam = 4, sire = 3, seed = "identity-foal", of = "stable" }: { view?: string; dam?: number; sire?: number; seed?: string; of?: "stable" | "horse" }) {
  const horses = useMemo(() => IDENTITY_HORSES.map((h, i) => ({ h, a: identityAppearance(h, i) })), []);
  const stable = useMemo(
    () =>
      horses.map(
        ({ h, a }, i) =>
          ({
            id: `id${i}`,
            stage: "prime",
            regNo: `ID-${i + 1}`,
            rating: 60,
            risk: { label: "low", permille: 10, factors: [] },
            condition: "ready",
            block: null,
            lockedRaceId: null,
            geneticsLine: null,
            horse: { id: `id${i}`, name: h.name, sex: i % 2 ? "female" : "male", age: 4, appearance: a },
          }) as unknown as StableHorse,
      ),
    [horses],
  );
  const show = (k: string) => !view || view === k;
  const [open, setOpen] = useState(true);
  if (view === "reveal") {
    const d = IDENTITY_HORSES[dam % IDENTITY_HORSES.length]!;
    const s = IDENTITY_HORSES[sire % IDENTITY_HORSES.length]!;
    const foalGenome = gc.inherit(identityGenome(s), identityGenome(d), seed);
    const appearance = gc.appearanceOf(foalGenome, { racingAge: false, starts: 0, retired: false, young: "foal" }, IDENTITY_SILKS[0]!);
    const foal = { id: "foal", horse: { id: "foal", name: "Little Ember", sex: "filly", appearance }, geneticsLine: gc.geneticsLine(foalGenome), stage: "foal", careerStatus: "racing", starts: 0, rating: 0 } as unknown as EcoHorse;
    return (
      <main style={{ minHeight: "100vh" }}>
        {open && (
          <FoalReveal
            foal={foal}
            eyebrow={`${d.name} has foaled`}
            parents={{ dam: { name: d.name, appearance: identityAppearance(d, dam) }, sire: { name: s.name, appearance: identityAppearance(s, sire) } }}
            onClose={() => setOpen(false)}
          >
            <button type="button" className="btn btn-brass btn-block">
              See the foal in the nursery
            </button>
          </FoalReveal>
        )}
      </main>
    );
  }
  if (view === "firstwin") {
    const h = horses[0]!;
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: 12 }}>
        <FirstWinMoment of={of} horseId="id0" horseName={h.h.name} appearance={h.a} stableName="Moss Lane" raceName="Ashcombe Maiden Stakes" onShare={() => undefined} onClose={() => undefined} />
      </main>
    );
  }
  return (
    <main style={{ background: "#5f845c", padding: 12, color: "#f3ecd8", fontFamily: "monospace", fontSize: 12 }}>
      {show("cells") && (
        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            {horses.map(({ h, a }, i) => (
              <tr key={i} data-identity={i} style={{ borderBottom: "1px solid #2f4a2d" }}>
                <td style={{ width: 150, verticalAlign: "top", padding: 4 }}>
                  <b>{h.name}</b>
                  <br />
                  {h.breed}
                  <br />
                  build {a.build ? `h${a.build.height} l${a.build.leg} n${a.build.neck} g${a.build.girth} hd${a.build.head}` : "-"}
                  <br />
                  hair {a.hair ? `m${a.hair.mane} t${a.hair.tail}${a.hair.thick ? " thick" : ""}${a.hair.wave ? " wavy" : ""}` : "-"}
                </td>
                <td style={{ padding: 4 }}>
                  <HorsePortrait appearance={a} scale={1} />
                </td>
                <td style={{ padding: 4 }}>
                  <GallopSprite appearance={a} scale={1} still={0} />
                </td>
                <td style={{ padding: 4 }}>
                  <GallopSprite appearance={a} scale={1} still={6} />
                </td>
                <td style={{ padding: 4 }} data-gallop-run>
                  <GallopSprite appearance={a} scale={1} fps={8} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {show("paddock") && (
        <div style={{ marginTop: 12, maxWidth: 1100 }} data-identity-paddock>
          <PaddockParade runners={horses.slice(0, 6).map(({ h, a }, i) => ({ id: `id${i}`, name: h.name, gate: i + 1, appearance: a, stableName: "Identity" }) as never)} />
        </div>
      )}
      {show("ranch") && (
        <div style={{ marginTop: 12 }} data-identity-ranch>
          <RanchStage horses={stable} eyebrow="Identity set" title="Ranch" onRace={() => undefined} />
        </div>
      )}
    </main>
  );
}
