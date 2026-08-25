#!/usr/bin/env bash
# Contract test for the shared tool-only formatter image.
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
script="$(cat "$scripts_dir/format-host-apply.sh")"
formatter_dir="$scripts_dir/../formatting"
dockerfile="$(cat "$formatter_dir/Dockerfile")"
formatter="$(cat "$formatter_dir/format.sh")"
agentic_taskfile="$(cat "$scripts_dir/../../.task/agentic-ai.yml")"
web_package="$(cat "$scripts_dir/../../nook-app/nook-web/nook-web-app/package.json")"
loom_package="$(cat "$scripts_dir/../../agentic-ai/loom/package.json")"
guest_formatter="$(
  printf '%s\n' "$agentic_taskfile" \
    | sed -n '/^  hive:guest:format:/,/^  hive:guest:pr:ready:/p'
)"

printf '%s\n' "$script" | grep -q 'formatter_image="nook-source-formatter:' \
  || { echo 'format-host-apply test: expected shared content-addressed image' >&2; exit 1; }
for hash_input in Dockerfile package.json bun.lock prettier-default.json prettier-web.json format.sh; do
  printf '%s\n' "$script" | grep -Fq "$hash_input" \
    || { echo "format-host-apply test: formatter hash misses $hash_input" >&2; exit 1; }
done
printf '%s\n' "$script" | grep -Fq '(cd "$formatter_dir" && \' \
  || { echo 'format-host-apply test: formatter hash must be worktree-independent' >&2; exit 1; }
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
for required in \
  '.agents/skills/*' \
  'executable_skill_files+=' \
  '"$repo_root/.agents/skills"'; do
  printf '%s\n' "$formatter" | grep -Fq "$required" \
    || { echo "format-host-apply test: missing executable-skill formatter contract: $required" >&2; exit 1; }
done

for required in \
  'nook-app/nook-web/nook-web-app/node_modules/.bin/prettier' \
  '--config .agents/skills/.prettierrc' \
  '".agents/skills/*/src/**/*.ts"' \
  '".agents/skills/*/tests/**/*.ts"' \
  '".agents/skills/*/executable-skill.json"' \
  '".agents/skills/*/SKILL.md"' \
  '".agents/skills/*.{ts,json,md}"' \
  '.agents/skills/eslint.config.js' \
  '.agents/skills/.prettierrc'; do
  printf '%s\n' "$guest_formatter" | grep -Fq -- "$required" \
    || { echo "format-host-apply test: sealed guest misses skill formatter contract: $required" >&2; exit 1; }
done
install_line="$(
  printf '%s\n' "$guest_formatter" \
    | grep -Fn 'cd nook-app/nook-web/nook-web-app && bun install --frozen-lockfile' \
    | cut -d: -f1
)"
skill_format_line="$(
  printf '%s\n' "$guest_formatter" \
    | grep -Fn 'nook-app/nook-web/nook-web-app/node_modules/.bin/prettier' \
    | cut -d: -f1
)"
test -n "$install_line" && test -n "$skill_format_line" && test "$install_line" -lt "$skill_format_line" \
  || { echo 'format-host-apply test: sealed guest must frozen-install web Prettier before skill formatting' >&2; exit 1; }
for package in "$web_package" "$loom_package"; do
  printf '%s\n' "$package" | grep -Fq '"prettier": "3.9.6"' \
    || { echo 'format-host-apply test: skill formatter Prettier version is not pinned consistently' >&2; exit 1; }
done
for forbidden in 'task skills:format' 'task skills:install' '.agents/skills && bun install'; do
  printf '%s\n' "$guest_formatter" | grep -Fq -- "$forbidden" \
    && { echo "format-host-apply test: sealed guest skill formatting recurses or installs: $forbidden" >&2; exit 1; }
done

echo 'format-host-apply test: ok'
