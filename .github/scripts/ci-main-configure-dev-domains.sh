#!/usr/bin/env bash
# Configure and verify isolated development custom domains.
#
# Required env:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
#   DEV_DOMAIN, SIMPLE_DOMAIN, SENTINEL_DOMAIN
#   SITE_PAGES_URL, SIMPLE_PAGES_URL, SENTINEL_PAGES_URL
#   COMMIT_SHA
# Optional env:
#   GITHUB_OUTPUT — when set, writes dev_url/simple_url/sentinel_url/extension_url
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${DEV_DOMAIN:?DEV_DOMAIN is required}"
: "${SIMPLE_DOMAIN:?SIMPLE_DOMAIN is required}"
: "${SENTINEL_DOMAIN:?SENTINEL_DOMAIN is required}"
: "${SITE_PAGES_URL:?SITE_PAGES_URL is required}"
: "${SIMPLE_PAGES_URL:?SIMPLE_PAGES_URL is required}"
: "${SENTINEL_PAGES_URL:?SENTINEL_PAGES_URL is required}"
: "${COMMIT_SHA:?COMMIT_SHA is required}"

api() {
  curl -sS \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    "$@"
}
api_json() {
  response="$(api "$@")"
  if ! printf '%s' "$response" | jq -e '.success == true' >/dev/null; then
    printf '%s\n' "$response" | jq -r '.errors[]? | "Cloudflare API error: \(.code) \(.message)"' >&2 || true
    printf '%s\n' "$response" >&2
    return 1
  fi
  printf '%s' "$response"
}

site_pages_host="development.nokey-sh.pages.dev"
simple_pages_host="development.nokey-simple.pages.dev"
sentinel_pages_host="development.nokey-sentinel.pages.dev"
zone_name="nokey.sh"
zone_id=""

attach_domain() {
  project="$1"
  domain="$2"
  domains="$(api_json "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$project/domains")" || return 1
  exists="$(printf '%s' "$domains" | jq -r --arg name "$domain" '[.result[]? | select(.name == $name)] | length')"
  if [ "$exists" = "0" ]; then
    api_json -X POST \
      --data "$(jq -nc --arg name "$domain" '{name: $name}')" \
      "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$project/domains" >/dev/null || return 1
  fi
}

ensure_cname() {
  domain="$1"
  target="$2"
  records="$(api_json "https://api.cloudflare.com/client/v4/zones/$zone_id/dns_records?name=$domain")" || return 1
  record_id="$(printf '%s' "$records" | jq -r '.result[0].id // empty')"
  body="$(jq -nc --arg name "$domain" --arg content "$target" '{type: "CNAME", name: $name, content: $content, ttl: 1, proxied: true}')"
  if [ -n "$record_id" ]; then
    current_ok="$(printf '%s' "$records" | jq -r --arg content "$target" '.result[0] | .type == "CNAME" and .content == $content and .proxied == true')"
    if [ "$current_ok" != true ]; then
      api_json -X PUT --data "$body" "https://api.cloudflare.com/client/v4/zones/$zone_id/dns_records/$record_id" >/dev/null || return 1
    fi
  else
    api_json -X POST --data "$body" "https://api.cloudflare.com/client/v4/zones/$zone_id/dns_records" >/dev/null || return 1
  fi
}

# Reconcile established custom-domain infrastructure when the deployment token also has
# zone permissions. Live boundary verification below remains authoritative for the
# least-privilege Pages token used by CI.
zone_response=""
if zone_response="$(api_json "https://api.cloudflare.com/client/v4/zones?name=$zone_name")" \
  && zone_id="$(printf '%s' "$zone_response" | jq -er '.result[0].id')"; then
  if ! attach_domain nokey-sh "$DEV_DOMAIN" \
    || ! attach_domain nokey-simple "$SIMPLE_DOMAIN" \
    || ! attach_domain nokey-sentinel "$SENTINEL_DOMAIN" \
    || ! ensure_cname "$DEV_DOMAIN" "$site_pages_host" \
    || ! ensure_cname "$SIMPLE_DOMAIN" "$simple_pages_host" \
    || ! ensure_cname "$SENTINEL_DOMAIN" "$sentinel_pages_host"; then
    echo "::warning::Cloudflare custom-domain reconciliation was unavailable; verifying live domains"
    zone_id=""
  fi
