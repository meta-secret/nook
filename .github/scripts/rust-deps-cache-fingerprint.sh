#!/usr/bin/env bash
# Content fingerprint for source-free Rust dependency images.
#
# The same script runs on developer hosts and GitHub-hosted runners. It reads
# worktree content, so an uncommitted Cargo manifest change gets a new scope
# without allowing source-sensitive layers into a committed SHA namespace.
set -euo pipefail

repo_root="${NOOK_RUST_DEPS_FINGERPRINT_ROOT:-$(git rev-parse --show-toplevel)}"
cd "$repo_root"

paths="$({
  printf '%s\n' \
    .github/scripts/rust-deps-cache-fingerprint.sh \
    nook-app/nook-platform/Cargo.toml \
    nook-app/nook-platform/Cargo.lock \
    nook-app/nook-platform/clippy.toml \
    nook-app/nook-platform/docker/rust/product.Dockerfile \
    nook-app/nook-platform/docker/rust/product.Dockerfile.dockerignore \
    nook-app/nook-platform/docker/sccache-wrapper.sh \
    nook-app/nook-platform/docker/sccache-report.sh
  git ls-files --cached --others --exclude-standard -- \
    'nook-app/**/Cargo.toml' \
    'nook-app/nook-platform/.cargo/**' \
    'nook-app/nook-platform/.config/**'
} | LC_ALL=C sort -u)"

{
  printf '%s\n' 'nook-rust-deps-input-v3'
  while IFS= read -r path; do
    if [ -L "$path" ] || [ ! -f "$path" ]; then
      echo "rust-deps-cache-fingerprint: expected regular file: $path" >&2
      exit 1
    fi
    printf '%s %s\n' "$path" "$(git hash-object "$path")"
  done <<<"$paths"
} | git hash-object --stdin
