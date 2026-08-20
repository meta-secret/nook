#!/usr/bin/env bash
# Refuse PR readiness while temporary Cortex session memory remains.
set -euo pipefail

repo_root="${NOOK_REPO_ROOT:-$(git rev-parse --show-toplevel)}"
session_root="$repo_root/.cortex/.session"

if [ ! -d "$session_root" ]; then
  exit 0
fi

session_entry="$(find "$session_root" -mindepth 1 ! -type d -print -quit)"
if [ -n "$session_entry" ]; then
  echo "PR readiness requires removing temporary Cortex session memory: $session_entry" >&2
  exit 1
fi
