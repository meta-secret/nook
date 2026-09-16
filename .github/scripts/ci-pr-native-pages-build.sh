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
  dev) wasm_opt_flag="--no-opt"; build_mode="no-opt" ;;
  prod) wasm_opt_flag=""; build_mode="optimized" ;;
  *)
    echo "Unsupported WASM_BUILD_MODE=$wasm_mode (expected dev or prod)" >&2
    exit 2
    ;;
esac

# The Pages preview job is intentionally host-native, but its Rust/WASM
# compiler path must retain the repository's real SeaweedFS sccache contract.
# The --prepare mode is called before cargo installs wasm-pack so that the
# tooling bootstrap itself cannot bypass the compiler cache.
sccache_version="0.17.0"
sccache_sha256="67c4a96dd237c1f518f6b36083f270f9976d516f1e57fce891755ea782e50006"
sccache_root="${RUNNER_TEMP:-/tmp}/nook-sccache"
sccache_report_dir="${RUNNER_TEMP:-/tmp}/nook-sccache-reports"
sccache_binary="$sccache_root/sccache"
sccache_wrapper="$sccache_root/nook-sccache"
sccache_report="$sccache_root/nook-sccache-report"
sccache_fallback_marker="$sccache_root/remote-disabled"
sccache_ready_marker="$sccache_root/remote-ready"
sccache_start_lock="$sccache_root/start-lock"

if [ "${1:-}" = --prepare ]; then
  if [ "${NOOK_SCCACHE_BACKEND:-}" != remote ] \
    || [ "${SCCACHE_S3_RW_MODE:-}" != READ_WRITE ] \
    || [ -z "${SCCACHE_S3_ACCESS_KEY_FILE:-}" ] \
    || [ -z "${SCCACHE_S3_SECRET_KEY_FILE:-}" ] \
    || [ ! -r "$SCCACHE_S3_ACCESS_KEY_FILE" ] \
    || [ ! -r "$SCCACHE_S3_SECRET_KEY_FILE" ]; then
    echo "Pages preview requires the writable remote sccache backend and both credential files" >&2
    exit 2
  fi
  command -v bun >/dev/null 2>&1 || {
    echo "Pages preview requires the pinned repository Bun runtime to fetch sccache" >&2
    exit 2
  }
  test -n "${GITHUB_ENV:-}"
  mkdir -p "$sccache_root" "$sccache_report_dir"
  archive="$sccache_root/sccache.tar.gz"
  if [ ! -x "$sccache_binary" ]; then
    NOOK_SCCACHE_DOWNLOAD_URL="https://github.com/mozilla/sccache/releases/download/v${sccache_version}/sccache-v${sccache_version}-x86_64-unknown-linux-musl.tar.gz" \
    NOOK_SCCACHE_DOWNLOAD_PATH="$archive" \
      bun -e '
      const url = process.env.NOOK_SCCACHE_DOWNLOAD_URL;
      const output = process.env.NOOK_SCCACHE_DOWNLOAD_PATH;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`sccache download failed: ${response.status}`);
      await Bun.write(output, response);
    '
    echo "$sccache_sha256  $archive" | sha256sum -c -
    tar -xzf "$archive" -C "$sccache_root"
    install -m 0755 \
      "$sccache_root/sccache-v${sccache_version}-x86_64-unknown-linux-musl/sccache" \
      "$sccache_binary"
    rm -rf "$archive" "$sccache_root/sccache-v${sccache_version}-x86_64-unknown-linux-musl"
  fi
  install -m 0755 "$ROOT/nook-app/nook-platform/docker/sccache-wrapper.sh" "$sccache_wrapper"
  install -m 0755 "$ROOT/nook-app/nook-platform/docker/sccache-report.sh" "$sccache_report"
  {
    printf 'NOOK_SCCACHE_BINARY=%s\n' "$sccache_binary"
    printf 'NOOK_SCCACHE_REPORT_BINARY=%s\n' "$sccache_binary"
    printf 'NOOK_SCCACHE_REPORT_SCRIPT=%s\n' "$sccache_report"
    printf 'NOOK_SCCACHE_REPORT_DIR=%s\n' "$sccache_report_dir"
    printf 'NOOK_SCCACHE_S3_MODE=external\n'
    printf 'NOOK_SCCACHE_RUNTIME_AUTHORITY=legacy\n'
    printf 'NOOK_SCCACHE_FALLBACK_MARKER=%s\n' "$sccache_fallback_marker"
    printf 'NOOK_SCCACHE_READY_MARKER=%s\n' "$sccache_ready_marker"
    printf 'NOOK_SCCACHE_START_LOCK=%s\n' "$sccache_start_lock"
    printf 'SCCACHE_CLIENT_SIDE=0\n'
    printf 'SCCACHE_SERVER_UDS=%s/server.sock\n' "$sccache_root"
    printf 'RUSTC_WRAPPER=%s\n' "$sccache_wrapper"
  } >> "$GITHUB_ENV"
  exit 0
fi

if [ "${NOOK_SCCACHE_BACKEND:-}" != remote ] \
  || [ "${SCCACHE_S3_RW_MODE:-}" != READ_WRITE ] \
  || [ ! -x "${NOOK_SCCACHE_BINARY:-}" ] \
  || [ ! -x "${RUSTC_WRAPPER:-}" ]; then
  echo "Pages preview must be prepared with remote sccache before Rust tooling installation" >&2
  exit 2
fi
sccache_binary="$NOOK_SCCACHE_BINARY"
sccache_report="${NOOK_SCCACHE_REPORT_SCRIPT:-$sccache_root/nook-sccache-report}"
cleanup_sccache() {
  "$sccache_binary" --stop-server >/dev/null 2>&1 || true
}
trap cleanup_sccache EXIT

vault_root="$shared_root/src/vault-app/lib/nook-wasm"
companion_root="$shared_root/src/extension/nook-companion-wasm"
vault_build_mode="$vault_root/nook-wasm-build-mode"

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

# This is an executable health gate, not advisory telemetry. A cold publisher
# may pass with authoritative remote writes; an existing cache must contribute
# at least one useful hit. Fallback, unavailable stats, transport errors, and
# zero-hit/no-write runs fail the preview before any Pages publication.
report_status=0
bash "$sccache_report" --require pages-preview-wasm || report_status=$?
if [ -e "$sccache_fallback_marker" ]; then
  echo "Pages preview sccache circuit opened; refusing direct-compiler success" >&2
  exit 1
fi
if [ "$report_status" -ne 0 ]; then
  exit "$report_status"
fi
echo "$build_mode" > "$vault_build_mode"

web_root="$ROOT/nook-app/nook-web/nook-web-app"
extension_root="$ROOT/nook-app/nook-web/nook-web-extension"

(cd "$web_root" && bun install --frozen-lockfile)
(
  cd "$web_root"
  # The host runner may carry Vite app-selection variables from its base image.
  # Let the package's mode files select the same unified/site output layout as
  # the sealed PR web build; otherwise site mode can inherit the unified app
  # shell and overwrite the site's dedicated static 404.html.
  unset VITE_NOOK_APP_KIND VITE_NOOK_OUT_DIR
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
