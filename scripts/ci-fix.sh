#!/usr/bin/env bash
# Main CI auto-fix: configure git, run ci-agent if needed, squash-merge when green.
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$REPO_ROOT"

if [[ -z "${CURSOR_API_KEY:-}" ]]; then
  echo "::warning::CURSOR_API_KEY is not set — skipping AI CI fix job."
  echo "Add repository secret CURSOR_API_KEY (Cursor Dashboard → Integrations → User API Keys)."
  exit 0
fi

: "${GH_TOKEN:?GH_TOKEN is required for gh/git push and PR merge}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"

FIX_BRANCH="${FIX_BRANCH:-fix/ci-${GITHUB_RUN_ID}}"
export FIX_BRANCH GITHUB_RUN_ID GITHUB_REPOSITORY REPO_ROOT

configure_git() {
  echo "==> Configuring gh and git (GH_TOKEN from environment)"
  git config --global --add safe.directory "$REPO_ROOT"
  git config --global credential.helper '!gh auth git-credential'
  git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git config --global user.name "github-actions[bot]"
}

find_open_pr() {
  gh pr list --head "$FIX_BRANCH" --state open --json number -q '.[0].number' 2>/dev/null || true
}

run_agent_if_needed() {
  local pr_num
  pr_num="$(find_open_pr)"
  if [[ -n "$pr_num" ]]; then
    echo "==> Open PR already exists for $FIX_BRANCH (#$pr_num) — waiting for checks" >&2
    echo "$pr_num"
    return
  fi

  task ci-agent:run
  pr_num="$(find_open_pr)"
  if [[ -z "$pr_num" ]]; then
    echo "::error::ci-agent did not open a PR for branch ${FIX_BRANCH}." >&2
    exit 1
  fi
  echo "==> Agent opened PR #${pr_num}" >&2
  echo "$pr_num"
}

wait_and_merge() {
  local pr_num="$1"
  echo "==> Waiting for PR #${pr_num} checks"
  gh pr checks "$pr_num" --watch --fail-fast
  echo "==> Squash merging PR #${pr_num}"
  gh pr merge "$pr_num" --squash --delete-branch
  echo "==> Done — merged PR #${pr_num} (fix for main run ${GITHUB_RUN_ID})"
}

configure_git
pr_num="$(run_agent_if_needed)"
wait_and_merge "$pr_num"
