"use client";

import { ART_SLOTS, artUrl } from "@/lib/art";
import { useArt } from "./pixel/ArtProvider";
import { PixelGrid, type PixelPalette } from "./pixel/PixelGrid";

/**
 * Pixel icon set, drawn in code (12x12 maps). If the art agent ships a PixelLab icon at
 * `ui/icon-<name>.png`, that file is used instead.
 */
const PAL: PixelPalette = {
  K: "#0b0f0c",
  k: "#2b2f2c",
  Y: "#d9a441",
  y: "#9a6b22",
  W: "#fbe3a1",
  C: "#f3e7c9",
  c: "#bfae86",
  R: "#7a1f1f",
  r: "#b0392e",
  G: "#1f4d35",
  g: "#3f8558",
  B: "#7a4a2a",
  b: "#4a2c18",
  S: "#c9d2d4",
  s: "#7d888b",
  L: "#7fc3ee",
  F: "currentColor",
};

export const ICONS = {
  coin: [
    "...KKKKKK...",
    ".KKYYYYYYKK.",
    ".KYWWYYYYyK.",
    "KYWYyyyyYYyK",
    "KYWyYYYYyYyK",
    "KYYyYYYYyYyK",
    "KYYyYYYYyYyK",
    "KYYyYYYYWYyK",
    "KYYYWWWWYYyK",
    ".KyYYYYYYyK.",
    ".KKyyyyyyKK.",
    "...KKKKKK...",
  ],
  trophy: [
    "..KKKKKKKK..",
    "KKKWYYYYyKKK",
    "KYKWYYYYyKyK",
    "KYKWYYYYyKyK",
    ".KKWYYYYyKK.",
    "...KYYYyK...",
    "....KYyK....",
    "....KYyK....",
    "...KYYYyK...",
    "..KBBBBBbK..",
    "..KBBBBBbK..",
    "..KKKKKKKK..",
  ],
  horseshoe: [
    "...KKKKKK...",
    ".KKYYYYYYKK.",
    "KYYWKKKKYYyK",
    "KYWK....KYyK",
    "KYYK....KYyK",
    "KWKK....KKyK",
    "KYYK....KYyK",
    "KYYK....KYyK",
    "KyKK....KKyK",
    "KYYK....KYyK",
    "KKKK....KKKK",
    "............",
  ],
  stopwatch: [
    "....KKKK....",
    "....KYYK....",
    "...KKKKKK...",
    "..KYYYYYYK..",
    ".KYCCCKCCYK.",
    ".KYCCCKCCyK.",
    ".KYCCCKKCyK.",
    ".KYCCCCCCyK.",
    ".KYcCCCCcyK.",
    "..KyyyyyyK..",
    "...KKKKKK...",
    "............",
  ],
  flag: [
    "KK..........",
    "KbKKKKKKKKK.",
    "KbKCCkkCCkK.",
    "KbKCCkkCCkK.",
    "KbKkkCCkkCK.",
    "KbKkkCCkkCK.",
    "KbKCCkkCCkK.",
    "KbKKKKKKKKK.",
    "KbK.........",
    "KbK.........",
    "KbK.........",
    "KKK.........",
  ],
  star: [
    ".....KK.....",
    "....KWYK....",
    "....KYYK....",
    "KKKKKWYyKKKK",
    "KYWWYYYYYYyK",
    ".KYYYYYYYyK.",
    "..KYYYYYyK..",
    "..KYYYYYyK..",
    ".KYYyKKYYyK.",
    ".KYyK..KYyK.",
    "KyyK....KyyK",
    "KKK......KKK",
  ],
  rosette: [
    "...KKKKKK...",
    "..KrRrRrRK..",
    ".KrRYYYYRrK.",
    ".KRYWYYYyRK.",
    ".KrYYYYYyrK.",
    ".KRYYYYyyRK.",
    "..KrRYYRrK..",
    "...KKKKKK...",
    "...KrKKrK...",
    "..KrRKKRrK..",
    "..KRK..KRK..",
    "..KK....KK..",
  ],
  paddock: [
    "..KK....KK..",
    ".KCCK..KCCK.",
    "KKCcKKKKCcKK",
    "KCCCCCCCCCcK",
    "KKCcKKKKCcKK",
    ".KCcK..KCcK.",
    "KKCcKKKKCcKK",
    "KCCCCCCCCCcK",
    "KKCcKKKKCcKK",
    ".KCcK..KCcK.",
    "GgCcGgGgCcGg",
    "GGGGGGGGGGGG",
  ],
  stable: [
    ".....KK.....",
    "....KCCK....",
    "...KCRRCK...",
    "..KCRRRRCK..",
    ".KCRRKKRRCK.",
    "KCRRRKKRRRCK",
    "KKRRRRRRRRKK",
    ".KRKKKKKKRK.",
    ".KRKCbbCKRK.",
    ".KRKbCCbKRK.",
    ".KRKCbbCKRK.",
    ".KKKKKKKKKK.",
  ],
  shield: [
    ".KKKKKKKKKK.",
    ".KYYYYYYYyK.",
    ".KYGGGGGGyK.",
    ".KYGGGGGCyK.",
    ".KYGGGGCCyK.",
    ".KYCGGCCGyK.",
    ".KYCCCCGGyK.",
    ".KYGCCGGGyK.",
    "..KYGGGGyK..",
    "...KYGGyK...",
    "....KYyK....",
    ".....KK.....",
  ],
  check: [
    "............",
    "..........KK",
    ".........KgK",
    "........KggK",
    "KK.....KggK.",
    "KgK...KggK..",
    "KggK.KggK...",
    ".KggKggK....",
    "..KgggK.....",
    "...KgK......",
    "....K.......",
    "............",
  ],
  cross: [
    "............",
    ".KK......KK.",
    "KrrK....KrrK",
    ".KrrK..KrrK.",
    "..KrrKKrrK..",
    "...KrrrrK...",
    "...KrrrrK...",
    "..KrrKKrrK..",
    ".KrrK..KrrK.",
    "KrrK....KrrK",
    ".KK......KK.",
    "............",
  ],
  play: [
    "..KK........",
    "..KFK.......",
    "..KFFK......",
    "..KFFFK.....",
    "..KFFFFK....",
    "..KFFFFFK...",
    "..KFFFFFK...",
    "..KFFFFK....",
    "..KFFFK.....",
    "..KFFK......",
    "..KFK.......",
    "..KK........",
  ],
  arrow: [
    "....F...",
    "....FF..",
    "FFFFFFF.",
    "FFFFFFFF",
    "FFFFFFF.",
    "....FF..",
    "....F...",
  ],
  sun: [
    "............",
    ".....Y......",
    "..Y..Y..Y...",
    "...KKKKK....",
    "..KWWYYYK...",
    "YYKWYYYYKYY.",
    "..KYYYYyK...",
    "..KYYYyyK...",
    "...KKKKK....",
    "..Y..Y..Y...",
    ".....Y......",
    "............",
  ],
  cloud: [
    "............",
    "............",
    "....KKKK....",
    "...KCCCCK...",
    ".KKCCCCCCKK.",
    "KCCCCCCCCccK",
    "KCCCCCCCcccK",
    ".KKKKKKKKKK.",
    "............",
    "............",
    "............",
    "............",
  ],
  rain: [
    "....KKKK....",
    "...KSSSSK...",
    ".KKSSSSSSKK.",
    "KSSSSSSSSssK",
    "KSSSSSSSsssK",
    ".KKKKKKKKKK.",
    "............",
    "..L...L...L.",
    ".L...L...L..",
    "............",
    "...L...L....",
    "..L...L.....",
  ],
  moon: [
    "............",
    "....KKKK....",
    "...KWWYK....",
    "..KWYYK.....",
    "..KYYK......",
    "..KYYK......",
    "..KYYYK.....",
    "..KyYYYKKK..",
    "...KyyYYYK..",
    "....KKKKK...",
    "............",
    "............",
  ],
  pencil: [
    ".........KK.",
    "........KRrK",
    ".......KYKRK",
    "......KYWYK.",
    ".....KYWYK..",
    "....KYWYK...",
    "...KYWYK....",
    "..KYWYK.....",
    ".KcYYK......",
    ".KCcK.......",
    ".KKK........",
    "............",
  ],
  dice: [
    "............",
    ".KKKKKKKKKK.",
    ".KCCCCCCCcK.",
    ".KCKKCCCCcK.",
    ".KCKKCCCCcK.",
    ".KCCCKKCCcK.",
    ".KCCCKKCCcK.",
    ".KCCCCCKKcK.",
    ".KCCCCCKKcK.",
    ".KcccccccK..",
    ".KKKKKKKKK..",
    "............",
  ],
} as const;

