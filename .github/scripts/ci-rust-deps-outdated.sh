#!/usr/bin/env bash
# Audit direct Cargo dependencies with cargo-outdated.
#
# Optional env:
#   GITHUB_OUTPUT — when set, writes outdated=true/false
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

outdated=false

check_manifest() {
  local directory="$1"
  local status

  set +e
  (
    cd "$directory"
    cargo outdated --workspace --root-deps-only --exit-code 1
  )
  status=$?
  set -e

  case "$status" in
    0)
      echo "All direct dependencies are current in $directory."
      ;;
    1)
      echo "Direct dependency updates are available in $directory."
      outdated=true
      ;;
    *)
      echo "cargo outdated failed in $directory (exit $status)." >&2
      exit "$status"
      ;;
  esac
}

check_manifest nook-app/nook-platform
check_manifest nook-app/nook-platform/fuzz
check_manifest agentic-ai/minds
check_manifest preflight
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "outdated=$outdated" >> "$GITHUB_OUTPUT"
fi
