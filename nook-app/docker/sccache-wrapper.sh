#!/bin/sh

set -eu

access_file=/run/secrets/sccache_s3_access_key
secret_file=/run/secrets/sccache_s3_secret_key

# Runtime commands and cache-missed BuildKit compiler vertices mount the same
# stable secret IDs. BuildKit excludes secret contents from cache checksums; the
# IDs and target paths remain constant across all builds.
if [ "${NOOK_SCCACHE_S3_MODE:-local}" = external ] \
  && [ -z "${AWS_ACCESS_KEY_ID:-}" ] \
  && [ ! -r "$access_file" ]; then
  exec "$@"
fi

if [ -z "${AWS_ACCESS_KEY_ID:-}" ] && [ -r "$access_file" ]; then
  AWS_ACCESS_KEY_ID="$(cat "$access_file")"
  export AWS_ACCESS_KEY_ID
fi
if [ -z "${AWS_SECRET_ACCESS_KEY:-}" ] && [ -r "$secret_file" ]; then
  AWS_SECRET_ACCESS_KEY="$(cat "$secret_file")"
  export AWS_SECRET_ACCESS_KEY
fi

if [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  : "${SCCACHE_BUCKET:=nook-sccache}"
  : "${SCCACHE_ENDPOINT:=https://sccache.dev.nokey.sh}"
  : "${SCCACHE_REGION:=auto}"
  : "${SCCACHE_S3_USE_SSL:=true}"
  export SCCACHE_BUCKET SCCACHE_ENDPOINT SCCACHE_REGION SCCACHE_S3_USE_SSL
  # SeaweedFS serves path-style buckets; do not enable virtual-host style.
  unset SCCACHE_S3_ENABLE_VIRTUAL_HOST_STYLE || true
fi

exec /usr/local/bin/sccache "$@"
