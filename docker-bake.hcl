variable "DOCKER_IMAGE" {
  default = "nook-build:local"
}

// ghcr.io/<owner>/<repo>/toolchain — shared remote cache (pull before build, push after green CI).
variable "TOOLCHAIN_REGISTRY" {
  default = ""
}

// Set by toolchain-setup.sh; stored on :latest after green CI for pull-skip on web-only PRs.
variable "TOOLCHAIN_INPUTS_HASH" {
  default = ""
}

group "default" {
  targets = ["toolchain"]
}

// Pre-build parallel rust stages explicitly so cold CI can fan out native + wasm tracks.
group "rust-builders" {
  targets = ["builder-debug", "builder-wasm"]
}

target "builder-deps" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "builder-deps"
  platforms  = ["linux/amd64"]
  cache-from = TOOLCHAIN_REGISTRY != "" ? [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache",
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:latest",
  ] : []
  cache-to = TOOLCHAIN_REGISTRY != "" ? [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache,mode=max",
  ] : []
}

target "builder-debug" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "builder-debug"
  platforms  = ["linux/amd64"]
  cache-from = TOOLCHAIN_REGISTRY != "" ? [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache",
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:latest",
  ] : []
  cache-to = TOOLCHAIN_REGISTRY != "" ? [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache,mode=max",
  ] : []
}

target "builder-wasm" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "builder-wasm"
  platforms  = ["linux/amd64"]
  cache-from = TOOLCHAIN_REGISTRY != "" ? [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache",
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:latest",
  ] : []
  cache-to = TOOLCHAIN_REGISTRY != "" ? [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache,mode=max",
  ] : []
}

target "_toolchain-common" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "toolchain"
  platforms  = ["linux/amd64"]
  labels = TOOLCHAIN_INPUTS_HASH != "" ? {
    "nook.toolchain.inputs-hash" = TOOLCHAIN_INPUTS_HASH
  } : {}
  cache-from = TOOLCHAIN_REGISTRY != "" ? [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache",
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:latest",
  ] : []
}

// Local dev: load into the Docker daemon as nook-build:local.
target "toolchain" {
  inherits = ["_toolchain-common"]
  tags = TOOLCHAIN_REGISTRY != "" ? [
    DOCKER_IMAGE,
    "${TOOLCHAIN_REGISTRY}:latest",
  ] : [DOCKER_IMAGE]
  output = ["type=docker"]
  cache-to = TOOLCHAIN_REGISTRY != "" ? [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache,mode=max",
  ] : []
}

// CI pre-verify build: push to :ci (registry only — no --load export).
target "toolchain-ci" {
  inherits = ["_toolchain-common"]
  tags = TOOLCHAIN_REGISTRY != "" ? [
    "${TOOLCHAIN_REGISTRY}:ci",
  ] : []
  output = ["type=registry"]
  cache-to = TOOLCHAIN_REGISTRY != "" ? [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache,mode=max",
  ] : []
}

// After green CI: promote verified image to :latest (reuses buildcache blobs — seconds).
// Do not use `docker push` after `--load`; the daemon re-uploads layers buildkit already has in GHCR.
target "toolchain-push" {
  inherits = ["_toolchain-common"]
  tags = TOOLCHAIN_REGISTRY != "" ? [
    "${TOOLCHAIN_REGISTRY}:latest",
  ] : []
  output   = ["type=registry"]
  cache-to = []
}
