#!/usr/bin/env bash
# Run a headless Claude Code worker whose model runs on Ollama Cloud (the owner's Ollama Max plan).
#
# Usage: tools/agents/ollama-worker.sh <name> <workdir> <prompt-file> [allowed-tools...]
#   OLLAMA_MODEL  glm-5.3 (default; coding, text only) or kimi-k3 (sees images; design work)
#   OLLAMA_API_KEY  from the cloud environment's secrets (never commit it or paste it in chat)
#   WORKER_OUT    where reports go (default: /tmp/agent-workers)
#
# The worker runs in <workdir> (use a git worktree per ticket), may commit locally, never pushes.
# The lead reviews its report + checks, then merges and pushes.
set -uo pipefail
name=$1; dir=$2; promptf=$3; shift 3
key="${OLLAMA_API_KEY:-$(cat ~/.config/ollama/key 2>/dev/null)}"
[ -n "$key" ] || { echo "OLLAMA_API_KEY is not set" >&2; exit 2; }
out="${WORKER_OUT:-/tmp/agent-workers}"; mkdir -p "$out"
cd "$dir"
# A clean environment, so the child CLI doesn't inherit this hosted session's own provider settings.
env -i PATH="$PATH" HOME="$HOME" \
  HTTPS_PROXY="${HTTPS_PROXY:-}" HTTP_PROXY="${HTTP_PROXY:-}" NO_PROXY="${NO_PROXY:-}" \
  https_proxy="${https_proxy:-}" no_proxy="${no_proxy:-}" NODE_OPTIONS="${NODE_OPTIONS:-}" \
  NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-}" SSL_CERT_FILE="${SSL_CERT_FILE:-}" REQUESTS_CA_BUNDLE="${REQUESTS_CA_BUNDLE:-}" \
  ANTHROPIC_BASE_URL=https://ollama.com ANTHROPIC_AUTH_TOKEN="$key" \
  claude -p "$(cat "$promptf")" --model "${OLLAMA_MODEL:-glm-5.3}" --output-format text --max-turns 150 \
  --allowedTools "$@" > "$out/$name.out" 2> >(grep -v unrecognized_model > "$out/$name.err")
echo "exit=$?" >> "$out/$name.out"
