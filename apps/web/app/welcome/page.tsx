"use client";

import { useRouter } from "next/navigation";
import { PlayerGate } from "@/components/PlayerGate";
import { MentorWelcome } from "@/components/onboarding/Mentor";

/** The mentor's welcome, any time (from Stable steps, the wiki's Quick start, or Home before it was seen). */
export default function WelcomePage() {
  const router = useRouter();
  return <PlayerGate>{() => <MentorWelcome onDone={() => router.push("/")} doneLabel="Back to the Estate" />}</PlayerGate>;
}
