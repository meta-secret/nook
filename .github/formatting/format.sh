#!/usr/bin/env bash
set -euo pipefail

repo_root=/workspace
prettier=/opt/nook-formatter/node_modules/.bin/prettier
svelte_plugin=/opt/nook-formatter/node_modules/prettier-plugin-svelte/plugin.js

cargo fmt --manifest-path "$repo_root/nook-app/nook-platform/Cargo.toml" --all
cargo fmt --manifest-path "$repo_root/preflight/Cargo.toml"
cargo fmt --manifest-path "$repo_root/agentic-ai/minds/Cargo.toml" --all

mapfile -t changed_files </tmp/nook-format-files

web_app_files=()
extension_files=()
research_files=()
hive_console_files=()
loom_files=()
for path in "${changed_files[@]}"; do
  case "$path" in
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
  esac
done

format_changed_files() {
  local directory="$1"
  shift
  if [[ "$#" -eq 0 ]]; then
    return
  fi
  (
    cd "$directory"
    "$prettier" \
      --plugin "$svelte_plugin" \
      --write \
      --ignore-unknown \
      "$@"
  )
}

web_app="$repo_root/nook-app/nook-web/nook-web-app"
format_changed_files "$web_app" "${web_app_files[@]}"
format_changed_files \
  "$repo_root/nook-app/nook-web/nook-web-extension" \
  "${extension_files[@]}"
format_changed_files \
  "$repo_root/nook-app/nook-web/nook-web-research" \
  "${research_files[@]}"
format_changed_files \
  "$repo_root/agentic-ai/minds/hive-console" \
  "${hive_console_files[@]}"
format_changed_files "$repo_root/agentic-ai/loom" "${loom_files[@]}"
