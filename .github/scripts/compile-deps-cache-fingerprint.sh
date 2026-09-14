#!/usr/bin/env bash
# Content fingerprint for the source-free build:compile dependency graph.
#
# The shared Rust dependency fingerprint intentionally has broader reuse
# semantics. Compose it with compile-only recipes, named-context definitions,
# and non-Rust dependency inputs here so a stale compile graph cannot suppress
# publication merely because Cargo.lock is unchanged.
set -euo pipefail

repo_root="${NOOK_COMPILE_DEPS_FINGERPRINT_ROOT:-$(git rev-parse --show-toplevel)}"
cd "$repo_root"

rust_deps_fingerprint="$({
  NOOK_RUST_DEPS_FINGERPRINT_ROOT="$repo_root" \
    bash .github/scripts/rust-deps-cache-fingerprint.sh
})"
if [[ ! "$rust_deps_fingerprint" =~ ^[0-9a-f]{40}$ ]]; then
  echo "compile-deps-cache-fingerprint: invalid Rust dependency fingerprint" >&2
  exit 1
fi

paths="$({
  printf '%s\n' \
    .github/scripts/compile-deps-cache-fingerprint.sh \
    .github/scripts/compile-deps-cache-seed.sh \
    .github/scripts/compile-remote.sh \
    nook-app/docker-bake.hcl \
    nook-app/nook-platform/docker/rust/compile.Dockerfile \
    nook-app/nook-platform/docker/rust/compile.docker-bake.hcl \
    nook-app/nook-platform/docker/rust/docker-bake.hcl \
    nook-app/nook-platform/docker/rust/product.Dockerfile \
    nook-app/nook-platform/docker/sccache-report.sh \
    nook-app/nook-platform/docker/sccache-wrapper.sh \
    nook-app/nook-web/docker/toolchain.Dockerfile \
    nook-app/nook-web/docker/toolchain.docker-bake.hcl \
    nook-app/nook-web/docker/web.Dockerfile \
    nook-app/nook-web/docker/web.docker-bake.hcl \
    nook-app/nook-web/nook-web-app/docker-bake.hcl \
    agentic-ai/minds/Cargo.toml \
    agentic-ai/minds/Cargo.lock \
    agentic-ai/minds/hive/Cargo.toml \
    agentic-ai/minds/hive-console/package.json \
    agentic-ai/minds/hive-console/bun.lock \
    nook-app/nook-web/nook-web-app/package.json \
    nook-app/nook-web/nook-web-app/bun.lock \
    nook-app/nook-web/nook-web-research/package.json \
    nook-app/nook-web/nook-web-research/bun.lock
  git ls-files --cached --others --exclude-standard -- \
    'agentic-ai/minds/vendor/**'
} | LC_ALL=C sort -u)"

{
  printf '%s\n' 'nook-rust-compile-deps-input-v3'
  printf 'rust-deps %s\n' "$rust_deps_fingerprint"
  while IFS= read -r path; do
    if [ -L "$path" ] || [ ! -f "$path" ]; then
      echo "compile-deps-cache-fingerprint: expected regular file: $path" >&2
      exit 1
    fi
    printf '%s %s\n' "$path" "$(git hash-object "$path")"
  done <<<"$paths"
} | git hash-object --stdin
