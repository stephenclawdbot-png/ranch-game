import { db } from "@/server/db";
import { careerStoryById } from "@/server/careerStory";
import { errorJson, handleError, json } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A horse's career story (public, like the horse page): oldest first, highlights marked. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const story = await careerStoryById(await db(), decodeURIComponent(id), new Date());
    if (!story) return errorJson(404, "horse_not_found", { message: "We couldn't find that horse." });
    return json(story);
  } catch (err) {
    return handleError(err);
  }
}
