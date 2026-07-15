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

curl --retry 4 --retry-all-errors --connect-timeout 5 --max-time 30 \
  -fsSL "$EXTENSION_METADATA_URL" -o "$metadata"

site_url="${EXPECTED_EXTENSION_SITE_URL%/}/"
simple_vault_url="${EXPECTED_SIMPLE_VAULT_URL%/}/"
sentinel_vault_match="${EXPECTED_SENTINEL_VAULT_URL%/}/*"
jq -e \
  --arg channel "$EXPECTED_EXTENSION_CHANNEL" \
  --arg commit "$EXPECTED_EXTENSION_COMMIT" \
  --arg simple "$simple_vault_url" \
  '.schema_version == 1
    and .channel == $channel
    and .commit == $commit
    and .simple_vault_url == $simple
    and (.extension_id | test("^[a-p]{32}$"))
    and (.sha256 | test("^[0-9a-f]{64}$"))' \
  "$metadata" >/dev/null

download_url="$(jq -er '.download_url' "$metadata")"
archive_name="$(jq -er '.archive' "$metadata")"
expected_download_url="${site_url}downloads/${archive_name}"
if [ "$download_url" != "$expected_download_url" ]; then
  echo "Extension download URL mismatch: $download_url != $expected_download_url" >&2
  exit 1
fi

curl --retry 4 --retry-all-errors --connect-timeout 5 --max-time 60 \
  -fsSL "$download_url" -o "$archive"
expected_sha256="$(jq -er '.sha256' "$metadata")"
printf '%s  %s\n' "$expected_sha256" "$archive" | sha256sum -c - >/dev/null

test "$(unzip -Z1 "$archive" | grep -c '^manifest.json$')" -eq 1
unzip -p "$archive" manifest.json > "$tmp_dir/manifest.json"
jq -e \
  --arg match "${simple_vault_url}*" \
  --arg sentinel "$sentinel_vault_match" \
  '.manifest_version == 3
    and (.key | type == "string" and length > 0)
    and .externally_connectable.matches == [$match]
    and any(.content_scripts[]; .matches == [$match])
    and all(.content_scripts[]; .exclude_matches | index($sentinel) != null)' \
  "$tmp_dir/manifest.json" >/dev/null

checksum_url="$(jq -er '.checksum_url' "$metadata")"
curl --retry 4 --retry-all-errors --connect-timeout 5 --max-time 30 \
  -fsSL "$checksum_url" -o "$tmp_dir/checksum"
grep -Fxq "$expected_sha256  $archive_name" "$tmp_dir/checksum"

printf 'Verified %s (%s) for %s\n' \
  "$download_url" "$(jq -r '.extension_id' "$metadata")" "$simple_vault_url"
