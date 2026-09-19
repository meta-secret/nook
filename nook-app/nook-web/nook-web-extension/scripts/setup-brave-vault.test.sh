#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=setup-brave-vault.sh
source "$SCRIPT_DIR/setup-brave-vault.sh"

expect_failure() {
  if "$@" >/dev/null 2>&1; then
    echo "expected command to fail: $*" >&2
    return 1
  fi
}

CHANNEL=dev PR='' validate_setup_selection
CHANNEL=development PR='' validate_setup_selection
CHANNEL='' PR=410 validate_setup_selection
expect_failure env CHANNEL='' PR='' bash -c "source '$SCRIPT_DIR/setup-brave-vault.sh'; validate_setup_selection"
expect_failure env CHANNEL=prod PR='' bash -c "source '$SCRIPT_DIR/setup-brave-vault.sh'; validate_setup_selection"
expect_failure env CHANNEL=production PR='' bash -c "source '$SCRIPT_DIR/setup-brave-vault.sh'; validate_setup_selection"
expect_failure env CHANNEL=dev PR=410 bash -c "source '$SCRIPT_DIR/setup-brave-vault.sh'; validate_setup_selection"
expect_failure env CHANNEL='' PR=0 bash -c "source '$SCRIPT_DIR/setup-brave-vault.sh'; validate_setup_selection"
expect_failure env CHANNEL='' PR=abc bash -c "source '$SCRIPT_DIR/setup-brave-vault.sh'; validate_setup_selection"
expect_failure env CHANNEL=qa PR='' bash -c "source '$SCRIPT_DIR/setup-brave-vault.sh'; validate_setup_selection"

port="$(pick_free_port)"
case "$port" in
  *[!0-9]*|'') echo "pick_free_port returned invalid port: $port" >&2; exit 1 ;;
esac
[ "$port" -gt 0 ]

marker="$(setup_marker_path /tmp/nook-profile-fixture)"
assert_equal() {
  [ "$1" = "$2" ] || { echo "expected '$2', got '$1'" >&2; exit 1; }
}
assert_equal "$marker" '/tmp/nook-profile-fixture/.nook-pin-vault-setup'

setup_script="$SCRIPT_DIR/setup-brave-vault.sh"
driver_script="$SCRIPT_DIR/setup-brave-vault.mjs"
assert_source_contains() {
  local source_file="$1"
  local expected="$2"
  grep -Fq "$expected" "$source_file" || {
    echo "expected $source_file to contain: $expected" >&2
    return 1
  }
}
assert_source_not_contains() {
  local source_file="$1"
  local unexpected="$2"
  if grep -Fq "$unexpected" "$source_file"; then
    echo "expected $source_file not to contain: $unexpected" >&2
    return 1
  fi
}

# A marker is only a setup hint. The driver must still inspect extension
# storage so a stale marker can repair pairing after a profile reset.
assert_source_not_contains "$setup_script" 'if [ -f "$marker" ]; then'
assert_source_contains "$setup_script" 'NOOK_EXTENSION_SETUP_CDP_URL="$cdp_url"'

# Keep Simple Vault WebAuthn intact while forcing the extension popup through
# the PIN path, matching e2e/helpers/pin-device.ts.
assert_source_contains "$driver_script" "globalThis.location?.protocol !== 'chrome-extension:'"
assert_source_not_contains "$driver_script" "Object.defineProperty(window, 'PublicKeyCredential'"

echo 'Brave PIN vault setup selection tests passed'
