#!/usr/bin/env bash
set -euo pipefail

repo_root="${NOOK_REPO_ROOT:-/workspace}"
formatter_root="${NOOK_FORMATTER_ROOT:-/opt/nook-formatter}"
changed_files="${FORMAT_CHANGED_FILES:-/tmp/nook-format-files}"
prettier="$formatter_root/node_modules/.bin/prettier"
svelte_plugin="$formatter_root/node_modules/prettier-plugin-svelte/plugin.js"

rust_files=()
web_app_files=()
web_shared_typescript_files=()
extension_files=()
research_files=()
hive_console_files=()
loom_files=()
skill_application_files=()
skill_application_roots=()
while IFS= read -r -d '' path; do
  if [[ ! -f "$repo_root/$path" || -L "$repo_root/$path" ]]; then
    continue
  fi
  case "$path" in
    nook-app/nook-platform/*.rs | nook-app/nook-platform/**/*.rs | preflight/*.rs | preflight/**/*.rs | agentic-ai/minds/*.rs | agentic-ai/minds/**/*.rs)
      rust_files+=("$path")
      ;;
    nook-app/nook-web/nook-web-shared/src/vault-app/*.ts)
      web_shared_typescript_files+=("../${path#nook-app/nook-web/}")
      ;;
    nook-app/nook-web/nook-web-app/*)
      web_app_files+=("${path#nook-app/nook-web/nook-web-app/}")
      ;;
    nook-app/nook-web/nook-web-shared/src/vault-app/* | nook-app/nook-web/nook-vault-simple/* | nook-app/nook-web/nook-vault-sentinel/*)
      web_app_files+=("../${path#nook-app/nook-web/}")
      ;;
    nook-app/nook-web/nook-web-extension/*)
      extension_files+=("${path#nook-app/nook-web/nook-web-extension/}")
      ;;
    nook-app/nook-web/nook-web-research/*)
      research_files+=("${path#nook-app/nook-web/nook-web-research/}")
      ;;
    agentic-ai/minds/hive-console/*)
      hive_console_files+=("${path#agentic-ai/minds/hive-console/}")
      ;;
    agentic-ai/loom/*)
      loom_files+=("${path#agentic-ai/loom/}")
      ;;
    .cortex/gizmo/dynamic-skills/*/scripts/* | .cortex/shared/dynamic-skills/*/scripts/* | .cortex/teams/*/dynamic-skills/*/scripts/*)
      if [[ ! "$path" =~ ^(\.cortex/(gizmo|shared|teams/[^/]+)/dynamic-skills/[^/]+/scripts)/(.+)$ ]]; then
        echo "format: invalid executable-skill path: $path" >&2
        exit 1
      fi
      skill_root="${BASH_REMATCH[1]}"
      skill_application_roots+=("$skill_root")
      skill_application_files+=("${BASH_REMATCH[3]}")
      ;;
  esac
done <"$changed_files"

if [[ "${#rust_files[@]}" -gt 0 ]]; then
  (
    cd "$repo_root"
    rustfmt --edition 2024 --config skip_children=true -- "${rust_files[@]}"
  )
fi

format_changed_files() {
  local config="$1"
  local directory="$2"
  shift 2
  if [[ "$#" -eq 0 ]]; then
    return
  fi
  (
    cd "$directory"
    "$prettier" \
      --config "$config" \
      --plugin "$svelte_plugin" \
      --write \
      --ignore-unknown \
      -- \
      "$@"
  )
}

web_app="$repo_root/nook-app/nook-web/nook-web-app"
web_config="$formatter_root/prettier-web.json"
default_config="$formatter_root/prettier-default.json"
shared_typescript_config="$formatter_root/prettier-shared-typescript.json"
if [[ "${#web_app_files[@]}" -gt 0 ]]; then
  format_changed_files "$web_config" "$web_app" "${web_app_files[@]}"
fi
if [[ "${#web_shared_typescript_files[@]}" -gt 0 ]]; then
  format_changed_files "$shared_typescript_config" "$web_app" "${web_shared_typescript_files[@]}"
fi
if [[ "${#extension_files[@]}" -gt 0 ]]; then
  format_changed_files "$web_config" "$repo_root/nook-app/nook-web/nook-web-extension" "${extension_files[@]}"
fi
if [[ "${#research_files[@]}" -gt 0 ]]; then
  format_changed_files "$web_config" "$repo_root/nook-app/nook-web/nook-web-research" "${research_files[@]}"
fi
if [[ "${#hive_console_files[@]}" -gt 0 ]]; then
  format_changed_files "$default_config" "$repo_root/agentic-ai/minds/hive-console" "${hive_console_files[@]}"
fi
if [[ "${#loom_files[@]}" -gt 0 ]]; then
  format_changed_files "$default_config" "$repo_root/agentic-ai/loom" "${loom_files[@]}"
fi
if [[ "${#skill_application_files[@]}" -gt 0 ]]; then
  for index in "${!skill_application_files[@]}"; do
    skill_root="${skill_application_roots[$index]}"
    skill_path="${skill_application_files[$index]}"
    format_changed_files "$repo_root/$skill_root/.prettierrc" "$repo_root/$skill_root" "$skill_path"
  done
fi
