/**
 * What stops an entry on the Live entry sheet, as one banner (null = nothing: configure away).
 * Shown at the top of the sheet; the plan, extras and jockey steps collapse while it stands, so
 * the player never sets up a race they can't enter.
 */
export interface EntryBlocker {
  title: string;
  detail: string;
}

export function entryBlocker(input: {
  /** Per racing horse: why it can't enter this race (null = eligible). Absent until loaded. */
  options: readonly { horseId: string; reason: string | null }[] | null;
  selected: { id: string; name: string } | null;
  entriesLeft: number;
  entryCost: number;
}): EntryBlocker | null {
  const { options, selected } = input;
  if (!options) return null;
  if (options.length === 0) return { title: "No horse can enter", detail: "You have no horses in training to race." };
  if (!options.some((o) => !o.reason)) {
    const reasons = [...new Set(options.map((o) => o.reason!))];
    return {
      title: "None of your horses can enter this race",
      detail: reasons.length === 1 ? reasons[0]! : "Each horse's reason is under its name below.",
    };
  }
  const own = selected ? options.find((o) => o.horseId === selected.id)?.reason : null;
  if (selected && own) return { title: `${selected.name} can't enter this race`, detail: `${own.replace(/\.$/, "")}. Pick another horse.` };
  if (input.entriesLeft < input.entryCost) {
    return {
      title: "Not enough stable entries",
      detail: `This race takes ${input.entryCost} ${input.entryCost === 1 ? "entry" : "entries"} and you have ${input.entriesLeft}. Entries refill at local midnight.`,
    };
  }
  return null;
}
