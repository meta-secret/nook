#!/usr/bin/env bash
# Run the task-planning agent in a detached worktree and copy its one result
# artifact back.
#
# Required env:
#   WORKBENCH_PLAN_FILE — relative path of the plan artifact inside the checkout
#   WORKBENCH_SUMMARY_FILE — relative path of the blocker artifact
#   IMPLEMENTATION_REPO_ROOT — isolated implementation source checkout
# Optional env:
#   CI_AGENT_PROMPT_FILE, CI_AGENT_TIMEOUT_MS, CURSOR_API_KEY
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${WORKBENCH_PLAN_FILE:?WORKBENCH_PLAN_FILE is required}"
: "${WORKBENCH_SUMMARY_FILE:?WORKBENCH_SUMMARY_FILE is required}"
: "${IMPLEMENTATION_REPO_ROOT:?IMPLEMENTATION_REPO_ROOT is required}"

if [ "$IMPLEMENTATION_REPO_ROOT" = "$ROOT" ]; then
  echo "Planning source must be isolated from trusted workflow tooling." >&2
  exit 1
fi

rm -f -- "$WORKBENCH_PLAN_FILE" "$WORKBENCH_SUMMARY_FILE"
planning_parent="$(mktemp -d)"
planning_root="$planning_parent/checkout"
cleanup() {
  git worktree remove --force "$planning_root" 2>/dev/null || true
  rm -rf -- "$planning_parent"
}
trap cleanup EXIT
git -C "$IMPLEMENTATION_REPO_ROOT" worktree add --detach "$planning_root" HEAD
REPO_ROOT="$planning_root" \
  node "$ROOT/agentic-ai/ci-agent/dist/main/main.js" plan
plan_path="$planning_root/$WORKBENCH_PLAN_FILE"
blocker_path="$planning_root/$WORKBENCH_SUMMARY_FILE"
artifact_ready() {
  [ -f "$1" ] && [ ! -L "$1" ] && [ -s "$1" ] && [ "$(wc -c < "$1")" -le 65536 ]
}
if artifact_ready "$plan_path" && artifact_ready "$blocker_path"; then
  echo "Planning agent produced both a plan and an authorization blocker." >&2
  exit 1
fi
if artifact_ready "$plan_path"; then
  cp -- "$plan_path" "$WORKBENCH_PLAN_FILE"
  test -s "$WORKBENCH_PLAN_FILE"
  exit 0
fi
if artifact_ready "$blocker_path"; then
  cp -- "$blocker_path" "$WORKBENCH_SUMMARY_FILE"
  test -s "$WORKBENCH_SUMMARY_FILE"
  exit 0
fi
echo "Planning agent produced neither a plan nor an authorization blocker." >&2
exit 1
