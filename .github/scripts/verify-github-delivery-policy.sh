#!/usr/bin/env bash
# Verify the GitHub repository settings required by the non-squashing delivery
# graph. This is intentionally read-only; repository administrators apply the
# settings, and this check fails closed when they drift.
set -euo pipefail

gh_bin="${GH:-gh}"
repository="${GITHUB_REPOSITORY:-}"

if [[ -z "$repository" ]]; then
  echo "GITHUB_REPOSITORY is required" >&2
  exit 2
fi

if ! command -v "$gh_bin" >/dev/null 2>&1; then
  echo "GitHub CLI is required to verify repository delivery policy" >&2
  exit 2
fi

expect_repository_setting() {
  local setting="$1"
  local expected="$2"
  local actual

  actual="$($gh_bin api "repos/${repository}" --jq "if .${setting} == null then \"missing\" else .${setting} end")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Repository delivery policy failed: ${setting}=${actual}; expected ${expected}" >&2
    return 1
  fi
  echo "Repository delivery policy: ${setting}=${actual}"
}

expect_branch_setting() {
  local branch="$1"
  local setting="$2"
  local expected="$3"
  local actual

  if ! actual="$($gh_bin api "repos/${repository}/branches/${branch}/protection" --jq "if .${setting} == null then \"missing\" else .${setting} end")"; then
    echo "Unable to read branch protection for ${branch}; an administrator token is required" >&2
    return 1
  fi
  if [[ "$actual" != "$expected" ]]; then
    echo "Branch delivery policy failed: ${branch}.${setting}=${actual}; expected ${expected}" >&2
    return 1
  fi
  echo "Branch delivery policy: ${branch}.${setting}=${actual}"
}

# GitHub's ordinary merge button remains available for unrelated workflows,
# while this repository's manager promotes by an exact non-forced fast-forward.
expect_repository_setting allow_merge_commit true
expect_repository_setting allow_squash_merge false
expect_repository_setting allow_rebase_merge false
expect_repository_setting delete_branch_on_merge false

for branch in main dev; do
  expect_branch_setting "$branch" allow_force_pushes.enabled false
  expect_branch_setting "$branch" allow_deletions.enabled false
  expect_branch_setting "$branch" required_linear_history.enabled false
done

echo "GitHub delivery policy is compatible with exact-commit, non-squashing promotion."
