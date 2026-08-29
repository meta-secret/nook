#!/usr/bin/env bash
set -euo pipefail

repo_root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
prepare_trusted_docker() {
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
  if [ -e "$docker_config_source/contexts" ]; then
    cp -RP -- "$docker_config_source/contexts" "$trusted_docker_config/contexts"
    if find "$trusted_docker_config/contexts" -type l -print -quit | grep -q .; then
      echo "Docker contexts must not contain symlinks" >&2
      exit 2
    fi
  fi
  if [ -f "$docker_config_source/config.json" ]; then
    if [ -x /usr/local/bin/jq ]; then jq_cli=/usr/local/bin/jq
    elif [ -x /usr/bin/jq ]; then jq_cli=/usr/bin/jq
    elif [ -x /opt/homebrew/bin/jq ]; then jq_cli=/opt/homebrew/bin/jq
    else
      echo "trusted jq is unavailable" >&2
      exit 127
    fi
    "$jq_cli" 'if any(keys[]; explode | any(. > 127)) then error("non-ASCII Docker config key") else with_entries(select((.key | ascii_downcase) != "clipluginsextradirs")) end' \
      "$docker_config_source/config.json" >"$trusted_docker_config/config.json"
    chmod 600 "$trusted_docker_config/config.json"
  fi
  export DOCKER_CONFIG="$trusted_docker_config"
  export BUILDX_CONFIG="$trusted_docker_config/buildx"
}
cache_scope="${GHA_RUST_WASM_DEPS_SCOPE:?missing GHA_RUST_WASM_DEPS_SCOPE}"
deps_fingerprint="${NOOK_RUST_DEPS_INPUT_FINGERPRINT:?missing NOOK_RUST_DEPS_INPUT_FINGERPRINT}"
sccache_mode="${SCCACHE_S3_MODE:-external}"
sccache_endpoint="${SCCACHE_ENDPOINT:-https://sccache.dev.nokey.sh}"
sccache_bucket="${SCCACHE_BUCKET:-nook-sccache}"
registry_host="${NOOK_REGISTRY_CACHE_HOST:-registry.dev.nokey.sh}"
cache_ref="${registry_host}/nook/buildcache/${cache_scope}:buildcache"

bake_args=(
  --allow="fs.read=$repo_root"
  -f "$repo_root/nook-app/docker-bake.hcl"
  -f "$repo_root/nook-app/nook-platform/docker/rust/docker-bake.hcl"
  -f "$repo_root/nook-app/nook-web/docker/web.docker-bake.hcl"
  -f "$repo_root/nook-app/nook-platform/nook-core/docker-bake.hcl"
  -f "$repo_root/nook-app/nook-platform/nook-wasm/docker-bake.hcl"
  -f "$repo_root/nook-app/nook-web/docker/toolchain.docker-bake.hcl"
  -f "$repo_root/nook-app/nook-web/nook-web-app/docker-bake.hcl"
  --set "*.context=$repo_root"
  --set "*.args.SCCACHE_S3_MODE=$sccache_mode"
  --set "*.args.SCCACHE_ENDPOINT=$sccache_endpoint"
  --set "*.args.SCCACHE_BUCKET=$sccache_bucket"
)

if [ -r "${SCCACHE_S3_ACCESS_KEY_FILE:-}" ] \
  && [ -r "${SCCACHE_S3_SECRET_KEY_FILE:-}" ]; then
  bake_args+=(
    --allow="fs.read=${SCCACHE_S3_ACCESS_KEY_FILE}"
    --allow="fs.read=${SCCACHE_S3_SECRET_KEY_FILE}"
    --set "*.secrets=id=sccache_s3_access_key,src=${SCCACHE_S3_ACCESS_KEY_FILE}"
    --set "*.secrets+=id=sccache_s3_secret_key,src=${SCCACHE_S3_SECRET_KEY_FILE}"
  )
fi

if [ "${NOOK_WASM_CACHE_PROMOTION_ENABLED:-}" = "1" ]; then
  if [ "${GITHUB_ACTIONS:-}" != "true" ] \
    || [ "${GITHUB_EVENT_NAME:-}" != "push" ] \
    || [ "${GITHUB_REF:-}" != "refs/heads/main" ]; then
    echo "portable WASM cache promotion is restricted to trusted Main pushes" >&2
    exit 2
  fi
  prepare_trusted_docker
  builder="${NOOK_PR_BUILDX_BUILDER:-}"
  case "$builder" in
    ''|nook-pr|*[!a-zA-Z0-9_.-]*)
      echo "ARC requires a valid job-scoped remote BuildKit builder" >&2
      exit 2
      ;;
  esac
  promotion_wrapper=()
  case "${NOOK_BUILDKIT_REMOTE:-}" in
    1)
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
      "$docker_cli" buildx use "$builder"
      ;;
    '')
      promotion_wrapper=("$repo_root/.github/scripts/with-healthy-buildkit.sh")
      ;;
    *)
      echo "NOOK_BUILDKIT_REMOTE must be 1 or unset" >&2
      exit 2
      ;;
  esac
  # Publish from the already-selected node-local rootless BuildKit shard. A
  # repair solve never imports the ref it is replacing: independent input and
  # source refs may accelerate it, while a miss rebuilds from source.
  "${promotion_wrapper[@]}" "$docker_cli" buildx bake \
    --progress=plain \
    "${bake_args[@]}" \
    --set "builder-wasm-deps-cache-proof.output=type=cacheonly" \
    --set "builder-wasm-deps-cache-proof.cache-to=type=registry,ref=${cache_ref},mode=max,compression=zstd,force-compression=true,timeout=10m" \
    --set "builder-wasm-deps-cache-proof.cache-from=type=registry,ref=${registry_host}/nook/remote-buildcache/nook-rust-wasm-deps-input-v3:fingerprint-${deps_fingerprint},ignore-error=true" \
    --set "builder-wasm-deps-cache-proof.cache-from+=type=registry,ref=${registry_host}/nook/buildcache/nook-rust-wasm-source-v3:buildcache,ignore-error=true" \
    builder-wasm-deps-cache-proof
fi

bun "$repo_root/.github/scripts/verify-registry-cache-blobs.ts" "$cache_ref"
echo "verified ARC-published WASM dependency cache blob integrity for $cache_scope"
