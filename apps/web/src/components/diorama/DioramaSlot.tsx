"use client";

import { Diorama } from "./Diorama";
import type { DioramaSceneId } from "./scenes";

/** Page-kit scene names -> diorama scenes (docs/brand-and-design-v2.md §4.7 rule 6). */
const FOR_SCENE: Record<string, DioramaSceneId> = { stable: "yard", barn: "barn", grandstand: "grandstand", paddock: "paddock" };

/**
 * Drop-in for the page kit's `data-slot="diorama"` wrapper (an absolutely positioned box):
 * the live HD-2D scene, with the static poster shown at once.
 */
export function DioramaSlot({ scene, alt, priority = true }: { scene: string; alt: string; priority?: boolean }) {
  return <Diorama scene={FOR_SCENE[scene] ?? "yard"} label={alt} aspect={null} priority={priority} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}
