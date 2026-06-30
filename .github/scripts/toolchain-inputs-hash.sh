#!/usr/bin/env bash
# Fingerprint toolchain dependency inputs (not repo source). Used to decide whether
# GHCR :latest is still valid for PR CI (web-only PRs skip rebuild when this matches).
set -euo pipefail

ROOT="${1:-.}"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

{
  printf '%s\n' "$(sha256_file "${ROOT}/Dockerfile")"
  printf '%s\n' "$(sha256_file "${ROOT}/Cargo.lock")"
  printf '%s\n' "$(sha256_file "${ROOT}/nook-web/package.json")"
  printf '%s\n' "$(sha256_file "${ROOT}/nook-web/bun.lock")"
} | {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}
