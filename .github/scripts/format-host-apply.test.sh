#!/usr/bin/env bash
# Contract test for fast host-side formatting (does not run formatters).
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
script="$(cat "$scripts_dir/format-host-apply.sh")"
printf '%s\n' "$script" | grep -q 'rust_toolchain=1.97.0' \
  || { echo 'format-host-apply test: expected pinned Rust formatter' >&2; exit 1; }
printf '%s\n' "$script" | grep -q 'bun_version=1.3.14' \
  || { echo 'format-host-apply test: expected pinned Bun formatter' >&2; exit 1; }
printf '%s\n' "$script" | grep -q 'nook-app/nook-platform/Cargo.toml' \
  || { echo 'format-host-apply test: expected platform formatter' >&2; exit 1; }
printf '%s\n' "$script" | grep -q 'preflight/Cargo.toml' \
  || { echo 'format-host-apply test: expected preflight formatter' >&2; exit 1; }
printf '%s\n' "$script" | grep -q 'agentic-ai/minds/Cargo.toml' \
  || { echo 'format-host-apply test: expected Hive formatter' >&2; exit 1; }
printf '%s\n' "$script" | grep -q 'bun run --cwd "$web_app" format' \
  || { echo 'format-host-apply test: expected web formatter' >&2; exit 1; }
printf '%s\n' "$script" | grep -q 'ln -s ../nook-web-app/node_modules' \
  || { echo 'format-host-apply test: expected extension dependency link' >&2; exit 1; }
printf '%s\n' "$script" | grep -q 'bun run --cwd "$hive_console" format' \
  || { echo 'format-host-apply test: expected Hive console formatter' >&2; exit 1; }
printf '%s\n' "$script" | grep -q 'task loom:format' \
  || { echo 'format-host-apply test: expected Loom formatter' >&2; exit 1; }
printf '%s\n' "$script" | grep -q 'task hive:guest:format' \
  || { echo 'format-host-apply test: expected native Hive guest formatter' >&2; exit 1; }

for forbidden in docker buildx registry-cache format:diff setup:rust; do
  printf '%s\n' "$script" | grep -Fq "$forbidden" \
    && { echo "format-host-apply test: forbidden heavy path: $forbidden" >&2; exit 1; }
done

echo 'format-host-apply test: ok'
