#!/usr/bin/env bash
# Apply repository formatters from one shared, tool-only Docker image.
#
# The image is shared by every worktree and contains only pinned Rustfmt,
# Prettier, and their plugins. It never contains project source, compiles a
# product, or reads or publishes a remote build cache.
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$scripts_dir/../.." && pwd)"
cd "$repo_root"

if [[ "${HIVE_SEALED_GUEST:-}" == "1" ]]; then
  task hive:guest:format
  git status --short --untracked-files=no
  exit 0
fi

formatter_dir="$repo_root/.github/formatting"
formatter_hash="$(
  (cd "$formatter_dir" && shasum -a 256 Dockerfile package.json bun.lock format.sh) \
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
changed_files="$(mktemp)"
trap 'rm -f "$changed_files"' EXIT
base_ref="$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD)"
{
  git diff --name-only --diff-filter=ACMR "$base_ref"
  git ls-files --others --exclude-standard
} | sort -u >"$changed_files"

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
git status --short --untracked-files=no
