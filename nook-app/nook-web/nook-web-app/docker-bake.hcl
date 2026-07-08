// nook-web image: the toolchain base with workspace SOURCE copied in. This is the image `task`
// runs against at runtime (no bind mount). Declares its own contexts next to nook-app/nook-web/nook-web-app/Dockerfile,
// like every other package bake file. nook-app/docker-bake.hcl adds the loadable `nook-web` variant.
// cache-from comes from shared_cache_from in nook-app/docker-bake.hcl (platform is always amd64).

variable "VITE_BASE" {
  default = "/"
}

variable "VITE_SITE_URL" {
  default = ""
}

variable "VITE_PUBLIC_APP_URL" {
  default = ""
}

target "_nook-web-common" {
  context    = "."
  dockerfile = "nook-app/nook-web/nook-web-app/Dockerfile"
  target     = "nook-web"
  platforms  = ["linux/amd64"]
  args = {
    VITE_BASE           = VITE_BASE
    VITE_SITE_URL       = VITE_SITE_URL
    VITE_PUBLIC_APP_URL = VITE_PUBLIC_APP_URL
  }
  contexts = {
    toolchain = "target:toolchain"
  }
  cache-from = shared_cache_from
}
