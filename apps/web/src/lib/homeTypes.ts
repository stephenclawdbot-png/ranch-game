/** Home tiles (GET /api/home). Types only: safe to import from client components. */
export interface HomeTiles {
  serverNowMs: number;
  /** Today's Daily Cup. */
  cup: {
    name: string;
    closesAtMs: number;
    entrants: number;
    participationCredits: number;
    mine: { rank: number; entryId: string; badge: string } | null;
    /** You have a horse that can take today's Cup run. */
    canRun: boolean;
  } | null;
  /** Horses not cared for yet today (local date). */
  care: { count: number; foals: number; href: string } | null;
  /** Free Paddock Packs ready to open. */
  freePacks: number;
  /** A mare past her due time: ready to foal. */
  foaling: { pregnancyId: string; damName: string; sireName: string } | null;
  /** A mare in foal (not due yet). */
  carrying: { damName: string; dueAtMs: number } | null;
  /** The next Story race of the current chapter. */
  story: { chapter: number; chapterTitle: string; raceKey: string; raceName: string; wins: number; winsToComplete: number; bestHorse: string | null } | null;
  /** The Club's day-2 gift foal, until its first care session. */
  giftFoal: { id: string; name: string } | null;
}
