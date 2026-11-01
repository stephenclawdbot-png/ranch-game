import { IdentityHarness } from "./IdentityHarness";

export const dynamic = "force-dynamic";

/** The identity set (eight horses of different breeds, builds and manes) in every non-race view (dev). Query: view=cells|paddock|ranch|reveal|firstwin, build=0 (painted bodies and hair); reveal: dam, sire (indexes), seed; firstwin: of=stable|horse. */
export default async function IdentityDevPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  return <IdentityHarness view={one("view")} dam={Number(one("dam") ?? 4)} sire={Number(one("sire") ?? 3)} seed={one("seed") ?? "identity-foal"} of={one("of") === "horse" ? "horse" : "stable"} />;
}
