import { IdentityHarness } from "./IdentityHarness";

export const dynamic = "force-dynamic";

/** The identity set (eight horses of different breeds, builds and manes) in every non-race view (dev). Query: view=cells|paddock|ranch, build=0 (painted bodies and hair). */
export default async function IdentityDevPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const view = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  return <IdentityHarness view={view} />;
}
