"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RaceStory } from "@/lib/raceStory";
import type { StableHorse } from "@/lib/types";
import type { RunningStyle } from "@thoroughbred/shared";
import { enterStoryRace, followUpChapterRace } from "../entry/EntryForm";
import { PixelIcon } from "../icons";
import { MentorLine } from "../onboarding/Mentor";
import { ActionBar } from "../ui/ActionBar";
import { ErrorNote } from "../ui/ErrorNote";
import { pushSure } from "@/lib/navigate";

/**
 * The result in one breath (first-hour playtest): Wilf says why it went that way in one sentence,
 * names the ONE change to try, and "Try again" runs a free Story race with that change at once,
 * so the loop race -> why -> adjust -> race is a single tap.
 */
export function Verdict({
  story,
  horse,
  tactic,
  fresh,
  live,
  chapterRaceKey = null,
}: {
  story: RaceStory;
  /** Your runner in your stable now (null when it has left it). */
  horse: StableHorse | null;
  /** The plan it was ridden to in this race. */
  tactic: RunningStyle;
  /** The horse the change suggests instead ("fresh_horse"). */
  fresh: StableHorse | null;
  live: boolean;
  /** A Story chapter race: "Try again" stays in the chapter (followUpChapterRace) instead of an open Story race. */
  chapterRaceKey?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const c = story.change;
  const runner = c?.kind === "fresh_horse" ? fresh : horse;
  const block = runner?.block ?? null;

  async function go() {
    if (!c || !runner) return;
    setBusy(true);
    setError(null);
    try {
      const plan = { tactic: c.kind === "tactic" && c.tactic ? c.tactic : c.kind === "fresh_horse" ? runner.horse.style : tactic, intensity: "normal" as const };
      const suited = c.kind === "suited";
      const { raceId } = chapterRaceKey ? await followUpChapterRace(chapterRaceKey, runner.id, plan, { suited }) : await enterStoryRace(runner.id, plan, suited ? { suited: true } : {});
      pushSure(router, `/race/${raceId}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <section className="frame-hero grid gap-3 p-3 sm:p-4" aria-labelledby="verdict-h" data-testid="verdict" data-kind={story.kind}>
      <h2 id="verdict-h" className="t-h2">
        Why it went that way
      </h2>
      <MentorLine compact>
        <p className="text-[1.0625rem] font-bold leading-7" data-testid="why-reason">
          {story.reason}
        </p>
        {c && (
          <p className="mt-2" data-testid="why-change">
            <span className="tag tag-ready mr-1.5 align-middle">Try this</span>
            {c.text}
          </p>
        )}
      </MentorLine>
      {c && runner && (
        <div className="grid gap-1">
          {block ? (
            <p className="t-meta font-bold" data-testid="try-change-blocked">
              {runner.horse.name}: {block}
            </p>
          ) : (
            <ActionBar>
              <button type="button" className="btn btn-brass btn-lg" onClick={go} disabled={busy} data-testid="try-change">
                <PixelIcon name="flag" size={32} className="-my-2" /> {busy ? "Going to the gates…" : c.label}
              </button>
            </ActionBar>
          )}
          <p className="caption">
            {live
              ? "A free Story race against the Club, straight away: try the change before your next Live race."
              : chapterRaceKey
                ? c.kind === "suited"
                  ? "The chapter race that suits best, straight away: a win counts towards the chapter."
                  : "The same chapter race until it's won, straight away."
                : "A free Story race against the Club, straight away."}
          </p>
        </div>
      )}
      {error !== null && <ErrorNote error={error} />}
    </section>
  );
}
