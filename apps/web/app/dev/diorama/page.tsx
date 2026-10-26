import { DioramaHarness } from "./DioramaHarness";

export const dynamic = "force-dynamic";

/**
 * HD-2D diorama harness (dev): every scene, with a reduced-motion toggle and live fps.
 * Query: scene=<id> (one scene, full width), motion=auto|still|live, quality=high|low, h=<css px>, poster=1 (posters only).
 */
export default async function DioramaDevPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  return <DioramaHarness scene={one("scene")} motion={one("motion")} quality={one("quality")} h={one("h")} poster={one("poster")} />;
}
