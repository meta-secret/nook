// Web deps branch: `bun install` -> node_modules. Own bake target (like builder-deps), cached in the
// selected builder locally and in its own GHA scope on hosted CI. No Rust target is merged here.
target "web-deps" {
  context    = "."
  dockerfile = "nook-app/docker/toolchain.Dockerfile"
  target     = "web-deps"
  platforms  = ["linux/amd64"]
  contexts = {
    web-base = "target:web-base"
  }
  cache-from = web_deps_cache_from
  cache-to   = web_deps_cache_to
}
