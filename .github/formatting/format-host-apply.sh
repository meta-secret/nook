#!/usr/bin/env bash
# Apply repository formatters from one shared, tool-only Docker image.
#
# The image is shared by every worktree and contains only pinned Rustfmt,
# Prettier, and their plugins. It never contains project source, compiles a
# product, or reads or publishes a remote build cache.
# Required input: PINNED_LOCAL_DEV_SHA is the exact local-dev commit used as the formatting base.
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$scripts_dir/../.." && pwd)"
cd "$repo_root"

if [[ ! "${PINNED_LOCAL_DEV_SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "PINNED_LOCAL_DEV_SHA must be an exact 40-character lowercase commit SHA" >&2
  exit 1
fi

resolved_base_sha="$({
  GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL=/dev/null \
    GIT_NO_REPLACE_OBJECTS=1 \
    git \
      -c core.fsmonitor=false \
      -c core.hooksPath=/dev/null \
      -c core.excludesFile=/dev/null \
      -c diff.external= \
      rev-parse --verify "${PINNED_LOCAL_DEV_SHA}^{commit}"
} 2>/dev/null)" || {
  echo "PINNED_LOCAL_DEV_SHA does not resolve to a commit" >&2
  exit 1
}
if [[ "$resolved_base_sha" != "$PINNED_LOCAL_DEV_SHA" ]]; then
  echo "PINNED_LOCAL_DEV_SHA did not resolve to the exact supplied commit" >&2
  exit 1
fi

changed_files="$(mktemp)"
trap 'rm -f "$changed_files"' EXIT
{
  GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL=/dev/null \
    GIT_NO_REPLACE_OBJECTS=1 \
    git \
      -c core.fsmonitor=false \
      -c core.hooksPath=/dev/null \
      -c core.excludesFile=/dev/null \
      -c diff.external= \
      diff --no-ext-diff --name-only --diff-filter=ACMR -z "$PINNED_LOCAL_DEV_SHA"
  GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL=/dev/null \
    GIT_NO_REPLACE_OBJECTS=1 \
    git \
      -c core.fsmonitor=false \
      -c core.hooksPath=/dev/null \
      -c core.excludesFile=/dev/null \
      -c diff.external= \
      ls-files --others --exclude-per-directory=.gitignore -z
} >"$changed_files"

formatter_dir="$repo_root/.github/formatting"
formatter_hash="$(
  (cd "$formatter_dir" && \
    shasum -a 256 \
      Dockerfile \
      package.json \
      bun.lock \
      prettier-default.json \
      prettier-shared-typescript.json \
      prettier-skill.json \
      prettier-web.json \
      format.sh) \
    | shasum -a 256 \
    | cut -c1-16
)"
case "$(uname -m)" in
  arm64 | aarch64)
    formatter_arch=arm64
    formatter_platform=linux/arm64
    ;;
  x86_64 | amd64)
    formatter_arch=amd64
    formatter_platform=linux/amd64
    ;;
  *)
    echo "task format does not support host architecture $(uname -m)" >&2
    exit 1
    ;;
esac
formatter_image="nook-source-formatter:${formatter_hash}-${formatter_arch}"

if ! docker image inspect "$formatter_image" >/dev/null 2>&1; then
  docker build \
    --platform "$formatter_platform" \
    --tag "$formatter_image" \
    --file "$formatter_dir/Dockerfile" \
    "$formatter_dir"
fi

docker run \
  --rm \
  --platform "$formatter_platform" \
  --env NODE_PATH=/opt/nook-formatter/node_modules \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --volume "$repo_root:/workspace" \
  --volume "$changed_files:/tmp/nook-format-files:ro" \
  "$formatter_image"
GIT_CONFIG_NOSYSTEM=1 \
  GIT_CONFIG_GLOBAL=/dev/null \
  GIT_NO_REPLACE_OBJECTS=1 \
  git \
    -c core.fsmonitor=false \
    -c core.hooksPath=/dev/null \
    -c core.excludesFile=/dev/null \
    -c diff.external= \
    status --short --untracked-files=no
