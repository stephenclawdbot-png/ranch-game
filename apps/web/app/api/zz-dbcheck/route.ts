import { NextResponse } from "next/server";
import { createAccount, getBalance } from "@thoroughbred/db";
import { db, dbHandle } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const d = await db();
  const acc = await createAccount(d, { stableName: "Check", silks: {} });
  return NextResponse.json({ driver: (await dbHandle()).driver, balance: await getBalance(d, acc.accountId) });
}
