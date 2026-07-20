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

echo 'Brave PIN vault setup selection tests passed'
