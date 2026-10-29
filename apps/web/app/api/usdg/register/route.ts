import { z } from "zod";
import { registerHorse } from "@/server/chain/usdg";
import { withUsdgPlayer } from "@/server/chain/usdgHttp";
import { errorJson, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ horseId: z.string().uuid(), terms: z.boolean() });

/**
 * Registers a horse for the USDG market: checks every requirement, writes the order row, then
 * returns the signed RegistrationOrder (the wallet pays the fee to the treasury via HorseMarket).
 */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Choose a horse to register." });
  return withUsdgPlayer((ctx, session, now) => registerHorse(ctx, session, { horseId: parsed.data.horseId, termsAccepted: parsed.data.terms }, now), { status: 201 });
}
