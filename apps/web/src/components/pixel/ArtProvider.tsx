"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { pickArt, type ArtFile } from "@/lib/art";

const ArtContext = createContext<ReadonlyMap<string, ArtFile>>(new Map());

/** Makes the list of PixelLab files that exist on disk available to client components. */
export function ArtProvider({ files, children }: { files: ArtFile[]; children: ReactNode }) {
  const map = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  return <ArtContext.Provider value={map}>{children}</ArtContext.Provider>;
}

/** First available file among the candidates, or null (-> draw the code fallback). */
export function useArt(candidates: readonly string[]): ArtFile | null {
  const files = useContext(ArtContext);
  return pickArt(files, candidates);
}
