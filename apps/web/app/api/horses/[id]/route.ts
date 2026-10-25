import { horseRepository } from "@/server/repository";
import { errorJson, json } from "@/server/http";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const view = await horseRepository().getHorse(id);
  if (!view) return errorJson(404, "horse_not_found");
  return json(view, { cache: "public, max-age=3600" });
}
