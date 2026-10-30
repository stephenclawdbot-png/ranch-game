import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { RULES } from "../rules";
import { ensureRaceCard } from "../services/card";
import { getBalance } from "../services/ledger";
import { getStable, grantStoryReward, listCardRaces, listInbox, markInboxRead, storyRewardFor, updateStableProfile } from "../services/player";
import { enterRace } from "../services/races";
import { at, makeHorse, memoryDb, MIN, newPlayer, settledAll, T0 } from "./helpers";
import { inboxItems } from "../schema";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

describe("story rewards", () => {
  it("pays the full reward on the first win of a story race, the replay reward after, once per race", async () => {
    const p = await newPlayer(h.db, { credits: 1_000 });
    const first = await grantStoryReward(h.db, { accountId: p.accountId, raceId: "00000000-0000-4000-8000-000000000001", storyKey: "club:maiden:1200", chapter: "club", won: true });
    expect(first).toMatchObject({ amount: gc.STORY_FIRST_WIN_REWARD.club, firstWin: true, duplicate: false });
    const again = await grantStoryReward(h.db, { accountId: p.accountId, raceId: "00000000-0000-4000-8000-000000000001", storyKey: "club:maiden:1200", chapter: "club", won: true });
    expect(again.duplicate).toBe(true);
    const replayWin = await grantStoryReward(h.db, { accountId: p.accountId, raceId: "00000000-0000-4000-8000-000000000002", storyKey: "club:maiden:1200", chapter: "club", won: true });
    expect(replayWin).toMatchObject({ amount: gc.STORY_REPLAY_REWARD, firstWin: false });
    expect(await getBalance(h.db, p.accountId)).toBe(1_000 + gc.STORY_FIRST_WIN_REWARD.club + gc.STORY_REPLAY_REWARD);
    expect(await storyRewardFor(h.db, "00000000-0000-4000-8000-000000000001")).toEqual({ amount: gc.STORY_FIRST_WIN_REWARD.club, firstWin: true });
  });

  it("never exceeds the chapter cap, even with concurrent settlements", async () => {
    const p = await newPlayer(h.db, { credits: 1_000 });
    const keys = Array.from({ length: 14 }, (_, i) => `club:novice:${1000 + i * 100}`);
    const res = await settledAll(
      keys.map((k, i) => grantStoryReward(h.db, { accountId: p.accountId, raceId: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, storyKey: k, chapter: "club", won: true })),
    );
    expect(res.errors).toHaveLength(0);
    const total = res.ok.reduce((s, r) => s + r.amount, 0);
    expect(total).toBe(gc.STORY_CHAPTER_CAP.club);
    expect(await getBalance(h.db, p.accountId)).toBe(1_000 + gc.STORY_CHAPTER_CAP.club);
  });
});

describe("inbox, card listing, profile", () => {
  it("marks a race's inbox items read once", async () => {
    const p = await newPlayer(h.db);
    const [race] = await ensureRaceCard(h.db, at(-60 * MIN));
    await h.db.insert(inboxItems).values({ accountId: p.accountId, kind: "race_result", dedupeKey: "x", title: "t", raceId: race!.id });
    expect(await markInboxRead(h.db, { accountId: p.accountId, raceId: race!.id, now: T0 })).toBe(1);
    expect(await markInboxRead(h.db, { accountId: p.accountId, raceId: race!.id, now: T0 })).toBe(0);
    expect((await listInbox(h.db, p.accountId))[0]?.readAt).not.toBeNull();
  });

  it("lists card races in a window with entry counts", async () => {
    const p = await newPlayer(h.db);
    const card = await ensureRaceCard(h.db, T0);
    const horse = await makeHorse(h.db, p.stableId);
    const target = card.find((r) => r.raceClass !== "listed" && r.raceClass !== "graded" && r.entriesCloseAt > T0)!;
    await enterRace(h.db, { accountId: p.accountId, raceId: target.id, horseId: horse.id, tactic: "front", now: T0, meta: { plan: { tactic: "front", intensity: "normal" } } });
    const list = await listCardRaces(h.db, { from: T0, to: at(RULES.cardHorizonMs), stableId: p.stableId });
    expect(list.length).toBe(card.filter((r) => r.postTime.getTime() <= at(RULES.cardHorizonMs).getTime()).length);
    expect(list.find((r) => r.id === target.id)).toMatchObject({ entered: 1, mine: 1 });
    expect(list.every((r) => !("seed" in r))).toBe(true);
  });

  it("updates the stable name and silks", async () => {
    const p = await newPlayer(h.db);
    await updateStableProfile(h.db, { accountId: p.accountId, name: "  New Name ", silks: { pattern: "solid", primary: "#000000", secondary: "#ffffff", cap: "#ffffff" } });
    expect(await getStable(h.db, p.stableId)).toMatchObject({ name: "New Name", silks: { pattern: "solid" } });
    await expect(updateStableProfile(h.db, { accountId: p.accountId, name: "" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
