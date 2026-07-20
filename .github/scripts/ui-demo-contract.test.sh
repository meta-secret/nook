#!/usr/bin/env bash
set -euo pipefail

contract="$(cd "$(dirname "$0")" && pwd)/ui-demo-contract.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

git -C "$fixture" init -q
git -C "$fixture" config user.email test@example.com
git -C "$fixture" config user.name Test
mkdir -p "$fixture/docs"
printf 'base\n' > "$fixture/docs/readme.md"
git -C "$fixture" add .
git -C "$fixture" commit -qm base
base_sha="$(git -C "$fixture" rev-parse HEAD)"

printf 'docs only\n' >> "$fixture/docs/readme.md"
git -C "$fixture" add .
git -C "$fixture" commit -qm docs
output="$(cd "$fixture" && "$contract" "$base_sha")"
grep -Fq 'required=false' <<< "$output"

mkdir -p "$fixture/nook-app/nook-web/nook-web-app/app"
printf '<main>app shell</main>\n' > "$fixture/nook-app/nook-web/nook-web-app/app/index.html"
git -C "$fixture" add .
git -C "$fixture" commit -qm routed-app-shell-without-demo
if (cd "$fixture" && "$contract" "$base_sha" >/dev/null 2>&1); then
  echo 'ui-demo-contract test: routed app shell change without a demo unexpectedly passed' >&2
  exit 1
fi

mkdir -p "$fixture/nook-app/nook-web/nook-web-app/public"
printf '<svg />\n' > "$fixture/nook-app/nook-web/nook-web-app/public/logo.svg"
git -C "$fixture" add .
git -C "$fixture" commit -qm public-ui-without-demo
if (cd "$fixture" && "$contract" "$base_sha" >/dev/null 2>&1); then
  echo 'ui-demo-contract test: public UI change without a demo unexpectedly passed' >&2
  exit 1
fi

mkdir -p "$fixture/nook-app/nook-web/nook-web-app/e2e/demos"
demo='nook-app/nook-web/nook-web-app/e2e/demos/example.demo.spec.ts'
printf 'demo\n' > "$fixture/$demo"
git -C "$fixture" add .
git -C "$fixture" commit -qm ui-with-demo
output="$(cd "$fixture" && "$contract" "$base_sha")"
grep -Fq 'required=true' <<< "$output"
grep -Fq "specs=$demo" <<< "$output"

git -C "$fixture" rm -q "$demo"
mkdir -p "$fixture/nook-app/nook-web/nook-web-shared/src/components"
printf '<svg />\n' > "$fixture/nook-app/nook-web/nook-web-shared/src/components/Logo.svelte"
git -C "$fixture" add .
git -C "$fixture" commit -qm shared-ui-with-deleted-demo
if (cd "$fixture" && "$contract" "$base_sha" >/dev/null 2>&1); then
  echo 'ui-demo-contract test: shared UI change with only a deleted demo unexpectedly passed' >&2
  exit 1
fi

echo 'ui-demo-contract test: ok'
