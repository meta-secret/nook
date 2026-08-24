#!/usr/bin/env bash
# Contract test for the shared tool-only formatter image.
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
script="$(cat "$scripts_dir/format-host-apply.sh")"
formatter_dir="$scripts_dir/../formatting"
dockerfile="$(cat "$formatter_dir/Dockerfile")"
formatter="$(cat "$formatter_dir/format.sh")"

printf '%s\n' "$script" | grep -q 'formatter_image="nook-source-formatter:' \
  || { echo 'format-host-apply test: expected shared content-addressed image' >&2; exit 1; }
printf '%s\n' "$script" | grep -q 'docker image inspect "$formatter_image"' \
  || { echo 'format-host-apply test: expected warm image reuse' >&2; exit 1; }
printf '%s\n' "$script" | grep -q '"$formatter_dir"' \
  || { echo 'format-host-apply test: build context must be formatter-only' >&2; exit 1; }
printf '%s\n' "$script" | grep -q 'docker run' \
  || { echo 'format-host-apply test: expected formatter container' >&2; exit 1; }
printf '%s\n' "$script" | grep -q '/tmp/nook-format-files:ro' \
  || { echo 'format-host-apply test: expected bounded changed-file input' >&2; exit 1; }
printf '%s\n' "$script" | grep -q 'task hive:guest:format' \
  || { echo 'format-host-apply test: expected native Hive guest formatter' >&2; exit 1; }

for forbidden in buildx registry-cache format:diff setup:rust cargo\ fmt bun\ install; do
  printf '%s\n' "$script" | grep -Fq "$forbidden" \
    && { echo "format-host-apply test: forbidden heavy path: $forbidden" >&2; exit 1; }
done

for required in \
  'rustup component add rustfmt' \
  'bun install --frozen-lockfile --ignore-scripts'; do
  printf '%s\n' "$dockerfile" | grep -Fq "$required" \
    || { echo "format-host-apply test: missing formatter image contract: $required" >&2; exit 1; }
done
for prohibited in 'COPY .' 'nook-app/' 'agentic-ai/' 'cargo build' 'cargo test'; do
  printf '%s\n' "$dockerfile" | grep -Fq "$prohibited" \
    && { echo "format-host-apply test: product work in formatter image: $prohibited" >&2; exit 1; }
done
for manifest in \
  nook-app/nook-platform/Cargo.toml \
  preflight/Cargo.toml \
  agentic-ai/minds/Cargo.toml; do
  printf '%s\n' "$formatter" | grep -Fq "$manifest" \
    || { echo "format-host-apply test: missing Rust formatter: $manifest" >&2; exit 1; }
done
printf '%s\n' "$formatter" | grep -Fq 'prettier-plugin-svelte' \
  || { echo 'format-host-apply test: missing Svelte formatter' >&2; exit 1; }

echo 'format-host-apply test: ok'
