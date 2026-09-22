#!/usr/bin/env bash
# Verify the GitHub repository settings required by squash-only delivery.
# This is intentionally read-only; repository administrators apply the
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

# GitHubRepositoryDeliveryPolicy owns repository-level merge and retention
# settings required by squash-only feature delivery.
verify_github_repository_delivery_policy() {
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

# GitHubBranchProtectionPolicy owns branch-level mutation and history settings
# required by protected linear main history.
verify_github_branch_protection_policy() {
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

# Feature PRs merge to main as one squash commit and their remote branches are
# deleted after merge.
verify_github_repository_delivery_policy allow_merge_commit false
verify_github_repository_delivery_policy allow_squash_merge true
verify_github_repository_delivery_policy allow_rebase_merge false
verify_github_repository_delivery_policy delete_branch_on_merge true

for branch in main; do
  verify_github_branch_protection_policy "$branch" allow_force_pushes.enabled false
  verify_github_branch_protection_policy "$branch" allow_deletions.enabled false
  verify_github_branch_protection_policy "$branch" required_linear_history.enabled true
  verify_github_branch_protection_policy "$branch" required_pull_request_reviews missing
done

echo "GitHub delivery policy is compatible with squash-only feature delivery."
