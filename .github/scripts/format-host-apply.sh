#!/usr/bin/env bash
# Format Rust + web/extension in sealed Docker images and apply the printed
# unified diffs to the host working tree. Sealed images never write the host.
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$scripts_dir/../.." && pwd)"
extract_awk="$scripts_dir/format-host-apply-extract.awk"
cd "$repo_root"

tmp="$(mktemp)"
patch="$(mktemp)"
trap 'rm -f "$tmp" "$patch"' EXIT

set -o pipefail
status=0
# Stream progress to the terminal while capturing for patch extraction.
{
  task setup:rust
  task docker:rust:task TASK=_rust:format
  task setup PREPARE_GROUP=prepare-with-unformatted-rust
  task docker:task TASK=_format
} 2>&1 | tee "$tmp" || status=$?

if [[ "$status" -ne 0 ]]; then
  echo "==> task format failed (see output above)." >&2
  exit "$status"
fi

awk -f "$extract_awk" "$tmp" >"$patch"

if [[ ! -s "$patch" ]]; then
  echo '==> Already formatted; host working tree unchanged.'
  exit 0
fi

git apply "$patch"

echo '==> Applied sealed-image format changes to the host working tree.'
git status --short --untracked-files=no
