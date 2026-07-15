#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
CHANNEL_KEY=''
EXTENSION_SITE_URL=''
METADATA_URL=''
EXPECTED_SIMPLE_VAULT_URL=''
EXPECTED_SENTINEL_VAULT_URL=''
INSTALL_ROOT=''
RELEASES_DIR=''
CURRENT_LINK=''

fail() {
  echo "$SCRIPT_NAME: $*" >&2
  return 1
}

resolve_selection() {
  local channel="${CHANNEL:-}"
  local pr="${PR:-}"

  if { [ -n "$channel" ] && [ -n "$pr" ]; } || { [ -z "$channel" ] && [ -z "$pr" ]; }; then
    fail 'set exactly one of CHANNEL=dev|prod or PR=<number>'
    return 1
  fi

  if [ -n "$pr" ]; then
    case "$pr" in
      *[!0-9]*|'') fail 'PR must be a positive integer'; return 1 ;;
    esac
    [ "$pr" -gt 0 ] || { fail 'PR must be a positive integer'; return 1; }
    CHANNEL_KEY="pr-$pr"
    EXTENSION_SITE_URL="https://pr-$pr.nokey-sh.pages.dev/"
    EXPECTED_SIMPLE_VAULT_URL="https://pr-$pr.nokey-simple.pages.dev/"
    EXPECTED_SENTINEL_VAULT_URL="https://pr-$pr.nokey-sentinel.pages.dev/"
  else
    case "$channel" in
      dev|development)
        CHANNEL_KEY='development'
        EXTENSION_SITE_URL='https://dev.nokey.sh/'
        EXPECTED_SIMPLE_VAULT_URL='https://simple.dev.nokey.sh/'
        EXPECTED_SENTINEL_VAULT_URL='https://sentinel.dev.nokey.sh/'
        ;;
      prod|production)
        CHANNEL_KEY='production'
        EXTENSION_SITE_URL='https://nokey.sh/'
        EXPECTED_SIMPLE_VAULT_URL='https://simple.nokey.sh/'
        EXPECTED_SENTINEL_VAULT_URL='https://sentinel.nokey.sh/'
        ;;
      *) fail 'CHANNEL must be dev or prod'; return 1 ;;
    esac
  fi
  METADATA_URL="${EXTENSION_SITE_URL}downloads/extension.json"
}

configure_install_paths() {
  local base="${NOOK_EXTENSION_RELEASE_DIR:-$HOME/Library/Application Support/Nook/browser-extensions/nook-web-extension}"
  INSTALL_ROOT="$base/hosted/$CHANNEL_KEY"
  RELEASES_DIR="$INSTALL_ROOT/releases"
  CURRENT_LINK="$INSTALL_ROOT/current"
}

profile_dir_for() {
  local browser="$1"
  local base="${NOOK_EXTENSION_PROFILE_ROOT:-$HOME/Library/Application Support/Nook/browser-profiles}"
  printf '%s/%s-extension-%s\n' "$base" "$browser" "$CHANNEL_KEY"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    fail 'sha256sum or shasum is required'
    return 1
  fi
}

validate_metadata() {
  local metadata="$1"
  jq -e \
    --arg channel "$CHANNEL_KEY" \
    --arg site "$EXTENSION_SITE_URL" \
    --arg simple "$EXPECTED_SIMPLE_VAULT_URL" \
    '.schema_version == 1
      and .channel == $channel
      and .simple_vault_url == $simple
      and (.commit | test("^[0-9a-f]{40}$"))
      and (.extension_id | test("^[a-p]{32}$"))
      and (.sha256 | test("^[0-9a-f]{64}$"))
      and (.archive | test("^[0-9A-Za-z][0-9A-Za-z.+_-]*\\.zip$"))
      and .download_url == ($site + "downloads/" + .archive)
      and .checksum_url == ($site + "downloads/" + .archive + ".sha256")' \
    "$metadata" >/dev/null || {
      fail "metadata from $METADATA_URL does not match the selected deployment"
      return 1
    }
}

validate_archive() {
  local archive="$1"
  local listing="$2"
  unzip -tq "$archive" >/dev/null || { fail 'downloaded extension ZIP is corrupt'; return 1; }
  unzip -Z1 "$archive" > "$listing"
  [ "$(grep -c '^manifest.json$' "$listing" || true)" -eq 1 ] || {
    fail 'extension ZIP must contain exactly one root manifest.json'
    return 1
  }
  awk '
    /^\// || /\\/ { bad = 1 }
    { count[$0]++ }
    $0 == ".." || $0 ~ /^\.\.\// || $0 ~ /\/\.\.\// || $0 ~ /\/\.\.$/ { bad = 1 }
    END {
      for (entry in count) if (count[entry] > 1) bad = 1
      exit bad ? 1 : 0
    }
  ' "$listing" || { fail 'extension ZIP contains an unsafe or duplicate path'; return 1; }
}

