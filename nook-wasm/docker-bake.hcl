// nook-wasm build target: wasm32 clippy + release build + wasm-pack bundle.
// Consumes the chef-cooked `builder-deps` from nook-core; runs in parallel with builder-debug.
// cache-from/to come from shared_cache_* in the root docker-bake.hcl (platform is always amd64).

target "builder-wasm" {
  context    = "."
  dockerfile = "nook-wasm/Dockerfile"
  target     = "builder-wasm"
  platforms  = ["linux/amd64"]
  contexts = {
    nook-base    = "target:nook-base"
    builder-deps = "target:builder-deps"
  }
  cache-from = shared_cache_from
  cache-to   = shared_cache_to
}
