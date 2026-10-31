import Link from "next/link";
import type { NewsItemView } from "@/lib/socialTypes";
import { LocalTime } from "../competition/LocalTime";
import { PixelIcon, type IconName } from "../icons";

const ICON: Record<string, IconName> = {
  feature_win: "trophy",
  first_big_win: "star",
  photo_finish: "flag",
  record_purse: "coin",
  season_champion: "laurel",
  league_champion: "laurel",
  jockey_claim_out: "silks-sash",
  jockey_retirement_announced: "silks-sash",
  jockey_retired: "silks-sash",
  sale: "coin",
  claim: "coin",
  hall_of_fame: "laurel",
};

/** The racing news as a list: headline, when, and a link to the race, horse, stable or jockey. */
export function NewsList({ items, testId = "news-list" }: { items: NewsItemView[]; testId?: string }) {
  return (
    <ul className="surface rows" data-testid={testId}>
      {items.map((n) => (
        <li key={n.id}>
          <Link href={n.href} className="row-link items-start gap-3 px-4 py-3" data-testid="racing-news-item" data-kind={n.kind}>
            <PixelIcon name={ICON[n.kind] ?? "star"} size={32} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="t-title block">{n.headline}</span>
              <span className="t-meta block">
                <LocalTime ms={n.atMs} withDate />
              </span>
            </span>
            <span className="chev">›</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
