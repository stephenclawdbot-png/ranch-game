"use client";

/**
 * Photo-finish card (REDESIGN §4.3): the result as printed matter worth sharing. Everything on
 * it comes from the settled replay: the winner, the real margin to second ("by a short head"),
 * the winning time, field size, and your own finish, prize and rating change when you ran.
 * "Save image" draws the same card on a canvas (no new dependencies) and shares or downloads
 * the PNG; the link it carries opens the replay at the finish.
 */
import { useState } from "react";
import { formatRaceTime, type RaceReplay } from "@thoroughbred/shared";
import type { RaceCard } from "@/lib/types";
import { formatCredits, formatDistance, ordinal, SURFACE_LABEL } from "@/lib/format";
import { resolveHorseColors } from "@/lib/art";
import { HorsePortrait } from "../HorsePortrait";
import type { Settlement } from "./ResultsSequence";

/** "nose" -> "by a nose", "1 1/4" -> "by 1¼ lengths", "dist" -> "by a distance" (engine labels). */
export function marginPhrase(label: string): string {
  const words: Record<string, string> = { nose: "by a nose", "short head": "by a short head", head: "by a head", neck: "by a neck", dist: "by a distance" };
  if (words[label]) return words[label]!;
  const pretty = label.replace(" 1/4", "¼").replace(" 1/2", "½").replace(" 3/4", "¾").replace(/^1\/2$/, "½").replace(/^3\/4$/, "¾");
  if (pretty === "½") return "by half a length";
  if (pretty === "¾") return "by three-quarters of a length";
  return `by ${pretty} ${pretty === "1" ? "length" : "lengths"}`;
}

