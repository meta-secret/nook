// nook-web build target: bun deps + Playwright chromium. Independent of the rust chain;
// also the base image for the final toolchain (see docker/toolchain.Dockerfile).
// cache-from/to come from shared_cache_* in the root docker-bake.hcl (platform is always amd64).

target "toolchain-web" {
  context    = "."
  dockerfile = "nook-web/Dockerfile"
  target     = "toolchain-web"
  platforms  = ["linux/amd64"]
  contexts = {
    nook-base = "target:nook-base"
  }
  cache-from = shared_cache_from
  cache-to   = shared_cache_to
}
