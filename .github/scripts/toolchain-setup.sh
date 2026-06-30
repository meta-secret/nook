#!/usr/bin/env bash
# Resolve the CI/dev toolchain image: pull GHCR :latest when inputs match, else bake.
# CI runs containers from the registry ref (no buildx --load). Local dev loads nook-build:local.
set -euo pipefail

ROOT="${1:-.}"
DOCKER="${DOCKER:-docker}"
REG="${TOOLCHAIN_REGISTRY:-}"
ENV="${NOOK_ENV:-dev}"
LOCAL_IMAGE="nook-build:local"
STATE_DIR="${ROOT}/.nook"
IMAGE_STATE="${STATE_DIR}/docker-image"

mkdir -p "${STATE_DIR}"

compute_hash() {
  bash "${ROOT}/.github/scripts/toolchain-inputs-hash.sh" "${ROOT}"
}

write_image_ref() {
  local ref="$1"
  printf '%s\n' "$ref" > "${IMAGE_STATE}"
  if [ -n "${GITHUB_ENV:-}" ]; then
    echo "DOCKER_IMAGE=${ref}" >> "${GITHUB_ENV}"
  fi
  echo "==> Using toolchain image: ${ref}"
}

if [ "${ENV}" = "dev" ]; then
  if [ -f "${IMAGE_STATE}" ] && ${DOCKER} image inspect "$(cat "${IMAGE_STATE}")" >/dev/null 2>&1; then
    write_image_ref "$(cat "${IMAGE_STATE}")"
    echo "==> Toolchain image present; skipping setup (NOOK_ENV=dev)."
    exit 0
  fi
  if ${DOCKER} image inspect "${LOCAL_IMAGE}" >/dev/null 2>&1; then
    write_image_ref "${LOCAL_IMAGE}"
    echo "==> Toolchain image present; skipping setup (NOOK_ENV=dev)."
    exit 0
  fi
  echo "==> Building toolchain (NOOK_ENV=dev) ..."
  TOOLCHAIN_REGISTRY="${REG}" TOOLCHAIN_INPUTS_HASH="$(compute_hash)" \
    ${DOCKER} buildx bake -f "${ROOT}/docker-bake.hcl" toolchain
  write_image_ref "${LOCAL_IMAGE}"
  exit 0
fi

if [ -z "${REG}" ]; then
  echo "error: TOOLCHAIN_REGISTRY is required when NOOK_ENV=ci" >&2
  exit 1
fi

HASH="$(compute_hash)"
echo "==> Toolchain inputs hash: ${HASH}"

if ${DOCKER} pull "${REG}:latest" >/dev/null 2>&1; then
  REMOTE_HASH="$(${DOCKER} inspect --format='{{index .Config.Labels "nook.toolchain.inputs-hash"}}' "${REG}:latest" 2>/dev/null || true)"
  if [ "${REMOTE_HASH}" = "${HASH}" ] && [ -n "${REMOTE_HASH}" ]; then
    write_image_ref "${REG}:latest"
    echo "==> Pulled matching GHCR :latest; skipping bake (toolchain inputs unchanged)."
    echo "    Mounted workspace source is compiled fresh inside the container."
    exit 0
  fi
  echo "==> GHCR :latest label mismatch (remote=${REMOTE_HASH:-none}); rebuilding."
else
  echo "==> GHCR :latest unavailable; building toolchain."
fi

echo "==> Building toolchain to registry (NOOK_ENV=ci, no --load) ..."
TOOLCHAIN_REGISTRY="${REG}" TOOLCHAIN_INPUTS_HASH="${HASH}" \
  ${DOCKER} buildx bake -f "${ROOT}/docker-bake.hcl" toolchain-ci

write_image_ref "${REG}:ci"
