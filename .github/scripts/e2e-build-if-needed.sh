#!/usr/bin/env bash
# Build nook-app/nook-web/nook-web-app/dist for e2e preview when missing or stale.
# Skips vite when dist matches e2e env vars and app sources are unchanged.
#
# Env:
#   E2E_FORCE_BUILD=1  — always rebuild
#   E2E_SKIP_BUILD=1   — never rebuild (fails if dist/index.html missing)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

WEB_ROOT="nook-app/nook-web/nook-web-app"
WEB_GROUP_ROOT="nook-app/nook-web"
WEB_SHARED_ROOT="$WEB_GROUP_ROOT/nook-web-shared"
SIMPLE_ROOT="$WEB_GROUP_ROOT/nook-vault-simple"
SENTINEL_ROOT="$WEB_GROUP_ROOT/nook-vault-sentinel"
DIST="$WEB_ROOT/dist"
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
    "$WEB_ROOT/src" \
    "$WEB_ROOT/index.html" \
    "$WEB_ROOT/package.json" \
    "$WEB_ROOT/vite.config.ts" \
    "$WEB_ROOT/svelte.config.js" \
    "$WEB_SHARED_ROOT/src/vault-app" \
    "$SIMPLE_ROOT/src" \
    "$SIMPLE_ROOT/index.html" \
    "$SIMPLE_ROOT/package.json" \
    "$SIMPLE_ROOT/vite.config.ts" \
    "$SENTINEL_ROOT/src" \
    "$SENTINEL_ROOT/index.html" \
    "$SENTINEL_ROOT/package.json" \
    "$SENTINEL_ROOT/vite.config.ts" \
    -newer "$INDEX" \
    -print -quit 2>/dev/null | grep -q .; then
    need=1
  fi
fi

if [[ "$need" -eq 1 ]]; then
  echo "==> e2e dist stale or missing — running vite build"
  (cd "$WEB_ROOT" && bun run build)
  mkdir -p "$DIST"
  printf '%s' "$inputs_hash" >"$STAMP"
else
  echo "==> e2e dist up to date — skipping vite build"
fi
