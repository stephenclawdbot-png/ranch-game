import { RanchHarness } from "./RanchHarness";

export const dynamic = "force-dynamic";

/** The Ranch with N made-up horses (dev): checks horses and name tags stay in view at any width. Query: n (default 8), names=long. */
export default async function RanchDevPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  return <RanchHarness n={Number(one("n") ?? 8)} longNames={one("names") === "long"} />;
}
