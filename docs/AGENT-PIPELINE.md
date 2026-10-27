# Agent pipeline: Opus lead + Ollama workers

**Owner decision (2026-10-26):** to stretch the Claude subscription, the Claude session (Opus)
is the **lead** and new hands-on work goes to **Ollama Cloud workers** on the owner's Ollama Max
plan (flat price). The owner wants to be told the plan and to say go **before** new work starts.

| Role | Runs on | Does |
|---|---|---|
| Lead | Claude session (Opus) | Plans, writes tickets, reviews worker reports and diffs, final visual check, merges, pushes; owns money, contracts, security and race-fairness code |
| Coder | `glm-5.3` via Ollama | Well-specified coding tickets, tests, bug fixes, content |
| Designer | `kimi-k3` via Ollama (**can see images**) | UI and page polish: screenshots its own work with Playwright, compares with `docs/brand-v2/` mockups, iterates |
| Escalation | Claude subagent | Only when an Ollama worker fails the same ticket twice, or for big creative leaps |

`glm-5.3` is text only (image requests are refused). Also available on the plan: `kimi-k2.7-code`,
`deepseek-v4-pro`, `mistral-large-4`, `minimax-m3`, `gpt-oss:120b` (list: `GET https://ollama.com/api/tags`).

## Setup (once per environment)

Put the keys in the cloud environment's settings (environment menu → Edit → network secrets or
environment variables), never in the repo or the chat: `OLLAMA_API_KEY`, `PIXELLAB_API_KEY`,
optionally `ANTHROPIC_API_KEY`. A new session picks them up.

## Running a ticket

```bash
git worktree add -b glm/<ticket> /tmp/wt-<ticket> origin/claude/thoroughbred-demo
(cd /tmp/wt-<ticket> && pnpm install --frozen-lockfile --prefer-offline)
OLLAMA_MODEL=glm-5.3 tools/agents/ollama-worker.sh <ticket> /tmp/wt-<ticket> prompt.md \
  Read Edit Write Grep Glob "Bash(npx *)" "Bash(pnpm *)" "Bash(node *)" "Bash(ls *)" "Bash(cat *)" \
  "Bash(git status*)" "Bash(git diff*)" "Bash(git add *)" "Bash(git commit *)" "Bash(git log*)"
```

Run it in the background; the report lands in `/tmp/agent-workers/<ticket>.out`.

## Writing a ticket (the lead's job)

A good ticket stands alone. Include:
1. **Goal and why**, in a sentence or two.
2. **Files to read first** (`docs/HANDOFF.md`, the relevant docs and code paths) and **paths it
   must not touch** (anything another agent owns).
3. **Exact acceptance criteria**, plus the checks to run (`npx tsc --noEmit`, `npx vitest run`,
   `next build`, e2e). For design: the reference mockups, sizes and spacing, pixel rules
   (`docs/art-direction.md`), screenshot sizes (390×844, 1440×900), and a checklist to verify
   against its own screenshots.
4. **Rules:** match the surrounding style, keep `data-testid`s, commit locally with the
   trailer `Co-Authored-By: GLM 5.3 via Ollama <noreply@ollama.com>` (or Kimi K3), never push.
5. **Report format:** under 200 words, with the changes per file and the check results.

## Design work: the lead architects, workers implement (owner rule, 2026-10-27)

Workers don't make design decisions. For anything visual (layout, a new screen, a scene, art,
HUD, copy placement) the lead writes a **design handover** first, and the worker implements
exactly that. Anything the handover doesn't cover is flagged in the worker's report, never
invented. A handover has:

1. **Intent:** what the screen is for, what the player notices first, the one primary action.
2. **Layout at 390 and 1440:** order, alignment, spacing and what wraps or truncates, in the
   design-system tokens (`docs/brand-and-design-v2.md` §4). No new colours or sizes unless the
   handover defines them.
3. **Components:** which existing ones to reuse; exact specs for anything new.
4. **States:** empty, loading, error, long names, many/few items.
5. **A reference mockup made by the lead:** an HTML/SVG wireframe or an annotated screenshot of
   the current page.
6. **Acceptance:** the exact screens and states to screenshot side by side with the mockup, and
   what must not change.
7. **Out of scope:** files and areas the worker doesn't touch.

The lead reviews the result against the mockup and sends precise notes until it matches.
Mechanical polish (wrapping, clipping, alignment, wiring) can still be specified briefly.
Why: in the 2026-10-26 runs Kimi met numeric criteria but missed the look twice (the stalls
"tower", tiny horses on phones); numbers can't judge taste.

## Review and merge

- Routine tickets: read the report and `git diff --stat`, run the checks, then merge.
- **Always read the code** for money, the ledger, contracts, chain, auth or security, and the race
  engine's determinism or no-spoiler rules.
- Design: look at the final 2–3 screenshots and send precise notes back until it meets the bar.
- Cherry-pick or merge into `claude/thoroughbred-demo`, push; ship to `main` only after the
  smoke e2e passes and **the owner says ship**.

## Track record

- 2026-10-26, `glm-5.3`, QA fixes (pool visitor 401, story visitor copy, 404 glyph, Hall order):
  correct first try, tests and build green, merged as `dff47c9`.
