#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=test-hosted-smoke.sh
source "$SCRIPT_DIR/test-hosted-smoke.sh"

expect_failure() {
  if "$@" >/dev/null 2>&1; then
    echo "expected command to fail: $*" >&2
    return 1
  fi
}

CHANNEL=dev PR='' validate_selection
CHANNEL=development PR='' validate_selection
CHANNEL='' PR=410 validate_selection
expect_failure env CHANNEL='' PR='' bash -c "source '$SCRIPT_DIR/test-hosted-smoke.sh'; validate_selection"
expect_failure env CHANNEL=prod PR='' bash -c "source '$SCRIPT_DIR/test-hosted-smoke.sh'; validate_selection"
expect_failure env CHANNEL=dev PR=410 bash -c "source '$SCRIPT_DIR/test-hosted-smoke.sh'; validate_selection"
expect_failure env CHANNEL='' PR=0 bash -c "source '$SCRIPT_DIR/test-hosted-smoke.sh'; validate_selection"
expect_failure env CHANNEL='' PR=abc bash -c "source '$SCRIPT_DIR/test-hosted-smoke.sh'; validate_selection"

echo 'hosted extension smoke selection tests passed'
