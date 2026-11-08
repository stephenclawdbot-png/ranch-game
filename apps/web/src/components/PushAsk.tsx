"use client";

import { useEffect, useState } from "react";
import { askedBefore, currentSubscription, markAsked, pushConfig, pushSupport, turnOnPush } from "@/lib/push";
import { PixelIcon } from "./icons";
import { moveOr } from "@/lib/machines/guard";
import { PUSH_ASK_MACHINE, type PushAskState as State } from "@/lib/machines/pushAsk";

/**
 * The one ask for phone alerts, at the moment they mean something: right after the player enters
 * a Live race ("Want a ping on your phone when it's off?"). Shown once per device, never on page
 * load; the browser's own prompt only comes from the Yes tap. Later the quiet "Turn on phone
 * alerts" link in Profile → Notifications does the same. Invisible when the server has push off.
 * On iPhone / iPad in a Safari tab it explains Add to Home Screen instead (Safari only delivers
 * alerts to the installed app).
 */
export function PushAsk() {
  // PUSH_ASK_MACHINE: moves are checked (src/lib/machines/pushAsk.ts).
  const [state, setRaw] = useState<State>("hidden");
  const setState = (to: State) => setRaw((from) => moveOr(PUSH_ASK_MACHINE, from, to, "PushAsk"));

  useEffect(() => {
    let live = true;
    void (async () => {
      if (askedBefore()) return;
      const cfg = await pushConfig();
      if (!cfg.enabled || !live) return;
      const support = pushSupport();
      if (support === "ios-install") {
        markAsked();
        setState("ios");
        return;
      }
      if (support !== "ready") return;
      if (await currentSubscription().catch(() => null)) return; // already on here
      if (!live) return;
      markAsked();
      setState("ask");
    })();
    return () => {
      live = false;
    };
  }, []);

  if (state === "hidden") return null;

  const yes = async () => {
    setState("busy");
    const r = await turnOnPush().catch(() => ({ ok: false as const, reason: "failed" as const }));
    setState(r.ok ? "on" : r.reason === "dismissed" || r.reason === "denied" ? "no" : "failed");
  };

  return (
    <div className="surface-2 grid gap-2 p-3" data-testid="push-ask" role="region" aria-label="Phone alerts">
      {state === "ios" ? (
        <>
          <p className="flex items-center gap-2 font-extrabold">
            <PixelIcon name="flag" size={24} /> Want a ping on your phone when it&apos;s off?
          </p>
          <p className="t-meta">
            On iPhone and iPad, alerts need Post Time on your Home Screen: tap <b>Share</b>, then <b>Add to Home Screen</b>, open Post Time from there and turn on phone alerts in Profile.
          </p>
          <button type="button" className="btn justify-self-start" onClick={() => setState("hidden")} data-testid="push-ask-ok">
            Got it
          </button>
        </>
      ) : state === "on" ? (
        <p className="t-meta" role="status" data-testid="push-ask-done">
          Done: this device gets a ping when your race goes to post. Change it any time in Profile → Notifications.
        </p>
      ) : state === "no" ? (
        <p className="t-meta" role="status">
          No problem: the bell at the top will have it. You can turn phone alerts on later in Profile → Notifications.
        </p>
      ) : state === "failed" ? (
        <p className="t-meta" role="status">
          That didn&apos;t work on this browser. The bell at the top will still tell you when it&apos;s off.
        </p>
      ) : (
        <>
          <p className="flex items-center gap-2 font-extrabold">
            <PixelIcon name="flag" size={24} /> Want a ping on your phone when it&apos;s off?
          </p>
          <p className="t-meta">Only for what matters: your race going to post, your result ready to watch, foals and horses back from injury. Quiet at night, a few a day at most.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-brass" disabled={state === "busy"} onClick={() => void yes()} data-testid="push-ask-yes">
              {state === "busy" ? "Turning on…" : "Yes, ping me"}
            </button>
            <button type="button" className="btn" disabled={state === "busy"} onClick={() => setState("hidden")} data-testid="push-ask-no">
              No thanks
            </button>
          </div>
        </>
      )}
    </div>
  );
}
