#!/usr/bin/env bash
# Apply repository formatters directly to the host working tree.
#
# Formatting is the only mandatory local code operation. Keep it independent
# from Docker, BuildKit, compilation, tests, and remote cache publication; those
# checks belong to GitHub Actions.
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$scripts_dir/../.." && pwd)"
cd "$repo_root"

if [[ "${HIVE_SEALED_GUEST:-}" == "1" ]]; then
  task hive:guest:format
  git status --short --untracked-files=no
  exit 0
fi

rust_toolchain=1.97.0
bun_version=1.3.14
if [[ "$(bun --version)" != "$bun_version" ]]; then
  echo "task format requires Bun $bun_version" >&2
  exit 1
fi
if ! rustup toolchain list | grep -q "^${rust_toolchain}-"; then
  rustup toolchain install "$rust_toolchain" --profile minimal --component rustfmt
fi

ensure_bun_dependencies() {
  local directory="$1"
  if [[ ! -x "$directory/node_modules/.bin/prettier" ]]; then
    bun install --cwd "$directory" --frozen-lockfile --ignore-scripts
  fi
}

rustup run "$rust_toolchain" cargo fmt \
  --manifest-path "$repo_root/nook-app/nook-platform/Cargo.toml" --all
rustup run "$rust_toolchain" cargo fmt \
  --manifest-path "$repo_root/preflight/Cargo.toml"
rustup run "$rust_toolchain" cargo fmt \
  --manifest-path "$repo_root/agentic-ai/minds/Cargo.toml" --all

web_app="$repo_root/nook-app/nook-web/nook-web-app"
web_extension="$repo_root/nook-app/nook-web/nook-web-extension"
web_research="$repo_root/nook-app/nook-web/nook-web-research"
hive_console="$repo_root/agentic-ai/minds/hive-console"
loom="$repo_root/agentic-ai/loom"

ensure_bun_dependencies "$web_app"
ensure_bun_dependencies "$web_research"
ensure_bun_dependencies "$hive_console"
ensure_bun_dependencies "$loom"
if [[ ! -e "$web_extension/node_modules" ]]; then
  ln -s ../nook-web-app/node_modules "$web_extension/node_modules"
fi

bun run --cwd "$web_app" format
bun run --cwd "$web_extension" format
bun run --cwd "$web_research" format
bun run --cwd "$hive_console" format
task loom:format
git status --short --untracked-files=no
