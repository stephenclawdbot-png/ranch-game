/**
 * The race seal's wording, by where the race is (trust copy: it must never claim more than is
 * true). The seed is committed when the card is drawn (its fingerprint is public from then);
 * the field is sealed when entries close; the seed is revealed with the official result.
 */
export type SealState = "committed" | "sealed" | "revealed" | "verified";

export function sealState(input: { fieldLocked: boolean; revealed: boolean; verified: boolean }): SealState {
  if (input.verified) return "verified";
  if (input.revealed) return "revealed";
  return input.fieldLocked ? "sealed" : "committed";
}

export interface SealCopy {
  /** The panel heading. */
  title: string;
  /** One or two sentences under it. */
  body: string;
  /** The short badge on the race header. */
  badge: string;
}

/** `fingerprint` is the shortened seed commitment. */
export function sealCopy(state: SealState, fingerprint: string): SealCopy {
  switch (state) {
    case "committed":
      return {
        title: "Seed committed",
        body: `The seed is committed: its fingerprint is published now and the field is sealed when entries close. Fingerprint ${fingerprint}.`,
        badge: "Committed",
      };
    case "sealed":
      return { title: "Sealed race", body: `The outcome was locked when entries closed. Fingerprint ${fingerprint}.`, badge: "Sealed" };
    case "revealed":
      return {
        title: "Sealed race · result revealed",
        body: "The secret seed is now public. Verify re-checks it against the fingerprint published before the off and re-runs the race.",
        badge: "Sealed ✓",
      };
    case "verified":
      return {
        title: "Verified race",
        body: "The revealed seed matches the fingerprint published before the off, and re-running the race gives the same result.",
        badge: "Sealed ✓",
      };
  }
}
