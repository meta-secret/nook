// nook-web image: the toolchain base with workspace SOURCE copied in. This is the image `task`
// runs against at runtime (no bind mount). Declares its own contexts next to nook-app/nook-web/Dockerfile,
// like every other package bake file. nook-app/docker-bake.hcl adds the loadable `nook-web` variant.
// cache-from comes from shared_cache_from in nook-app/docker-bake.hcl (platform is always amd64).

variable "VITE_BASE" {
  default = "/"
}

target "_nook-web-common" {
  context    = "."
  dockerfile = "nook-app/nook-web/Dockerfile"
  target     = "nook-web"
  platforms  = ["linux/amd64"]
  args = {
    VITE_BASE = VITE_BASE
  }
  contexts = {
    toolchain = "target:toolchain"
  }
  cache-from = shared_cache_from
}
