#!/usr/bin/env bash
# Main CI auto-fix: Cursor Agent diagnoses failure, opens a PR, then this script merges when green.
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/workspace}"
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
export FIX_BRANCH GITHUB_RUN_ID GITHUB_REPOSITORY

echo "==> Configuring gh and git (GH_TOKEN from environment)"
git config --global --add safe.directory "$REPO_ROOT"
git config --global credential.helper '!gh auth git-credential'
git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
git config --global user.name "github-actions[bot]"

if existing_pr="$(gh pr list --head "$FIX_BRANCH" --state open --json number -q '.[0].number' 2>/dev/null || true)" \
  && [[ -n "$existing_pr" ]]; then
  echo "==> Open PR already exists for $FIX_BRANCH (#$existing_pr) — waiting for checks"
  PR_NUM="$existing_pr"
else
  PROMPT_FILE=".github/prompts/ci-fix-agent.md"
  if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "Missing agent prompt: $PROMPT_FILE" >&2
    exit 1
  fi

  PROMPT="$(envsubst '${GITHUB_RUN_ID} ${GITHUB_REPOSITORY} ${FIX_BRANCH}' < "$PROMPT_FILE")"

  echo "==> Running Cursor Agent (run ${GITHUB_RUN_ID}, branch ${FIX_BRANCH})"
  agent -p "$PROMPT" \
    --force \
    --trust \
    --sandbox disabled \
    --workspace "$REPO_ROOT" \
    --output-format text

  PR_NUM="$(gh pr list --head "$FIX_BRANCH" --state open --json number -q '.[0].number' || true)"
  if [[ -z "$PR_NUM" ]]; then
    echo "::error::Cursor Agent did not open a PR for branch ${FIX_BRANCH}." >&2
    exit 1
  fi
  echo "==> Agent opened PR #${PR_NUM}"
fi

echo "==> Waiting for PR #${PR_NUM} checks"
gh pr checks "$PR_NUM" --watch --fail-fast

echo "==> Squash merging PR #${PR_NUM}"
gh pr merge "$PR_NUM" --squash --delete-branch

echo "==> Done — merged PR #${PR_NUM} (fix for main run ${GITHUB_RUN_ID})"
