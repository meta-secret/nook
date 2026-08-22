#!/usr/bin/env bash
set -euo pipefail

tests_dir="${1:?usage: run-arc-tests.sh TESTS_DIR}"
exchange_root="${NOOK_ARC_HIVE_TEST_EXCHANGE:-/var/run/nook-hive-tests}"
request_id="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$-$RANDOM"
case "$request_id" in
  *[!0-9-]*) echo "Invalid Hive test-runtime request ID" >&2; exit 2 ;;
esac

request_dir="$exchange_root/$request_id"
cleanup() { rm -rf -- "$request_dir" "$exchange_root/$request_id.request"; }
trap cleanup EXIT
install -d -m 0700 "$request_dir/tests"
cp -a "$tests_dir/." "$request_dir/tests/"
printf '%s\n' "$request_id" > "$exchange_root/$request_id.request.tmp"
mv "$exchange_root/$request_id.request.tmp" "$exchange_root/$request_id.request"

for _ in $(seq 1 6000); do
  if test -f "$request_dir/status"; then
    cat "$request_dir/output.log"
    status="$(cat "$request_dir/status")"
    case "$status" in
      0) exit 0 ;;
      ''|*[!0-9]*) echo "Invalid Hive test-runtime status" >&2; exit 1 ;;
      *) exit "$status" ;;
    esac
  fi
  sleep 0.1
done

echo "Pinned Hive test runtime did not return within ten minutes" >&2
exit 1
