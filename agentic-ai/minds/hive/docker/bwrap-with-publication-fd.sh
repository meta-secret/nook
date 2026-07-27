#!/bin/bash
set -euo pipefail

real_bwrap="${HIVE_REAL_BWRAP:-/usr/bin/bwrap}"
publication_fd="${HIVE_PUBLICATION_FD:-}"

if [[ -n "$publication_fd" ]]; then
  if [[ ! "$publication_fd" =~ ^[0-9]+$ ]]; then
    printf 'invalid HIVE_PUBLICATION_FD\n' >&2
    exit 2
  fi
  exec "$real_bwrap" --keep-fd "$publication_fd" "$@"
fi

exec "$real_bwrap" "$@"
