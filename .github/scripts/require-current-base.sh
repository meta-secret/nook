#!/usr/bin/env bash
set -euo pipefail

remote="${1:-origin}"
base_ref="${2:-main}"
remote_base_ref="refs/remotes/$remote/$base_ref"

if ! git fetch --quiet --no-tags \
  "$remote" "+refs/heads/$base_ref:$remote_base_ref"; then
  echo "Unable to refresh $remote/$base_ref; refusing expensive validation." >&2
  exit 2
fi

base_sha="$(git rev-parse "$remote_base_ref")"
if git merge-base --is-ancestor "$base_sha" HEAD; then
  echo "Base freshness check passed: HEAD contains $remote/$base_ref at $base_sha."
  exit 0
fi

behind_by="$(git rev-list --count "HEAD..$base_sha")"
echo "Refusing expensive validation: HEAD is behind $remote/$base_ref by $behind_by commit(s)." >&2
echo "Merge $remote/$base_ref, run task format, push the updated branch, and retry." >&2
exit 2
