#!/usr/bin/env bash
set -euo pipefail

if [ ! -e node_modules ]; then
  ln -s ../nook-web-app/node_modules node_modules
fi

export NOOK_SIMPLE_VAULT_URL="${NOOK_SIMPLE_VAULT_URL:-http://127.0.0.1:5174/}"

bun run build

if command -v Xvfb >/dev/null 2>&1 && [ -z "${NOOK_EXTENSION_E2E_NO_XVFB:-}" ]; then
  display="${DISPLAY:-:99}"
  Xvfb "$display" -screen 0 1280x720x24 >/tmp/nook-extension-xvfb.log 2>&1 &
  xvfb_pid=$!
  cleanup() {
    kill "$xvfb_pid" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT
  DISPLAY="$display" node_modules/.bin/playwright test --config playwright.config.ts "$@"
else
  node_modules/.bin/playwright test --config playwright.config.ts "$@"
fi
