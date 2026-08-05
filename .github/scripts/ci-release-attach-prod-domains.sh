#!/usr/bin/env bash
# Attach and verify isolated production Simple/Sentinel domains.
#
# Required env:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, RELEASE_SHA
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${RELEASE_SHA:?RELEASE_SHA is required}"

api() {
  curl -fsS \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    "$@"
}
api_json() {
  response="$(api "$@")"
  printf '%s' "$response" | jq -e '.success == true' >/dev/null
  printf '%s' "$response"
}
zone_id="$(api_json 'https://api.cloudflare.com/client/v4/zones?name=nokey.sh' | jq -er '.result[0].id')"
for spec in "simple.nokey.sh:nokey-simple" "sentinel.nokey.sh:nokey-sentinel"; do
  domain="${spec%%:*}"
  project="${spec#*:}"
  app_kind="${domain%%.*}"
  pages_host="$project.pages.dev"
  domains="$(api_json "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$project/domains")"
  if [ "$(printf '%s' "$domains" | jq -r --arg domain "$domain" '[.result[]? | select(.name == $domain)] | length')" = 0 ]; then
    api_json -X POST \
      --data "$(jq -nc --arg name "$domain" '{name: $name}')" \
      "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$project/domains" >/dev/null
  fi
  records="$(api_json "https://api.cloudflare.com/client/v4/zones/$zone_id/dns_records?name=$domain")"
  record_id="$(printf '%s' "$records" | jq -r '.result[0].id // empty')"
  payload="$(jq -nc --arg name "$domain" --arg content "$pages_host" '{type:"CNAME",name:$name,content:$content,ttl:1,proxied:true}')"
  if [ -z "$record_id" ]; then
    api_json -X POST --data "$payload" "https://api.cloudflare.com/client/v4/zones/$zone_id/dns_records" >/dev/null
  elif [ "$(printf '%s' "$records" | jq -r --arg content "$pages_host" '.result[0].type == "CNAME" and .result[0].content == $content and .result[0].proxied == true')" != true ]; then
    api_json -X PUT --data "$payload" "https://api.cloudflare.com/client/v4/zones/$zone_id/dns_records/$record_id" >/dev/null
  fi
  verified=false
  for attempt in $(seq 1 30); do
    headers="$(mktemp)"
    body="$(mktemp)"
    if curl -fsSL -D "$headers" -o "$body" "https://$domain/" &&
      grep -Fq "name=\"nook-app-kind\" content=\"$app_kind\"" "$body" &&
      grep -Fiq 'content-security-policy:' "$headers" &&
      grep -Fiq 'x-content-type-options: nosniff' "$headers"; then
      release_commit="$(curl -fsSL "https://$domain/release.json" | jq -er '.commit')"
      if [ "$release_commit" = "$RELEASE_SHA" ]; then
        verified=true
        rm -f "$headers" "$body"
        break
      fi
    fi
    rm -f "$headers" "$body"
    sleep 10
  done
  if [ "$verified" != true ]; then
    echo "$domain did not serve the expected $app_kind artifact, security headers, and release commit" >&2
    exit 1
  fi
  extension_status="$(curl -sS -o /dev/null -w '%{http_code}' "https://$domain/extension-connect")"
  if [ "$app_kind" = simple ] && [ "$extension_status" != 200 ]; then
    echo "Simple Vault extension route returned HTTP $extension_status" >&2
    exit 1
  fi
  if [ "$app_kind" = sentinel ] && [ "$extension_status" != 404 ]; then
    echo "Sentinel Vault extension route must return HTTP 404, received $extension_status" >&2
    exit 1
  fi
done
