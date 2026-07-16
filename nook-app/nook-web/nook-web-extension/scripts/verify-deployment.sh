#!/usr/bin/env bash
set -euo pipefail

: "${EXTENSION_METADATA_URL:?EXTENSION_METADATA_URL is required}"
: "${EXPECTED_EXTENSION_CHANNEL:?EXPECTED_EXTENSION_CHANNEL is required}"
: "${EXPECTED_EXTENSION_COMMIT:?EXPECTED_EXTENSION_COMMIT is required}"
: "${EXPECTED_EXTENSION_SITE_URL:?EXPECTED_EXTENSION_SITE_URL is required}"
: "${EXPECTED_SIMPLE_VAULT_URL:?EXPECTED_SIMPLE_VAULT_URL is required}"
: "${EXPECTED_SENTINEL_VAULT_URL:?EXPECTED_SENTINEL_VAULT_URL is required}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
metadata="$tmp_dir/extension.json"
archive="$tmp_dir/extension.zip"
site_url="${EXPECTED_EXTENSION_SITE_URL%/}/"

fetch_from_selected_origin() {
  local url="$1"
  local output="$2"
  local effective_url
  effective_url="$(
    curl --retry 4 --retry-all-errors --connect-timeout 5 --max-time 60 \
      --proto '=https' --proto-redir '=https' \
      -fsSL --output "$output" --write-out '%{url_effective}' "$url"
  )"
  case "$effective_url" in
    "$site_url"*) ;;
    *)
      echo "Extension artifact redirected outside selected origin: $effective_url" >&2
      return 1
      ;;
  esac
}

fetch_from_selected_origin "$EXTENSION_METADATA_URL" "$metadata"

simple_vault_url="${EXPECTED_SIMPLE_VAULT_URL%/}/"
sentinel_vault_match="${EXPECTED_SENTINEL_VAULT_URL%/}/*"
production_sentinel_match='https://sentinel.nokey.sh/*'
jq -e \
  --arg channel "$EXPECTED_EXTENSION_CHANNEL" \
  --arg commit "$EXPECTED_EXTENSION_COMMIT" \
  --arg simple "$simple_vault_url" \
  '.schema_version == 2
    and .channel == $channel
    and .commit == $commit
    and .simple_vault_url == $simple
    and (.extension_id | test("^[a-p]{32}$"))
    and (.sha256 | test("^[0-9a-f]{64}$"))
    and (if $channel == "production" then
      .install_method == "chrome_web_store"
      and .install_url == ("https://chromewebstore.google.com/detail/" + .extension_id)
    else
      .install_method == "manual_zip"
      and .install_url == .download_url
    end)' \
  "$metadata" >/dev/null

download_url="$(jq -er '.download_url' "$metadata")"
archive_name="$(jq -er '.archive' "$metadata")"
expected_download_url="${site_url}downloads/${archive_name}"
if [ "$download_url" != "$expected_download_url" ]; then
  echo "Extension download URL mismatch: $download_url != $expected_download_url" >&2
  exit 1
fi

fetch_from_selected_origin "$download_url" "$archive"
expected_sha256="$(jq -er '.sha256' "$metadata")"
printf '%s  %s\n' "$expected_sha256" "$archive" | sha256sum -c - >/dev/null

test "$(unzip -Z1 "$archive" | grep -c '^manifest.json$')" -eq 1
unzip -Z1 "$archive" > "$tmp_dir/archive.list"
awk '
  /^\// || /\\/ { bad = 1 }
  { count[$0]++ }
  $0 == ".." || $0 ~ /^\.\.\// || $0 ~ /\/\.\.\// || $0 ~ /\/\.\.$/ { bad = 1 }
  END {
    for (entry in count) if (count[entry] > 1) bad = 1
    exit bad ? 1 : 0
  }
' "$tmp_dir/archive.list"
unzip -p "$archive" manifest.json > "$tmp_dir/manifest.json"
jq -e \
  --arg match "${simple_vault_url}*" \
  --arg sentinel "$sentinel_vault_match" \
  --arg production_sentinel "$production_sentinel_match" \
  '.manifest_version == 3
    and (.key | type == "string" and length > 0)
    and .externally_connectable.matches == [$match]
    and any(.content_scripts[]; .matches == [$match])
    and all(.content_scripts[];
      (.matches == [$match]) or
      (.matches == ["<all_urls>"] and (.exclude_matches | index($match) != null)))
    and all(.content_scripts[]; .exclude_matches | index($sentinel) != null)
    and all(.content_scripts[]; .exclude_matches | index($production_sentinel) != null)
    and all(.content_scripts[]; .matches | index($sentinel) == null)
    and all(.content_scripts[]; .matches | index($production_sentinel) == null)' \
  "$tmp_dir/manifest.json" >/dev/null

manifest_key="$(jq -er '.key' "$tmp_dir/manifest.json")"
manifest_digest="$(
  printf '%s' "$manifest_key" \
    | openssl base64 -d -A \
    | openssl dgst -sha256 \
    | awk '{print $NF}'
)"
manifest_extension_id="$(
  printf '%s' "${manifest_digest%${manifest_digest#????????????????????????????????}}" \
    | tr '0123456789abcdef' 'abcdefghijklmnop'
)"
metadata_extension_id="$(jq -er '.extension_id' "$metadata")"
test "$manifest_extension_id" = "$metadata_extension_id"

checksum_url="$(jq -er '.checksum_url' "$metadata")"
fetch_from_selected_origin "$checksum_url" "$tmp_dir/checksum"
grep -Fxq "$expected_sha256  $archive_name" "$tmp_dir/checksum"

printf 'Verified %s (%s) for %s\n' \
  "$download_url" "$(jq -r '.extension_id' "$metadata")" "$simple_vault_url"
