/**
 * Keeps docs/state-machines-ui.md honest: its generated block must be exactly what UI_MACHINES
 * gives today. After changing a machine:
 *
 *   cd apps/web && BAKE_MACHINES=1 pnpm exec vitest run src/lib/machines/doc.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UI_MACHINES } from "./index";
import { machinesMarkdown, replaceGenerated } from "./doc";

const DOC = join(dirname(fileURLToPath(import.meta.url)), "../../../../../docs/state-machines-ui.md");
const BAKE = process.env.BAKE_MACHINES === "1";

describe("docs/state-machines-ui.md", () => {
  it("shows every UI machine as declared (BAKE_MACHINES=1 rewrites it)", () => {
    const doc = readFileSync(DOC, "utf8");
    const fresh = replaceGenerated(doc, machinesMarkdown(UI_MACHINES));
    if (BAKE && fresh !== doc) writeFileSync(DOC, fresh);
    expect(BAKE ? fresh : doc, "docs/state-machines-ui.md is stale: run with BAKE_MACHINES=1").toBe(fresh);
  });

  it("names every machine in the doc's generated block", () => {
    const block = machinesMarkdown(UI_MACHINES);
    for (const m of UI_MACHINES) {
      expect(block).toContain(`### \`${m.name}\``);
      expect(block).toContain(m.toMermaid());
    }
  });
});
