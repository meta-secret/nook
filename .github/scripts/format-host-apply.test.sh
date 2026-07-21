#!/usr/bin/env bash
# Unit test for sealed-image format patch extraction (no Docker).
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
extract_awk="$scripts_dir/format-host-apply-extract.awk"

sample="$(
  printf '%s\n' \
    'task: [docker:rust:task]' \
    '==> Rust formatting changes (host apply via task format):' \
    'diff --git a/nook-app/nook-core/src/foo.rs b/nook-app/nook-core/src/foo.rs' \
    'index 1111111..2222222 100644' \
    '--- a/nook-app/nook-core/src/foo.rs' \
    '+++ b/nook-app/nook-core/src/foo.rs' \
    '@@ -1,3 +1,3 @@' \
    ' fn main() {' \
    '-    let x=1;' \
    '+    let x = 1;' \
    ' }' \
    'task: [setup]' \
    'building image...' \
    '==> Web/extension formatting changes (host apply via task format):' \
    'diff --git a/nook-app/nook-web/nook-web-app/src/x.ts b/nook-app/nook-web/nook-web-app/src/x.ts' \
    'index aaa..bbb 100644' \
    '--- a/nook-app/nook-web/nook-web-app/src/x.ts' \
    '+++ b/nook-app/nook-web/nook-web-app/src/x.ts' \
    '@@ -1 +1 @@' \
    '-const a=1' \
    '+const a = 1'
)"

patch="$(printf '%s\n' "$sample" | awk -f "$extract_awk")"

printf '%s\n' "$patch" | grep -q 'diff --git a/nook-app/nook-core/src/foo.rs' \
  || { echo 'format-host-apply test: missing rust diff' >&2; exit 1; }
printf '%s\n' "$patch" | grep -q 'diff --git a/nook-app/nook-web/nook-web-app/src/x.ts' \
  || { echo 'format-host-apply test: missing web diff' >&2; exit 1; }
printf '%s\n' "$patch" | grep -q 'building image' \
  && { echo 'format-host-apply test: docker chatter leaked into patch' >&2; exit 1; }
printf '%s\n' "$patch" | grep -q '^task: ' \
  && { echo 'format-host-apply test: task chatter leaked into patch' >&2; exit 1; }

empty="$(printf '%s\n' '==> Already formatted; no changes.' | awk -f "$extract_awk")"
[[ -z "$empty" ]] || {
  echo 'format-host-apply test: expected empty patch when already formatted' >&2
  exit 1
}

# Guard the known failure mode: CLI invocation of internal docker:task exits 202.
script="$(cat "$scripts_dir/format-host-apply.sh")"
printf '%s\n' "$script" | grep -q 'task format:diff' \
  || { echo 'format-host-apply test: expected task format:diff entrypoint' >&2; exit 1; }
printf '%s\n' "$script" | grep -Eq 'task docker:task( |$)' \
  && { echo 'format-host-apply test: must not CLI-invoke internal docker:task' >&2; exit 1; }
printf '%s\n' "$script" | grep -Eq 'task docker:rust:task( |$)' \
  && { echo 'format-host-apply test: must not CLI-invoke internal docker:rust:task' >&2; exit 1; }

echo 'format-host-apply test: ok'
