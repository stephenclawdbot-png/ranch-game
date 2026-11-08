/**
 * The generated half of docs/state-machines-ui.md: one section per machine in UI_MACHINES (where
 * it lives, a Mermaid diagram, what each state means). Between the BEGIN / END markers; the rest
 * of the doc is written by hand. doc.test.ts fails when the doc is stale.
 */
import type { Machine } from "@thoroughbred/shared";

export const DOC_BEGIN = "<!-- BEGIN GENERATED: UI_MACHINES (BAKE_MACHINES=1 to refresh) -->";
export const DOC_END = "<!-- END GENERATED: UI_MACHINES -->";

export function machineSection(m: Machine<string>): string {
  const lines = [`### \`${m.name}\``, ""];
  if (m.storedIn) lines.push(`Lives in: ${m.storedIn}.`, "");
  lines.push("```mermaid", m.toMermaid(), "```", "");
  lines.push("| State | Initial | Terminal | Moves to | Meaning |", "|---|---|---|---|---|");
  for (const s of m.states) {
    const next = m.next(s);
    lines.push(
      `| \`${s}\` | ${m.initialStates.includes(s) ? "yes" : ""} | ${m.isTerminal(s) ? "yes" : ""} | ${next.length ? next.map((n) => `\`${n}\``).join(", ") : "-"} | ${(m.describe?.[s] ?? "").replace(/\|/g, "\\|")} |`,
    );
  }
  return lines.join("\n");
}

export function machinesMarkdown(machines: readonly Machine<string>[]): string {
  return [DOC_BEGIN, "", ...machines.map((m) => `${machineSection(m)}\n`), DOC_END].join("\n");
}

/** `doc` with its generated block replaced by `block` (throws when the markers are missing). */
export function replaceGenerated(doc: string, block: string): string {
  const a = doc.indexOf(DOC_BEGIN);
  const b = doc.indexOf(DOC_END);
  if (a < 0 || b < a) throw new Error("docs/state-machines-ui.md: generated block markers not found");
  return doc.slice(0, a) + block + doc.slice(b + DOC_END.length);
}
