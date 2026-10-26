import { json } from "@/server/http";
import { chainError } from "@/server/chain/http";
import { priceService } from "@/server/chain/price";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ETH/USD median (for "≈ $" labels). Cached server-side for <= 45 s. */
export async function GET() {
  try {
    const p = await priceService().get();
    return json({ usd: p.usd, micros: p.micros, fetchedAtMs: p.fetchedAtMs, sources: p.sources.map((s) => ({ source: s.source, usd: s.usd })) }, { cache: "public, max-age=30" });
  } catch (err) {
    return chainError(err);
  }
}
