// nook-wasm build target: wasm32 clippy + release build + wasm-pack bundle.
// LINEAR CHAIN: FROM builder-debug (native warm-up), so wasm target/ + wasm pkg accumulate in the
// same image lineage (no COPY --from of target/). cache-from/to come from shared_cache_* in the
// root docker-bake.hcl (platform is always amd64).

target "builder-wasm" {
  context    = "."
  dockerfile = "nook-wasm/Dockerfile"
  target     = "builder-wasm"
  platforms  = ["linux/amd64"]
  contexts = {
    builder-debug = "target:builder-debug"
  }
  cache-from = shared_cache_from
  cache-to   = shared_cache_to
}
