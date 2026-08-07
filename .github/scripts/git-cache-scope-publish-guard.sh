#!/usr/bin/env bash
# Local-only gate for publishing git-scoped remote-buildcache refs.
# Requires a clean worktree and GHA_CACHE_SCOPE_SUFFIX=-git-<HEAD>.
set -euo pipefail

if [ -n "${GITHUB_ACTIONS:-}" ]; then
  exit 0
fi

if [ "${NOOK_REGISTRY_CACHE_LOCAL_PUBLISH:-}" != "1" ]; then
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
expected="$("$repo_root/.github/scripts/git-cache-scope.sh" --require-clean)"
actual="${GHA_CACHE_SCOPE_SUFFIX:-}"

if [ "$actual" != "$expected" ]; then
  echo "git-cache-scope-publish-guard: GHA_CACHE_SCOPE_SUFFIX must be $expected (got: ${actual:-empty})" >&2
  exit 1
fi
