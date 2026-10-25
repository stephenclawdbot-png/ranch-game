import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HorseDetail } from "@/components/horse/HorseDetail";
import { horseRepository } from "@/server/repository";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const view = await horseRepository().getHorse((await params).id);
  return { title: view?.horse.name ?? "Horse not found" };
}

export default async function HorsePage({ params }: { params: Promise<{ id: string }> }) {
  const view = await horseRepository().getHorse((await params).id);
  if (!view) notFound();
  return <HorseDetail view={view} />;
}
