#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOSTED_INSTALLER="$SCRIPT_DIR/hosted-extension.sh"
SMOKE_ROOT=''

fail() {
  echo "test-hosted-smoke.sh: $*" >&2
  return 1
}

validate_selection() {
  local channel="${CHANNEL:-}"
  local pr="${PR:-}"

  if [ -n "$pr" ]; then
    [ -z "$channel" ] || {
      fail 'set PR or CHANNEL=dev, not both'
      return 1
    }
    case "$pr" in
      *[!0-9]*|'') fail 'PR must be a positive integer'; return 1 ;;
    esac
    [ "$pr" -gt 0 ] || fail 'PR must be a positive integer'
    return
  fi

  case "$channel" in
    dev|development) ;;
    prod|production)
      fail 'production smoke is disabled because this test creates vault data'
      ;;
    '') fail 'set CHANNEL=dev or PR=<number>' ;;
    *) fail 'CHANNEL must be dev' ;;
  esac
}

run_playwright() {
  local test_title='uses a passkey-backed extension to create, approve, lock, and unlock a Simple Vault'
  if command -v Xvfb >/dev/null 2>&1 && [ -z "${NOOK_EXTENSION_E2E_NO_XVFB:-}" ]; then
    local display="${DISPLAY:-:99}"
    Xvfb "$display" -screen 0 1280x720x24 >/tmp/nook-hosted-extension-xvfb.log 2>&1 &
    local xvfb_pid=$!
    local status=0
    DISPLAY="$display" node_modules/.bin/playwright test \
      --config playwright.config.ts \
      --grep "$test_title" || status=$?
    kill "$xvfb_pid" >/dev/null 2>&1 || true
    return "$status"
  fi

  node_modules/.bin/playwright test \
    --config playwright.config.ts \
    --grep "$test_title"
}

main() {
  validate_selection

  SMOKE_ROOT="$(mktemp -d)"
  trap 'rm -rf "$SMOKE_ROOT"' EXIT

  export NOOK_EXTENSION_RELEASE_DIR="$SMOKE_ROOT/releases"
  export NOOK_EXTENSION_PROFILE_ROOT="$SMOKE_ROOT/profiles"

  local extension_dir selection simple_vault_url
  extension_dir="$(bash "$HOSTED_INSTALLER" install)"
  selection="$(bash "$HOSTED_INSTALLER" resolve)"
  simple_vault_url="$(printf '%s\n' "$selection" | awk -F= '$1 == "simple_vault_url" { print substr($0, index($0, "=") + 1) }')"
  [ -n "$simple_vault_url" ] || fail 'could not resolve the selected Simple Vault URL'

  export NOOK_EXTENSION_E2E_DIR="$extension_dir"
  export NOOK_EXTENSION_E2E_HOSTED=true
  export NOOK_SIMPLE_VAULT_URL="$simple_vault_url"

  printf 'Testing verified extension at %s against %s\n' "$extension_dir" "$simple_vault_url"
  cd "$EXTENSION_ROOT"
  run_playwright
  printf 'Hosted extension smoke passed; disposable browser and vault state removed.\n'
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
