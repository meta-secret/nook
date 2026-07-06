#!/usr/bin/env bash
# Build nook-app/nook-web/dist for e2e preview when missing or stale.
# Skips vite when dist matches e2e env vars and app sources are unchanged.
#
# Env:
#   E2E_FORCE_BUILD=1  — always rebuild
#   E2E_SKIP_BUILD=1   — never rebuild (fails if dist/index.html missing)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DIST="nook-app/nook-web/dist"
STAMP="$DIST/.nook-e2e-build-stamp"
INDEX="$DIST/index.html"

base="${VITE_BASE:-/}"
inputs_hash="$(
  printf '%s|%s|%s|%s|%s' \
    "$base" \
    "${VITE_E2E_EXPOSE_VAULT:-}" \
    "${VITE_VAULT_SYNC_INTERVAL_MS:-}" \
    "${VITE_VAULT_IDLE_TIMEOUT_MS:-}" \
    "${VITE_VAULT_IDLE_WARNING_MS:-}"
)"

if [[ "${E2E_FORCE_BUILD:-}" == "1" ]]; then
  echo "==> E2E_FORCE_BUILD=1 — running vite build"
  need=1
elif [[ "${E2E_SKIP_BUILD:-}" == "1" ]]; then
  if [[ ! -f "$INDEX" ]]; then
    echo "error: E2E_SKIP_BUILD=1 but $INDEX is missing" >&2
    exit 1
  fi
  echo "==> E2E_SKIP_BUILD=1 — skipping vite build"
  exit 0
else
  need=0
  if [[ ! -f "$INDEX" ]]; then
    need=1
  elif [[ ! -f "$STAMP" ]] || [[ "$(cat "$STAMP")" != "$inputs_hash" ]]; then
    need=1
  elif find \
    nook-app/nook-web/src \
    nook-app/nook-web/index.html \
    nook-app/nook-web/vite.config.ts \
    nook-app/nook-web/svelte.config.js \
    nook-app/nook-web/src/lib/nook-wasm/nook_wasm_bg.wasm \
    -newer "$INDEX" \
    -print -quit 2>/dev/null | grep -q .; then
    need=1
  fi
fi

if [[ "$need" -eq 1 ]]; then
  echo "==> e2e dist stale or missing — running vite build"
  (cd nook-app/nook-web && bun run build)
  mkdir -p "$DIST"
  printf '%s' "$inputs_hash" >"$STAMP"
else
  echo "==> e2e dist up to date — skipping vite build"
fi
