#!/usr/bin/env bash
# After Main images are baked, overlap web e2e with extension Playwright and
# headless UI demos. Each suite uses the sealed nook-web-e2e image via a public
# Task wrapper (docker:e2e:run / docker:ui-demo:run are internal).
#
# Deploy stays outside this script and must wait for web e2e to succeed.
set -euo pipefail

: "${UI_DEMO_OUTPUT_DIR:?main-post-web-e2e requires UI_DEMO_OUTPUT_DIR}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

web_status=0
ext_status=0
demo_status=0

task ci:main:web-e2e:ci &
web_pid=$!
task extension:test:e2e:ci &
ext_pid=$!
task ui:demo:ci UI_DEMO_OUTPUT_DIR="$UI_DEMO_OUTPUT_DIR" &
demo_pid=$!

wait "$web_pid" || web_status=$?
wait "$ext_pid" || ext_status=$?
wait "$demo_pid" || demo_status=$?

if [ "$web_status" -ne 0 ] || [ "$ext_status" -ne 0 ] || [ "$demo_status" -ne 0 ]; then
  echo "main-post-web-e2e failed: web_e2e=${web_status} extension_e2e=${ext_status} ui_demos=${demo_status}" >&2
  exit 1
fi
