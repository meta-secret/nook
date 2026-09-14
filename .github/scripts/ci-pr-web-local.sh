#!/usr/bin/env bash
# Assemble the split WASM handoff and run the hosted-shaped web consumer locally.
# This route is intentionally registry-disabled: local verification must not depend on
# remote Zot cache availability or silently turn into an unbounded remote compile.
set -euo pipefail

repo_root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
cd "$repo_root"

timeout_seconds="${NOOK_LOCAL_CI_TIMEOUT_SECONDS:-900}"
case "$timeout_seconds" in
  ''|*[!0-9]*)
    echo "NOOK_LOCAL_CI_TIMEOUT_SECONDS must be a positive whole number" >&2
    exit 2
    ;;
esac
if [ "$timeout_seconds" -lt 60 ] || [ "$timeout_seconds" -gt 3600 ]; then
  echo "NOOK_LOCAL_CI_TIMEOUT_SECONDS must be between 60 and 3600 seconds" >&2
  exit 2
fi

artifact_root="${CI_ARTIFACT_DIR:-}"
temporary_artifacts=0
if [ -z "$artifact_root" ]; then
  artifact_root="$(mktemp -d "${TMPDIR:-/tmp}/nook-ci-pr-web.XXXXXX")"
  temporary_artifacts=1
else
  case "$artifact_root" in
    /*) ;;
    *) artifact_root="$repo_root/$artifact_root" ;;
  esac
  mkdir -p "$artifact_root"
fi
if [ "$temporary_artifacts" -eq 1 ]; then
  trap 'rm -rf -- "$artifact_root"' EXIT
fi

source_sha="$(git rev-parse HEAD)"
common_env=(
  CI=1
  GITHUB_ACTIONS=
  NOOK_ARC_RUNNER=
  NOOK_REGISTRY_CACHE=0
  NOOK_REGISTRY_CACHE_LOCAL_PUBLISH=0
  NOOK_BUILDKIT_REMOTE=0
  SCCACHE_OPTIONAL=1
  SCCACHE_S3_MODE=external
  GHA_CACHE_ENABLED=
  GHA_CACHE_WRITE_ENABLED=
  GIT_COMMIT_ID="$source_sha"
  NOOK_EXTENSION_COMMIT="$source_sha"
  CI_ARTIFACT_DIR="$artifact_root"
)

for stage in wasm web; do
  case "$stage" in
    wasm)
      label="WASM handoff assembly"
      stage_command=(env "${common_env[@]}" task --dir "$repo_root" ci:pr:wasm)
      ;;
    web)
      label="web artifact consumer"
      stage_command=(env "${common_env[@]}" \
        bash "$repo_root/.github/scripts/with-healthy-buildkit.sh" \
        task --dir "$repo_root" docker:ci:web:build)
      ;;
  esac

  started=$SECONDS
  echo "task ci:pr:web:local: starting $label (limit=${timeout_seconds}s)" >&2
  set -m
  "${stage_command[@]}" &
  command_pid=$!
  set +m
  while kill -0 "$command_pid" 2>/dev/null; do
    if [ "$SECONDS" -ge $((started + timeout_seconds)) ]; then
      echo "task ci:pr:web:local: $label exceeded ${timeout_seconds}s; terminating" >&2
      kill -TERM -- "-$command_pid" 2>/dev/null || kill -TERM "$command_pid" 2>/dev/null || true
      sleep 2
      kill -KILL -- "-$command_pid" 2>/dev/null || kill -KILL "$command_pid" 2>/dev/null || true
      wait "$command_pid" 2>/dev/null || true
      exit 124
    fi
    sleep 1
  done
  stage_status=0
  wait "$command_pid" || stage_status=$?
  if [ "$stage_status" -ne 0 ]; then
    echo "task ci:pr:web:local: $label failed after $((SECONDS - started))s" >&2
    exit "$stage_status"
  fi
  echo "task ci:pr:web:local: $label completed in $((SECONDS - started))s" >&2

  if [ "$stage" = wasm ]; then
    wasm_root="$artifact_root/nook-wasm"
    for required in \
      "$wasm_root/nook_wasm.js" \
      "$wasm_root/nook_wasm_bg.wasm" \
      "$wasm_root/nook-companion-wasm/nook_companion_wasm.js" \
      "$wasm_root/nook-companion-wasm/nook_companion_wasm_bg.wasm"; do
      test -s "$required" || {
        echo "task ci:pr:web:local: missing generated handoff file $required" >&2
        exit 1
      }
    done
  fi
done

echo "task ci:pr:web:local: verified exact-source WASM handoff at $wasm_root" >&2
