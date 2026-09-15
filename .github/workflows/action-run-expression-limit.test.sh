#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
limit=20000
status=0

while IFS= read -r action; do
  if ! awk -v limit="$limit" '
    function fail(line, bytes) {
      printf "%s:%d: action run expression is %d bytes (limit %d)\n", FILENAME, line, bytes, limit > "/dev/stderr"
      failed = 1
    }
    function flush() {
      if (in_block && bytes >= limit) fail(start, bytes)
      in_block = 0
      bytes = 0
    }
    {
      match($0, /^[ ]*/)
      indent = RLENGTH
      if (in_block && NF && indent <= run_indent) flush()
      if (!in_block && $0 ~ /^[ ]*run:[ ]*[|>][-+]?[ ]*$/) {
        in_block = 1
        run_indent = indent
        start = NR
        bytes = length($0) + 1
      } else if (in_block) {
        bytes += length($0) + 1
      } else if ($0 ~ /^[ ]*run:[ ]*[^|>]/ && length($0) >= limit) {
        fail(NR, length($0))
      }
    }
    END {
      flush()
      exit failed
    }
  ' "$action"; then
    status=1
  fi
done < <(find "$repo_root/.github/actions" -name action.yml -type f -print | sort)

test "$status" -eq 0
echo "composite action run expressions stay below $limit bytes"
