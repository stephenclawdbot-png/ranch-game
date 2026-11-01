import { z } from "zod";
import { db } from "@/server/db";
import { playerView } from "@/server/game";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { HorseIdSchema, PlanSchema } from "@/server/planSchema";
import { requireSession } from "@/server/session";
import { createChapterRace, followUpChapterRace } from "@/server/story";
import { trackEvent } from "@/server/playtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A Story chapter race (§4e): solo against the chapter's rival stables, free (no stable
 * entries). The client chooses the race, the horse (or `pick: "auto"`) and the plan; the race
 * is simulated and settled here (capped first-win reward, chapter progress, licences).
 * `instant` skips to the result (Story only).
 * `then`: a follow-up from a chapter race's result page ("Try again"): `raceKey` is the race just run
 * and the server stays in the chapter (followUpChapterRace): the same race while it isn't won, else
 * the suggested one; "suited": the race not yet won that suits the horse best.
 */
const BodySchema = z
  .object({
    raceKey: z.string().regex(/^[a-z]+-\d{1,2}$/),
    pick: z.literal("auto").optional(),
    horseId: HorseIdSchema.optional(),
    plan: PlanSchema.optional(),
    instant: z.boolean().optional(),
    then: z.enum(["again", "suited"]).optional(),
  })
  .refine((b) => b.pick === "auto" || b.horseId !== undefined, { message: 'horseId is required unless pick is "auto"' });

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { issues: parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message) });
  try {
    const database = await db();
    const session = await requireSession(database);
    const now = new Date();
    const b = parsed.data;
    const horseId = b.pick === "auto" ? undefined : b.horseId;
    const raceKey = b.then ? await followUpChapterRace(database, session, b.raceKey, { horseId, suited: b.then === "suited" }, now) : b.raceKey;
    const created = await createChapterRace(database, session, { raceKey, horseId, plan: b.plan, instant: b.instant }, now);
    await trackEvent(database, session.accountId, "race_entered", { kind: "story", chapter: true, instant: !!b.instant });
    return json({ ...created, player: await playerView(database, session, now) }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
