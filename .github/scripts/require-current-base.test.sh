#!/usr/bin/env bash
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/require-current-base.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

git init -q --bare "$fixture/remote.git"
git init -q "$fixture/seed"
git -C "$fixture/seed" config user.email test@example.com
git -C "$fixture/seed" config user.name Test
printf 'base\n' > "$fixture/seed/content.txt"
git -C "$fixture/seed" add content.txt
git -C "$fixture/seed" commit -qm base
git -C "$fixture/seed" branch -M main
git -C "$fixture/seed" remote add origin "$fixture/remote.git"
git -C "$fixture/seed" push -qu origin main

git clone -q --branch main "$fixture/remote.git" "$fixture/feature"
git -C "$fixture/feature" config user.email test@example.com
git -C "$fixture/feature" config user.name Test
git -C "$fixture/feature" switch -qc feature
printf 'feature\n' >> "$fixture/feature/content.txt"
git -C "$fixture/feature" add content.txt
git -C "$fixture/feature" commit -qm feature

current_output="$(cd "$fixture/feature" && "$script")"
grep -Fq 'Base freshness check passed' <<< "$current_output"

printf 'new main\n' >> "$fixture/seed/content.txt"
git -C "$fixture/seed" add content.txt
git -C "$fixture/seed" commit -qm new-main
git -C "$fixture/seed" push -q origin main

if stale_output="$(cd "$fixture/feature" && "$script" 2>&1)"; then
  echo 'require-current-base test: stale branch unexpectedly passed' >&2
  exit 1
fi
grep -Fq 'HEAD is behind origin/main by 1 commit(s)' <<< "$stale_output"

if fetch_output="$(cd "$fixture/feature" && "$script" missing main 2>&1)"; then
  echo 'require-current-base test: failed fetch unexpectedly passed' >&2
  exit 1
fi
grep -Fq 'refusing expensive validation' <<< "$fetch_output"

echo 'require-current-base test: ok'
