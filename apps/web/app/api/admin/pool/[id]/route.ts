import { z } from "zod";
import { errorJson, readJson } from "@/server/http";
import { withChainAdmin } from "@/server/chain/http";
import { epochDetail, postEpochWithServer, recordWalletPostedEpoch } from "@/server/chain/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ser = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withChainAdmin(async (ctx) => ser(await epochDetail(ctx, id)));
}

const Schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("post_server") }),
  z.object({ action: z.literal("record_wallet"), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
]);

/** Post the draft's root with the server key, or record a root the owner posted from their wallet (verified on-chain). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Unknown action." });
  return withChainAdmin(async (ctx, now) =>
    ser(parsed.data.action === "post_server" ? await postEpochWithServer(ctx, id, now) : await recordWalletPostedEpoch(ctx, id, parsed.data.txHash, now)),
  );
}
