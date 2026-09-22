#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_dir="$root/.meta-cortex-source"
target_dir="$root/.meta-cortex"
expected_sha="3a87a1e9a28ae43a18921dc7002d351ceb03ad76"

test "$(git -C "$source_dir" rev-parse HEAD)" = "$expected_sha"
mkdir "$target_dir"
cp -R "$source_dir/cortex/." "$target_dir/"
cp "$source_dir/LICENSE" "$target_dir/LICENSE"
rm -rf "$source_dir"
