#!/usr/bin/env bash

# Select and health-check ARC's remote BuildKit client. This entrypoint may
# build or export through the Kubernetes BuildKit service, but it never owns a
# container runtime or daemon lifecycle.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

builder="${NOOK_PR_BUILDX_BUILDER:-}"
health_timeout="${NOOK_BUILDKIT_HEALTH_TIMEOUT_SECONDS:-60}"
if [ -x /usr/local/bin/docker ]; then docker_cli=/usr/local/bin/docker
elif [ -x /usr/bin/docker ]; then docker_cli=/usr/bin/docker
elif [ -x /opt/homebrew/bin/docker ]; then docker_cli=/opt/homebrew/bin/docker
else
  echo "trusted Docker CLI is unavailable" >&2
  exit 127
fi
if [ -x /usr/local/lib/docker/cli-plugins/docker-buildx ]; then buildx_cli=/usr/local/lib/docker/cli-plugins/docker-buildx
elif [ -x /usr/local/libexec/docker/cli-plugins/docker-buildx ]; then buildx_cli=/usr/local/libexec/docker/cli-plugins/docker-buildx
elif [ -x /usr/lib/docker/cli-plugins/docker-buildx ]; then buildx_cli=/usr/lib/docker/cli-plugins/docker-buildx
elif [ -x /usr/libexec/docker/cli-plugins/docker-buildx ]; then buildx_cli=/usr/libexec/docker/cli-plugins/docker-buildx
elif [ -x /opt/homebrew/lib/docker/cli-plugins/docker-buildx ]; then buildx_cli=/opt/homebrew/lib/docker/cli-plugins/docker-buildx
elif [ -x /Applications/Docker.app/Contents/Resources/cli-plugins/docker-buildx ]; then buildx_cli=/Applications/Docker.app/Contents/Resources/cli-plugins/docker-buildx
else
  echo "trusted Docker Buildx plugin is unavailable" >&2
  exit 127
fi
docker_config_source="${DOCKER_CONFIG:-${HOME:?HOME is required when DOCKER_CONFIG is unset}/.docker}"
case "$docker_config_source" in
  /*) ;;
  *)
    echo "Docker config path must be absolute" >&2
    exit 2
    ;;
esac
trusted_docker_config="$(mktemp -d "${TMPDIR:-/tmp}/nook-docker-config.XXXXXX")"
chmod 700 "$trusted_docker_config"
mkdir -m 700 "$trusted_docker_config/cli-plugins"
ln -s "$buildx_cli" "$trusted_docker_config/cli-plugins/docker-buildx"
cleanup_docker_config() {
  rm -rf -- "$trusted_docker_config"
}
trap cleanup_docker_config EXIT
for entry in contexts; do
  if [ -e "$docker_config_source/$entry" ]; then
    cp -RL "$docker_config_source/$entry" "$trusted_docker_config/$entry"
  fi
done
if [ -f "$docker_config_source/config.json" ]; then
  if [ -x /usr/local/bin/jq ]; then jq_cli=/usr/local/bin/jq
  elif [ -x /usr/bin/jq ]; then jq_cli=/usr/bin/jq
  elif [ -x /opt/homebrew/bin/jq ]; then jq_cli=/opt/homebrew/bin/jq
  else
    echo "trusted jq is unavailable" >&2
    exit 127
  fi
  "$jq_cli" 'with_entries(select((.key | ascii_downcase) != "clipluginsextradirs"))' \
    "$docker_config_source/config.json" >"$trusted_docker_config/config.json"
  chmod 600 "$trusted_docker_config/config.json"
fi
export DOCKER_CONFIG="$trusted_docker_config"
export BUILDX_CONFIG="$trusted_docker_config/buildx"

case "$builder" in
  ''|nook-pr|*[!a-zA-Z0-9_.-]*)
    echo "ARC requires a valid job-scoped remote BuildKit builder" >&2
    exit 2
    ;;
esac

case "$health_timeout" in
  ''|*[!0-9]*|0)
    echo "BuildKit health timeout must be a positive whole number" >&2
    exit 2
    ;;
esac

case "${NOOK_BUILDKIT_ADDR:-}" in
  tcp://nook-buildkit.arc-runners.svc.cluster.local:1234) ;;
  *)
    echo "ARC BuildKit address must be tcp://nook-buildkit.arc-runners.svc.cluster.local:1234" >&2
    exit 2
    ;;
esac
mkdir -m 700 -p "$BUILDX_CONFIG/instances"
printf '{"Name":"%s","Driver":"remote","Nodes":[{"Name":"%s0","Endpoint":"%s","Platforms":null,"DriverOpts":null,"Flags":null,"Files":null}],"Dynamic":false}\n' \
  "$builder" "$builder" "$NOOK_BUILDKIT_ADDR" >"$BUILDX_CONFIG/instances/$builder"
chmod 600 "$BUILDX_CONFIG/instances/$builder"

probe_context="$(mktemp -d "${TMPDIR:-/tmp}/nook-remote-buildkit-probe.XXXXXX")"
printf 'FROM scratch\n' > "$probe_context/Dockerfile"

cleanup() {
  rm -rf "$probe_context"
  rm -rf -- "$trusted_docker_config"
}
trap cleanup EXIT

run_with_timeout() {
  local timeout_seconds="$1"
  shift

  set -m
  "$@" &
  local command_pid=$!
  set +m
  local deadline=$((SECONDS + timeout_seconds))

  while kill -0 "$command_pid" 2>/dev/null; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      kill -TERM -- "-$command_pid" 2>/dev/null || true
      sleep 2
      kill -KILL -- "-$command_pid" 2>/dev/null || true
      wait "$command_pid" 2>/dev/null || true
      return 124
    fi
    sleep 1
  done

  local status=0
  wait "$command_pid" || status=$?
  return "$status"
}

probe_remote_builder() {
  "$docker_cli" buildx inspect "$builder" --bootstrap >/dev/null 2>&1 \
    && "$docker_cli" buildx build \
      --builder "$builder" \
      --file "$probe_context/Dockerfile" \
      --output type=cacheonly \
      --progress=quiet \
      "$probe_context" >/dev/null 2>&1
}

probe_status=0
run_with_timeout "$health_timeout" probe_remote_builder || probe_status=$?
if [ "$probe_status" -ne 0 ]; then
  if [ "$probe_status" -eq 124 ]; then
    echo "ARC remote BuildKit builder $builder did not respond within ${health_timeout}s" >&2
  else
    echo "ARC remote BuildKit builder $builder is missing or unhealthy" >&2
  fi
  echo "refusing hosted or local daemon recovery from an ARC Pod" >&2
  exit "$probe_status"
fi

echo "Using healthy ARC remote BuildKit builder $builder" >&2
"$docker_cli" buildx use "$builder"
DOCKER="$docker_cli" "$@"
