#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOSTED_INSTALLER="$SCRIPT_DIR/hosted-extension.sh"
DRIVER="$SCRIPT_DIR/setup-brave-vault.mjs"

# shellcheck source=hosted-extension.sh
source "$HOSTED_INSTALLER"

fail() {
  echo "setup-brave-vault.sh: $*" >&2
  return 1
}

validate_setup_selection() {
  local channel="${CHANNEL:-}"
  local pr="${PR:-}"

  if [ -n "$pr" ]; then
    [ -z "$channel" ] || {
      fail 'set PR or CHANNEL=dev, not both'
      return 1
    }
    case "$pr" in
      *[!0-9]*|'') fail 'PR must be a positive integer'; return 1 ;;
    esac
    [ "$pr" -gt 0 ] || fail 'PR must be a positive integer'
    return 0
  fi

  case "$channel" in
    dev|development) ;;
    prod|production)
      fail 'production setup is disabled because this task creates vault data'
      ;;
    '') fail 'set CHANNEL=dev or PR=<number>' ;;
    *) fail 'CHANNEL must be dev' ;;
  esac
}

pick_free_port() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import socket
sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    node -e 'const net=require("net"); const s=net.createServer(); s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port)); s.close();});'
    return 0
  fi
  fail 'python3 or node is required to allocate a CDP port'
}

wait_for_cdp() {
  local cdp_url="$1"
  local attempt
  for attempt in $(seq 1 100); do
    if curl --fail --silent --show-error --max-time 1 "$cdp_url/json/version" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

ensure_playwright() {
  if [ ! -e "$EXTENSION_ROOT/node_modules" ]; then
    ln -s ../nook-web-app/node_modules "$EXTENSION_ROOT/node_modules"
  fi
  [ -d "$EXTENSION_ROOT/node_modules/playwright" ] || [ -d "$EXTENSION_ROOT/node_modules/playwright-core" ] || {
    fail 'Playwright is missing. Run `cd nook-app/nook-web/nook-web-app && bun install --frozen-lockfile` first.'
  }
}

extension_id_from_dir() {
  local extension_dir="$1"
  local manifest_key
  manifest_key="$(jq -er '.key' "$extension_dir/manifest.json")"
  extension_id_from_manifest_key "$manifest_key"
}

setup_marker_path() {
  local profile_dir="$1"
  printf '%s/.nook-pin-vault-setup\n' "$profile_dir"
}

launch_already_paired() {
  local extension_dir="$1"
  local profile_dir="$2"
  local simple_vault_url="$3"
  local pin="$4"
  local marker vault_name
  marker="$(setup_marker_path "$profile_dir")"
  vault_name="$(tr -d '\n' <"$marker" 2>/dev/null || true)"
  [ -n "$vault_name" ] || vault_name='(paired)'

  printf 'Profile already paired (%s). Launching Brave without re-running setup…\n' "$vault_name"
  launch_browser brave "$extension_dir" "$profile_dir" >/dev/null
  printf '\nBrave is ready.\n'
  printf '  Simple Vault: %s\n' "$simple_vault_url"
  printf '  Profile:      %s\n' "$profile_dir"
  printf '  PIN:          %s\n' "$pin"
  if [ -n "${PR:-}" ]; then
    printf '  Later launches: PR=%s task extension:run:brave\n' "$PR"
  else
    printf '  Later launches: CHANNEL=%s task extension:run:brave\n' "$CHANNEL"
  fi
}

main() {
  validate_setup_selection
  resolve_selection
  configure_install_paths

  local extension_dir profile_dir cdp_port cdp_url simple_vault_url extension_id pin vault_name marker
  extension_dir="$(bash "$HOSTED_INSTALLER" install)"
  resolve_selection
  configure_install_paths
  profile_dir="$(profile_dir_for brave)"
  simple_vault_url="$EXPECTED_SIMPLE_VAULT_URL"
  extension_id="$(extension_id_from_dir "$extension_dir")"
  pin="${NOOK_EXTENSION_SETUP_PIN:-123456}"
  vault_name="${NOOK_EXTENSION_SETUP_VAULT_NAME:-test}"
  marker="$(setup_marker_path "$profile_dir")"

  printf 'extension_dir=%s\n' "$extension_dir"
  printf 'simple_vault_url=%s\n' "$simple_vault_url"
  printf 'profile_dir=%s\n' "$profile_dir"

  if [ -f "$marker" ]; then
    launch_already_paired "$extension_dir" "$profile_dir" "$simple_vault_url" "$pin"
    return 0
  fi

  ensure_playwright
  cdp_port="$(pick_free_port)"
  cdp_url="http://127.0.0.1:$cdp_port"

  printf 'Installing and launching Brave for PIN vault setup…\n'

  NOOK_EXTENSION_REMOTE_DEBUGGING_PORT="$cdp_port" \
    launch_browser brave "$extension_dir" "$profile_dir" >/dev/null

  wait_for_cdp "$cdp_url" || {
    fail "Brave CDP endpoint did not become ready at $cdp_url (close any Brave window using this profile and retry)"
  }

  NOOK_EXTENSION_SETUP_CDP_URL="$cdp_url" \
    NOOK_EXTENSION_SETUP_EXTENSION_ID="$extension_id" \
    NOOK_SIMPLE_VAULT_URL="$simple_vault_url" \
    NOOK_EXTENSION_SETUP_PIN="$pin" \
    NOOK_EXTENSION_SETUP_VAULT_NAME="$vault_name" \
    node "$DRIVER"

  printf '%s\n' "$vault_name" >"$marker"

  printf '\nBrave PIN vault setup complete.\n'
  printf '  Simple Vault: %s\n' "$simple_vault_url"
  printf '  Profile:      %s\n' "$profile_dir"
  printf '  PIN:          %s\n' "$pin"
  printf '  Re-run skips automation when this profile is already paired.\n'
  if [ -n "${PR:-}" ]; then
    printf '  Later launches: PR=%s task extension:run:brave\n' "$PR"
  else
    printf '  Later launches: CHANNEL=%s task extension:run:brave\n' "$CHANNEL"
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
