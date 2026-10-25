/**
 * Persistence boundary. Pages and route handlers depend only on these interfaces.
 *
 * Milestone A ships `DemoRepository`, which is fully stateless (deterministic demo
 * data + signed race ids). Milestone B swaps in a Postgres implementation without
 * touching pages or API routes.
 */
import type { Horse, RaceBroadcastChunk, RaceReplay } from "@thoroughbred/shared";
import { houseStable, parsePlayerHorseId, rivalById, starterHorses, isValidPlayerId } from "./demoData";
import { sliceBroadcast } from "./live";
import {
  computeReplay,
  createQuickRace,
  getRace,
  getReplay,
  listScheduled,
  verifyRace,
  type QuickRaceRequest,
  type RaceCard,
  type RaceSummary,
  type VerifyResult,
} from "./races";

export interface HorseView {
  horse: Horse;
  kind: "rival" | "player";
  /** House stable name for rivals; null for player horses (the name lives with the player). */
  stableName: string | null;
  trainer: string | null;
}

export interface HorseRepository {
  getHorse(id: string): Promise<HorseView | null>;
  /** The player's roster. Demo: six deterministic starters. */
  getStable(playerId: string): Promise<Horse[] | null>;
}

export interface RaceRepository {
  listRaces(nowMs: number): Promise<{ upcoming: RaceSummary[]; recent: RaceSummary[] }>;
  /** Throws RaceNotFoundError. */
  getRace(id: string, nowMs: number): Promise<RaceCard>;
  /** Throws RaceNotFoundError or TooEarlyError (before post time, and while the race is live). */
  getReplay(id: string, nowMs: number): Promise<RaceReplay>;
  /** Live broadcast slice from `fromFrame`; never reveals the outcome before the finish is broadcast. Throws RaceNotFoundError. */
  getLiveChunk(id: string, fromFrame: number, nowMs: number): Promise<RaceBroadcastChunk>;
  createQuickRace(req: QuickRaceRequest, nowMs: number): Promise<{ raceId: string; postTimeMs: number; seedCommitment: string }>;
  verifyRace(id: string, nowMs: number, claimed?: { commitment?: string; resultHash?: string }): Promise<VerifyResult>;
}

export class DemoRepository implements HorseRepository, RaceRepository {
  async getHorse(id: string): Promise<HorseView | null> {
    const rival = rivalById(id);
    if (rival) {
      const stable = houseStable(rival.ownerId);
      return { horse: rival, kind: "rival", stableName: stable?.name ?? null, trainer: stable?.trainer ?? null };
    }
    const p = parsePlayerHorseId(id);
    if (p) {
      const horse = starterHorses(p.playerId)[p.index];
      return horse ? { horse, kind: "player", stableName: null, trainer: null } : null;
    }
    return null;
  }

  async getStable(playerId: string): Promise<Horse[] | null> {
    return isValidPlayerId(playerId) ? starterHorses(playerId) : null;
  }

  async listRaces(nowMs: number) {
    return listScheduled(nowMs);
  }

  async getRace(id: string, nowMs: number) {
    return getRace(id, nowMs);
  }

  async getReplay(id: string, nowMs: number) {
    return getReplay(id, nowMs);
  }

  async getLiveChunk(id: string, fromFrame: number, nowMs: number) {
    return sliceBroadcast(computeReplay(id), fromFrame, nowMs);
  }

  async createQuickRace(req: QuickRaceRequest, nowMs: number) {
    const created = createQuickRace(req, nowMs);
    const card = getRace(created.raceId, nowMs);
    return { ...created, seedCommitment: card.seedCommitment };
  }

  async verifyRace(id: string, nowMs: number, claimed?: { commitment?: string; resultHash?: string }) {
    return verifyRace(id, nowMs, claimed);
  }
}

let instance: DemoRepository | null = null;

export function horseRepository(): HorseRepository {
  return (instance ??= new DemoRepository());
}

export function raceRepository(): RaceRepository {
  return (instance ??= new DemoRepository());
}
