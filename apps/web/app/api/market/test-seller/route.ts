import { listStableHorses } from "@thoroughbred/db";
import { withPlayer } from "@/server/economyHttp";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TEST FIXTURE (never in production): makes the signed-in account meet the seller
 * requirements (8 days old, verified email, 20 settled races) so e2e can list a horse.
 * 404 on any Vercel deployment, and on production builds unless ALLOW_TEST_FIXTURES=1
 * (local QA of a production build only).
 */
export async function POST() {
  if (process.env.VERCEL || process.env.VERCEL_ENV) return errorJson(404, "NOT_FOUND");
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_TEST_FIXTURES !== "1") return errorJson(404, "NOT_FOUND");
  return withPlayer(async (db, session) => {
    const [horse] = await listStableHorses(db, session.stable.id);
    if (!horse) throw new Error("fixture needs a horse");
    // Ids come from the session and the database (UUIDs), never from the request.
    const acc = session.accountId.replace(/[^0-9a-f-]/g, "");
    const stable = session.stable.id.replace(/[^0-9a-f-]/g, "");
    const hid = horse.id.replace(/[^0-9a-f-]/g, "");
    await db.execute(`update accounts set created_at = now() - interval '8 days', email_verified_at = coalesce(email_verified_at, now()) where id = '${acc}'`);
    await db.execute(`
      with r as (
        insert into races (kind, name, race_class, conditions, post_time, entries_close_at, status, seed_commitment, seed)
        select 'quick', 'Fixture ' || g, 'maiden', '{}'::jsonb, now() - g * interval '1 day', now() - g * interval '1 day' - interval '1 minute', 'settled', md5('${acc}' || g), md5('${acc}' || g)
          from generate_series(1, 20) g
        returning id)
      insert into race_entries (race_id, horse_id, stable_id, gate, tactic, snapshot, rating_before)
      select r.id, '${hid}', '${stable}', 1, 'stalker', '{}'::jsonb, 0 from r`);
    return { ok: true };
  });
}
