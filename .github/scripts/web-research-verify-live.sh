#!/usr/bin/env bash
# Verify the live web-research custom domain serves the expected title.
#
# Required env:
#   RESEARCH_URL
set -euo pipefail

: "${RESEARCH_URL:?RESEARCH_URL is required}"

curl --retry 30 --retry-all-errors --retry-delay 10 -fsS "$RESEARCH_URL/" \
  | grep -F '<title>Nook UI experiments</title>' >/dev/null
