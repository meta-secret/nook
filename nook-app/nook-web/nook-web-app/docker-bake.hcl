// Slim nook-web image: web base + dependencies + host-exported WASM/coverage + workspace source.
// This is the image `task` runs against at runtime (no bind mount). Declares its own contexts next to nook-app/nook-web/nook-web-app/Dockerfile,
// like every other package bake file. nook-app/docker-bake.hcl adds the loadable `nook-web` variant.
// The selected builder's local content store caches this linux/amd64 lineage.

variable "VITE_BASE" {
  default = "/"
}

variable "VITE_SITE_URL" {
  default = ""
}

variable "VITE_PUBLIC_APP_URL" {
  default = ""
}

// Set by `task setup` to the commit-scoped, invocation-isolated directory exported by the
// web-artifacts target. The default keeps `bake --print` usable; a direct nook-web build without the
// prepare phase fails on the missing /nook-wasm artifact instead of silently using stale generated
// code.
variable "WEB_ARTIFACTS_CONTEXT" {
  default = "."
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
    web-base      = "target:web-base"
    web-deps      = "target:web-deps"
    web-artifacts = WEB_ARTIFACTS_CONTEXT
  }
}
