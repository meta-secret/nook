#!/usr/bin/env bash
set -euo pipefail

probe_status="${1:?probe status is required}"
probe_output="${2:?probe output path is required}"

if [ "$probe_status" -eq 0 ]; then
  echo available
elif grep -Eqi 'unauthorized|authentication required|denied|forbidden|insufficient[_ ]scope|permission denied|invalid reference|invalid repository|invalid tag|invalid checksum' "$probe_output"; then
  echo fatal
elif grep -Eqi 'not found|manifest unknown|name unknown' "$probe_output"; then
  echo absent
elif [ "$probe_status" -eq 124 ] \
  || grep -Eqi 'context canceled|context cancelled|deadline exceeded|timed out|timeout|temporary failure in name resolution|no such host|server misbehaving|connection (reset|refused)|tls handshake timeout|unexpected eof|service unavailable|bad gateway|gateway timeout' "$probe_output"; then
  echo transient_unavailable
else
  echo fatal
fi
