#!/usr/bin/env bash
# Verify the live web-research custom domain serves the expected title.
#
# Required env:
#   RESEARCH_URL
set -euo pipefail

: "${RESEARCH_URL:?RESEARCH_URL is required}"

body="$(mktemp)"
trap 'rm -f "$body"' EXIT
status="$(curl -sS -o "$body" -w '%{http_code}' "$RESEARCH_URL/" || true)"
if [ "$status" != 200 ] || ! grep -Fq '<title>Nook UI experiments</title>' "$body"; then
  echo "Web research deployment verification failed (status=$status, expected title missing)" >&2
  exit 1
fi