export function PhotoFinishCard({ replay, card, highlightHorseId, settlement }: { replay: RaceReplay; card: RaceCard; highlightHorseId?: string; settlement: Settlement | null }) {
  const order = replay.result.finishOrder;
  const winner = order[0];
  const second = order[1];
  const byId = new Map(card.field.map((e) => [e.horse.id, e]));
  const w = winner ? byId.get(winner.horseId) : undefined;
  const mine = highlightHorseId ? order.find((f) => f.horseId === highlightHorseId) : undefined;
  const mineEntry = highlightHorseId ? byId.get(highlightHorseId) : undefined;
  const [busy, setBusy] = useState(false);
  if (!winner || !w) return null;

  const headline = `${w.horse.name} wins${second ? ` ${marginPhrase(second.marginLabel)}` : ""}`;
  const facts = [formatRaceTime(replay.result.winningTimeUs), `${order.length} ran`, `${formatDistance(card.config.distanceM)} ${SURFACE_LABEL[card.config.surface].toLowerCase()}`];
  const yours =
    mine && mineEntry && mine.position !== 1
      ? `${mineEntry.horse.name} ${ordinal(mine.position)}${mine.position > 1 ? `, ${marginPhrase(mine.marginLabel).replace("by ", "")} behind ${ordinal(mine.position - 1)}` : ""}`
      : null;
  const rating =
    settlement && settlement.ratingBefore !== undefined && settlement.ratingAfter != null && settlement.ratingAfter !== settlement.ratingBefore
      ? `rating ${settlement.ratingBefore} → ${settlement.ratingAfter}`
      : null;

  async function saveImage() {
    setBusy(true);
    try {
      const blob = await drawCard({
        race: card.config.name,
        headline,
        facts,
        yours: [yours, settlement && settlement.prize > 0 ? `+${formatCredits(settlement.prize)} credits` : null, rating].filter(Boolean).join(" · ") || null,
        photo: replay.result.photoFinish,
        portrait: w!.horse.appearance,
      });
      const file = new File([blob], `post-time-${card.id.slice(0, 8)}.png`, { type: "image/png" });
      const url = `${window.location.origin}/race/${card.id}?at=finish`;
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: headline, url }).catch(() => undefined);
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="photo-card print" aria-labelledby="photo-h" data-testid="photo-finish-card">
      <div className="photo-card-top">
        <span className="photo-card-portrait">
          <HorsePortrait appearance={w.horse.appearance} scale={1} title={w.horse.name} />
        </span>
        <div className="min-w-0">
          <p className="photo-card-eyebrow">
            {replay.result.photoFinish ? "Photo finish · " : ""}
            {card.config.name}
          </p>
          <h2 id="photo-h" className="photo-card-headline">
            {headline}
          </h2>
        </div>
      </div>
      <p className="photo-card-facts">
        {facts.map((f) => (
          <span key={f}>{f}</span>
        ))}
      </p>
      {(yours || rating || (settlement && settlement.prize > 0)) && (
        <p className="photo-card-yours">
          {[yours, settlement && settlement.prize > 0 ? `+${formatCredits(settlement.prize)} credits` : null, rating].filter(Boolean).join(" · ")}
        </p>
      )}
      <div className="photo-card-actions">
        <button type="button" className="btn btn-sm photo-card-btn" onClick={() => void saveImage()} disabled={busy} data-testid="save-photo-card">
          {busy ? "Drawing…" : "Save image"}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------- canvas export

const W = 1200;
const H = 630;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      line = word;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** The share image (1200 x 630, the social card size): paper card, portrait, real data. */
async function drawCard(d: { race: string; headline: string; facts: string[]; yours: string | null; photo: boolean; portrait: Parameters<typeof resolveHorseColors>[0] }): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  await document.fonts?.ready;
  // paper with an ink keyline and a brass rule
  ctx.fillStyle = "#08150e";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#f6ecd3";
  ctx.fillRect(28, 28, W - 56, H - 56);
  ctx.strokeStyle = "#1d140a";
  ctx.lineWidth = 3;
  ctx.strokeRect(40, 40, W - 80, H - 80);
  ctx.fillStyle = "#d9a441";
  ctx.fillRect(80, 470, W - 160, 3);
  // the winner's portrait (the painted 3/4 head for its coat), nearest-neighbour at 3x
  const portrait = document.querySelector<HTMLImageElement | HTMLCanvasElement>('[data-testid="photo-finish-card"] [data-testid="horse-portrait"]');
  ctx.imageSmoothingEnabled = false;
  if (portrait) {
    try {
      const src = portrait instanceof HTMLImageElement ? await loadImage(portrait.src) : portrait;
      ctx.fillStyle = "#163a28";
      ctx.fillRect(80, 80, 384, 384);
      ctx.drawImage(src, 80, 80, 384, 384);
    } catch {
      /* the card still has every fact without the picture */
    }
  }
  const serif = getComputedStyle(document.documentElement).getPropertyValue("--font-cormorant").trim() || "Georgia";
  const sans = getComputedStyle(document.documentElement).getPropertyValue("--font-nunito").trim() || "sans-serif";
  const score = getComputedStyle(document.documentElement).getPropertyValue("--font-jersey").trim() || "monospace";
  ctx.fillStyle = "#8a5d14";
  ctx.font = `800 22px ${sans}`;
  ctx.fillText(`${d.photo ? "PHOTO FINISH · " : ""}${d.race}`.toUpperCase(), 500, 120, W - 580);
  ctx.fillStyle = "#1d140a";
  ctx.font = `600 64px ${serif}`;
  wrap(ctx, d.headline, W - 580)
    .slice(0, 4)
    .forEach((l, i) => ctx.fillText(l, 500, 200 + i * 70));
  ctx.font = `44px ${score}`;
  ctx.fillText(d.facts.join("   ·   "), 80, 540, W - 160);
  if (d.yours) {
    ctx.fillStyle = "#5a4630";
    ctx.font = `700 26px ${sans}`;
    ctx.fillText(d.yours, 80, 588, W - 300);
  }
  ctx.fillStyle = "#8a5d14";
  ctx.font = `800 22px ${sans}`;
  ctx.textAlign = "right";
  ctx.fillText("POST TIME", W - 80, 588);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
}
