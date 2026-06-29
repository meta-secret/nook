variable "DOCKER_IMAGE" {
  default = "nook-build:local"
}

// ghcr.io/<owner>/<repo>/toolchain — shared remote cache (pull before build, push after green CI).
variable "TOOLCHAIN_REGISTRY" {
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

target "toolchain" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "toolchain"
  platforms  = ["linux/amd64"]
  tags = TOOLCHAIN_REGISTRY != "" ? [
    DOCKER_IMAGE,
    "${TOOLCHAIN_REGISTRY}:latest",
  ] : [DOCKER_IMAGE]
  output = ["type=docker"]
  cache-from = TOOLCHAIN_REGISTRY != "" ? [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache",
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:latest",
  ] : []
  cache-to = TOOLCHAIN_REGISTRY != "" ? [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache,mode=max",
  ] : []
}

// Push :latest via buildx (reuses buildcache blobs — seconds when layers unchanged).
// Do not use `docker push` after `--load`; the daemon re-uploads layers buildkit already has in GHCR.
target "toolchain-push" {
  inherits = ["toolchain"]
  tags = TOOLCHAIN_REGISTRY != "" ? [
    "${TOOLCHAIN_REGISTRY}:latest",
  ] : []
  output   = ["type=registry"]
  cache-to = []
}

// Cursor SDK ci-agent + docker/gh/git — extends toolchain via a named build context.
// CI: pull GHCR :latest (buildx container driver cannot use daemon-only tags).
// Dev: bake builds toolchain target inside buildkit (target:toolchain).
target "cursor-agent" {
  context    = "."
  dockerfile = "Dockerfile.cursor-agent"
  platforms  = ["linux/amd64"]
  contexts = {
    toolchain = TOOLCHAIN_REGISTRY != "" ? "docker-image://${TOOLCHAIN_REGISTRY}:latest" : "target:toolchain"
  }
  tags   = ["nook-cursor-agent:local"]
  output = ["type=docker"]
}