else
  echo "::warning::Cloudflare zone administration was unavailable; verifying live domains"
fi

purge_body="$(
  jq -nc \
    --arg root "https://$DEV_DOMAIN/" \
    --arg site "https://$DEV_DOMAIN/site/" \
    --arg simple "https://$DEV_DOMAIN/simple/" \
    --arg sentinel "https://$DEV_DOMAIN/sentinel/" \
    --arg app "https://$DEV_DOMAIN/app/" \
    --arg extension "https://$DEV_DOMAIN/extension-connect.html" \
    --arg simple_root "https://$SIMPLE_DOMAIN/" \
    --arg simple_extension "https://$SIMPLE_DOMAIN/extension-connect" \
    --arg sentinel_root "https://$SENTINEL_DOMAIN/" \
    --arg sentinel_extension "https://$SENTINEL_DOMAIN/extension-connect" \
    '{files: [$root, $site, $simple, $sentinel, $app, $extension, $simple_root, $simple_extension, $sentinel_root, $sentinel_extension]}'
)"

root_body="$(mktemp)"
headers="$(mktemp)"
trap 'rm -f "$root_body" "$headers"' EXIT
verified=false
for attempt in $(seq 1 30); do
  # The custom hostname can still point at the previous Pages
  # deployment briefly. Purge before every probe so an old SPA
  # fallback cannot repopulate the cache for the rest of the loop.
  if [ -n "$zone_id" ] && ! api_json -X POST \
    --data "$purge_body" \
    "https://api.cloudflare.com/client/v4/zones/$zone_id/purge_cache" >/dev/null; then
    echo "::warning::Cloudflare cache purge was unavailable; switching to cache-busted probes"
    zone_id=""
  fi
  cache_bust="nook_commit=$COMMIT_SHA&attempt=$attempt"
  root_status="$(curl -sS -o "$root_body" -w '%{http_code}' "https://$DEV_DOMAIN/?$cache_bust" || true)"
  site_status="$(curl -sS -o /dev/null -w '%{http_code}' "https://$DEV_DOMAIN/site/?$cache_bust" || true)"
  simple_status="$(curl -sS -o /dev/null -w '%{http_code}' "https://$DEV_DOMAIN/simple/?$cache_bust" || true)"
  sentinel_status="$(curl -sS -o /dev/null -w '%{http_code}' "https://$DEV_DOMAIN/sentinel/?$cache_bust" || true)"
  app_status="$(curl -sS -o /dev/null -w '%{http_code}' "https://$DEV_DOMAIN/app/?$cache_bust" || true)"
  extension_status="$(curl -sS -o /dev/null -w '%{http_code}' "https://$DEV_DOMAIN/extension-connect.html?$cache_bust" || true)"
  site_ok=false
  if [ "$root_status" = "200" ] \
    && grep -Fq '<title>Nook — Keys, not accounts</title>' "$root_body" \
    && grep -Fq "https://$SIMPLE_DOMAIN/" "$root_body" \
    && grep -Fq "https://$SENTINEL_DOMAIN/" "$root_body" \
    && [ "$site_status" = "404" ] \
    && [ "$simple_status" = "404" ] \
    && [ "$sentinel_status" = "404" ] \
    && [ "$app_status" = "404" ] \
    && [ "$extension_status" = "404" ]; then
    site_ok=true
  fi

  simple_root_status="$(curl -sS -D "$headers" -o "$root_body" -w '%{http_code}' "https://$SIMPLE_DOMAIN/?$cache_bust" || true)"
  simple_extension_status="$(curl -sS -o /dev/null -w '%{http_code}' "https://$SIMPLE_DOMAIN/extension-connect?$cache_bust" || true)"
  simple_ok=false
  if [ "$simple_root_status" = "200" ] \
    && grep -Fq '<meta name="nook-app-kind" content="simple"' "$root_body" \
    && tr -d '\r' < "$headers" | grep -Eiq '^content-security-policy:' \
    && tr -d '\r' < "$headers" | grep -Eiq '^x-content-type-options:[[:space:]]*nosniff' \
    && [ "$simple_extension_status" = "200" ]; then
    simple_ok=true
  fi

  sentinel_root_status="$(curl -sS -D "$headers" -o "$root_body" -w '%{http_code}' "https://$SENTINEL_DOMAIN/?$cache_bust" || true)"
  sentinel_extension_status="$(curl -sS -o /dev/null -w '%{http_code}' "https://$SENTINEL_DOMAIN/extension-connect?$cache_bust" || true)"
  sentinel_ok=false
  if [ "$sentinel_root_status" = "200" ] \
    && grep -Fq '<meta name="nook-app-kind" content="sentinel"' "$root_body" \
    && tr -d '\r' < "$headers" | grep -Eiq '^content-security-policy:' \
    && tr -d '\r' < "$headers" | grep -Eiq '^x-content-type-options:[[:space:]]*nosniff' \
    && [ "$sentinel_extension_status" = "404" ]; then
    sentinel_ok=true
  fi

  if [ "$site_ok" = true ] && [ "$simple_ok" = true ] && [ "$sentinel_ok" = true ]; then
    verified=true
    break
  fi
  echo "Waiting for isolated development domains (attempt $attempt/30; site=$root_status/$site_status/$simple_status/$sentinel_status/$app_status/$extension_status, simple=$simple_root_status/$simple_extension_status, sentinel=$sentinel_root_status/$sentinel_extension_status)"
  sleep 10
