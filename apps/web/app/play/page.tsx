import { playtestConfig } from "@thoroughbred/db";
import { PlayClient } from "./PlayClient";

export const dynamic = "force-dynamic";

/** Found a stable. In the closed playtest (PLAYTEST_MODE=1) an invite code comes first. */
export default function PlayPage() {
  return <PlayClient playtest={playtestConfig().enabled} />;
}
