# Shared by Hive Task recipes. Stages only the two sccache helper scripts into a
# throwaway directory so BuildKit never uploads the host nook-app tree.
#
# Usage:
#   # shellcheck source=prepare-sccache-context.sh
#   . "$hive_task_dir/prepare-sccache-context.sh"
#   prepare_nook_sccache_helpers_context
#   # -> sets NOOK_SCCACHE_HELPERS_CONTEXT
#   # call cleanup_nook_sccache_helpers_context from an EXIT trap

prepare_nook_sccache_helpers_context() {
  local repo_root helpers kib
  repo_root="$(git rev-parse --show-toplevel)"
  helpers="$(mktemp -d "${TMPDIR:-/tmp}/nook-sccache-helpers.XXXXXX")"
  cp \
    "$repo_root/nook-app/nook-platform/docker/sccache-wrapper.sh" \
    "$repo_root/nook-app/nook-platform/docker/sccache-report.sh" \
    "$helpers/"
  chmod 0755 "$helpers/sccache-wrapper.sh" "$helpers/sccache-report.sh"
  kib="$(du -sk "$helpers" | awk '{print $1}')"
  if [ "$kib" -gt 64 ]; then
    echo "Refusing oversized sccache helper context: ${kib} KiB at $helpers" >&2
    rm -rf "$helpers"
    return 1
  fi
  if [ -e "$helpers/target" ] || [ -f "$helpers/Cargo.toml" ]; then
    echo "Refusing sccache helper context that looks like nook-app: $helpers" >&2
    rm -rf "$helpers"
    return 1
  fi
  NOOK_SCCACHE_HELPERS_CONTEXT="$helpers"
}

cleanup_nook_sccache_helpers_context() {
  if [ -n "${NOOK_SCCACHE_HELPERS_CONTEXT:-}" ]; then
    rm -rf "$NOOK_SCCACHE_HELPERS_CONTEXT"
    NOOK_SCCACHE_HELPERS_CONTEXT=""
  fi
}
