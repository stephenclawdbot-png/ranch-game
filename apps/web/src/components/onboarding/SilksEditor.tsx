"use client";

import type { SilkPattern, Silks as SilksT } from "@thoroughbred/shared";
import { SILK_COLORS, SILK_PATTERNS, contrastRatio } from "@/lib/silks";
import { Silks } from "../Silks";
import { PixelIcon } from "../icons";
import { SceneBackdrop } from "../pixel/SceneBackdrop";

export const NAME_RE = /^[\p{L}\p{N} '&.\-]{2,32}$/u;
const NAME_A = ["Harbourlight", "Ashdown", "Blackthorn", "Kingsfold", "Larkrise", "Moorcroft", "Nettlebed", "Oakwood", "Ravensmoor", "Stonebridge", "Whitecross", "Wildmere", "Foxcote", "Glenmorrow"];
const NAME_B = ["Stables", "Racing", "Lodge", "Stud", "House", "Farm", "Yard"];

export function suggestName(): string {
  const a = NAME_A[Math.floor(Math.random() * NAME_A.length)]!;
  const b = NAME_B[Math.floor(Math.random() * NAME_B.length)]!;
  return `${a} ${b}`;
}

/** The silks on a tack-room stand (barn scene at an integer scale; silks at 6x their 16 px grid). */
export function SilksStand({ silks, name, caption = "Your colours" }: { silks: SilksT; name: string; caption?: string }) {
  return (
    <div className="surface overflow-hidden !p-0">
      <div className="relative flex h-40 items-end justify-center md:h-52">
        <SceneBackdrop variant="barn" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/4 bg-[#2a170c]/40" />
        <Silks silks={silks} className="relative mb-3 h-[120px] w-[96px] drop-shadow-[4px_4px_0_rgba(0,0,0,0.45)]" title="Your racing silks" />
      </div>
      <div className="paper m-2 px-3 py-2 text-center">
        <p className="text-xs font-extrabold text-[#5c4a2e]">{caption}</p>
        <p className="t-display-m truncate" data-testid="preview-name">
          {name.trim() || "Your stable"}
        </p>
      </div>
    </div>
  );
}

/** Stable name input with a dice button. */
export function NameField({ name, onChange }: { name: string; onChange: (n: string) => void }) {
  const valid = NAME_RE.test(name.trim());
  return (
    <div>
      <label htmlFor="stable-name" className="mb-1.5 block font-extrabold">
        Stable name
      </label>
      <div className="flex gap-2">
        <input
          id="stable-name"
          name="stableName"
          value={name}
          maxLength={32}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          className="field min-w-0 flex-1 text-lg font-bold"
          aria-invalid={!valid}
          aria-describedby="name-hint"
        />
        <button type="button" className="btn shrink-0" onClick={() => onChange(suggestName())} aria-label="Suggest another name">
          <PixelIcon name="dice" className="h-6 w-6" />
        </button>
      </div>
      <p id="name-hint" className={`mt-1.5 text-sm ${valid ? "text-sage" : "font-bold text-negative"}`}>
        {valid ? "You can change it any time." : "2–32 characters: letters, numbers, spaces and ’ & . -"}
      </p>
    </div>
  );
}

function Swatches({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-extrabold text-cream-dim">{label}</legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1">
        {SILK_COLORS.map((c) => {
          const selected = c.hex.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={c.hex}
              type="button"
              title={c.name}
              aria-label={`${label}: ${c.name}`}
              aria-pressed={selected}
              onClick={() => onChange(c.hex)}
              className="flex aspect-square min-h-11 items-center justify-center"
            >
              <span
                className="block h-[78%] w-[78%]"
                style={{
                  background: c.hex,
                  boxShadow: selected ? "0 0 0 2px #0b0f0c, 0 0 0 5px #f2c86a" : "0 0 0 2px #0b0f0c",
                }}
              />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Pattern + three colour rows. Warns when body and pattern colours are too close to read in a race. */
export function SilksEditor({ silks, onChange }: { silks: SilksT; onChange: (s: SilksT) => void }) {
  const lowContrast = silks.pattern !== "solid" && contrastRatio(silks.primary, silks.secondary) < 2;
  return (
    <div className="grid gap-5">
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-sm font-extrabold text-cream-dim">Pattern</legend>
        <div className="grid grid-cols-4 gap-1.5">
          {SILK_PATTERNS.map((p) => {
            const selected = silks.pattern === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange({ ...silks, pattern: p.id as SilkPattern })}
                className={`surface-2 flex flex-col items-center gap-1 px-1 pb-1 pt-1.5 text-sm font-bold ${selected ? "is-selected text-cream" : "text-cream-dim hover:brightness-110"}`}
              >
                <Silks silks={{ ...silks, pattern: p.id }} cap={false} className="h-[39px] w-12" />
                {p.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid gap-4 lg:grid-cols-2">
        <Swatches label="Body colour" value={silks.primary} onChange={(hex) => onChange({ ...silks, primary: hex })} />
        <Swatches label="Pattern colour" value={silks.secondary} onChange={(hex) => onChange({ ...silks, secondary: hex })} />
        <Swatches label="Cap" value={silks.cap} onChange={(hex) => onChange({ ...silks, cap: hex })} />
      </div>
      {lowContrast && (
        <p className="text-sm font-bold text-warn" role="status">
          ~ These two colours are close: the pattern may be hard to see in a race.
        </p>
      )}
    </div>
  );
}
