/** Errors the race and account services throw; http.ts maps them (and DomainError) to responses. */

export class RaceNotFoundError extends Error {
  constructor(id: string) {
    super(`race not found: ${id.slice(0, 40)}`);
    this.name = "RaceNotFoundError";
  }
}

export class TooEarlyError extends Error {
  /** "live": the race is running on the broadcast clock; never carries a finish time. */
  constructor(
    public readonly postTimeMs: number,
    public readonly phase: "upcoming" | "live" = "upcoming",
  ) {
    super(phase === "live" ? "race is still running" : "race has not started yet");
    this.name = "TooEarlyError";
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super("no stable for this browser yet");
    this.name = "UnauthorizedError";
  }
}
