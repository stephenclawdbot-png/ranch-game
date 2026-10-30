#!/usr/bin/env bash
# Run a headless Claude Code worker on the owner's Anthropic API key (pay-as-you-go credits).
#
# Usage: tools/agents/api-worker.sh <name> <workdir> <prompt-file> <max-usd> [allowed-tools...]
#   API_MODEL    claude-opus-5-5 (default)
#   ANTHROPIC_API_KEY  from the environment, else ~/.config/anthropic/key (never commit it or paste it in chat)
#   WORKER_OUT   where reports go (default: /tmp/agent-workers)
#
# <max-usd> caps the run's spend (--max-budget-usd). The result JSON ($WORKER_OUT/<name>.json) carries
# the final report and total_cost_usd, which the lead adds to the running total.
# The worker runs in <workdir> (use a git worktree per ticket), may commit locally, never pushes.
set -uo pipefail
name=$1; dir=$2; promptf=$3; budget=$4; shift 4
key="${ANTHROPIC_API_KEY:-$(cat ~/.config/anthropic/key 2>/dev/null)}"
[ -n "$key" ] || { echo "ANTHROPIC_API_KEY is not set" >&2; exit 2; }
out="${WORKER_OUT:-/tmp/agent-workers}"; mkdir -p "$out"
cd "$dir"
# A clean environment, so the child CLI doesn't inherit this hosted session's own provider settings.
env -i PATH="$PATH" HOME="$HOME" \
  HTTPS_PROXY="${HTTPS_PROXY:-}" HTTP_PROXY="${HTTP_PROXY:-}" NO_PROXY="${NO_PROXY:-}" \
  https_proxy="${https_proxy:-}" no_proxy="${no_proxy:-}" NODE_OPTIONS="${NODE_OPTIONS:-}" \
  NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-}" SSL_CERT_FILE="${SSL_CERT_FILE:-}" REQUESTS_CA_BUNDLE="${REQUESTS_CA_BUNDLE:-}" \
  ANTHROPIC_API_KEY="$key" \
  claude -p "$(cat "$promptf")" --model "${API_MODEL:-claude-opus-5-5}" --output-format json --max-turns 200 \
  --max-budget-usd "$budget" --allowedTools "$@" > "$out/$name.json" 2> "$out/$name.err"
echo "exit=$?" >> "$out/$name.err"
