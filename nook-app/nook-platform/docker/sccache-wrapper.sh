#!/bin/sh

set -eu

access_file=/run/secrets/sccache_s3_access_key
secret_file=/run/secrets/sccache_s3_secret_key

# Cache namespaces are non-secret build policy. Keep the policy in a neutral
# ENV so Docker's secret scanner does not mistake it for a credential, then
# materialize the sccache-specific variable only for this compiler invocation.
if [ -n "${NOOK_BUILD_CACHE_NAMESPACE:-}" ]; then
  SCCACHE_S3_KEY_PREFIX="$NOOK_BUILD_CACHE_NAMESPACE"
  export SCCACHE_S3_KEY_PREFIX
fi

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
  : "${SCCACHE_S3_RW_MODE:=READ_WRITE}"
  case "$SCCACHE_S3_RW_MODE" in
    READ_ONLY|READ_WRITE) ;;
    *)
      echo "unsupported SCCACHE_S3_RW_MODE: $SCCACHE_S3_RW_MODE" >&2
      exit 2
      ;;
  esac
  export SCCACHE_BUCKET SCCACHE_ENDPOINT SCCACHE_REGION SCCACHE_S3_USE_SSL SCCACHE_S3_RW_MODE
  # SeaweedFS serves path-style buckets; do not enable virtual-host style.
  unset SCCACHE_S3_ENABLE_VIRTUAL_HOST_STYLE || true
fi

exec /usr/local/bin/sccache "$@"
