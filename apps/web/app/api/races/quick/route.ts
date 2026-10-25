import { z } from "zod";
import { RunningStyleSchema, SilksSchema } from "@thoroughbred/shared";
import { raceRepository } from "@/server/repository";
import { PLAYER_ID_RE, STARTER_COUNT } from "@/server/demoData";
import { StableNameSchema } from "@/server/races";
import { errorJson, json } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clients choose only which of their horses runs and how it is ridden. Never speeds or results. */
const BodySchema = z.object({
  playerId: z.string().regex(PLAYER_ID_RE),
  horseIndex: z.number().int().min(0).max(STARTER_COUNT - 1),
  tactic: RunningStyleSchema,
  silks: SilksSchema.optional(),
  stableName: StableNameSchema.optional(),
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
  const created = await raceRepository().createQuickRace(parsed.data, Date.now());
  return json(created, { status: 201 });
}
