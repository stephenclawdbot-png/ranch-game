import type { HorseLifeView } from "@/lib/horseLife";
import { SEX_LABEL } from "@/lib/format";
import { formatCredits } from "@/lib/format";
import { HorsePortrait } from "../HorsePortrait";
import { SceneBackdrop } from "../ui/Page";
import { BackLink } from "./common";
import { HorseTabs, type HorseTab } from "./HorseTabs";

/** Compact identity + tabs for the owner's horse sub-pages. */
export function HorseLifeHeader({ view, active }: { view: HorseLifeView; active: HorseTab }) {
  const young = view.care.growth !== null;
  return (
    <div className="grid gap-3">
      <SceneBackdrop scene="barn" />
      <BackLink href={young ? "/nursery" : "/stable"} label={young ? "Nursery" : "Your stable"} />
      <header className="flex items-center gap-3">
        <span className="well grid shrink-0 place-items-center">
          <HorsePortrait appearance={view.horse.appearance} scale="thumb" />
        </span>
        <div className="min-w-0">
          <h1 className="t-page break-words" data-testid="horse-name">
            {view.name}
          </h1>
          <p className="t-meta">
            {view.career.stageLabel} · {SEX_LABEL[view.horse.sex]} · <span className="num text-cream">{formatCredits(view.credits)}</span> credits
          </p>
        </div>
      </header>
      <HorseTabs id={view.id} active={active} />
    </div>
  );
}
