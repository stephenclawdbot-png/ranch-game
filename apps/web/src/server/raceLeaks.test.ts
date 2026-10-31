/**
 * No spoilers, across every client-facing race endpoint: while a locked race is running (post
 * time passed, broadcast not over) nothing a client can GET for that race (the card, the live
 * feed, the replay and verify routes, the entry options, the rivals, the pick, the what-if, the
 * signed-in views, the tote board, the bettor's tote side, the real-money board) may carry the
 * race's seed, its result hash or any runner's finish time. Checked both signed out and signed in
 * as the owner of a runner and as a bettor. The result is learned afterwards from the official
 * replay, so the test knows exactly what must not have leaked.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }),
  headers: async () => new Headers(),
}));

import { confirmToteAdult, createAccount, getRace, getRaceForSimulation, placeToteBet, stableOf } from "@thoroughbred/db";
import { GET as card } from "../../app/api/races/[id]/route";
import { GET as live } from "../../app/api/races/[id]/live/route";
import { GET as me } from "../../app/api/races/[id]/me/route";
import { GET as options } from "../../app/api/races/[id]/options/route";
import { GET as pick } from "../../app/api/races/[id]/pick/route";
import { GET as replay } from "../../app/api/races/[id]/replay/route";
import { GET as rivals } from "../../app/api/races/[id]/rivals/route";
import { GET as tote } from "../../app/api/races/[id]/tote/route";
import { GET as toteMe } from "../../app/api/races/[id]/tote/me/route";
import { GET as toteReal } from "../../app/api/races/[id]/tote/real/route";
import { GET as verify } from "../../app/api/races/[id]/verify/route";
import { GET as whatIf } from "../../app/api/races/[id]/what-if/route";
import { dbHandle } from "./db";
import { driveCard, enterLive, entryOptions, raceList, servedReplay } from "./game";
import { broadcastEndsAtMs } from "./live";

const HOUR = 3_600_000;
const T0 = new Date(Math.ceil((Date.now() + 3 * 24 * HOUR) / HOUR) * HOUR + 7_000);

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const ENDPOINTS: [string, Handler, string][] = [
  ["card", card as Handler, ""],
  ["live", live as Handler, "/live"],
  ["live window", live as Handler, "/live?w=0"],
  ["me", me as Handler, "/me"],
  ["options", options as Handler, "/options"],
  ["pick", pick as Handler, "/pick"],
  ["replay", replay as Handler, "/replay"],
  ["rivals", rivals as Handler, "/rivals"],
  ["tote", tote as Handler, "/tote"],
  ["tote me", toteMe as Handler, "/tote/me"],
  ["tote real", toteReal as Handler, "/tote/real"],
  ["verify", verify as Handler, "/verify"],
  ["what-if", whatIf as Handler, "/what-if"],
];

let raceId: string;
let postTimeMs: number;
let ownerToken: string;
let bettorToken: string;

async function at<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  vi.setSystemTime(ms);
  try {
    return await fn();
  } finally {
    vi.setSystemTime(T0);
  }
}

/** Every endpoint's body (or error body) for one viewer. */
async function sweep(token: string | null): Promise<Record<string, string>> {
  jar.token = token;
  const out: Record<string, string> = {};
  for (const [name, handler, path] of ENDPOINTS) {
    const res = await handler(new Request(`https://tb.example/api/races/${raceId}${path}`), { params: Promise.resolve({ id: raceId }) });
    out[name] = `${res.status} ${await res.text()}`;
  }
  jar.token = null;
  return out;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  const h = await dbHandle();
  const owner = await createAccount(h.db, { stableName: "Leak Owner", silks: { pattern: "hoops", primary: "#223344", secondary: "#556677", cap: "#8899aa" }, timezone: "Europe/London", now: T0 });
  ownerToken = owner.token;
  const p = { accountId: owner.accountId, stable: await stableOf(h.db, owner.accountId) };
  await driveCard(h.db, T0, { force: true });
  const { upcoming } = await raceList(h.db, T0, p.stable.id);
  for (const r of [...upcoming].sort((a, b) => a.postTimeMs - b.postTimeMs)) {
    const ok = (await entryOptions(h.db, p, r.id, T0)).options.find((o) => o.reason === null);
    if (!ok) continue;
    await enterLive(h.db, p, r.id, ok.horseId, { tactic: "stalker", intensity: "normal" }, T0);
    raceId = r.id;
    postTimeMs = r.postTimeMs;
    break;
  }
  expect(raceId).toBeTruthy();
  const bettor = await createAccount(h.db, { stableName: "Leak Punter", silks: { pattern: "hoops", primary: "#334455", secondary: "#667788", cap: "#99aabb" }, timezone: "Europe/London", now: T0 });
  bettorToken = bettor.token;
  await confirmToteAdult(h.db, { accountId: bettor.accountId, now: T0 });
  // a bet just before the off, on the owner's runner's rival (any runner the bettor has no stake in)
  const race = await getRace(h.db, raceId);
  const field = (race!.field as { runners?: { horseId: string }[] } | null)?.runners;
  if (field?.length) {
    await at(postTimeMs - 5_000, () =>
      placeToteBet(h.db, { accountId: bettor.accountId, raceId, horseId: field[field.length - 1]!.horseId, pool: "win", currency: "CR", stake: 20, clientKey: "leak-1", now: new Date() }, { dbClock: false }).catch(() => undefined),
    );
  }
}, 180_000);

afterAll(() => {
  vi.useRealTimers();
});

describe("no endpoint leaks a running race's result or seed", () => {
  it("before the broadcast ends, no client-facing GET carries the seed, the result hash or a finish time (signed out, owner, bettor)", { timeout: 180_000 }, async () => {
    // Mid-race: the post time has passed, the field is locked, the race is simulated server-side.
    const mid = postTimeMs + 20_000;
    const seen = {
      anonymous: await at(mid, () => sweep(null)),
      owner: await at(mid, () => sweep(ownerToken)),
      bettor: await at(mid, () => sweep(bettorToken)),
    };
    // Afterwards: the official replay says what had to stay hidden.
    const h = await dbHandle();
    const seed = (await at(postTimeMs + 3 * HOUR, () => getRaceForSimulation(h.db, raceId, new Date()))).race.seed;
    const official = await at(postTimeMs + 3 * HOUR, () => servedReplay(h.db, raceId, new Date()));
    expect(mid).toBeLessThan(broadcastEndsAtMs(official)); // the sweep really was mid-race
    const secrets = [seed, official.result.resultHash, ...official.result.finishOrder.map((f) => String(f.finishTimeUs))].filter((x) => x && x.length >= 6);
    expect(secrets.length).toBeGreaterThan(2);
    for (const [viewer, bodies] of Object.entries(seen)) {
      for (const [endpoint, body] of Object.entries(bodies)) {
        for (const secret of secrets) expect(body.includes(secret), `${viewer} ${endpoint} leaks ${secret.slice(0, 12)}…`).toBe(false);
      }
    }
    // and the sweep really reached the endpoints (not just 404s)
    expect(seen.anonymous.card).toMatch(/^200 /);
    expect(seen.bettor["tote me"]).toMatch(/^200 /);
  });
});
