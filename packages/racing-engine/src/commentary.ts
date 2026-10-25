/** Short, ready-to-display commentary lines. Variant choice is a pure function of (tick, key). */

function pick(lines: readonly string[], tick: number, key: number): string {
  const i = (Math.imul(tick + 1, 2654435761) ^ Math.imul(key + 7, 40503)) >>> 0;
  return lines[i % lines.length] ?? lines[0] ?? "";
}

export const say = {
  start(raceName: string, runners: number, tick: number): string {
    return pick(
      [`And they're off in the ${raceName}!`, `The gates open and ${runners} runners are away in the ${raceName}!`, `They're racing in the ${raceName}!`],
      tick,
      runners,
    );
  },
  slowStart(name: string, tick: number, key: number): string {
    return pick([`${name} misses the break and is slowly away.`, `${name} stumbles leaving the gate and loses ground.`, `A tardy start from ${name}.`], tick, key);
  },
  earlyLead(name: string, tick: number, key: number): string {
    return pick([`${name} shows early speed and takes up the running.`, `${name} goes to the front.`, `${name} breaks sharply and leads the field.`], tick, key);
  },
  leadChange(name: string, prev: string, tick: number, key: number): string {
    return pick([`${name} takes over from ${prev}!`, `${name} grabs the lead from ${prev}.`, `${prev} is headed, ${name} is in front now.`], tick, key);
  },
  move(name: string, wide: boolean, tick: number, key: number): string {
    return wide
      ? pick([`${name} is making a big move out wide.`, `${name} sweeps around the field.`, `Here comes ${name} on the outside!`], tick, key)
      : pick([`${name} is improving along the rail.`, `${name} is picking them off.`, `${name} is making steady progress.`], tick, key);
  },
  boxedIn(name: string, tick: number, key: number): string {
    return pick([`${name} is boxed in and looking for room.`, `${name} has nowhere to go!`, `Traffic problems for ${name}.`], tick, key);
  },
  kick(name: string, tactic: string, leading: boolean, tick: number, key: number): string {
    if (leading) return pick([`${name} kicks for home!`, `${name} asks for more in front.`], tick, key);
    if (tactic === "closer") return pick([`${name} launches a big late run!`, `${name} is flying from the back!`, `${name} unleashes the closing kick.`], tick, key);
    return pick([`${name} quickens and sets off after the leader.`, `${name} pounces!`, `${name} is ridden and responds.`], tick, key);
  },
  tiring(name: string, tick: number, key: number): string {
    return pick([`${name} is starting to tire.`, `${name} is weakening.`, `${name} has nothing left to give.`], tick, key);
  },
  finalFurlong(leader: string, second: string | null, tick: number): string {
    return second
      ? pick([`A furlong to run and ${leader} leads from ${second}!`, `Into the final furlong, ${leader} in front, ${second} chasing!`], tick, 3)
      : `A furlong to run and ${leader} is in front!`;
  },
  photo(first: string, second: string): string {
    return `Photo finish! ${first} and ${second} hit the line together!`;
  },
  finish(winner: string, label: string, time: string, photo: boolean): string {
    if (photo) return `${winner} gets the verdict by a ${label} in ${time}.`;
    return `${winner} wins by ${marginPhrase(label)} in ${time}!`;
  },
};

/** "1 1/2" -> "1 1/2 lengths", "neck" -> "a neck", "dist" -> "a distance". */
export function marginPhrase(label: string): string {
  if (label === "dist") return "a distance";
  if (label === "1/2") return "half a length";
  if (label === "3/4") return "three-quarters of a length";
  if (label === "1") return "a length";
  if (/^[0-9]/.test(label)) return `${label} lengths`;
  return `a ${label}`;
}
