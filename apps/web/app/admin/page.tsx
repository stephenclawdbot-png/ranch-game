import type { Metadata } from "next";
import { AdminLogin, AdminShell } from "@/components/admin/AdminShell";
import { adminSecret, isAdmin } from "@/server/playtest";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

/** Playtest admin (ADMIN_SECRET): metrics, invites, testers, feedback, manual payouts, reset. */
export default async function AdminPage() {
  if (!(await isAdmin())) return <AdminLogin enabled={!!adminSecret()} />;
  return <AdminShell />;
}
