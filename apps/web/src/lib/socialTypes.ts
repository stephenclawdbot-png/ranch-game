/**
 * Rivals, the racing news and the campaign planner, as the pages and the browser get them.
 * Types only: safe to import from client components.
 */
import type { Silks } from "@thoroughbred/shared";

export interface H2HView {
  meetings: number;
  ahead: number;
  behind: number;
  close: number;
  /** The last meeting, with its replay link. */
  last: { raceId: string; raceName: string; atMs: number; ahead: boolean } | null;
}

export interface HorsePairView extends H2HView {
  mineId: string;
  mineName: string;
  theirId: string;
  theirName: string;
}

export interface RivalView extends H2HView {
  stableId: string;
  stableName: string;
  silks: Silks | null;
  /** The closest-fought horse pairs against this stable (most meetings first). */
  pairs: HorsePairView[];
}

export interface NemesisView {
  horseId: string;
  horseName: string;
  stableId: string;
  stableName: string;
  closeBeats: number;
  meetings: number;
}

export interface NewsItemView {
  id: string;
  kind: string;
  headline: string;
  href: string;
  atMs: number;
}

export interface HomeSocialView {
  rivals: RivalView[];
  nemesis: NemesisView | null;
  news: NewsItemView[];
}

export interface PublicStableView {
  id: string;
  name: string;
  silks: Silks | null;
  photoUrl: string | null;
  createdAtMs: number;
  horses: { id: string; name: string; rating: number; starts: number; wins: number; places: number; shows: number }[];
  /** The viewer's record against this stable (null when signed out or your own stable). */
  record: (H2HView & { pairs: HorsePairView[]; rival: boolean }) | null;
  mine: boolean;
  news: NewsItemView[];
}

export interface PlanTargetView {
  id: string;
  horseId: string;
  horseName: string;
  raceId: string | null;
  name: string;
  raceClass: string;
  postTimeMs: number;
  calendar: boolean;
  entry: { opensAtMs: number; closesAtMs: number; state: "not_open" | "open" | "closed" };
  entered: boolean;
  eligibility: string | null;
  freshness: { phase: "peak" | "building" | "fading" | "flat"; text: string; peakFromMs: number | null; peakToMs: number | null };
  clashes: string[];
}

export interface PlanView {
  targets: PlanTargetView[];
  removed: { id: string; horseId: string; horseName: string; name: string; postTimeMs: number; note: string }[];
  /** Most targets per horse. */
  max: number;
}

export interface PlanCandidate {
  slotIndex: number;
  raceId: string | null;
  name: string;
  raceClass: string;
  postTimeMs: number;
  calendar: boolean;
  reason: string | null;
}
