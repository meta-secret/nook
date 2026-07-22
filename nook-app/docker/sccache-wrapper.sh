#!/bin/sh

set -eu

password_file=/run/secrets/sccache_redis_password
if [ -z "${SCCACHE_REDIS_PASSWORD:-}" ] && [ -r "$password_file" ]; then
  SCCACHE_REDIS_PASSWORD="$(cat "$password_file")"
  export SCCACHE_REDIS_PASSWORD
fi

exec /usr/local/bin/sccache "$@"
