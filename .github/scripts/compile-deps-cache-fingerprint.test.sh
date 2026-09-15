#!/usr/bin/env bash
# Regression contract for the complete source-free build:compile dependency scope.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
fingerprint_script="$repo_root/.github/scripts/compile-deps-cache-fingerprint.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

git -C "$fixture" init -q

fixture_paths=(
  .github/scripts/compile-deps-cache-fingerprint.sh
  .github/scripts/rust-deps-cache-fingerprint.sh
  nook-app/docker-bake.hcl
  nook-app/nook-platform/Cargo.toml
  nook-app/nook-platform/Cargo.lock
  nook-app/nook-platform/clippy.toml
  nook-app/nook-platform/docker/rust/compile.Dockerfile
  nook-app/nook-platform/docker/rust/compile.docker-bake.hcl
  nook-app/nook-platform/docker/rust/docker-bake.hcl
  nook-app/nook-platform/docker/rust/product.Dockerfile
  nook-app/nook-platform/docker/rust/product.Dockerfile.dockerignore
  nook-app/nook-platform/docker/sccache-wrapper.sh
  nook-app/nook-platform/docker/sccache-report.sh
  nook-app/nook-web/docker/toolchain.Dockerfile
  nook-app/nook-web/docker/toolchain.docker-bake.hcl
  nook-app/nook-web/docker/web.Dockerfile
  nook-app/nook-web/docker/web.docker-bake.hcl
  nook-app/nook-web/nook-web-app/docker-bake.hcl
  nook-app/nook-web/nook-web-app/package.json
  nook-app/nook-web/nook-web-app/bun.lock
  nook-app/nook-web/nook-web-research/package.json
  nook-app/nook-web/nook-web-research/bun.lock
)

for path in "${fixture_paths[@]}"; do
  mkdir -p "$fixture/$(dirname "$path")"
  cp "$repo_root/$path" "$fixture/$path"
done

# A normal source file is deliberately outside the dependency allowlist.
mkdir -p "$fixture/nook-app/nook-web/nook-web-app/src"
printf 'export const ignored = true;\n' >"$fixture/nook-app/nook-web/nook-web-app/src/ignored.ts"

git -C "$fixture" add .

fingerprint() {
  NOOK_COMPILE_DEPS_FINGERPRINT_ROOT="$fixture" bash "$fingerprint_script"
}

baseline="$(fingerprint)"
[[ "$baseline" =~ ^[0-9a-f]{40}$ ]]

graph_inputs=(
  nook-app/docker-bake.hcl
  nook-app/nook-platform/Cargo.lock
  nook-app/nook-platform/docker/rust/compile.Dockerfile
  nook-app/nook-platform/docker/rust/compile.docker-bake.hcl
  nook-app/nook-platform/docker/rust/docker-bake.hcl
  nook-app/nook-web/docker/toolchain.Dockerfile
  nook-app/nook-web/docker/toolchain.docker-bake.hcl
  nook-app/nook-web/docker/web.Dockerfile
  nook-app/nook-web/docker/web.docker-bake.hcl
  nook-app/nook-web/nook-web-app/docker-bake.hcl
  nook-app/nook-web/nook-web-app/package.json
  nook-app/nook-web/nook-web-app/bun.lock
  nook-app/nook-web/nook-web-research/package.json
  nook-app/nook-web/nook-web-research/bun.lock
)

for path in "${graph_inputs[@]}"; do
  original="$fixture/$path.original"
  cp "$fixture/$path" "$original"
  printf '\n# dependency scope regression\n' >>"$fixture/$path"
  mutated="$(fingerprint)"
  [[ "$mutated" =~ ^[0-9a-f]{40}$ ]]
  [[ "$mutated" != "$baseline" ]] || {
    echo "compile dependency mutation did not rotate fingerprint: $path" >&2
    exit 1
  }
  mv "$original" "$fixture/$path"
done

source_original="$fixture/nook-app/nook-web/nook-web-app/src/ignored.ts.original"
cp "$fixture/nook-app/nook-web/nook-web-app/src/ignored.ts" "$source_original"
printf '\n// ordinary source mutation\n' >>"$fixture/nook-app/nook-web/nook-web-app/src/ignored.ts"
source_mutated="$(fingerprint)"
[[ "$source_mutated" == "$baseline" ]] || {
  echo "ordinary source mutation rotated compile dependency fingerprint" >&2
  exit 1
}

echo "compile dependency fingerprint regression passed"
