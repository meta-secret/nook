// nook-web image: the toolchain base with workspace SOURCE copied in. This is the image `task`
// runs against at runtime (no bind mount). Declares its own contexts next to docker/nook-web.Dockerfile,
// like every other package bake file. The root docker-bake.hcl adds the loadable `nook-web` variant.
// cache-from comes from shared_cache_from in the root docker-bake.hcl (platform is always amd64).

variable "VITE_BASE" {
  default = "/"
}

target "_nook-web-common" {
  context    = "."
  dockerfile = "docker/nook-web.Dockerfile"
  target     = "nook-web"
  platforms  = ["linux/amd64"]
  args = {
    VITE_BASE = VITE_BASE
  }
  contexts = {
    toolchain    = "target:toolchain"
    builder-wasm = "target:builder-wasm"
  }
  cache-from = shared_cache_from
}
