// Shared toolchain base (rust, bun, task, mold, wasm-pack, llvm-cov).
// Every package builder and the final image consume it via
// `contexts = { nook-base = "target:nook-base" }`.
// cache-from/to come from shared_cache_* in nook-app/docker-bake.hcl (platform is always amd64).

target "nook-base" {
  context    = "."
  dockerfile = "nook-app/docker/base.Dockerfile"
  target     = "nook-base"
  platforms  = ["linux/amd64"]
  cache-from = shared_cache_from
  cache-to   = shared_cache_to
}
