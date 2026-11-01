import { pushCategoryList } from "@thoroughbred/db";
import { json } from "@/server/http";
import { pushPublicKey } from "@/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phone / desktop alerts: whether they are on for this deployment, the key browsers subscribe
 * with, and the categories that have alerts. `{ enabled: false }` hides every alert control.
 */
export async function GET() {
  const publicKey = pushPublicKey();
  return json(publicKey ? { enabled: true, publicKey, categories: pushCategoryList() } : { enabled: false });
}
