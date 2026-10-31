/**
 * Writes tools/commentary/phrases.json: every clip id the radio commentary can play, with the
 * text the caster says, the casters and the intensities. render_library.py renders from it;
 * apps/web's commentary test checks it matches the race viewer's vocabulary and that the
 * shipped library covers it.
 *   npx vitest run --config tools/commentary/vitest.config.ts export
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { INTENSITIES, VOCABULARY } from "../../packages/race-viewer/src/call/voice/speech";
import { CASTER_IDS } from "../../packages/race-viewer/src/call/voice/casters";

export function phrasesJson(): string {
  const phrases = Object.fromEntries([...VOCABULARY.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `${JSON.stringify({ casters: CASTER_IDS, intensities: INTENSITIES, phrases }, null, 2)}\n`;
}

it("exports the phrase list", () => {
  const path = fileURLToPath(new URL("./phrases.json", import.meta.url));
  writeFileSync(path, phrasesJson());
  console.log(`${VOCABULARY.size} phrases -> ${path}`);
});
