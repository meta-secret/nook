#!/usr/bin/env bash
set -euo pipefail

# Playwright MCP's Docker image is headless-only, while browser_annotate needs a
# visible dashboard. Keep the server on the host but give every MCP process an
# atomic, private output directory. Browser state is separately isolated in
# memory by the required --isolated argument supplied from config.toml.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

umask 077
mkdir -p "$repo_root/.playwright-mcp"
session_dir="$(mktemp -d "$repo_root/.playwright-mcp/session.XXXXXXXX")"
cleanup() {
  rm -rf "$session_dir"
}
trap cleanup EXIT HUP INT TERM

cd "$repo_root"
npx -y @playwright/mcp@0.0.78 --output-dir="$session_dir" "$@"
