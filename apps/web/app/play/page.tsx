import { playtestConfig } from "@thoroughbred/db";
import { SceneBackdrop } from "@/components/ui/Page";
import { PlayClient } from "./PlayClient";

export const dynamic = "force-dynamic";

/** Found a stable. In the closed playtest (PLAYTEST_MODE=1) an invite code comes first. */
export default function PlayPage() {
  return (
    <>
      <SceneBackdrop scene="barn" />
      <PlayClient playtest={playtestConfig().enabled} />
    </>
  );
}
