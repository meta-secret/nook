#!/usr/bin/env bash

set -euo pipefail

output="$(mktemp)"
trap 'rm -f "$output"' EXIT

status=0
"$@" >"$output" 2>&1 || status=$?

if grep -q '┌────────────' "$output"; then
  sed -n '/┌────────────/,/time:/p' "$output"
else
  cat "$output" >&2
fi

exit "$status"
