"use client";

import { Diorama } from "./Diorama";
import { DIORAMA_SCENES, type DioramaSceneId } from "./scenes";

/** Page-kit scene names -> diorama scenes (docs/brand-and-design-v2.md §4.7 rule 6). */
const FOR_SCENE: Record<string, DioramaSceneId> = { stable: "yard", barn: "barn", grandstand: "grandstand", paddock: "paddock" };
const isScene = (s: string): s is DioramaSceneId => (DIORAMA_SCENES as readonly string[]).includes(s);

/**
 * Drop-in for an absolutely positioned art box (the page kit's `data-slot="diorama"`, the race
 * stage's pre-race backdrop): the live HD-2D scene, with the static poster shown at once.
 */
export function DioramaSlot({ scene, alt, priority = true }: { scene: string; alt: string; priority?: boolean }) {
  const id = isScene(scene) ? scene : (FOR_SCENE[scene] ?? "yard");
  return <Diorama scene={id} label={alt} aspect={null} priority={priority} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}
