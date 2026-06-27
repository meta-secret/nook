#!/bin/sh
set -e

if [ ! -f /workspace/Cargo.lock ] && [ -f /opt/nook/Cargo.lock ]; then
  cp /opt/nook/Cargo.lock /workspace/Cargo.lock
fi

wasm_pkg=/workspace/nook-web/src/lib/nook-wasm
if [ ! -f "$wasm_pkg/nook_wasm_bg.wasm" ] && [ -d /opt/nook/nook-wasm-pkg ]; then
  mkdir -p "$wasm_pkg"
  cp -a /opt/nook/nook-wasm-pkg/. "$wasm_pkg/"
fi

if [ -f /workspace/nook-web/package.json ]; then
  (cd /workspace/nook-web && bun install --frozen-lockfile)
fi

exec "$@"
