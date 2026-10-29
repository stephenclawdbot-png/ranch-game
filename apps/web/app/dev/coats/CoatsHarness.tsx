"use client";

import type { HorseAppearance, Silks } from "@thoroughbred/shared";
import { adultCoatName, appearanceOf, generateFoundationGenome, type CoatGenes } from "@thoroughbred/game-core";
import { resolveHorseColors } from "@/lib/art";
import { HorsePortrait } from "@/components/HorsePortrait";
import { GallopSprite } from "@/components/pixel/GallopSprite";

/** Neutral silks so only the coat differs between cells. */
const SILKS: Silks = { primary: "#3a4b5c", secondary: "#e8e4da", pattern: "solid", cap: "#3a4b5c" };

const WILD: CoatGenes = {
  extension: ["E", "E"],
  agouti: ["A", "A"],
  cream: ["n", "n"],
  grey: ["n", "n"],
  roan: ["n", "n"],
  dun: ["n", "n"],
  liver: ["L", "L"],
  sabino: ["n", "n"],
};

const ee: Partial<CoatGenes> = { extension: ["e", "e"] };
const aa: Partial<CoatGenes> = { agouti: ["a", "a"] };
const at: Partial<CoatGenes> = { agouti: ["At", "a"] };
const ll: Partial<CoatGenes> = { liver: ["l", "l"] };
const cr1: Partial<CoatGenes> = { cream: ["Cr", "n"] };
const cr2: Partial<CoatGenes> = { cream: ["Cr", "Cr"] };
const dun: Partial<CoatGenes> = { dun: ["D", "n"] };
const rn: Partial<CoatGenes> = { roan: ["Rn", "n"] };
const gg: Partial<CoatGenes> = { grey: ["G", "n"] };

type Progress = { racingAge: boolean; starts: number; retired: boolean };
const ADULT: Progress = { racingAge: true, starts: 5, retired: false };

interface Row {
  genes: Partial<CoatGenes>;
  progress?: Progress;
  /** Overrides adultCoatName (grey stages, where the adult name is just "Grey"). */
  label?: string;
}

const withoutGrey = (g: Partial<CoatGenes>): CoatGenes => ({ ...WILD, ...g, grey: ["n", "n"] });

const ROWS: Row[] = [
  // base (cream 0)
  { genes: {} },
  { genes: at },
  { genes: ee },
  { genes: { ...ee, ...ll } },
  { genes: aa },
  // one cream
  { genes: cr1 },
  { genes: { ...at, ...cr1 } },
  { genes: { ...ee, ...cr1 } },
  { genes: { ...ee, ...ll, ...cr1 }, label: "Dark palomino" },
  { genes: { ...aa, ...cr1 } },
  // two cream
  { genes: cr2 },
  { genes: { ...ee, ...cr2 } },
  { genes: { ...aa, ...cr2 } },
  // dun
  { genes: dun },
  { genes: { ...ee, ...dun } },
  { genes: { ...aa, ...dun } },
  { genes: { ...cr1, ...dun } },
  { genes: { ...ee, ...cr1, ...dun } },
  // roans (the ticking must sit on each horse's own body colour)
  { genes: rn },
  { genes: { ...aa, ...rn } },
  { genes: { ...ee, ...rn } },
  { genes: { ...dun, ...rn } },
  // grey stages
  { genes: gg, progress: { racingAge: true, starts: 3, retired: false }, label: `Dapple Grey (born ${adultCoatName(withoutGrey(gg))})` },
  { genes: gg, progress: { racingAge: false, starts: 0, retired: false }, label: `${adultCoatName(withoutGrey(gg))} (greying foal)` },
  { genes: gg, progress: { racingAge: true, starts: 30, retired: false } },
];

function cellAppearance(row: Row, i: number): HorseAppearance {
  const genes: CoatGenes = { ...WILD, ...row.genes };
  const genome = { ...generateFoundationGenome(`coat-cell-${i}`, { season: 1 }), coat: genes };
  const a = appearanceOf(genome, row.progress ?? ADULT, SILKS);
  // Pure coat comparison: no white markings, no mane override.
  return { ...a, face: "none", legs: ["none", "none", "none", "none"], maneColor: undefined };
}

function Swatch({ hex, title }: { hex?: string; title: string }) {
  if (!hex) return <span className="h-3 w-6 rounded-sm border border-dashed border-neutral-700" title={`${title}: –`} />;
  return <span className="h-3 w-6 rounded-sm border border-black/40" style={{ background: hex }} title={`${title}: ${hex}`} />;
}

function CoatCell({ name, appearance }: { name: string; appearance: HorseAppearance }) {
  const c = resolveHorseColors(appearance);
  return (
    <div data-testid="coat-cell" className="flex w-full flex-col items-center gap-1 rounded-md border border-neutral-800 bg-[#171310] p-2" title={name}>
      <div className="min-h-5 text-center text-[11px] font-semibold tracking-wide text-[#e8d9b0]">{name}</div>
      <HorsePortrait appearance={appearance} scale={1} codeDrawn title={name} />
      <div className="w-full bg-[#20180f]">
        <GallopSprite appearance={appearance} still={3} fit />
      </div>
      <div className="flex items-center gap-0.5 pt-0.5">
        <Swatch hex={c.body} title="body" />
        <Swatch hex={c.shade} title="shade" />
        <Swatch hex={c.highlight} title="highlight" />
        <Swatch hex={c.mane} title="mane" />
        <Swatch hex={c.points} title="points" />
        <Swatch hex={c.stripe} title="stripe" />
      </div>
    </div>
  );
}

export function CoatsHarness() {
  return (
    <main className="min-h-screen bg-[#14100c] p-3 text-neutral-200">
      <h1 className="mb-1 text-lg font-bold text-[#e8d9b0]">Coat anchors v2</h1>
      <p className="mb-3 max-w-3xl text-xs text-neutral-400">
        Every anchor row of docs/brand-v2/coats/coat-anchors-v2.png, plus roans and grey stages. Each cell: code-drawn
        portrait (scale 1), a still Trackside gallop frame, and the resolved palette (body · shade · highlight · mane ·
        points · stripe).
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {ROWS.map((row, i) => {
          const appearance = cellAppearance(row, i);
          const name = row.label ?? adultCoatName({ ...WILD, ...row.genes });
          return <CoatCell key={i} name={name} appearance={appearance} />;
        })}
      </div>
    </main>
  );
}
