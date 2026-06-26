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
  // :latest is the runnable image; :buildcache holds intermediate layers (cargo chef cook, etc.).
  cache-from = TOOLCHAIN_REGISTRY != "" ? [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache",
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:latest",
  ] : []
  cache-to = TOOLCHAIN_REGISTRY != "" ? [
    "type=registry,ref=${TOOLCHAIN_REGISTRY}:buildcache,mode=max",
  ] : []
}

// Regenerate recipe.json after Cargo.toml / Cargo.lock dependency changes.
target "generate-recipe" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "recipe-output"
  platforms  = ["linux/amd64"]
  output     = ["type=local,dest=."]
}
