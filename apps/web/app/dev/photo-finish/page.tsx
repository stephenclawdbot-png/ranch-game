import { PhotoFinishHarness } from "./PhotoFinishHarness";

export const dynamic = "force-dynamic";

/**
 * Photo-finish strip harness (dev only; not linked from the site): crafted finishes
 * (dead heat, short head, neck, wide field) rendered by <PhotoFinish>, plus the share card.
 * Query: `case` (one case only), `animate=0`, `width` (container px, e.g. 390), `card=1`.
 */
export default async function PhotoFinishDevPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  return <PhotoFinishHarness only={q.case} animate={q.animate !== "0"} width={q.width ? Number(q.width) : undefined} card={q.card === "1"} />;
}
