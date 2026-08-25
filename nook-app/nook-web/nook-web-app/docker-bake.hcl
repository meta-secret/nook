// Slim nook-web image: web base + dependencies + host-exported WASM/coverage + workspace source.
// This is the image `task` runs against at runtime (no bind mount). Declares contexts and
// loadable tags next to nook-app/nook-web/nook-web-app/Dockerfile.
// Hosted Zot cache scopes for final images live in nook-web/docker/web.docker-bake.hcl.

variable "DOCKER_IMAGE" {
  default = "nook-web:local"
}

variable "DOCKER_E2E_IMAGE" {
  default = "nook-web-e2e:local"
}

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
    NOOK_SOURCE_REVISION    = NOOK_EXTENSION_COMMIT
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

target "_nook-web-focused-common" {
  inherits = ["_nook-web-base"]
  target   = "nook-web-source"
}

// Default: build the nook-web image (source-in-image) that `task` runs.
group "default" {
  targets = ["nook-web"]
}

target "nook-web" {
  inherits   = ["_nook-web-common"]
  tags       = [DOCKER_IMAGE]
  output     = ["type=docker"]
  cache-from = web_cache_from
  cache-to   = web_cache_to
}

// PR CI joins production builds with the sibling lint/check/test stage.
target "nook-web-ci" {
  inherits   = ["_nook-web-ci-common"]
  tags       = [DOCKER_IMAGE]
  output     = ["type=docker"]
  cache-from = web_cache_from
  cache-to   = web_cache_to
}

target "nook-web-deploy-artifacts" {
  inherits = ["_nook-web-base"]
  target   = "nook-web-deploy-artifacts"
  output   = ["type=cacheonly"]
  cache-from = web_cache_from
}

# Main/manual-e2e image. Same sealed app as nook-web, Chromium base swapped in.
# Tag as DOCKER_IMAGE too so deploy/extract tasks consume the already-tested image.
target "nook-web-e2e" {
  inherits = ["_nook-web-common"]
  contexts = {
    web-base = "target:web-e2e-base"
  }
  tags       = [DOCKER_IMAGE, DOCKER_E2E_IMAGE]
  output     = ["type=docker"]
  cache-from = web_e2e_cache_from
}

// Explicit writer for the browser-image scope. Validation uses nook-web-e2e
// read-only; a successful producer invokes this cache-only target afterward.
target "nook-web-e2e-publish" {
  inherits = ["_nook-web-common"]
  contexts = {
    web-base = "target:web-e2e-base"
  }
  output     = ["type=cacheonly"]
  cache-from = web_e2e_cache_from
  cache-to   = web_e2e_cache_to
}

// Focused web/type-check tasks stop at the sealed source image.
target "nook-web-focused" {
  inherits   = ["_nook-web-focused-common"]
  tags       = [DOCKER_IMAGE]
  output     = ["type=docker"]
  cache-from = web_cache_from
  cache-to   = web_cache_to
}
