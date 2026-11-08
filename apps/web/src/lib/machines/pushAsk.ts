/**
 * The one phone-alerts ask after a Live entry (PushAsk).
 *
 *   hidden -> ask (Yes / No thanks) -> busy (the browser's prompt, then subscribing) -> on | no | failed
 *   hidden -> ios (Add to Home Screen first) -> hidden (Got it)
 *
 * `busy` always ends: the browser's own prompt is the player's to answer, and every step after
 * it (service worker ready, subscribe, save) gives up after a timeout (src/lib/push.ts).
 */
import { defineMachine } from "@thoroughbred/shared";

export const PUSH_ASK_MACHINE = defineMachine({
  name: "pushAsk",
  storedIn: "PushAsk state (apps/web/src/components/PushAsk.tsx)",
  states: ["hidden", "ask", "ios", "busy", "on", "no", "failed"],
  initial: "hidden",
  terminal: ["on", "no", "failed"],
  transitions: {
    hidden: ["ask", "ios"],
    ask: ["busy", "hidden"],
    ios: ["hidden"],
    busy: ["on", "no", "failed"],
  },
  describe: {
    hidden: "Nothing shown: asked before on this device, alerts off on the server, unsupported, already on, or dismissed.",
    ask: "Want a ping when it's off? Yes / No thanks.",
    ios: "iPhone / iPad in a Safari tab: how to add Post Time to the Home Screen first.",
    busy: "Turning on… (both buttons disabled). Ends with the browser's answer, or a timeout after it.",
    on: "Done: this device gets a ping.",
    no: "Declined or dismissed: the bell will have it.",
    failed: "Didn't work in this browser: the bell will still tell you.",
  },
});

export type PushAskState = (typeof PUSH_ASK_MACHINE.states)[number];
