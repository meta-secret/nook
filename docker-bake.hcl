variable "DOCKER_IMAGE" {
  default = "nook-build:local"
}

variable "CACHE_REGISTRY" {
  default = ""
}

// Set PUSH_CACHE=1 in CI to push deps cache images (builder-*:cache tags).
variable "PUSH_CACHE" {
  default = ""
}

// Legacy single cache ref (toolchain:latest); kept for local backward compatibility.
variable "CACHE_FROM" {
  default = ""
}

variable "CACHE_TO" {
  default = ""
}

group "default" {
  targets = ["toolchain"]
}

group "setup" {
  targets = ["builder-debug-cache", "builder-wasm-cache", "toolchain"]
}

// Pre-compiled debug/test deps (cargo chef cook --tests). Pushed as builder-debug:cache in CI.
target "builder-debug-cache" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "builder-debug"
  tags       = CACHE_REGISTRY != "" ? ["${CACHE_REGISTRY}/builder-debug:cache"] : []
  output     = PUSH_CACHE != "" ? ["type=registry"] : ["type=cacheonly"]
  cache-from = concat(
    CACHE_REGISTRY != "" ? ["type=registry,ref=${CACHE_REGISTRY}/builder-debug:cache"] : [],
    CACHE_FROM != "" ? [CACHE_FROM] : [],
  )
}

// Pre-compiled wasm32 release deps for nook-wasm. Pushed as builder-wasm:cache in CI.
target "builder-wasm-cache" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "builder-wasm"
  tags       = CACHE_REGISTRY != "" ? ["${CACHE_REGISTRY}/builder-wasm:cache"] : []
  output     = PUSH_CACHE != "" ? ["type=registry"] : ["type=cacheonly"]
  depends_on = ["builder-debug-cache"]
  cache-from = concat(
    CACHE_REGISTRY != "" ? [
      "type=registry,ref=${CACHE_REGISTRY}/builder-wasm:cache",
      "type=registry,ref=${CACHE_REGISTRY}/builder-debug:cache",
    ] : [],
    CACHE_FROM != "" ? [CACHE_FROM] : [],
  )
}

target "toolchain" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "toolchain"
  tags       = [DOCKER_IMAGE]
  output     = ["type=docker"]
  depends_on = ["builder-wasm-cache"]
  cache-from = concat(
    CACHE_REGISTRY != "" ? [
      "type=registry,ref=${CACHE_REGISTRY}/builder-debug:cache",
      "type=registry,ref=${CACHE_REGISTRY}/builder-wasm:cache",
      "type=registry,ref=${CACHE_REGISTRY}:latest",
    ] : [],
    CACHE_FROM != "" ? [CACHE_FROM] : [],
  )
  cache-to = CACHE_TO != "" ? [CACHE_TO] : []
}

// Regenerate recipe.json after Cargo.toml / Cargo.lock dependency changes.
target "generate-recipe" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "recipe-output"
  output     = ["type=local,dest=."]
}
