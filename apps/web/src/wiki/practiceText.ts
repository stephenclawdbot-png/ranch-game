/**
 * Practice mode (USDG_MODE=practice): the wiki says "T-USDG", never plain "USDG" or a dollar
 * amount. Rewrites the text of a server-rendered page tree (strings, children and node props),
 * leaving links, ids, classes and other attributes alone. Server only.
 */
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { isUsdgPracticeMode, practiceUsdgText } from "@thoroughbred/game-core";

const SKIP = new Set(["href", "className", "id", "slug", "src", "alt", "key", "ref", "style", "data-testid", "tone"]);

export function wikiPracticeOn(): boolean {
  return isUsdgPracticeMode(process.env);
}

function rewrite(v: unknown): unknown {
  if (typeof v === "string") return /USDG|\$\d/.test(v) ? practiceUsdgText(v) : v;
  if (Array.isArray(v)) return v.map(rewrite);
  if (isValidElement(v)) {
    const el = v as ReactElement<Record<string, unknown>>;
    // The owner's explainer quotes "USDG is test money (T-USDG)" on purpose: left as written.
    if (el.props && "data-practice-raw" in el.props) return el;
    const next: Record<string, unknown> = {};
    let changed = false;
    for (const [k, val] of Object.entries(el.props ?? {})) {
      if (SKIP.has(k) || typeof val === "function") continue;
      const r = rewrite(val);
      if (r !== val) {
        next[k] = r;
        changed = true;
      }
    }
    if (!changed) return el;
    // Static JSX children go back as arguments (not one array), so React doesn't ask for keys.
    if ("children" in next && Array.isArray(next.children)) {
      const { children, ...rest } = next;
      return cloneElement(el, rest, ...(children as ReactNode[]));
    }
    return cloneElement(el, next);
  }
  return v;
}

/** The node in T-USDG wording (practice mode only). */
export function practiceWiki(node: ReactNode): ReactNode {
  return wikiPracticeOn() ? (rewrite(node) as ReactNode) : node;
}

/** A title or summary in T-USDG wording (practice mode only). */
export function practiceWikiText(s: string): string {
  return wikiPracticeOn() ? practiceUsdgText(s) : s;
}
