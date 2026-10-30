/** Client-safe shapes of the "Sponsor a race" screen (server: src/server/sponsor.ts). */
import type { RaceClass, Surface } from "@thoroughbred/shared";

export interface SponsorSlotView {
  /** Live card slot index (what the purchase sends). */
  slot: number;
  postTimeMs: number;
  entriesCloseAtMs: number;
  /** The race's own name, and the name it carries once you sponsor it. */
  name: string;
  sponsoredName: string;
  feature: boolean;
  raceClass: RaceClass;
  track: string;
  distanceM: number | null;
  surface: Surface | null;
  purse: number;
  price: number;
  /** Already on the card (entries open). */
  published: boolean;
  raceId: string | null;
  /** Taken: by whom (null while on sale). */
  sponsoredBy: string | null;
  mine: boolean;
  /** Why it can't be bought (null: on sale). */
  block: "sponsored" | "closed" | null;
}

export interface MySponsorshipView {
  id: string;
  raceId: string | null;
  raceName: string | null;
  postTimeMs: number;
  price: number;
  status: "upcoming" | "run" | "refunded";
}

export interface SponsorView {
  credits: number;
  stableName: string;
  /** The viewer's local days in the window ("YYYY-MM-DD"), with the slots on sale each day. */
  days: { date: string; onSale: number }[];
  /** The day listed below. */
  date: string;
  slots: SponsorSlotView[];
  mine: MySponsorshipView[];
  rules: { purseMultiple: number; minPrice: number; windowDays: number; maxUpcoming: number; upcoming: number };
}
