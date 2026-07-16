#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hosted-extension.sh
source "$SCRIPT_DIR/hosted-extension.sh"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT
export HOME="$TEST_ROOT/home"
export NOOK_EXTENSION_RELEASE_DIR="$TEST_ROOT/releases"
export NOOK_EXTENSION_PROFILE_ROOT="$TEST_ROOT/profiles"
mkdir -p "$HOME"

assert_equal() {
  [ "$1" = "$2" ] || { echo "expected '$2', got '$1'" >&2; exit 1; }
}

expect_failure() {
  if "$@" >/dev/null 2>&1; then
    echo "expected command to fail: $*" >&2
    exit 1
  fi
}

CHANNEL=dev PR='' resolve_selection
assert_equal "$CHANNEL_KEY" 'development'
assert_equal "$METADATA_URL" 'https://dev.nokey.sh/downloads/extension.json'
assert_equal "$EXPECTED_SIMPLE_VAULT_URL" 'https://simple.dev.nokey.sh/'
assert_equal "$EXPECTED_SENTINEL_VAULT_URL" 'https://sentinel.dev.nokey.sh/'

CHANNEL=prod PR='' resolve_selection
assert_equal "$CHANNEL_KEY" 'production'
assert_equal "$EXTENSION_SITE_URL" 'https://nokey.sh/'

CHANNEL='' PR=410 resolve_selection
assert_equal "$CHANNEL_KEY" 'pr-410'
assert_equal "$METADATA_URL" 'https://pr-410.nokey-sh.pages.dev/downloads/extension.json'
assert_equal "$EXPECTED_SIMPLE_VAULT_URL" 'https://pr-410.nokey-simple.pages.dev/'
configure_install_paths
assert_equal "$CURRENT_LINK" "$NOOK_EXTENSION_RELEASE_DIR/hosted/pr-410/current"
assert_equal "$(profile_dir_for chrome)" "$NOOK_EXTENSION_PROFILE_ROOT/chrome-extension-pr-410"

expect_failure env CHANNEL='' PR='' bash "$SCRIPT_DIR/hosted-extension.sh" resolve
expect_failure env CHANNEL=qa PR='' bash "$SCRIPT_DIR/hosted-extension.sh" resolve
expect_failure env CHANNEL=dev PR=410 bash "$SCRIPT_DIR/hosted-extension.sh" resolve
expect_failure env CHANNEL='' PR=0 bash "$SCRIPT_DIR/hosted-extension.sh" resolve

fixture="$TEST_ROOT/fixture"
mkdir -p "$fixture/archive"
cat > "$fixture/archive/manifest.json" <<'EOF'
{
  "manifest_version": 3,
  "name": "Nook test",
  "version": "1.0.0",
  "key": "dGVzdC1rZXk=",
  "externally_connectable": {"matches": ["https://pr-410.nokey-simple.pages.dev/*"]},
  "content_scripts": [{
    "matches": ["https://pr-410.nokey-simple.pages.dev/*"],
    "exclude_matches": [
      "https://sentinel.nokey.sh/*",
      "https://pr-410.nokey-sentinel.pages.dev/*"
    ],
    "js": ["service-worker.js"]
  }, {
    "matches": ["<all_urls>"],
    "exclude_matches": [
      "https://pr-410.nokey-simple.pages.dev/*",
      "https://sentinel.nokey.sh/*",
      "https://pr-410.nokey-sentinel.pages.dev/*"
    ],
    "js": ["service-worker.js"]
  }]
}
EOF
printf 'worker\n' > "$fixture/archive/service-worker.js"
(cd "$fixture/archive" && zip -q "$fixture/extension.zip" manifest.json service-worker.js)
digest="$(sha256_file "$fixture/extension.zip")"
extension_id="$(extension_id_from_manifest_key 'dGVzdC1rZXk=')"
commit='0123456789abcdef0123456789abcdef01234567'
archive_name='nook-passwords-pr-410.zip'
cat > "$fixture/metadata.json" <<EOF
{
  "schema_version": 1,
  "channel": "pr-410",
  "version": "1.0.0",
  "manifest_version": "1.0.0",
  "commit": "$commit",
  "simple_vault_url": "https://pr-410.nokey-simple.pages.dev/",
  "extension_id": "$extension_id",
  "archive": "$archive_name",
  "download_url": "https://pr-410.nokey-sh.pages.dev/downloads/$archive_name",
  "checksum_url": "https://pr-410.nokey-sh.pages.dev/downloads/$archive_name.sha256",
  "sha256": "$digest"
}
EOF
printf '%s  %s\n' "$digest" "$archive_name" > "$fixture/checksum"

CHANNEL='' PR=410 resolve_selection
validate_extracted_manifest "$fixture/archive/manifest.json" "$extension_id"
missing_production_sentinel="$fixture/missing-production-sentinel.json"
jq '(.content_scripts[].exclude_matches) -= ["https://sentinel.nokey.sh/*"]' \
  "$fixture/archive/manifest.json" > "$missing_production_sentinel"
expect_failure validate_extracted_manifest "$missing_production_sentinel" "$extension_id"
missing_simple="$fixture/missing-simple.json"
jq '(.content_scripts[].exclude_matches) -= ["https://pr-410.nokey-simple.pages.dev/*"]' \
  "$fixture/archive/manifest.json" > "$missing_simple"
