// toolchain target: merges the two PARALLEL branches (docker/toolchain.Dockerfile).
//   - web-deps  (FROM nook-base): `bun install` -> node_modules, built concurrently with the rust chain.
//   - toolchain (FROM builder-wasm): rust lineage (target/ + wasm pkg in place) + COPY node_modules.
// Both branches share nook-base, so bake injects both nook-base (for the web-deps branch) and
// builder-wasm (the rust lineage the merge is FROM). This is the base for the sealed nook-web image.
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
  }
  cache-from = shared_cache_from
}
