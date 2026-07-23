#!/bin/sh

set -eu

password_file=/run/secrets/sccache_redis_password

# Trusted runtime commands mount the external Redis credential. Image-build RUNs deliberately do
# not: secret-dependent compiler vertices cannot be reused safely across delivery workflows. In
# external mode, compile directly when that credential is absent; local mode remains passwordless.
if [ "${NOOK_SCCACHE_REDIS_MODE:-local}" = external ] \
  && [ -z "${SCCACHE_REDIS_PASSWORD:-}" ] \
  && [ ! -r "$password_file" ]; then
  exec "$@"
fi

if [ -z "${SCCACHE_REDIS_PASSWORD:-}" ] && [ -r "$password_file" ]; then
  SCCACHE_REDIS_PASSWORD="$(cat "$password_file")"
  export SCCACHE_REDIS_PASSWORD
fi

exec /usr/local/bin/sccache "$@"
