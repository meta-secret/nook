#!/usr/bin/env bash
set -euo pipefail

repo_root="$1"
function_source="$(
  sed -n \
    '/NEO4J_CREDENTIAL_RECONCILIATION_BEGIN/,/NEO4J_CREDENTIAL_RECONCILIATION_END/p' \
    "$repo_root/infra/tasks/neo4j.yml" |
    sed '1d;$d;s/^        //'
)"
source /dev/stdin <<<"$function_source"

auth_present=false
client_present=false
auth_lookup_error=""
client_lookup_error=""
auth_value=""
client_value=""
apply_log="$(mktemp)"
trap 'rm -f "$apply_log"' EXIT

kubectl() {
  if test "$1" = get; then
    local name="$3"
    local present=false
    local value=""
    case "$name" in
      hive-neo4j-auth)
        if test -n "$auth_lookup_error"; then
          printf '%s\n' "$auth_lookup_error" >&2
          return 1
        fi
        present="$auth_present"
        value="$auth_value"
        ;;
      hive-neo4j-client)
        if test -n "$client_lookup_error"; then
          printf '%s\n' "$client_lookup_error" >&2
          return 1
        fi
        present="$client_present"
        value="$client_value"
        ;;
    esac
    if test "$present" != true; then
      printf 'Error from server (NotFound): secrets "%s" not found\n' "$name" >&2
      return 1
    fi
    if [[ " $* " == *" -o jsonpath="* ]]; then
      printf %s "$value" | base64
    fi
    return
  fi
  if test "$1" = create; then
    printf '%s\n' "$*"
    return
  fi
  if test "$1" = apply; then
    printf 'apply\n' >>"$apply_log"
    cat >/dev/null
    return
  fi
  return 1
}

openssl() {
  test "$1 $2 $3" = "rand -hex 32"
  printf 'generated-password\r\n'
}

run_case() {
  local retained="$1"
  local expected="$2"
  local directory
  directory="$(mktemp -d)"
  : >"$apply_log"
  reconcile_neo4j_credentials "$directory" "$retained"
  test "$(cat "$directory/password")" = "$expected"
  test "$(cat "$directory/NEO4J_PASSWORD")" = "$expected"
  test "$client_secret_checksum" = "$(
    printf %s "$expected" | sha256sum | cut -d' ' -f1
  )"
  rm -rf "$directory"
}

# Generated credentials are normalized and both Secrets are published.
auth_present=false
client_present=false
run_case false generated-password
test "$(wc -l <"$apply_log")" -eq 2

# An existing auth Secret is authoritative and CR/LF never reaches consumers.
auth_present=true
client_present=false
auth_value=$'neo4j/auth-password\r\n'
run_case true auth-password
test "$(wc -l <"$apply_log")" -eq 1

# Empty auth retries from the client value and repairs both Secrets.
auth_present=true
client_present=true
auth_value=$'neo4j/\r\n'
client_value=$'client-password\r\n'
run_case true client-password
test "$(wc -l <"$apply_log")" -eq 2

# Client-only recovery preserves the exact normalized password.
auth_present=false
client_present=true
client_value=$'client-only\r\n'
run_case true client-only
test "$(wc -l <"$apply_log")" -eq 2

# Retained data without credentials and divergent credentials fail before apply.
auth_present=false
client_present=false
directory="$(mktemp -d)"
: >"$apply_log"
if reconcile_neo4j_credentials "$directory" true 2>/dev/null; then
  exit 1
fi
test ! -s "$apply_log"
rm -rf "$directory"

# Transient lookup failures are not treated as confirmed Secret absence.
auth_lookup_error='Unable to connect to the server'
auth_present=false
client_present=false
directory="$(mktemp -d)"
: >"$apply_log"
if reconcile_neo4j_credentials "$directory" false 2>/dev/null; then
  exit 1
fi
test ! -s "$apply_log"
rm -rf "$directory"
auth_lookup_error=""

auth_present=true
client_present=true
auth_value='neo4j/auth-password'
client_value='different-password'
directory="$(mktemp -d)"
: >"$apply_log"
if reconcile_neo4j_credentials "$directory" true 2>/dev/null; then
  exit 1
fi
test ! -s "$apply_log"
rm -rf "$directory"
