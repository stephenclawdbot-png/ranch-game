import { groundView } from "@/server/ground";
import { handleError, json } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ground & weather at every course: the exact going and weather for the days the card has
 * published, then a 4-day outlook (rain chance, likely going). Public: no session needed.
 */
export async function GET() {
  try {
    return json({ ground: groundView(new Date()) });
  } catch (err) {
    return handleError(err);
  }
}
