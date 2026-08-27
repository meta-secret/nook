#!/usr/bin/env bash
# Promote one quarantined local dependency cache only after complete hosted reads.
set -euo pipefail

fingerprint="${1:-}"
candidate="${2:-}"
registry_host="${NOOK_REGISTRY_CACHE_HOST:-registry.dev.nokey.sh}"

if [[ ! "$fingerprint" =~ ^[0-9a-f]{40}$ ]]; then
  echo "rust-deps-cache-promote: fingerprint must be a 40-char lowercase git object ID" >&2
  exit 2
fi
if [[ ! "$candidate" =~ ^[0-9a-z][0-9a-z.-]{0,63}$ ]]; then
  echo "rust-deps-cache-promote: candidate must be a lowercase OCI-tag component" >&2
  exit 2
fi
if ! command -v oras >/dev/null 2>&1; then
  echo "rust-deps-cache-promote: oras is required" >&2
  exit 2
fi

run_id="${GITHUB_RUN_ID:-manual}"
run_attempt="${GITHUB_RUN_ATTEMPT:-1}"
promotion_root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/nook-rust-cache-promotion.XXXXXX")"
cleanup() {
  rm -rf "$promotion_root"
}
trap cleanup EXIT

for graph in native wasm; do
  repository="$registry_host/nook/remote-buildcache/nook-rust-${graph}-deps-input-v3"
  candidate_tag="candidate-${fingerprint}-${candidate}"
  verified_tag="verified-${fingerprint}-${run_id}-${run_attempt}"
  stable_tag="fingerprint-${fingerprint}"
  local_layout="$promotion_root/local-$graph"
  hosted_layout="$promotion_root/hosted-$graph"

  # ORAS copies the complete reachable OCI graph. A short or missing blob makes
  # either download fail before the PR-visible stable tag is touched.
  oras cp --to-oci-layout "$repository:$candidate_tag" "$local_layout:buildcache"
  candidate_digest="$(oras resolve --oci-layout "$local_layout:buildcache")"
  oras cp --from-oci-layout "$local_layout:buildcache" "$repository:$verified_tag"
  oras cp --to-oci-layout "$repository:$verified_tag" "$hosted_layout:buildcache"
  hosted_digest="$(oras resolve --oci-layout "$hosted_layout:buildcache")"

  if [ "$candidate_digest" != "$hosted_digest" ]; then
    echo "rust-deps-cache-promote: $graph digest changed during hosted normalization" >&2
    exit 1
  fi

  # The verified and stable tags share one repository, so this is an atomic
  # manifest tag operation over the already re-downloaded hosted blobs.
  oras tag "$repository:$verified_tag" "$stable_tag"
  stable_digest="$(oras resolve "$repository:$stable_tag")"
  if [ "$stable_digest" != "$hosted_digest" ]; then
    echo "rust-deps-cache-promote: $graph stable tag does not match verified content" >&2
    exit 1
  fi
  echo "Promoted verified $graph dependency cache $stable_tag ($stable_digest)"
done
