import { z } from "zod";
import { RunningStyleSchema, SilksSchema } from "@thoroughbred/shared";
import { raceRepository } from "@/server/repository";
import { PLAYER_ID_RE, STARTER_COUNT } from "@/server/demoData";
import { StableNameSchema, quickPick } from "@/server/races";
import { errorJson, json } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Clients choose only which of their horses runs and how it is ridden, or ask for a Quick Pick
 * (`pick: "auto"`). Never speeds or results.
 */
const BodySchema = z
  .object({
    playerId: z.string().regex(PLAYER_ID_RE),
    pick: z.literal("auto").optional(),
    /** Quick Pick: horses run recently, to rotate the stable. */
    exclude: z.array(z.number().int().min(0).max(STARTER_COUNT - 1)).max(STARTER_COUNT).optional(),
    horseIndex: z.number().int().min(0).max(STARTER_COUNT - 1).optional(),
    tactic: RunningStyleSchema.optional(),
    /** Story mode only: these solo races may skip straight to the result. Live races never can. */
    instant: z.boolean().optional(),
    silks: SilksSchema.optional(),
    stableName: StableNameSchema.optional(),
  })
  .refine((b) => b.pick === "auto" || (b.horseIndex !== undefined && b.tactic !== undefined), {
    message: "horseIndex and tactic are required unless pick is \"auto\"",
  });

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson(400, "invalid_json");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return errorJson(400, "invalid_body", { issues: parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message) });
  const { pick, exclude, horseIndex, tactic, ...rest } = parsed.data;
  const chosen = pick === "auto" ? quickPick(rest.playerId, exclude) : { horseIndex: horseIndex!, tactic: tactic!, reason: null };
  const created = await raceRepository().createQuickRace({ ...rest, horseIndex: chosen.horseIndex, tactic: chosen.tactic }, Date.now());
  return json({ ...created, pick: pick === "auto" ? chosen : undefined }, { status: 201 });
}
