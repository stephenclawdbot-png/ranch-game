import { it } from "vitest";
import { createDb, RULES, stableOf } from "@thoroughbred/db";
import { driveCard, quickPickLive } from "@/server/game";
import { foundStable } from "@/server/founding";

it("probe", async () => {
  const t0 = Date.now();
  const h = await createDb({ url: null, pglite: "memory" });
  console.log("db", Date.now() - t0, "slotMs", RULES.slotMs);
  const T0 = new Date(Date.UTC(2026, 10, 2, 0, 0, 0));
  const r = await h.db.execute("select gen_random_uuid() as u");
  console.log(JSON.stringify(r));
  const sessions = [];
  for (let i = 0; i < 12; i++) {
    const acc = await foundStable(h.db, { stableName: `Probe Stable ${i}`, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, inviteCode: null, now: T0 });
    sessions.push({ accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) });
  }
  console.log("accounts", Date.now() - t0);
  let t = T0.getTime();
  const end = t + 86_400_000;
  let settled = 0;
  let steps = 0;
  while (t < end) {
    const now = new Date(t);
    const s0 = Date.now();
    const rep = await driveCard(h.db, now, { force: true, maintenance: true });
    settled += rep?.settled.length ?? 0;
    if (steps % 8 === 0) {
      for (const s of sessions) {
        try {
          await quickPickLive(h.db, s, now);
        } catch (e) {
          /* ignore */
        }
      }
    }
    if (steps % 16 === 0) console.log("step", steps, now.toISOString(), "ms", Date.now() - s0, "settled", settled);
    steps++;
    t += RULES.slotMs;
  }
  console.log("total", Date.now() - t0, "settled", settled);
  await h.close();
}, 3_600_000);
