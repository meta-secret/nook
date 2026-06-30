#!/usr/bin/env bash
# Measure nook-core line coverage (cargo llvm-cov + nextest) and enforce coverage-floor.json.
#
# Usage:
#   rust-coverage-check.sh                 # fail if below floor (default 90%)
#   rust-coverage-check.sh --update-floor  # optional: rewrite floor to measured % (user-approved only)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

FLOOR_FILE="nook-core/coverage-floor.json"
UPDATE_FLOOR=0

if [[ "${1:-}" == "--update-floor" ]]; then
  UPDATE_FLOOR=1
fi

if [[ ! -f "$FLOOR_FILE" ]]; then
  echo "error: missing $FLOOR_FILE" >&2
  exit 1
fi

FLOOR="$(sed -n 's/.*"lines_percent"[[:space:]]*:[[:space:]]*\([0-9.]*\).*/\1/p' "$FLOOR_FILE" | head -1)"
if [[ -z "$FLOOR" ]]; then
  echo "error: could not read lines_percent from $FLOOR_FILE" >&2
  exit 1
fi

if ! command -v cargo-llvm-cov >/dev/null 2>&1; then
  if ! cargo llvm-cov --version >/dev/null 2>&1; then
    echo "error: cargo-llvm-cov not installed (need llvm-tools-preview + cargo-llvm-cov in toolchain image)" >&2
    exit 1
  fi
fi

echo "==> nook-core coverage (floor: ${FLOOR}% lines)"

SUMMARY_FILE="$(mktemp)"
trap 'rm -f "$SUMMARY_FILE"' EXIT
cargo llvm-cov nextest --no-clean --profile ci -p nook-core --summary-only 2>&1 | tee "$SUMMARY_FILE"

TOTAL_LINE=""
while IFS= read -r line; do
  if [[ "$line" == TOTAL* ]]; then
    TOTAL_LINE="$line"
  fi
done <"$SUMMARY_FILE"

if [[ -z "$TOTAL_LINE" ]]; then
  echo "error: could not parse llvm-cov summary (missing TOTAL row)" >&2
  exit 1
fi

# TOTAL row: region%, function%, line% are the 3rd, 6th, ... percentage fields in order.
ACTUAL="$(printf '%s\n' "$TOTAL_LINE" | awk '
{
  n = 0
  for (i = 1; i <= NF; i++) {
    if ($i ~ /%$/) {
      n++
      pct[n] = substr($i, 1, length($i) - 1)
    }
  }
  if (n >= 3) {
    print pct[3]
  } else {
    exit 1
  }
}')"

if [[ -z "$ACTUAL" ]]; then
  echo "error: could not extract line coverage percent from TOTAL row" >&2
  exit 1
fi

printf '==> measured line coverage: %s%% (floor: %s%%)\n' "$ACTUAL" "$FLOOR"

if awk -v actual="$ACTUAL" -v floor="$FLOOR" 'BEGIN { exit (actual + 0 >= floor + 0) ? 0 : 1 }'; then
  echo "==> coverage OK"
else
  echo "error: nook-core line coverage ${ACTUAL}% is below ${FLOOR}% threshold" >&2
  echo "hint: add Rust unit/integration tests for new or uncovered code until coverage is at least ${FLOOR}%" >&2
  exit 1
fi

if [[ "$UPDATE_FLOOR" -eq 1 ]]; then
  ROUNDED="$(awk -v v="$ACTUAL" 'BEGIN { printf "%.2f", v }')"
  if awk -v actual="$ROUNDED" -v floor="$FLOOR" 'BEGIN { exit (actual + 0 > floor + 0) ? 0 : 1 }'; then
    TODAY="$(date -u +%Y-%m-%d)"
    cat >"$FLOOR_FILE" <<EOF
{
  "lines_percent": ${ROUNDED},
  "package": "nook-core",
  "tool": "cargo llvm-cov nextest --profile ci",
  "updated": "${TODAY}",
  "note": "Minimum line coverage for nook-core. CI fails below this threshold. When under 90%, agents should add Rust tests in the same task."
}
EOF
    echo "==> updated $FLOOR_FILE to ${ROUNDED}%"
  else
    echo "==> floor unchanged (${FLOOR}%); measured ${ACTUAL}%"
  fi
fi