extension_id_from_manifest_key() {
  local manifest_key="$1"
  local digest
  digest="$(
    printf '%s' "$manifest_key" \
      | openssl base64 -d -A 2>/dev/null \
      | openssl dgst -sha256 2>/dev/null \
      | awk '{print $NF}'
  )"
  case "$digest" in
    *[!0-9a-f]*|'') fail 'extension manifest key is not valid base64 key material'; return 1 ;;
  esac
  [ "${#digest}" -eq 64 ] || { fail 'could not derive extension id from manifest key'; return 1; }
  printf '%s' "${digest%${digest#????????????????????????????????}}" | tr '0123456789abcdef' 'abcdefghijklmnop'
}

validate_extracted_manifest() {
  local manifest="$1"
  local expected_extension_id="$2"
  local simple_match="${EXPECTED_SIMPLE_VAULT_URL}*"
  local sentinel_match="${EXPECTED_SENTINEL_VAULT_URL}*"
  local production_sentinel_match='https://sentinel.nokey.sh/*'
  jq -e \
    --arg simple "$simple_match" \
    --arg sentinel "$sentinel_match" \
    --arg production_sentinel "$production_sentinel_match" \
    '.manifest_version == 3
      and (.key | type == "string" and length > 0)
      and .externally_connectable.matches == [$simple]
      and any(.content_scripts[]; .matches == [$simple])
      and all(.content_scripts[];
        if (.matches | index("<all_urls>") != null)
        then .exclude_matches | index($simple) != null
        else true
        end)
      and all(.content_scripts[]; .exclude_matches | index($sentinel) != null)
      and all(.content_scripts[]; .exclude_matches | index($production_sentinel) != null)
      and all(.content_scripts[]; .matches | index($sentinel) == null)
      and all(.content_scripts[]; .matches | index($production_sentinel) == null)' \
    "$manifest" >/dev/null || {
      fail 'extension manifest is not exclusively bound to the selected Simple Vault deployment'
      return 1
    }
  local manifest_key actual_extension_id
  manifest_key="$(jq -er '.key' "$manifest")"
  actual_extension_id="$(extension_id_from_manifest_key "$manifest_key")"
  [ "$actual_extension_id" = "$expected_extension_id" ] || {
    fail "extension manifest key derives $actual_extension_id, metadata declares $expected_extension_id"
    return 1
  }
}

fetch_from_selected_origin() {
  local url="$1"
  local output="$2"
  local effective_url
  effective_url="$(
    curl \
      --location --fail --show-error --silent \
      --proto '=https' --proto-redir '=https' \
      --retry 4 --retry-all-errors --connect-timeout 10 --max-time 120 \
      --output "$output" --write-out '%{url_effective}' \
      "$url"
  )"
  case "$effective_url" in
    "$EXTENSION_SITE_URL"*) ;;
    *)
      fail "download redirected outside the selected deployment: $effective_url"
      return 1
      ;;
  esac
}

activate_release() {
  local release_dir="$1"
  local next_link="$INSTALL_ROOT/.current.$$.tmp"
  if [ -e "$CURRENT_LINK" ] && [ ! -L "$CURRENT_LINK" ]; then
    fail "$CURRENT_LINK exists and is not a managed symlink"
    return 1
  fi
  rm -f "$next_link"
  ln -s "$release_dir" "$next_link"
  if mv -Tf "$next_link" "$CURRENT_LINK" 2>/dev/null; then
    return 0
  fi
  mv -fh "$next_link" "$CURRENT_LINK"
}

