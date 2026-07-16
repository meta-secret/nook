#!/usr/bin/env bash

set -euo pipefail

docker_bin="${DOCKER:-docker}"

if [ -n "${SCCACHE_REDIS_HOST_IP:-}" ]; then
  host_ip="$SCCACHE_REDIS_HOST_IP"
elif [ "$(uname -s)" = Darwin ]; then
  redis_image="${SCCACHE_REDIS_IMAGE:-redis:8.2.2-alpine}"
  host_ip="$({
    "$docker_bin" run --rm "$redis_image" sh -c 'ping -4 -c 1 host.docker.internal'
  } | awk -F '[()]' '/^PING / { host_ip = $2 } END { print host_ip }')"
else
  host_ip="$("$docker_bin" network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')"
fi

case "$host_ip" in
  ''|*[!0-9.]*)
    echo "unable to resolve a numeric Docker host IPv4 address" >&2
    exit 1
    ;;
esac

printf '%s\n' "$host_ip"
