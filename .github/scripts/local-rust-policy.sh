#!/usr/bin/env bash
set -euo pipefail

task_name="${1:-unknown Rust/WASM task}"

case "${NOOK_ALLOW_LOCAL_RUST_DIAGNOSTIC:-}" in
  1)
    exit 0
    ;;
  ""|0) ;;
  *)
    echo "NOOK_ALLOW_LOCAL_RUST_DIAGNOSTIC must be 1 for an explicit human diagnostic build." >&2
    exit 2
    ;;
esac

if [[ "${GITHUB_ACTIONS:-}" == "true" && ( "${CI:-}" == "true" || "${CI:-}" == "1" ) ]]; then
  exit 0
fi

# Source-sealed Rust task images are entered only after their host-side setup or
# CI producer passed this policy. They intentionally set CI=1 but do not receive
# the host's GitHub or diagnostic environment.
if [[ "${CI:-}" == "1" && -f /.dockerenv && "${PWD:-}" == /meta-secret/nook* ]]; then
  exit 0
fi

echo "Local Rust/WASM product execution is disabled: task $task_name" >&2
echo "Commit and push the exact branch head, then use GitHub Actions:" >&2
case "$task_name" in
  preflight*)
    echo "  task remote TASK_NAME=preflight" >&2
    ;;
  rust:*|_rust:*|docker:ecosystem:*|docker:coverage:*|docker:ci:rust:*|docker:rust-base)
    echo "  task remote TASK_NAME=rust:ci" >&2
    ;;
  setup|setup:web:*|build|test|lint|check|web:*|extension:*|ci:*)
    echo "  task remote:list" >&2
    echo "  task remote TASK_NAME=<matching-selector>" >&2
    ;;
  *)
    echo "  task remote:list" >&2
    ;;
esac
echo "Required merge evidence remains: task pr:validate PR=<number>" >&2
echo "A human may opt into one intentional local diagnostic with:" >&2
echo "  NOOK_ALLOW_LOCAL_RUST_DIAGNOSTIC=1 task $task_name" >&2
exit 2
