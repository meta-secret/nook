#!/usr/bin/env bash
set -euo pipefail

route="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/remote-cache-probe-route.sh"

for selector in dependency-policy deterministic dylint rust wasm wasm-node web; do
  bash "$route" --validate "cache:probe:$selector"
done

for invalid in \
  cache:probe:unknown \
  cache:probe:rust-extra \
  prefix-cache:probe:rust \
  cache:probe:rust-suffix \
  cache:probe:rust,preflight \
  preflight,cache:probe:rust \
  cache:probe:rust,cache:probe:wasm; do
  if bash "$route" --validate "$invalid" >/dev/null 2>&1; then
    echo "invalid cache probe route was accepted: $invalid" >&2
    exit 1
  fi
done

bash "$route" --validate preflight
bash "$route" --validate preflight,loom:verify
echo "remote cache probe route contract passed"
