#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <xvfb-log> <command> [args...]" >&2
  exit 2
fi

log_file=$1
shift

if ! command -v Xvfb >/dev/null 2>&1 || [ -n "${NOOK_EXTENSION_E2E_NO_XVFB:-}" ]; then
  exec "$@"
fi

display_file=$(mktemp)
xvfb_pid=''
cleanup() {
  if [ -n "$xvfb_pid" ]; then
    kill "$xvfb_pid" >/dev/null 2>&1 || true
    wait "$xvfb_pid" 2>/dev/null || true
  fi
  rm -f "$display_file"
}
trap cleanup EXIT

# Let Xvfb select an unused display and report it only after the server is ready.
# -noreset keeps the server alive when a Playwright retry temporarily has no clients.
Xvfb -displayfd 3 -screen 0 1280x720x24 -noreset 3>"$display_file" >"$log_file" 2>&1 &
xvfb_pid=$!

display_number=''
for _ in $(seq 1 100); do
  if [ -s "$display_file" ]; then
    display_number=$(tr -d '[:space:]' <"$display_file")
    break
  fi
  if ! kill -0 "$xvfb_pid" >/dev/null 2>&1; then
    echo "Xvfb exited before becoming ready" >&2
    cat "$log_file" >&2
    exit 1
  fi
  sleep 0.1
done

if ! [[ "$display_number" =~ ^[0-9]+$ ]]; then
  echo "Xvfb did not report a ready display" >&2
  cat "$log_file" >&2
  exit 1
fi

status=0
DISPLAY=":$display_number" "$@" || status=$?
if ! kill -0 "$xvfb_pid" >/dev/null 2>&1; then
  echo "Xvfb exited while the browser suite was running" >&2
  cat "$log_file" >&2
  if [ "$status" -eq 0 ]; then
    status=1
  fi
elif [ "$status" -ne 0 ]; then
  cat "$log_file" >&2
fi

exit "$status"
