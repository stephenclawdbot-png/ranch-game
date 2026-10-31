import type { Metadata } from "next";
import { TipstersScreen } from "@/components/picks/TipstersScreen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tipsters" };

export default function TipstersPage() {
  return <TipstersScreen />;
}
