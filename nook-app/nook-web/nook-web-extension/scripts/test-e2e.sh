#!/usr/bin/env bash
set -euo pipefail

if [ ! -e node_modules ]; then
  ln -s ../nook-web-app/node_modules node_modules
fi

export NOOK_SIMPLE_VAULT_URL="${NOOK_EXTENSION_E2E_SIMPLE_VAULT_URL:-http://127.0.0.1:5174/}"

bun run build
bun run e2e:mock-auth:build

bash scripts/run-with-xvfb.sh \
  /tmp/nook-extension-xvfb.log \
  node_modules/.bin/playwright test --config playwright.config.ts "$@"