expect_failure validate_extracted_manifest "$missing_simple" "$extension_id"
extra_target="$fixture/extra-target.json"
jq '.content_scripts += [{
  "matches": ["https://example.com/*"],
  "exclude_matches": [
    "https://sentinel.nokey.sh/*",
    "https://pr-410.nokey-sentinel.pages.dev/*"
  ],
  "js": ["service-worker.js"]
}]' "$fixture/archive/manifest.json" > "$extra_target"
expect_failure validate_extracted_manifest "$extra_target" "$extension_id"
expect_failure validate_extracted_manifest \
  "$fixture/archive/manifest.json" 'abcdefghijklmnopabcdefghijklmnop'

FAKE_METADATA="$fixture/metadata.json"
FAKE_ARCHIVE="$fixture/extension.zip"
FAKE_CHECKSUM="$fixture/checksum"
curl() {
  local output=''
  local url=''
  local write_out=''
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -o|--output) output="$2"; shift 2 ;;
      --write-out) write_out="$2"; shift 2 ;;
      http*) url="$1"; shift ;;
      *) shift ;;
    esac
  done
  case "$url" in
    */extension.json) cp "$FAKE_METADATA" "$output" ;;
    *.sha256) cp "$FAKE_CHECKSUM" "$output" ;;
    *.zip) cp "$FAKE_ARCHIVE" "$output" ;;
    *) return 1 ;;
  esac
  [ -z "$write_out" ] || printf '%s' "${FAKE_EFFECTIVE_URL:-$url}"
}

CHANNEL='' PR=410
FAKE_EFFECTIVE_URL='https://redirect.invalid/extension.json'
expect_failure fetch_from_selected_origin "$METADATA_URL" "$TEST_ROOT/redirected.json"
unset FAKE_EFFECTIVE_URL
installed="$(install_hosted_extension)"
assert_equal "$installed" "$NOOK_EXTENSION_RELEASE_DIR/hosted/pr-410/current"
[ -L "$installed" ]
[ -f "$installed/manifest.json" ]
first_target="$(readlink "$installed")"

second_metadata="$fixture/second-metadata.json"
jq '.commit = "89abcdef0123456789abcdef0123456789abcdef"' \
  "$fixture/metadata.json" > "$second_metadata"
FAKE_METADATA="$second_metadata"
install_hosted_extension >/dev/null
second_target="$(readlink "$installed")"
[ "$second_target" != "$first_target" ] || {
  echo 'expected a new immutable release to replace the current symlink' >&2
  exit 1
}
first_target="$second_target"

bad_metadata="$fixture/bad-metadata.json"
jq '.sha256 = "0000000000000000000000000000000000000000000000000000000000000000"' \
  "$fixture/metadata.json" > "$bad_metadata"
FAKE_METADATA="$bad_metadata"
if install_hosted_extension >/dev/null 2>&1; then
  echo 'expected checksum mismatch to fail' >&2
  exit 1
fi
assert_equal "$(readlink "$installed")" "$first_target"

wrong_site="$fixture/wrong-site.json"
jq '.download_url = "https://sentinel.dev.nokey.sh/downloads/nook-passwords-pr-410.zip"' \
  "$fixture/metadata.json" > "$wrong_site"
CHANNEL='' PR=410 resolve_selection
expect_failure validate_metadata "$wrong_site"

mkdir -p "$fixture/invalid"
printf 'missing manifest\n' > "$fixture/invalid/readme.txt"
(cd "$fixture/invalid" && zip -q "$fixture/invalid.zip" readme.txt)
expect_failure validate_archive "$fixture/invalid.zip" "$fixture/invalid.list"

fake_browser="$fixture/chrome"
fake_browser_log="$fixture/chrome.log"
cat > "$fake_browser" <<'EOF'
#!/bin/sh
if [ "${1:-}" = --version ]; then
  printf 'Chromium 150.0.0.0\n'
  exit 0
fi
printf '%s\n' "$*" > "$FAKE_BROWSER_LOG"
exit 0
EOF
chmod +x "$fake_browser"
uname() { printf 'Linux\n'; }
FAKE_BROWSER_LOG="$fake_browser_log" CHROME_BIN="$fake_browser" launch_browser chrome "$installed" >/dev/null
for _ in $(seq 1 20); do [ -f "$fake_browser_log" ] && break; sleep 0.05; done
grep -Fq -- "--load-extension=$installed" "$fake_browser_log"

fake_stable_chrome="$fixture/google-chrome"
fake_stable_log="$fixture/google-chrome.log"
cat > "$fake_stable_chrome" <<'EOF'
#!/bin/sh
if [ "${1:-}" = --version ]; then
  printf 'Google Chrome 150.0.0.0\n'
  exit 0
fi
printf '%s\n' "$*" > "$FAKE_STABLE_LOG"
exit 0
EOF
chmod +x "$fake_stable_chrome"
FAKE_STABLE_LOG="$fake_stable_log" CHROME_BIN="$fake_stable_chrome" \
  launch_browser chrome "$installed" >/dev/null
for _ in $(seq 1 20); do [ -f "$fake_stable_log" ] && break; sleep 0.05; done
grep -Fq 'chrome://extensions' "$fake_stable_log"
if grep -Fq -- '--load-extension' "$fake_stable_log"; then
  echo 'branded Google Chrome must not receive the ignored --load-extension switch' >&2
  exit 1
fi
unset -f uname
[ -d "$NOOK_EXTENSION_PROFILE_ROOT/chrome-extension-pr-410" ]

printf 'Hosted extension launcher tests passed.\n'
