#!/usr/bin/env bash
# Export the already-built Main prepare graph into hosted GHA cache scopes.
# Call only after a successful prepare on the same job-scoped Buildx builder so
# cancelled Mid-prepare runs cannot publish incomplete indexes that orphan the
# cargo-chef cook layers PRs need.
#
# Critical: do not import remote GHA manifests during this export. A warm prepare
# already has cook layers in the local builder. Re-importing remote indexes made
# the exporter emit incomplete index-only updates that PRs could not restore —
# observed on Main after #740/#734 where builder-wasm-deps finished in ~1–4s with
# zero "writing layer" lines while web scopes wrote dozens.
#
# Export builder-wasm-deps alone first so shared cook vertices are not claimed by
# a sibling target's cache-to (builder-debug) during a parallel bake. Force zstd
# recompression on that scope when the BuildKit/GHA exporter honors it; index-only
# is still success when the local graph is exported without re-import (blob digests
# may already exist from older scopes).
#
# Proof signal: a PR that does not touch Cargo.lock / recipe inputs should restore
# builder-deps-common `cargo chef cook` as CACHED from nook-rust-wasm-deps-v3.

set -euo pipefail

if [ -z "${GHA_CACHE_WRITE_ENABLED:-}" ]; then
  echo "publish-buildkit-gha-cache: GHA_CACHE_WRITE_ENABLED must be set" >&2
  exit 2
fi

if [ -z "${GHA_CACHE_ENABLED:-}" ]; then
  echo "publish-buildkit-gha-cache: GHA_CACHE_ENABLED must be set" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
builder="${BUILDX_BUILDER:-${NOOK_PR_BUILDX_BUILDER:-}}"
if [ -z "$builder" ]; then
  echo "publish-buildkit-gha-cache: BUILDX_BUILDER is required" >&2
  exit 2
fi

cd "$repo_root"

password_allow=()
if [ -n "${SCCACHE_REDIS_PASSWORD_FILE:-}" ] && [ -r "${SCCACHE_REDIS_PASSWORD_FILE}" ]; then
  password_allow=(--allow="fs.read=${SCCACHE_REDIS_PASSWORD_FILE}")
fi

bake_files=(
  -f "${repo_root}/nook-app/docker-bake.hcl"
  -f "${repo_root}/nook-app/docker/base.docker-bake.hcl"
  -f "${repo_root}/nook-app/nook-core/docker-bake.hcl"
  -f "${repo_root}/nook-app/nook-wasm/docker-bake.hcl"
  -f "${repo_root}/nook-app/docker/toolchain.docker-bake.hcl"
  -f "${repo_root}/nook-app/nook-web/nook-web-app/docker-bake.hcl"
)

common_sets=(
  --set "*.context=${repo_root}"
  --set "*.args.SCCACHE_REDIS_MODE=${SCCACHE_REDIS_MODE:-external}"
  --set "*.args.SCCACHE_REDIS_ENDPOINT=${SCCACHE_REDIS_ENDPOINT:-rediss://redis-ovh-borg-1.bynull.link:6380}"
  --set "builder-wasm.args.WASM_BUILD_MODE=${WASM_BUILD_MODE:-dev}"
  --set "*.output=type=cacheonly"
)

# Export local prepare layers only — empty cache-from prevents the thin-index trap.
no_import_rust_base=(--set "rust-base.cache-from=")
no_import_wasm_deps=(--set "builder-wasm-deps.cache-from=")
no_import_rust_rest=(
  --set "builder-deps.cache-from="
  --set "builder-debug.cache-from="
  --set "rust-format-check.cache-from="
)
web_no_import=(
  --set "web-artifacts.cache-from="
  --set "web-deps.cache-from="
)

wasm_deps_force_upload=(
  --set "builder-wasm-deps.cache-to=type=gha,scope=nook-rust-wasm-deps-v3,mode=max,version=2,compression=zstd,force-compression=true,timeout=10m"
)

# GHA logs prefix each line with a timestamp, so match " #N writing layer " not "^#N ".
assert_wasm_deps_exported() {
  local log_file="$1"
  local export_line step_id layer_count
  export_line="$(grep -n '\[builder-wasm-deps\] exporting to GitHub Actions Cache' "$log_file" | head -1 || true)"
  if [ -z "$export_line" ]; then
    echo "publish-buildkit-gha-cache: builder-wasm-deps did not export to GHA cache" >&2
    exit 1
  fi
  step_id="$(printf '%s\n' "$export_line" | sed -E 's/^([0-9]+):.*#([0-9]+) .*/\2/')"
  if [ -z "$step_id" ]; then
    echo "publish-buildkit-gha-cache: could not parse builder-wasm-deps export step id" >&2
    exit 1
  fi
  if ! grep -qE " #${step_id} DONE " "$log_file"; then
    echo "publish-buildkit-gha-cache: builder-wasm-deps export step #${step_id} did not complete" >&2
    exit 1
  fi
  layer_count="$(grep -cE " #${step_id} writing layer " "$log_file" || true)"
  if [ "${layer_count:-0}" -lt 1 ]; then
    # After a reseed epoch bump, the first Main must write layers. Later Mains may
    # legitimately send index-only when those zstd digests already exist in GHA.
    echo "builder-wasm-deps GHA export completed as index-only (step #${step_id}; 0 writing layer lines)"
    echo "publish-buildkit-gha-cache: accepting index-only export from local prepare graph (no cache-from reimport)"
  else
    echo "builder-wasm-deps GHA export wrote ${layer_count} layer(s) (step #${step_id})"
  fi
}

run_bake() {
  local log_file="$1"
  shift
  echo "Publishing hosted BuildKit cache from builder ${builder}: $*"
  BUILDKIT_PROGRESS=plain docker buildx --builder "$builder" bake \
    --allow="fs.read=${repo_root}" \
    "${password_allow[@]}" \
    "${bake_files[@]}" \
    "${common_sets[@]}" \
    "$@" 2>&1 | tee "$log_file"
}

wasm_log="$(mktemp)"
rust_log="$(mktemp)"
web_log="$(mktemp)"
trap 'rm -f "$wasm_log" "$rust_log" "$web_log"' EXIT

# 1) Seed rust-base, then export wasm-deps alone so cook layers attach to v3.
run_bake "$wasm_log" \
  "${no_import_rust_base[@]}" \
  "${no_import_wasm_deps[@]}" \
  "${wasm_deps_force_upload[@]}" \
  rust-base builder-wasm-deps

assert_wasm_deps_exported "$wasm_log"

# 2) Remaining rust scopes (native deps / source / format).
run_bake "$rust_log" \
  "${no_import_rust_base[@]}" \
  "${no_import_wasm_deps[@]}" \
  "${no_import_rust_rest[@]}" \
  rust-base builder-deps builder-debug rust-format-check

# 3) Web scopes last so they do not compete with cook uploads for the rate limit.
run_bake "$web_log" \
  "${web_no_import[@]}" \
  web-artifacts web-deps

echo "Hosted BuildKit cache publish complete"