export type IconName = keyof typeof ICONS;

export function PixelIcon({ name, className, title }: { name: IconName; className?: string; title?: string }) {
  const art = useArt(ART_SLOTS.icon(name));
  if (art && name !== "arrow" && name !== "play") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={artUrl(art)} alt={title ?? ""} aria-hidden={title ? undefined : true} className={`pixelated object-contain ${className ?? ""}`} draggable={false} />
    );
  }
  return <PixelGrid rows={ICONS[name]} palette={PAL} className={className} title={title} />;
}

type P = { className?: string };
export const PaddockIcon = ({ className }: P) => <PixelIcon name="paddock" className={className} />;
export const StableIcon = ({ className }: P) => <PixelIcon name="stable" className={className} />;
export const RacesIcon = ({ className }: P) => <PixelIcon name="flag" className={className} />;
export const ClockIcon = ({ className }: P) => <PixelIcon name="stopwatch" className={className} />;
export const ShieldIcon = ({ className }: P) => <PixelIcon name="shield" className={className} />;
export const ArrowIcon = ({ className }: P) => <PixelIcon name="arrow" className={className} />;
export const CoinIcon = ({ className }: P) => <PixelIcon name="coin" className={className} />;

/** The club crest: a brass horseshoe in a green roundel, computed on a 20x20 pixel grid. */
const CREST_ROWS: string[] = (() => {
  const N = 20;
  const rows: string[] = [];
  const inShoe = (x: number, y: number) => {
    const px = x + 0.5;
    const py = y + 0.5;
    const r = Math.hypot(px - 10, py - 9.2);
    const arc = py <= 9.2 && r >= 2.6 && r <= 5.4;
    const legs = py > 9.2 && py <= 14.6 && ((px >= 4.6 && px <= 7.5) || (px >= 12.5 && px <= 15.4));
    return arc || legs;
  };
  for (let y = 0; y < N; y++) {
    let s = "";
    for (let x = 0; x < N; x++) {
      const r = Math.hypot(x + 0.5 - 10, y + 0.5 - 10);
      if (r > 9.7) s += ".";
      else if (r > 8.7) s += "K";
      else if (r > 7.7) s += x + y < 19 ? "W" : "y";
      else if (r > 6.9) s += "Y";
      else if (inShoe(x, y)) s += (x + y) % 7 === 0 ? "y" : x < 9 && y < 9 ? "W" : "Y";
      else if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inShoe(x + dx!, y + dy!))) s += "K";
      else s += y > 13 ? "g" : "G";
    }
    rows.push(s);
  }
  return rows;
})();

export function Crest({ className }: P) {
  const art = useArt(ART_SLOTS.logo);
  if (art) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={artUrl(art)} alt="" aria-hidden className={`pixelated object-contain ${className ?? ""}`} draggable={false} />;
  }
  return <PixelGrid rows={CREST_ROWS} palette={PAL} className={className} />;
}
