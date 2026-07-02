// Final image assembly: COPY artifacts from the parallel package builders into one image.
// Declares its own builder dependencies as contexts (like every package bake file), so the
// wiring lives next to docker/toolchain.Dockerfile. The root docker-bake.hcl only adds the
// publish variants (toolchain / -ci / -push) that inherit this and set tags/output.
// cache-from comes from shared_cache_from in the root docker-bake.hcl (platform is always amd64).

target "_toolchain-common" {
  context    = "."
  dockerfile = "docker/toolchain.Dockerfile"
  target     = "toolchain"
  platforms  = ["linux/amd64"]
  contexts = {
    toolchain-web = "target:toolchain-web"
    builder-deps  = "target:builder-deps"
    builder-debug = "target:builder-debug"
    builder-wasm  = "target:builder-wasm"
  }
  cache-from = shared_cache_from
}
