// Slim nook-web image: web base + dependencies + host-exported WASM/coverage + workspace source.
// This is the image `task` runs against at runtime (no bind mount). Declares its own contexts next to nook-app/nook-web/nook-web-app/Dockerfile,
// like every other package bake file. nook-app/docker-bake.hcl adds the loadable `nook-web` variant.
// The selected builder caches this linux/amd64 lineage locally and in the matching hosted GHA scope.

variable "VITE_BASE" {
  default = "/"
}

variable "VITE_SITE_URL" {
  default = ""
}

variable "VITE_PUBLIC_APP_URL" {
  default = ""
}

variable "NOOK_SIMPLE_VAULT_URL" {
  default = "https://simple.nokey.sh/"
}

variable "VITE_SIMPLE_APP_URL" {
  default = ""
}

variable "VITE_SENTINEL_APP_URL" {
  default = ""
}

variable "NOOK_EXTENSION_CHANNEL" {
  default = "production"
}

variable "NOOK_EXTENSION_VERSION" {
  default = "1.0.0"
}

variable "NOOK_EXTENSION_COMMIT" {
  default = ""
}

variable "NOOK_EXTENSION_SITE_URL" {
  default = "https://nokey.sh/"
}

// Set by `task setup` to the commit-scoped, invocation-isolated directory exported by the
// web-artifacts target. The default keeps `bake --print` usable; a direct nook-web build without the
// prepare phase fails on the missing /nook-wasm artifact instead of silently using stale generated
// code.
variable "WEB_ARTIFACTS_CONTEXT" {
  default = "."
}

target "_nook-web-base" {
  context    = "."
  dockerfile = "nook-app/nook-web/nook-web-app/Dockerfile"
  platforms  = ["linux/amd64"]
  args = {
    VITE_BASE               = VITE_BASE
    VITE_SITE_URL           = VITE_SITE_URL
    VITE_PUBLIC_APP_URL     = VITE_PUBLIC_APP_URL
    NOOK_SIMPLE_VAULT_URL   = NOOK_SIMPLE_VAULT_URL
    VITE_SIMPLE_APP_URL     = VITE_SIMPLE_APP_URL
    VITE_SENTINEL_APP_URL   = VITE_SENTINEL_APP_URL
    NOOK_EXTENSION_CHANNEL  = NOOK_EXTENSION_CHANNEL
    NOOK_EXTENSION_VERSION  = NOOK_EXTENSION_VERSION
    NOOK_EXTENSION_COMMIT   = NOOK_EXTENSION_COMMIT
    NOOK_EXTENSION_SITE_URL = NOOK_EXTENSION_SITE_URL
  }
  contexts = {
    web-base      = "target:web-base"
    web-deps      = "target:web-deps"
    web-artifacts = WEB_ARTIFACTS_CONTEXT
  }
}

target "_nook-web-common" {
  inherits = ["_nook-web-base"]
  target   = "nook-web"
}

target "_nook-web-ci-common" {
  inherits = ["_nook-web-base"]
  target   = "nook-web-ci"
}