done
if [ "$verified" != true ]; then
  echo "::error::Development domains must serve isolated landing, Simple, and Sentinel applications"
  exit 1
fi
extension_verified=false
last_extension_output=""
for attempt in $(seq 1 12); do
  set +e
  last_extension_output="$(
    EXTENSION_METADATA_URL="https://$DEV_DOMAIN/downloads/extension.json" \
    EXTENSION_CACHE_BUST="$COMMIT_SHA-$attempt" \
    EXPECTED_EXTENSION_CHANNEL="development" \
    EXPECTED_EXTENSION_COMMIT="$COMMIT_SHA" \
    EXPECTED_EXTENSION_SITE_URL="https://$DEV_DOMAIN/" \
    EXPECTED_SIMPLE_VAULT_URL="https://$SIMPLE_DOMAIN/" \
    EXPECTED_SENTINEL_VAULT_URL="https://$SENTINEL_DOMAIN/" \
      bash nook-app/nook-web/nook-web-extension/scripts/verify-deployment.sh 2>&1
  )"
  extension_status=$?
  set -e
  if [ "$extension_status" -eq 0 ]; then
    printf '%s\n' "$last_extension_output"
    extension_verified=true
    break
  fi
  echo "Waiting for exact-head development extension artifacts (attempt $attempt/12)"
  sleep 5
done
if [ "$extension_verified" != true ]; then
  printf '%s\n' "$last_extension_output" >&2
  echo "::error::Development extension artifacts did not converge to the exact main head"
  exit 1
fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "dev_url=https://$DEV_DOMAIN/" >> "$GITHUB_OUTPUT"
  echo "simple_url=https://$SIMPLE_DOMAIN/" >> "$GITHUB_OUTPUT"
  echo "sentinel_url=https://$SENTINEL_DOMAIN/" >> "$GITHUB_OUTPUT"
  echo "extension_url=https://$DEV_DOMAIN/downloads/nook-passwords-dev.zip" >> "$GITHUB_OUTPUT"
fi
