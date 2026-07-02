// toolchain target: the LINEAR TOP of the build chain (docker/toolchain.Dockerfile).
// FROM builder-wasm, adding bun deps + Playwright on top. No merge/COPY --from — the whole
// toolchain (deps, warm native+wasm target/, wasm pkg, node_modules, playwright) is one continuous
// image lineage. This is the base for the sealed nook-web image (nook-web/Dockerfile).
// The root docker-bake.hcl adds the output/publish variants (toolchain / -cache / -push).
// cache-from/to come from shared_cache_* in the root docker-bake.hcl (platform is always amd64).

target "_toolchain-common" {
  context    = "."
  dockerfile = "docker/toolchain.Dockerfile"
  target     = "toolchain"
  platforms  = ["linux/amd64"]
  contexts = {
    builder-wasm = "target:builder-wasm"
  }
  cache-from = shared_cache_from
}
