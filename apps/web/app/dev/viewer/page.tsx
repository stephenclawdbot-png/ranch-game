import { ViewerHarness, type HarnessParams } from "./Harness";

export const dynamic = "force-dynamic";

/** Visual test harness for the race viewer (dev only). Query: weather, surface, horses, seed, distance, t, start, paused, camera, quality, highlight, art=none, pixel, live, studio. */
export default async function ViewerDevPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  const params: HarnessParams = {
    weather: one("weather"),
    surface: one("surface"),
    horses: one("horses"),
    seed: one("seed"),
    distance: one("distance"),
    t: one("t"),
    start: one("start"),
    studio: one("studio"),
    phase: one("phase"),
    quality: one("quality"),
    camera: one("camera"),
    highlight: one("highlight"),
    paused: one("paused"),
    gallop: one("gallop"),
    drive: one("drive"),
    art: one("art"),
    pixel: one("pixel"),
    live: one("live"),
  };
  return <ViewerHarness params={params} />;
}
