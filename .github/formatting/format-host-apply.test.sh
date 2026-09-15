#!/usr/bin/env bash
# Contract test for the shared tool-only formatter image.
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
script="$(cat "$scripts_dir/format-host-apply.sh")"
formatter_dir="$scripts_dir"
dockerfile="$(cat "$formatter_dir/Dockerfile")"
formatter="$(cat "$formatter_dir/format.sh")"
web_package="$(cat "$scripts_dir/../../nook-app/nook-web/nook-web-app/package.json")"
loom_package="$(cat "$scripts_dir/../../agentic-ai/loom/package.json")"
printf '%s\n' "$script" | grep -q 'formatter_image="nook-source-formatter:' \
  || { echo 'format-host-apply test: expected shared content-addressed image' >&2; exit 1; }
for hash_input in Dockerfile package.json bun.lock prettier-default.json prettier-shared-typescript.json prettier-web.json prettier-skill.json format.sh; do
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
for required in \
  '# Required input: PINNED_LOCAL_DEV_SHA is the exact local-dev commit used as the formatting base.' \
  '[[ ! "${PINNED_LOCAL_DEV_SHA:-}" =~ ^[0-9a-f]{40}$ ]]' \
  'GIT_CONFIG_NOSYSTEM=1' \
  'GIT_CONFIG_GLOBAL=/dev/null' \
  'GIT_NO_REPLACE_OBJECTS=1' \
  '-c core.fsmonitor=false' \
  '-c core.hooksPath=/dev/null' \
  '-c core.excludesFile=/dev/null' \
  '-c diff.external=' \
  'rev-parse --verify "${PINNED_LOCAL_DEV_SHA}^{commit}"' \
  '[[ "$resolved_base_sha" != "$PINNED_LOCAL_DEV_SHA" ]]' \
  'diff --no-ext-diff --name-only --diff-filter=ACMR -z "$PINNED_LOCAL_DEV_SHA"' \
  'ls-files --others --exclude-per-directory=.gitignore -z'; do
  printf '%s\n' "$script" | grep -Fq -- "$required" \
    || { echo "format-host-apply test: canonical changed-file selection misses $required" >&2; exit 1; }
done
printf '%s\n' "$script" | grep -Fq -- '--exclude-standard' \
  && { echo 'format-host-apply test: untracked selection must not read info or global excludes' >&2; exit 1; }
for forbidden_base in 'merge-base HEAD origin/main' 'git rev-parse HEAD'; do
  printf '%s\n' "$script" | grep -Fq "$forbidden_base" \
    && { echo "format-host-apply test: forbidden formatter base fallback: $forbidden_base" >&2; exit 1; }
done

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
for required in \
  'nook-app/nook-platform/**/*.rs' \
  'preflight/**/*.rs' \
  'rustfmt --edition 2024 --config skip_children=true -- "${rust_files[@]}"'; do
  printf '%s\n' "$formatter" | grep -Fq "$required" \
    || { echo "format-host-apply test: missing changed-only Rust formatter: $required" >&2; exit 1; }
done
printf '%s\n' "$formatter" | grep -Fq 'prettier-plugin-svelte' \
  || { echo 'format-host-apply test: missing Svelte formatter' >&2; exit 1; }
for required in \
  'nook-app/nook-web/nook-web-shared/src/vault-app/*.ts' \
  'web_shared_typescript_files+=' \
  'prettier-shared-typescript.json' \
  '"${web_shared_typescript_files[@]}"'; do
  printf '%s\n' "$formatter" | grep -Fq "$required" \
    || { echo "format-host-apply test: missing shared TypeScript formatter contract: $required" >&2; exit 1; }
done
for required in \
  '.cortex/gizmo-prime/dynamic-skills/*/scripts/*' \
  '.cortex/shared/dynamic-skills/*/scripts/*' \
  '.cortex/teams/*/dynamic-skills/*/scripts/*' \
  '^(\.cortex/(gizmo-prime|shared|teams/[^/]+)/dynamic-skills/[^/]+/scripts)/(.+)$' \
  'skill_root="${BASH_REMATCH[1]}"' \
  'skill_application_files+=("${BASH_REMATCH[3]}")' \
  'skill_application_files+=' \
  'skill_application_roots+=' \
  '"$formatter_root/prettier-skill.json"' \
  'done <"$changed_files"'; do
  printf '%s\n' "$formatter" | grep -Fq "$required" \
    || { echo "format-host-apply test: missing shared-tooling formatter contract: $required" >&2; exit 1; }
done
for obsolete in \
  '.agents/skills/*' \
  'executable_skill_files+=' \
  '"$repo_root/.agents/skills"'; do
  printf '%s\n' "$formatter" | grep -Fq "$obsolete" \
    && { echo "format-host-apply test: obsolete project skill formatter remains: $obsolete" >&2; exit 1; }
done

for invalid_base in "" not-a-sha 0000000000000000000000000000000000000000; do
  if PINNED_LOCAL_DEV_SHA="$invalid_base" bash "$scripts_dir/format-host-apply.sh" >/dev/null 2>&1; then
    echo "format-host-apply test: invalid pinned base must fail closed: $invalid_base" >&2
    exit 1
  fi
done

echo 'format-host-apply test: ok'
