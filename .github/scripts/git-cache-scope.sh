#!/usr/bin/env bash
# Emit the isolated BuildKit cache suffix for the current git commit.
# Format: -git-<40-char-sha>
#
# Options:
#   --require-clean  Fail when the worktree has uncommitted changes.
set -euo pipefail

require_clean=0
for arg in "$@"; do
  case "$arg" in
    --require-clean) require_clean=1 ;;
    -h | --help)
      echo "Usage: git-cache-scope.sh [--require-clean]" >&2
      exit 0
      ;;
    *)
      echo "git-cache-scope.sh: unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [ "$require_clean" = 1 ] && [ -n "$(git status --porcelain)" ]; then
  echo "git-cache-scope.sh: refusing dirty worktree; commit before git-scoped cache publish" >&2
  exit 1
fi

sha="$(git rev-parse HEAD)"
if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "git-cache-scope.sh: HEAD is not a 40-char lowercase SHA: $sha" >&2
  exit 1
fi

printf '%s' "-git-$sha"
