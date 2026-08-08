#!/usr/bin/env bash
# Local-only gate for source-free dependency cache publication.
set -euo pipefail

if [ -n "${GITHUB_ACTIONS:-}" ]; then
  exit 0
fi

if [ "${NOOK_REGISTRY_CACHE_LOCAL_DEPS_PUBLISH:-}" != "1" ]; then
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"

# Application source and Cargo inputs may be dirty: their content either stays
# outside these stages or rotates the fingerprint. The cache recipe itself must
# be committed and unchanged so a dirty Bake edit cannot widen a publisher to a
# source-bearing target.
readonly recipe_paths=(
  .github/scripts/rust-deps-cache-fingerprint.sh
  .github/scripts/rust-deps-cache-promote.sh
  .github/scripts/rust-deps-cache-publish-guard.sh
  .github/workflows/remote.yml
  Taskfile.yml
  nook-app/Taskfile.yml
  nook-app/docker-bake.hcl
  nook-app/nook-platform/docker/Taskfile.yml
  nook-app/nook-platform/docker/rust/docker-bake.hcl
  nook-app/nook-platform/docker/rust/product.Dockerfile
  nook-app/nook-platform/docker/rust/product.Dockerfile.dockerignore
  nook-app/nook-platform/nook-core/docker-bake.hcl
)

for path in "${recipe_paths[@]}"; do
  if ! git -C "$repo_root" ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
    echo "rust-deps-cache-publish-guard: cache recipe is not committed; skip publish: $path" >&2
    exit 1
  fi
done

if ! git -C "$repo_root" diff --quiet HEAD -- "${recipe_paths[@]}"; then
  echo "rust-deps-cache-publish-guard: cache recipe is dirty; skip dependency publication" >&2
  exit 1
fi

expected="$(bash "$repo_root/.github/scripts/rust-deps-cache-fingerprint.sh")"
actual="${NOOK_RUST_DEPS_INPUT_FINGERPRINT:-}"

if [ "$actual" != "$expected" ]; then
  echo "rust-deps-cache-publish-guard: fingerprint must be $expected (got: ${actual:-empty})" >&2
  exit 1
fi

if [[ ! "$actual" =~ ^[0-9a-f]{40}$ ]]; then
  echo "rust-deps-cache-publish-guard: fingerprint must be a 40-char lowercase git object ID" >&2
  exit 1
fi
