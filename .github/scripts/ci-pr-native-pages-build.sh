#!/usr/bin/env bash
# Build the preview WASM handoff and web/extension artifacts on a host runner.
# This is the runner-native equivalent of the existing PR build graph; it does
# not invoke Task targets that enter the Docker-backed build path.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

platform_root="$ROOT/nook-app/nook-platform"
shared_root="$ROOT/nook-app/nook-web/nook-web-shared"
wasm_mode="${WASM_BUILD_MODE:-dev}"
case "$wasm_mode" in
  dev) wasm_opt_flag="--no-opt"; stamp_mode="no-opt" ;;
  prod) wasm_opt_flag=""; stamp_mode="optimized" ;;
  *)
    echo "Unsupported WASM_BUILD_MODE=$wasm_mode (expected dev or prod)" >&2
    exit 2
    ;;
esac

current="$(
  cd "$platform_root"
  find Cargo.toml Cargo.lock \
    nook-wasm/Cargo.toml nook-wasm/src \
    nook-companion-wasm/Cargo.toml nook-companion-wasm/src \
    nook-companion-core/Cargo.toml nook-companion-core/src \
    nook-app-common/Cargo.toml nook-app-common/src nook-app-common/locales \
    nook-core/Cargo.toml nook-core/src \
    nook-authenticator-domain/Cargo.toml nook-authenticator-domain/src \
    nook-auth2/Cargo.toml nook-auth2/src \
    nook-replication/Cargo.toml nook-replication/src \
    nook-event-log/Cargo.toml nook-event-log/src \
    \( -name '*.rs' -o -name '*.json' -o -name 'Cargo.toml' -o -name 'Cargo.lock' \) -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 sha256sum \
    | sha256sum \
    | cut -d' ' -f1
)"

vault_root="$shared_root/src/vault-app/lib/nook-wasm"
companion_root="$shared_root/src/extension/nook-companion-wasm"
desired="$current $stamp_mode"

vault_output="$vault_root/nook_wasm_bg.wasm"
vault_stamp="$vault_root/.wasm-source-sha256"
vault_build_mode="$vault_root/nook-wasm-build-mode"
companion_output="$companion_root/nook_companion_wasm_bg.wasm"
companion_stamp="$companion_root/.wasm-source-sha256"

vault_stored=""
companion_stored=""
[ -f "$vault_stamp" ] && vault_stored="$(<"$vault_stamp")"
[ -f "$companion_stamp" ] && companion_stored="$(<"$companion_stamp")"

if [ ! -f "$vault_output" ] || [ ! -f "$companion_output" ] \
  || [ "$desired" != "$vault_stored" ] || [ "$desired" != "$companion_stored" ]; then
  mkdir -p "$vault_root" "$companion_root"
  (
    cd "$platform_root"
    wasm-pack build nook-wasm --target web \
      --out-dir "../../nook-web/nook-web-shared/src/vault-app/lib/nook-wasm" \
      --out-name nook_wasm $wasm_opt_flag
    wasm-pack build nook-companion-wasm --target web \
      --out-dir "../../nook-web/nook-web-shared/src/extension/nook-companion-wasm" \
      --out-name nook_companion_wasm $wasm_opt_flag
  )
  echo "$desired" > "$vault_stamp"
  echo "$desired" > "$companion_stamp"
fi
echo "$stamp_mode" > "$vault_build_mode"

web_root="$ROOT/nook-app/nook-web/nook-web-app"
extension_root="$ROOT/nook-app/nook-web/nook-web-extension"

(cd "$web_root" && bun install --frozen-lockfile)
(
  cd "$web_root"
  VITE_BASE="${VITE_BASE:-/}" \
    VITE_SITE_URL="${VITE_SITE_URL:-}" \
    VITE_PUBLIC_APP_URL="${VITE_PUBLIC_APP_URL:-}" \
    VITE_SIMPLE_APP_URL="${VITE_SIMPLE_APP_URL:-}" \
    VITE_SENTINEL_APP_URL="${VITE_SENTINEL_APP_URL:-}" \
    bun run build
)
(
  cd "$extension_root"
  NOOK_SIMPLE_VAULT_URL="${NOOK_SIMPLE_VAULT_URL:-}" \
    NOOK_EXTENSION_CHANNEL="${NOOK_EXTENSION_CHANNEL:-production}" \
    NOOK_EXTENSION_VERSION="${NOOK_EXTENSION_VERSION:-1.0.0}" \
    NOOK_EXTENSION_COMMIT="${NOOK_EXTENSION_COMMIT:-${GIT_COMMIT_ID:-}}" \
    bun run build
  NOOK_EXTENSION_CHANNEL="${NOOK_EXTENSION_CHANNEL:-production}" \
    NOOK_EXTENSION_VERSION="${NOOK_EXTENSION_VERSION:-1.0.0}" \
    NOOK_EXTENSION_COMMIT="${NOOK_EXTENSION_COMMIT:-${GIT_COMMIT_ID:-}}" \
    NOOK_EXTENSION_SITE_URL="${NOOK_EXTENSION_SITE_URL:-https://nokey.sh/}" \
    bun run package:deployment
)
