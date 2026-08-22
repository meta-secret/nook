#!/usr/bin/env bash
set -euo pipefail

for _ in $(seq 1 120); do
  response="$(
    curl --fail --silent --show-error \
      --user 'neo4j:hive-integration-password' \
      --header 'Content-Type: application/json' \
      --data '{"statements":[{"statement":"RETURN 1"}]}' \
      http://127.0.0.1:7474/db/neo4j/tx/commit 2>/dev/null || true
  )"
  if test -n "$response" &&
     test "$(jq '.errors | length' <<< "$response")" = 0; then
    exit 0
  fi
  sleep 2
done

echo "Private Hive Neo4j sidecar did not become query-ready" >&2
exit 1
