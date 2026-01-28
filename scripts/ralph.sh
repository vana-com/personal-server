#!/usr/bin/env bash
set -euo pipefail

# Ralph loop runner
#
# Usage:
#   ./ralph.sh <prompt_file>               # unlimited iterations
#   ./ralph.sh <prompt_file> 10            # max 10 iterations
#
# Notes:
# - This script assumes you have Claude Code CLI and jq installed.
# - Default command is Claude Code in headless mode (override via RALPH_AGENT_CMD).
# - Uses --output-format stream-json + jq for real-time streaming output.
# - We intentionally keep this script close to the Ralph playbook: dumb outer loop,
#   shared state in files + git, minimal orchestration.

# --- Dependencies -----------------------------------------------------------
command -v jq >/dev/null 2>&1 || { echo "Error: jq is required but not found" >&2; exit 1; }

# --- Paths ------------------------------------------------------------------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$ROOT_DIR/.."

# --- Parse arguments ---------------------------------------------------------
if [[ -z "${1:-}" ]]; then
  echo "Usage: $0 <prompt_file> [max_iterations]" >&2
  exit 1
fi

PROMPT_FILE="$1"
# Resolve relative paths against REPO_DIR
if [[ ! "$PROMPT_FILE" = /* ]]; then
  PROMPT_FILE="$REPO_DIR/$PROMPT_FILE"
fi

MAX_ITERATIONS=0
if [[ "${2:-}" =~ ^[0-9]+$ ]]; then
  MAX_ITERATIONS="$2"
fi

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Error: prompt file not found: $PROMPT_FILE" >&2
  exit 1
fi

# --- jq filters for stream-json output ---------------------------------------
STREAM_TEXT='select(.type == "assistant").message.content[]? | select(.type == "text").text // empty | gsub("\n"; "\r\n") | . + "\r\n\n"'
FINAL_RESULT='select(.type == "result").result // empty'

# --- Agent command configuration ---------------------------------------------
AGENT_CMD_DEFAULT=(claude -p --dangerously-skip-permissions --output-format stream-json --verbose)
if [[ -n "${RALPH_AGENT_CMD:-}" ]]; then
  # shellcheck disable=SC2206
  AGENT_CMD=($RALPH_AGENT_CMD)
else
  AGENT_CMD=("${AGENT_CMD_DEFAULT[@]}")
fi

ITERATION=0

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Ralph Loop"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Prompt:      $PROMPT_FILE"
if [[ "$MAX_ITERATIONS" -gt 0 ]]; then
  echo "Max loops:   $MAX_ITERATIONS"
else
  echo "Max loops:   unlimited"
fi
echo "Agent cmd:   ${AGENT_CMD[*]}"
echo "Repo:        $REPO_DIR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

while true; do
  if [[ "$MAX_ITERATIONS" -gt 0 && "$ITERATION" -ge "$MAX_ITERATIONS" ]]; then
    echo "Reached max iterations: $MAX_ITERATIONS"
    break
  fi

  BEFORE_HEAD="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || true)"
  LOG_FILE="$(mktemp -t "ralph.loop-${ITERATION}.XXXXXX")"

  echo "ITERATION_START: iteration=$ITERATION started_at=\"$(date -u "+%Y-%m-%dT%H:%M:%SZ")\""
  echo "ITERATION_LOG: $LOG_FILE"

  set +e
  "${AGENT_CMD[@]}" < "$PROMPT_FILE" \
    | grep --line-buffered '^{' \
    | tee "$LOG_FILE" \
    | jq --unbuffered -rj "$STREAM_TEXT"
  AGENT_EXIT_CODE_RAW="${PIPESTATUS[0]}"
  set -e

  AFTER_HEAD="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || true)"
  DIRTY_COUNT="$(
    git -C "$REPO_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' '
  )"

  AGENT_EXIT_CODE_EFFECTIVE="$AGENT_EXIT_CODE_RAW"
  COMMIT_MADE="0"
  if [[ -n "$BEFORE_HEAD" && -n "$AFTER_HEAD" && "$BEFORE_HEAD" != "$AFTER_HEAD" ]]; then
    COMMIT_MADE="1"
  fi

  # Handle SIGTERM (143) as success if a clean commit was made
  if [[ "${RALPH_TREAT_SIGTERM_AS_SUCCESS:-0}" == "1" ]]; then
    if [[ "$AGENT_EXIT_CODE_RAW" -eq 143 && "$COMMIT_MADE" -eq 1 && "$DIRTY_COUNT" -eq 0 ]]; then
      echo "ITERATION_NOTE: agent exited 143 after a clean commit; treating as success."
      AGENT_EXIT_CODE_EFFECTIVE="0"
    fi
  fi

  COMMIT_STR="NO"
  if [[ "$COMMIT_MADE" -eq 1 ]]; then
    COMMIT_STR="YES"
  fi

  echo ""
  echo "ITERATION_RESULT: agent_exit_raw=$AGENT_EXIT_CODE_RAW agent_exit_effective=$AGENT_EXIT_CODE_EFFECTIVE commit=$COMMIT_STR dirty=$DIRTY_COUNT"
  echo "ITERATION_LOG: $LOG_FILE"

  if [[ "$AGENT_EXIT_CODE_EFFECTIVE" -ne 0 ]]; then
    echo "Agent exited non-zero ($AGENT_EXIT_CODE_RAW). Stopping loop."
    exit "$AGENT_EXIT_CODE_RAW"
  fi

  ITERATION=$((ITERATION + 1))
  echo ""
  echo "======================== LOOP $ITERATION ========================"
  echo ""
done
