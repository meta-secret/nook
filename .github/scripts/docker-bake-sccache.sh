#!/usr/bin/env bash
# Bake one or more targets with SeaweedFS sccache secret mounts when present.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: docker-bake-sccache.sh <bake-args-and-targets...>" >&2
  exit 1
fi

secrets=()
if [ -n "${SCCACHE_S3_ACCESS_KEY_FILE:-}" ] && [ -r "${SCCACHE_S3_ACCESS_KEY_FILE}" ] \
  && [ -n "${SCCACHE_S3_SECRET_KEY_FILE:-}" ] && [ -r "${SCCACHE_S3_SECRET_KEY_FILE}" ]; then
  secrets=(
    --allow=fs.read="${SCCACHE_S3_ACCESS_KEY_FILE}"
    --allow=fs.read="${SCCACHE_S3_SECRET_KEY_FILE}"
    --set "*.secrets=id=sccache_s3_access_key,src=${SCCACHE_S3_ACCESS_KEY_FILE}"
    --set "*.secrets+=id=sccache_s3_secret_key,src=${SCCACHE_S3_SECRET_KEY_FILE}"
  )
fi

exec docker buildx bake \
  --set "*.args.SCCACHE_S3_MODE=${SCCACHE_S3_MODE:-external}" \
  --set "*.args.SCCACHE_ENDPOINT=${SCCACHE_ENDPOINT:-https://sccache.dev.nokey.sh}" \
  --set "*.args.SCCACHE_BUCKET=${SCCACHE_BUCKET:-nook-sccache}" \
  "${secrets[@]}" \
  "$@"
