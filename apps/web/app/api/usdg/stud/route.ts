import { z } from "zod";
import { bookUsdgStud } from "@/server/chain/usdg";
import { withUsdgPlayer } from "@/server/chain/usdgHttp";
import { errorJson, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ sireId: z.string().uuid(), damId: z.string().uuid() });

/**
 * Books a covering by a registered stallion standing for a USDG stud fee: every breeding rule is
 * checked, his slot and your mare are held for the payment window, and the signed StudOrder comes
 * back to pay (straight to his owner's wallet, the market fee to the Club). The covering happens
 * once the payment is verified.
 */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Choose a mare and a stallion." });
  return withUsdgPlayer((ctx, session, now) => bookUsdgStud(ctx, session, parsed.data, now), { status: 201 });
}
