/**
 * The owner's moment for a first win (visual research V-08): shown once per horse, on the fresh
 * result of the win that was the stable's first or the horse's first (the server says which).
 * "Once" is remembered in the browser per horse; a later visit to the same result, or a replay,
 * never shows it again.
 */
export type FirstWinOf = "stable" | "horse";

export const FIRST_WIN_SEEN_KEY = "pt.firstWinSeen.v1";

type Store = Pick<Storage, "getItem" | "setItem">;

const read = (store: Store | null): string[] => {
  try {
    const v = JSON.parse(store?.getItem(FIRST_WIN_SEEN_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/**
 * Whether to show the moment now: a fresh result, a first win, and this horse's moment not shown
 * before. Claiming it records the horse, so the next call for the same horse is false.
 */
export function claimFirstWinMoment(r: { horseId: string; firstWinOf: FirstWinOf | null | undefined; fresh: boolean }, store: Store | null): boolean {
  if (!r.fresh || !r.firstWinOf) return false;
  const seen = read(store);
  if (seen.includes(r.horseId)) return false;
  try {
    store?.setItem(FIRST_WIN_SEEN_KEY, JSON.stringify([...seen, r.horseId].slice(-200)));
  } catch {
    /* private mode: it may show again, never more than once per visit */
  }
  return true;
}

/** The moment's words. */
export function firstWinWords(of: FirstWinOf, horseName: string, stableName: string | null): { eyebrow: string; title: string; line: string } {
  return of === "stable"
    ? { eyebrow: "Your stable's first winner", title: `${horseName} is led in`, line: `The first win for ${stableName ?? "your colours"}. Every stable remembers its first.` }
    : { eyebrow: "A first win", title: `${horseName} is led in`, line: `${horseName}'s first win. The rosette goes up on the stall door.` };
}
