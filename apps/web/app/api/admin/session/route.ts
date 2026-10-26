import { z } from "zod";
import { errorJson, json, readJson } from "@/server/http";
import { adminSecret, checkAdminSecret, clearAdminCookie, setAdminCookie } from "@/server/playtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ secret: z.string().min(1).max(200) });

/** Admin sign-in: the ADMIN_SECRET becomes an httpOnly cookie (a hash of it, 12 h). */
export async function POST(req: Request) {
  if (!adminSecret()) return errorJson(404, "NOT_FOUND", { message: "Admin is disabled on this server (ADMIN_SECRET is not set)." });
  const parsed = Schema.safeParse(await readJson(req));
  // A small fixed delay blunts guessing.
  await new Promise((r) => setTimeout(r, 400));
  if (!parsed.success || !checkAdminSecret(parsed.data.secret)) return errorJson(401, "admin_denied", { message: "That isn't the admin secret." });
  const res = json({ ok: true });
  setAdminCookie(res);
  return res;
}

/** Admin sign-out. */
export async function DELETE() {
  const res = json({ ok: true });
  clearAdminCookie(res);
  return res;
}
