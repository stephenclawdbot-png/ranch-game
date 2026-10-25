import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HorseDetail } from "@/components/horse/HorseDetail";
import { db } from "@/server/db";
import { horseDetail } from "@/server/game";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";

async function load(id: string) {
  const database = await db();
  return horseDetail(database, id, await getSession(database), new Date());
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const view = await load((await params).id);
  return { title: view?.horse.name ?? "Horse not found" };
}

export default async function HorsePage({ params }: { params: Promise<{ id: string }> }) {
  const view = await load((await params).id);
  if (!view) notFound();
  return <HorseDetail view={view} />;
}
