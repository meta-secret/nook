#!/usr/bin/env bash
set -euo pipefail

base_sha="${1:-}"
if [[ ! "$base_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ui-demo-contract: expected a full lowercase base SHA" >&2
  exit 2
fi
git cat-file -e "$base_sha^{commit}"

ui_changed=false
demo_specs=()
changed_list="$(mktemp)"
trap 'rm -f "$changed_list"' EXIT
git diff --name-only -z "$base_sha" HEAD > "$changed_list"

while IFS= read -r -d '' file; do
  case "$file" in
    nook-app/nook-web/nook-web-app/e2e/demos/*.demo.spec.ts)
      [[ -f "$file" ]] || continue
      [[ "$file" =~ ^[A-Za-z0-9_./-]+$ ]] || {
        echo "ui-demo-contract: unsupported demo filename: $file" >&2
        exit 2
      }
      demo_specs+=("$file")
      ;;
  esac

  case "$file" in
    nook-app/nook-web/nook-web-app/src/*|\
    nook-app/nook-web/nook-web-app/public/*|\
    nook-app/nook-web/nook-web-app/static/*|\
    nook-app/nook-web/nook-web-shared/src/components/*|\
    nook-app/nook-web/nook-web-shared/src/vault-app/*|\
    nook-app/nook-web/nook-vault-simple/src/*|\
    nook-app/nook-web/nook-vault-sentinel/src/*|\
    nook-app/nook-web/nook-web-extension/src/content/*|\
    nook-app/nook-web/nook-web-extension/src/popup/*|\
    nook-app/nook-web/nook-web-app/e2e/demos/*.demo.spec.ts)
      ui_changed=true
      ;;
  esac
done < "$changed_list"

if [[ "$ui_changed" == true && ${#demo_specs[@]} -eq 0 ]]; then
  echo "::error::UI-facing changes require an updated Playwright demo in nook-app/nook-web/nook-web-app/e2e/demos/*.demo.spec.ts" >&2
  exit 1
fi

specs="${demo_specs[*]:-}"
echo "ui-demo-contract: ui_changed=$ui_changed demo_specs=${specs:-none}"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "required=$ui_changed"
    echo "specs=$specs"
  } >> "$GITHUB_OUTPUT"
else
  printf 'required=%s\nspecs=%s\n' "$ui_changed" "$specs"
fi
