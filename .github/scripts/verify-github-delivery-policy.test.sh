#!/usr/bin/env bash
# Contract test for GitHub delivery policy ownership and read-only behavior.
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
script="$(cat "$scripts_dir/verify-github-delivery-policy.sh")"

for forbidden in \
  'expect_repository_setting()' \
  'expect_branch_setting()'; do
  printf '%s\n' "$script" | grep -Fq -- "$forbidden" \
    && { echo "verify-github-delivery-policy test: unowned helper remains: $forbidden" >&2; exit 1; }
done

for required in \
  'verify_github_repository_delivery_policy()' \
  'verify_github_branch_protection_policy()' \
  'verify_github_repository_delivery_policy allow_merge_commit true' \
  'verify_github_branch_protection_policy "$branch" allow_force_pushes.enabled false'; do
  printf '%s\n' "$script" | grep -Fq -- "$required" \
    || { echo "verify-github-delivery-policy test: missing semantic owner contract: $required" >&2; exit 1; }
done

echo 'verify-github-delivery-policy test: ok'
