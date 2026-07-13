// Web deps branch: `bun install` -> node_modules. Own bake target (like builder-deps) so its layers
// are exported to the independent web cache refs. No Rust target is merged into this lineage.
target "web-deps" {
  context    = "."
  dockerfile = "nook-app/docker/toolchain.Dockerfile"
  target     = "web-deps"
  platforms  = ["linux/amd64"]
  contexts = {
    web-base = "target:web-base"
  }
  cache-from = web_cache_from
  cache-to   = web_cache_to
}
