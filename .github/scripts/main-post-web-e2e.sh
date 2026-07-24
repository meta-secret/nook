#!/usr/bin/env bash
# After Main web e2e, overlap extension Playwright with headless UI demos.
# Both reuse the already-built nook-web-e2e image; each suite stays at one
# Chromium worker so the hosted runner can sustain the pair.
set -euo pipefail

: "${UI_DEMO_OUTPUT_DIR:?main-post-web-e2e requires UI_DEMO_OUTPUT_DIR}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ext_status=0
demo_status=0

task docker:e2e:run TASK=_extension:test:e2e &
ext_pid=$!
task ui:demo:ci UI_DEMO_OUTPUT_DIR="$UI_DEMO_OUTPUT_DIR" &
demo_pid=$!

wait "$ext_pid" || ext_status=$?
wait "$demo_pid" || demo_status=$?

if [ "$ext_status" -ne 0 ] || [ "$demo_status" -ne 0 ]; then
  echo "main-post-web-e2e failed: extension_e2e=${ext_status} ui_demos=${demo_status}" >&2
  exit 1
fi
