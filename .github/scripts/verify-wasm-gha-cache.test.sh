#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/.github/scripts/verify-wasm-gha-cache.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

mock_docker="$fixture/docker"
cat > "$mock_docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${DOCKER_CALLS:?}"
if [ "${1:-} ${2:-}" = "buildx bake" ]; then
  printf '%s\n' \
    '#10 RUN nook-sccache-report chef-wasm-release' \
    '#10 CACHED' \
    '#11 RUN nook-sccache-report chef-wasm-clippy' \
    '#11 CACHED' \
    '#12 RUN nook-sccache-report wasm-release-test-dependencies' \
    '#12 CACHED'
fi
MOCK
chmod +x "$mock_docker"

run_proof() {
  local calls_file="$1"
  shift
  env \
    DOCKER="$mock_docker" \
    DOCKER_CALLS="$calls_file" \
    GHA_RUST_WASM_DEPS_SCOPE=nook-rust-wasm-deps-test \
    REPO_ROOT="$repo_root" \
    "$@" \
    bash "$script"
}

arc_calls="$fixture/arc-calls"
run_proof \
  "$arc_calls" \
  NOOK_BUILDKIT_REMOTE=1 \
  NOOK_PR_BUILDX_BUILDER=nook-arc-32615034478-wasm-1 \
  GITHUB_RUN_ID=32615034478 \
  GITHUB_JOB=wasm \
  GITHUB_RUN_ATTEMPT=1
grep -Fxq 'buildx use nook-arc-32615034478-wasm-1' "$arc_calls"
grep -Fxq 'buildx prune --all --force' "$arc_calls"
if grep -Fq 'buildx create' "$arc_calls" || grep -Fq 'buildx rm' "$arc_calls"; then
  echo 'ARC cache proof must reuse, prune, and retain its private sidecar' >&2
  exit 1
fi

refused_calls="$fixture/refused-calls"
if run_proof \
  "$refused_calls" \
  NOOK_BUILDKIT_REMOTE=1 \
  NOOK_PR_BUILDX_BUILDER=nook-arc-another-job \
  GITHUB_RUN_ID=32615034478 \
  GITHUB_JOB=wasm \
  GITHUB_RUN_ATTEMPT=1; then
  echo 'ARC cache proof must reject a non-job builder before pruning' >&2
  exit 1
fi
if [ -e "$refused_calls" ]; then
  echo 'ARC cache proof contacted the runtime before rejecting a non-job builder' >&2
  exit 1
fi

hosted_calls="$fixture/hosted-calls"
run_proof "$hosted_calls"
grep -Fq 'buildx create --name nook-wasm-cache-proof-' "$hosted_calls"
grep -Fq ' --driver docker-container --use --bootstrap' "$hosted_calls"
grep -Fq 'buildx rm nook-wasm-cache-proof-' "$hosted_calls"
if grep -Fq 'buildx prune' "$hosted_calls"; then
  echo 'hosted cache proof must use a disposable fresh builder' >&2
  exit 1
fi

echo 'verify-wasm-gha-cache test: ok'
