"use client";

import { useEffect, useMemo, useState } from "react";
import { marginLabel } from "@thoroughbred/racing-engine";
import { PhotoFinish, craftPhotoReplay, loadPhotoFinishArt, photoFinishModel, renderPhotoShareCard, type CraftedRunner, type PhotoArt } from "@thoroughbred/race-viewer";

const V = 16_500;
const T0 = 72_345_678;
const gap = (mm: number) => Math.ceil((mm * 1_000_000) / V);

/** Gaps (mm) behind the horse ahead, with speed and lane at the line. */
const CASES: Record<string, { title: string; runners: (Omit<CraftedRunner, "crossingUs"> & { gapMm: number })[] }> = {
  "dead-heat": {
    title: "Dead heat",
    runners: [
      { name: "Silver Bramble", gapMm: 0, laneMilli: 1000, speedMmS: 16_600 },
      { name: "Golden Mile", gapMm: 0, laneMilli: 3000, speedMmS: 16_900 },
      { name: "Quiet Riot", gapMm: 1000, laneMilli: 200, speedMmS: 16_200 },
    ],
  },
  "short-head": {
    title: "Short head",
    runners: [
      { name: "Silver Bramble", gapMm: 0, laneMilli: 2000, speedMmS: 16_400 },
      { name: "Golden Mile", gapMm: 300, laneMilli: 600, speedMmS: 16_800 },
      { name: "Quiet Riot", gapMm: 1000, laneMilli: 3400, speedMmS: 16_100 },
      { name: "Harbour Light", gapMm: 1400, laneMilli: 1200, speedMmS: 15_800 },
    ],
  },
  neck: {
    title: "Neck",
    runners: [
      { name: "Velvet Thunder", gapMm: 0, laneMilli: 400, speedMmS: 17_000 },
      { name: "Paper Moon", gapMm: 1000, laneMilli: 2200, speedMmS: 15_600 },
      { name: "Kestrel Bay", gapMm: 600, laneMilli: 1200, speedMmS: 16_300 },
    ],
  },
};

function replayFor(id: string) {
  const c = CASES[id]!;
  let t = T0;
  return craftPhotoReplay({
    name: `The ${c.title} Stakes`,
    marginLabel,
    runners: c.runners.map(({ gapMm, ...r }) => {
      t += gap(gapMm);
      return { ...r, crossingUs: t };
    }),
  });
}

function ShareCard({ id, art }: { id: string; art: PhotoArt }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const model = photoFinishModel(replayFor(id));
    const c = renderPhotoShareCard(model, art, { course: "Ashcombe Downs", stables: Object.fromEntries(model.runners.map((r, i) => [r.horseId, ["Hollow Oak Stud", "Brass Lantern Stables", "Fenwick Yard", "Marsh End"][i % 4]!])) });
    setUrl(c.toDataURL("image/png"));
  }, [id, art]);
  return url ? <img src={url} alt="share card" data-share-card style={{ maxWidth: "100%", display: "block" }} /> : null;
}

export function PhotoFinishHarness({ only, animate, width, card }: { only?: string; animate: boolean; width?: number; card: boolean }) {
  const [art, setArt] = useState<PhotoArt | null>(null);
  useEffect(() => {
    loadPhotoFinishArt("/art").then(setArt, (e) => console.error(e));
  }, []);
  const ids = only && CASES[only] ? [only] : Object.keys(CASES);
  const models = useMemo(() => Object.fromEntries(ids.map((id) => [id, photoFinishModel(replayFor(id))])), [ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <main style={{ background: "#0f2a1d", minHeight: "100vh", padding: 16, color: "#f3e7c9", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      {ids.map((id) => (
        <section key={id} data-case={id} style={{ marginBottom: 28, width: width ?? "100%", maxWidth: "100%" }}>
          <h2 style={{ fontSize: 14, margin: "0 0 6px", color: "#d9a441" }}>{CASES[id]!.title}</h2>
          {art ? <PhotoFinish model={models[id]!} art={art} animate={animate} /> : <p>Loading art…</p>}
          {card && art ? <div style={{ marginTop: 12 }}><ShareCard id={id} art={art} /></div> : null}
        </section>
      ))}
    </main>
  );
}
