/** Route plumbing for /api/admin/*: admin-only (ADMIN_SECRET), JSON errors, no caching. */
import { db, type Db } from "./db";
import { errorJson, handleError, json } from "./http";
import { adminSecret, isAdmin } from "./playtest";

export async function adminRoute<T>(fn: (database: Db, now: Date) => Promise<T>, status = 200) {
  try {
    if (!adminSecret()) return errorJson(404, "NOT_FOUND", { message: "Admin is disabled on this server (ADMIN_SECRET is not set)." });
    if (!(await isAdmin())) return errorJson(401, "admin_required", { message: "Sign in as admin first." });
    return json(await fn(await db(), new Date()), { status });
  } catch (err) {
    return handleError(err);
  }
}
