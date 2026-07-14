// Web deps branch: `bun install` -> node_modules. Own bake target (like builder-deps), cached only
// in the selected builder's local content store. No Rust target is merged into this lineage.
target "web-deps" {
  context    = "."
  dockerfile = "nook-app/docker/toolchain.Dockerfile"
  target     = "web-deps"
  platforms  = ["linux/amd64"]
  contexts = {
    web-base = "target:web-base"
  }
}
