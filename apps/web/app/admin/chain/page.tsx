import type { Metadata } from "next";
import { AdminLogin } from "@/components/admin/AdminShell";
import { ChainAdmin } from "@/components/chain/admin/ChainAdmin";
import { adminSecret, isAdmin } from "@/server/playtest";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Chain", robots: { index: false, follow: false } };

/** Deploy the beta contracts from the owner's wallet, see them live, claim the affiliate root. */
export default async function AdminChainPage() {
  if (!(await isAdmin())) return <AdminLogin enabled={!!adminSecret()} />;
  return <ChainAdmin />;
}
