/**
 * Short, ready-to-display commentary lines.
 *
 * Variant choice is a pure function of a per-race offset and how many lines of that kind were
 * already used, so a race never repeats the same phrasing back to back and different races
 * sound different. No randomness is consumed.
 */

const LINES = {
  start: ["And they're off in the {race}!", "The gates open and {n} runners are away in the {race}!", "They're racing in the {race}!"],
  slowStart: ["{a} misses the break and is slowly away.", "{a} stumbles leaving the gate and loses ground.", "A tardy start from {a}."],
  earlyLead: ["{a} shows early speed and takes up the running.", "{a} goes straight to the front.", "{a} breaks sharply and leads the field."],
  leadChange: ["{a} takes over from {b}!", "{a} grabs the lead from {b}.", "{b} is headed, {a} is in front now.", "{a} surges past {b} into the lead!"],
  moveWide: ["{a} is making a big move out wide.", "{a} sweeps around the field.", "Here comes {a} on the outside!"],
  moveInside: ["{a} is improving along the rail.", "{a} is picking them off one by one.", "{a} is making steady progress.", "{a} creeps closer to the leaders."],
  boxedIn: ["{a} is boxed in and looking for room.", "{a} has nowhere to go!", "Traffic problems for {a}.", "{a} is stuck behind a wall of horses."],
  kickLeader: ["{a} kicks for home!", "{a} asks for more in front.", "{a} turns for home and quickens."],
  kickCloser: ["{a} launches a big late run!", "{a} is flying from the back!", "{a} unleashes the closing kick."],
  kickChaser: ["{a} quickens and sets off after the leader.", "{a} pounces!", "{a} is asked for an effort and responds."],
  tiring: ["{a} is starting to tire.", "{a} is weakening.", "{a} has nothing left to give.", "{a} is going backwards now."],
  finalFurlong: ["A furlong to run and {a} leads from {b}!", "Into the final furlong, {a} in front, {b} chasing!", "{a} holds the advantage over {b} with a furlong to go!"],
  finalFurlongAlone: ["A furlong to run and {a} is in front!"],
} as const;

type Kind = keyof typeof LINES;

export class Commentator {
  private readonly used = new Map<Kind, number>();

  /** `offset` should come from the race seed so phrasing varies between races. */
  constructor(private readonly offset: number) {}

  line(kind: Kind, vars: { a?: string; b?: string; race?: string; n?: number }): string {
    const lines: readonly string[] = LINES[kind];
    const k = this.used.get(kind) ?? 0;
    this.used.set(kind, k + 1);
    const tpl = lines[(this.offset + k) % lines.length] ?? lines[0] ?? "";
    return tpl
      .replaceAll("{a}", vars.a ?? "")
      .replaceAll("{b}", vars.b ?? "")
      .replaceAll("{race}", vars.race ?? "")
      .replaceAll("{n}", `${vars.n ?? ""}`);
  }
}

export function photoLine(first: string, second: string): string {
  return `Photo finish! ${first} and ${second} hit the line together!`;
}

export function finishLine(winner: string, label: string, time: string, photo: boolean): string {
  if (photo) return `${winner} gets the verdict by a ${label} in ${time}.`;
  return `${winner} wins by ${marginPhrase(label)} in ${time}!`;
}

/** "1 1/2" -> "1 1/2 lengths", "neck" -> "a neck", "dist" -> "a distance". */
export function marginPhrase(label: string): string {
  if (label === "dist") return "a distance";
  if (label === "1/2") return "half a length";
  if (label === "3/4") return "three-quarters of a length";
  if (label === "1") return "a length";
  if (/^[0-9]/.test(label)) return `${label} lengths`;
  return `a ${label}`;
}
