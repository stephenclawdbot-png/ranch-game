/**
 * Founding a stable (/play, PlayClient): the screens a new player walks through. Registering
 * itself (the "Register & get my horses" button) is a SUBMIT_MACHINE flow on the form.
 *
 *   form -> key (your login code, skips itself without one) -> mentor (three short screens)
 *        -> welcome (the starters, Race now)
 *
 * Before `form` the page waits for the player (/api/me): a browser that already has a stable is
 * sent on, and a failed load shows Try again (player store, LOAD_MACHINE).
 */
import { defineMachine } from "@thoroughbred/shared";

export const FOUNDING_MACHINE = defineMachine({
  name: "founding",
  storedIn: "PlayClient stage (apps/web/app/play/PlayClient.tsx)",
  states: ["form", "key", "mentor", "welcome"],
  initial: "form",
  terminal: ["welcome"],
  transitions: {
    form: ["key"],
    key: ["mentor"],
    mentor: ["welcome"],
  },
  describe: {
    form: "Name and colours; Register (a submit flow: Registering…, or the error with the button working again).",
    key: "Your key to come back: the stable name and login code (ComeBackKey). Moves on by itself when there is no code.",
    mentor: "The head lad's three short screens (skippable).",
    welcome: "The starters arrive; Race now (a submit flow that leaves for the race page) or Walk into the stable.",
  },
});

export type FoundingStage = (typeof FOUNDING_MACHINE.states)[number];
