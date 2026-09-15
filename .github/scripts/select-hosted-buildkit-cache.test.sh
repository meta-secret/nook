#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/bin"

cat > "$fixture/bin/git" <<'EOF'
#!/usr/bin/env bash
case "$1|${2:-}" in
  rev-parse\|HEAD) printf '%040d\n' 1 ;;
  rev-list\|*) printf '%040d\n%040d\n' 2 3 ;;
  rev-parse\|*:nook-app/nook-platform) printf '%040d\n' 4 ;;
  *) exec /usr/bin/git "$@" ;;
esac
EOF
cat > "$fixture/bin/docker" <<'EOF'
#!/usr/bin/env bash
ref="${*: -1}"
case "$ref" in
  *nook-rust-base-v2-git-0000000000000000000000000000000000000001:buildcache) exit 0 ;;
  *nook-rust-deps-v4*) echo 'context canceled' >&2; exit 1 ;;
  *nook-rust-native-source-v4-git-0000000000000000000000000000000000000001:buildcache) echo 'manifest unknown' >&2; exit 1 ;;
  *nook-rust-native-source-v4-git-0000000000000000000000000000000000000002:buildcache) exit 0 ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$fixture/bin/git" "$fixture/bin/docker"

env_file="$fixture/github-env"
PATH="$fixture/bin:$PATH" \
GITHUB_ENV="$env_file" \
GITHUB_WORKSPACE="$repo_root" \
NOOK_SELECTED_BUILDER=fixture \
NOOK_REGISTRY_USERNAME=fixture \
NOOK_REGISTRY_PASSWORD=fixture \
NOOK_CACHE_EVENT_NAME=pull_request \
NOOK_CACHE_GIT_REF=refs/pull/1592/merge \
NOOK_CACHE_PR_NUMBER=1592 \
NOOK_CACHE_ACTION_PATH="$repo_root/.github/actions/nook-docker-setup" \
NOOK_CACHE_SELECTION=native \
NOOK_CACHE_REGISTRY_HOST=registry.example.invalid \
NOOK_CACHE_WRITE_REQUESTED=false \
NOOK_CACHE_MAIN_ONLY=true \
NOOK_CACHE_ISOLATED_WRITE=true \
NOOK_CACHE_PUBLISH_COMPILE=true \
NOOK_REMOTE_TASK_SELECTION=cache:probe:rust \
bash "$repo_root/.github/scripts/select-hosted-buildkit-cache.sh" >"$fixture/output"

grep -Fqx 'GHA_CACHE_ENABLED=1' "$env_file"
! grep -Fqx 'GHA_CACHE_ENABLED=' "$env_file"
grep -Fqx 'GHA_CACHE_RESTORE_RUST_BASE_SCOPE_SUFFIX=-git-0000000000000000000000000000000000000001' "$env_file"
grep -Fqx 'GHA_CACHE_RESTORE_RUST_DEPS_SCOPE_SUFFIX=' "$env_file"
grep -Fqx 'GHA_CACHE_RESTORE_RUST_NATIVE_SCOPE_SUFFIX=-git-0000000000000000000000000000000000000002' "$env_file"
grep -Fqx 'GHA_CACHE_EXACT_PROBE_FAILURE_CLASS=transient_unavailable' "$env_file"
grep -Fq '"action":"lineage_main_fallback"' "$fixture/output"
echo 'hosted BuildKit lineage probe isolation contract passed'
