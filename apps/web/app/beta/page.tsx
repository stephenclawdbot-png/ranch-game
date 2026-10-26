import type { Metadata } from "next";
import { BetaScreen } from "@/components/playtest/BetaScreen";

export const metadata: Metadata = { title: "Beta rewards" };

export default function BetaPage() {
  return <BetaScreen />;
}
