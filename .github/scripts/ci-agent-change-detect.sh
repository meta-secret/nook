#!/usr/bin/env bash
set -euo pipefail

: "${REPO_ROOT:?REPO_ROOT is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

artifacts=(.nook-workbench-plan.md .nook-workbench-worklog.md)
git -C "$REPO_ROOT" reset --quiet HEAD -- "${artifacts[@]}"
status_file="$(mktemp)"
trap 'rm -f -- "$status_file"' EXIT
git -C "$REPO_ROOT" status --porcelain --untracked-files=all -- \
  . ':(exclude).nook-workbench-plan.md' \
  ':(exclude).nook-workbench-worklog.md' > "$status_file"
if [ -s "$status_file" ]; then
  echo "changed=true" >> "$GITHUB_OUTPUT"
else
  echo "changed=false" >> "$GITHUB_OUTPUT"
fi
