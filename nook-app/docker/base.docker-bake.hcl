// Independent Rust/WASM and web/e2e bases. BuildKit prepares both branches in parallel, and the
// final web image consumes only web-base plus small artifacts copied from builder-wasm.
// Each branch is cached independently in the selected builder's local content store.

target "rust-base" {
  context    = "."
  dockerfile = "nook-app/docker/base.Dockerfile"
  target     = "rust-base"
  platforms  = ["linux/amd64"]
}

target "web-base" {
  context    = "."
  dockerfile = "nook-app/docker/base.Dockerfile"
  target     = "web-base"
  platforms  = ["linux/amd64"]
}

target "web-e2e-base" {
  context    = "."
  dockerfile = "nook-app/docker/base.Dockerfile"
  target     = "web-e2e-base"
  platforms  = ["linux/amd64"]
}
