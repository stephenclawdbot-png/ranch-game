import type { HorseLifeView } from "@/lib/horseLife";
import { SEX_LABEL } from "@/lib/format";
import { formatCredits } from "@/lib/format";
import { HorsePortrait } from "../HorsePortrait";
import { SceneStrip, type StillSceneName } from "../ui/Page";
import { BackLink } from "./common";
import { HorseTabs, type HorseTab } from "./HorseTabs";

/** Each sub-page opens on its own picture (graphics round 2): the grooming bay, the gallops, the trophy shelf, the logbook desk. */
const HERO: Record<Exclude<HorseTab, "overview">, { scene: StillSceneName; alt: string }> = {
  care: { scene: "grooming-bay", alt: "A grey being sponged down in the grooming bay" },
  training: { scene: "trainer-gallops", alt: "The trainer timing two horses at the top of the gallops" },
  career: { scene: "trophy-shelf", alt: "A shelf of silver cups and rosettes" },
  log: { scene: "logbook-desk", alt: "The stable logbook open on the desk by the half-door" },
};

/** Compact identity + tabs for the owner's horse sub-pages. */
export function HorseLifeHeader({ view, active }: { view: HorseLifeView; active: HorseTab }) {
  const young = view.care.growth !== null;
  return (
    <div className="grid gap-3">
      {active !== "overview" && <SceneStrip scene={HERO[active].scene} alt={HERO[active].alt} testId="horse-hero" />}
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
