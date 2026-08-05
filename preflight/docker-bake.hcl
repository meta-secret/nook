// Standalone preflight Bake targets. Callers merge rust-base via:
//   -f nook-app/docker-bake.hcl
//   -f nook-app/docker/rust.docker-bake.hcl
//   -f preflight/docker-bake.hcl

target "_preflight-common" {
  inherits   = ["_sccache"]
  context    = "."
  dockerfile = "preflight/Dockerfile"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-base = "target:rust-base"
  }
}

target "preflight-test" {
  inherits = ["_preflight-common"]
  target   = "test"
  output   = ["type=cacheonly"]
}

target "preflight-cli-export" {
  inherits = ["_preflight-common"]
  target   = "cli-export"
}
