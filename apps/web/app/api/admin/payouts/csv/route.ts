import { approvedUnpaidCsv } from "@thoroughbred/db";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { errorJson, handleError } from "@/server/http";
import { adminSecret, isAdmin } from "@/server/playtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV of approved, unpaid rewards (wallet, USD, reason) for paying from the operator's wallet. */
export async function GET() {
  try {
    if (!adminSecret()) return errorJson(404, "NOT_FOUND");
    if (!(await isAdmin())) return errorJson(401, "admin_required");
    const csv = await approvedUnpaidCsv(await db());
    return new NextResponse(csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="beta-payouts-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
    });
  } catch (err) {
    return handleError(err);
  }
}
