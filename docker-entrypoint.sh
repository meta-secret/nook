#!/bin/sh
set -e

if [ ! -f /workspace/Cargo.lock ] && [ -f /opt/nook/Cargo.lock ]; then
  cp /opt/nook/Cargo.lock /workspace/Cargo.lock
fi

if [ ! -d /workspace/target/debug/deps ] || [ -z "$(ls -A /workspace/target/debug/deps 2>/dev/null)" ]; then
  if [ -d /opt/nook/target ]; then
    mkdir -p /workspace/target
    cp -a /opt/nook/target/. /workspace/target/
  fi
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
