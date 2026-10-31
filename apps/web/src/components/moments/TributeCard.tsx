import Link from "next/link";
import type { TributeView } from "@/lib/types";
import { formatCredits } from "@/lib/format";
import { PixelIcon, type IconName } from "../icons";

/** Icon per moment kind (game-core MomentKind, plus the League recap). */
export const MOMENT_ICON: Record<string, IconName> = {
  quirk: "binoculars",
  improver: "star",
  exact: "papers",
  scan: "papers",
  first_win: "rosette",
  first_feature: "trophy",
  retired: "laurel",
  legacy: "laurel",
  memorial: "lantern",
  week_recap: "medallion",
};

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * A retired horse's record on one card: starts, wins, places, earnings, peak rating and the best
 * win with its replay. `memorial` (a horse lost to a race injury) keeps it quiet: muted colours,
 * no celebration, the race named plainly.
 */
export function TributeCard({
  name,
  tribute,
  memorial,
  className,
}: {
  name: string;
  tribute: TributeView;
  memorial?: { atMs: number; raceId: string | null; raceName: string | null; cause?: string | null } | null;
  className?: string;
}) {
  const t = tribute;
  const cells: [string, string][] = [
    ["Starts", String(t.starts)],
    ["Wins", String(t.wins)],
    ["2nd", String(t.places)],
    ["3rd", String(t.shows)],
    ["Earned", `${formatCredits(t.earnings)} cr`],
    ["Peak OR", t.peakOr > 0 ? String(t.peakOr) : "–"],
  ];
  return (
    <div className={`grid gap-3 border-2 p-3 ${memorial ? "border-line bg-inset" : "border-brass-lo bg-inset"} ${className ?? ""}`} data-testid={memorial ? "memorial-card" : "tribute-card"}>
      <p className="flex items-center gap-2 font-bold">
        <PixelIcon name={memorial ? "lantern" : "laurel"} size={32} />
        <span className={memorial ? "text-cream-dim" : "text-brass-hi"}>{memorial ? `In memoriam · ${name}` : `${name}'s career`}</span>
      </p>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-6">
        {cells.map(([k, v]) => (
          <div key={k}>
            <dt className="label">{k}</dt>
            <dd className="num font-bold text-cream">{v}</dd>
          </div>
        ))}
      </dl>
      {t.bestWin ? (
        <p className="text-sm">
          Best win: <b>{t.bestWin.raceName}</b> ({day(t.bestWin.atMs)}{t.bestWin.purse > 0 ? `, purse ${formatCredits(t.bestWin.purse)} cr` : ""}) ·{" "}
          <Link href={`/race/${t.bestWin.raceId}`} className="link font-bold" data-testid="best-win-replay">
            Watch the replay
          </Link>
        </p>
      ) : t.wins === 0 ? (
        <p className="text-sm text-cream-dim">No wins on the record{t.starts > 0 ? `, ${t.starts} ${t.starts === 1 ? "start" : "starts"} given` : ""}.</p>
      ) : null}
      {memorial && (
        <p className="text-sm text-cream-dim">
          Lost {memorial.raceName ? <>in the {memorial.raceId ? <Link href={`/race/${memorial.raceId}`} className="link">{memorial.raceName}</Link> : memorial.raceName}</> : "to a race injury"}{memorial.cause ? ` (${memorial.cause.toLowerCase()})` : ""} on {day(memorial.atMs)}. The record stays in your books and the Hall, and any foals carry the line on.
        </p>
      )}
    </div>
  );
}
