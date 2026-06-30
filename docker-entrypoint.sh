#!/bin/sh
set -e

if [ ! -f /workspace/Cargo.lock ] && [ -f /opt/nook/Cargo.lock ]; then
  cp /opt/nook/Cargo.lock /workspace/Cargo.lock
fi

wasm_pkg=/workspace/nook-web/src/lib/nook-wasm
if [ -z "${CI:-}" ] && [ ! -f "$wasm_pkg/nook_wasm_bg.wasm" ] && [ -d /opt/nook/nook-wasm-pkg ]; then
  mkdir -p "$wasm_pkg"
  cp -a /opt/nook/nook-wasm-pkg/. "$wasm_pkg/"
fi

if [ -f /workspace/nook-web/package.json ]; then
  lock=/workspace/nook-web/bun.lock
  stamp=/workspace/nook-web/node_modules/.bun-lock-stamp
  if [ -f "$lock" ] && [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$(sha256sum "$lock" | awk '{print $1}')" ]; then
    : # node_modules volume matches bun.lock — skip reinstall
  else
    (cd /workspace/nook-web && bun install --frozen-lockfile)
    if [ -f "$lock" ]; then
      mkdir -p /workspace/nook-web/node_modules
      sha256sum "$lock" | awk '{print $1}' > "$stamp"
    fi
  fi
fi

exec "$@"