install_hosted_extension() {
  resolve_selection
  configure_install_paths
  command -v curl >/dev/null 2>&1 || fail 'curl is required'
  command -v jq >/dev/null 2>&1 || fail 'jq is required'
  command -v openssl >/dev/null 2>&1 || fail 'openssl is required'
  command -v unzip >/dev/null 2>&1 || fail 'unzip is required'

  local tmp_dir=''
  local stage_dir=''
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir:-}" "${stage_dir:-}"' EXIT
  local metadata="$tmp_dir/extension.json"
  local archive="$tmp_dir/extension.zip"
  local checksum="$tmp_dir/extension.sha256"
  local listing="$tmp_dir/archive.list"
  fetch_from_selected_origin "$METADATA_URL" "$metadata"
  validate_metadata "$metadata"
  local archive_name expected_sha download_url checksum_url commit actual_sha expected_extension_id
  archive_name="$(jq -er '.archive' "$metadata")"
  expected_sha="$(jq -er '.sha256' "$metadata")"
  download_url="$(jq -er '.download_url' "$metadata")"
  checksum_url="$(jq -er '.checksum_url' "$metadata")"
  commit="$(jq -er '.commit' "$metadata")"
  expected_extension_id="$(jq -er '.extension_id' "$metadata")"

  fetch_from_selected_origin "$download_url" "$archive"
  actual_sha="$(sha256_file "$archive")"
  [ "$actual_sha" = "$expected_sha" ] || {
    fail "checksum mismatch for $download_url"
    return 1
  }
  fetch_from_selected_origin "$checksum_url" "$checksum"
  grep -Fxq "$expected_sha  $archive_name" "$checksum" || {
    fail "checksum file from $checksum_url does not match metadata"
    return 1
  }
  validate_archive "$archive" "$listing"

  mkdir -p "$RELEASES_DIR"
  local release_dir="$RELEASES_DIR/${commit}-${expected_sha%${expected_sha#????????????}}"
  if [ ! -d "$release_dir" ]; then
    stage_dir="$(mktemp -d "$RELEASES_DIR/.staging.XXXXXX")"
    unzip -q "$archive" -d "$stage_dir"
    if find "$stage_dir" -type l -print | grep -q .; then
      fail 'extension ZIP extracted a symbolic link'
      return 1
    fi
    validate_extracted_manifest "$stage_dir/manifest.json" "$expected_extension_id"
    mv "$stage_dir" "$release_dir"
    stage_dir=''
  fi
  activate_release "$release_dir"
  printf '%s\n' "$CURRENT_LINK"
}

launch_browser() {
  local browser="$1"
  local extension_dir="$2"
  local profile_dir
  local binary=''
  local app_name=''
  local env_name=''
  profile_dir="$(profile_dir_for "$browser")"
  mkdir -p "$profile_dir"
  chmod 700 "$profile_dir"

  case "$browser" in
    chrome)
      binary="${CHROME_BIN:-}"
      app_name='Google Chrome'
      env_name='CHROME_BIN'
      ;;
    brave)
      binary="${BRAVE_BIN:-}"
      app_name='Brave Browser'
      env_name='BRAVE_BIN'
      ;;
    *) fail "unsupported browser: $browser"; return 1 ;;
  esac

  if [ -n "$binary" ]; then
    [ -x "$binary" ] || { fail "$env_name is not executable: $binary"; return 1; }
    nohup "$binary" --user-data-dir="$profile_dir" --load-extension="$extension_dir" about:blank >/dev/null 2>&1 </dev/null &
  else
    [ "$(uname -s)" = 'Darwin' ] || {
      fail "automatic $app_name discovery is supported only on macOS; set $env_name to its executable"
      return 1
    }
    [ -d "/Applications/$app_name.app" ] || {
      fail "$app_name is not installed in /Applications; set $env_name to its executable"
      return 1
    }
    open -na "$app_name" --args --user-data-dir="$profile_dir" --load-extension="$extension_dir" about:blank
  fi
  printf 'Launched %s with %s using isolated profile %s\n' "$app_name" "$extension_dir" "$profile_dir"
}

main() {
  case "${1:-}" in
    install) install_hosted_extension ;;
    run)
      [ "$#" -eq 2 ] || { fail 'usage: hosted-extension.sh run chrome|brave'; return 1; }
      resolve_selection
      local selected_channel="$CHANNEL_KEY"
      local extension_dir
      extension_dir="$(install_hosted_extension)"
      CHANNEL_KEY="$selected_channel"
      launch_browser "$2" "$extension_dir"
      ;;
    resolve)
      resolve_selection
      configure_install_paths
      printf 'channel=%s\nsite_url=%s\nmetadata_url=%s\nsimple_vault_url=%s\nsentinel_vault_url=%s\ninstall_dir=%s\n' \
        "$CHANNEL_KEY" "$EXTENSION_SITE_URL" "$METADATA_URL" "$EXPECTED_SIMPLE_VAULT_URL" \
        "$EXPECTED_SENTINEL_VAULT_URL" "$CURRENT_LINK"
      ;;
    *) fail 'usage: hosted-extension.sh install|run chrome|run brave|resolve'; return 1 ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
