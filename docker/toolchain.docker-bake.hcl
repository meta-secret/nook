// Web deps branch: `bun install` -> node_modules. Own bake target (like builder-deps) so its layers
// are exported to GHCR :buildcache via cache-to — an inline stage inside `toolchain` was not cached
// across identical CI re-runs because only named targets with cache-to publish their layers.
target "web-deps" {
  context    = "."
  dockerfile = "docker/toolchain.Dockerfile"
  target     = "web-deps"
  platforms  = ["linux/amd64"]
  contexts = {
    nook-base = "target:nook-base"
  }
  cache-from = shared_cache_from
  cache-to   = shared_cache_to
}

// toolchain target: merges the two PARALLEL branches (docker/toolchain.Dockerfile).
//   - web-deps  (FROM nook-base): `bun install` -> node_modules, built concurrently with the rust chain.
//   - toolchain (FROM builder-wasm): rust lineage (target/ + wasm pkg in place) + COPY node_modules.
// Both branches share nook-base, so bake injects nook-base, builder-wasm, and the pre-built web-deps
// image (see web-deps target above). This is the base for the sealed nook-web image.
// The root docker-bake.hcl adds the output/publish variants (toolchain / -cache / -push).
// cache-from/to come from shared_cache_* in the root docker-bake.hcl (platform is always amd64).

target "_toolchain-common" {
  context    = "."
  dockerfile = "docker/toolchain.Dockerfile"
  target     = "toolchain"
  platforms  = ["linux/amd64"]
  contexts = {
    nook-base    = "target:nook-base"
    builder-wasm = "target:builder-wasm"
    web-deps     = "target:web-deps"
  }
  cache-from = shared_cache_from
}
